"""Margin calls and house liquidation.

  maintenance call  equity < maintenance requirement            due 2 trading days later (16:00 ET)
  Fed (Reg T) call  a margin fill left equity < initial requirement  due 4 trading days later
  met               automatically once the account is back in compliance
  liquidation       equity < 90% of maintenance, or a call passes its due time:
                    the position with the largest maintenance requirement is closed at
                    market (source="liquidation"), one position per pass, until compliant.
Withdrawals are blocked while a call is open (see funding.withdrawable_cents).
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Dict, List, Optional

from bson import ObjectId
from pymongo import ASCENDING

from app.database import NOTIFICATIONS_COLLECTION, get_collection
from app.market_data import calendar
from app.market_data.bus import bus
from app.trading import events, ledger, margin, positions
from app.trading import options as opt

D = Decimal
CALLS = "margin_calls"
LIQUIDATION_THRESHOLD = D("0.90")


def calls_col():
    return get_collection(CALLS)


def ensure_indexes() -> None:
    calls_col().create_index([("user_id", ASCENDING), ("status", ASCENDING)], name="user_status")


def _due(trading_days: int) -> datetime:
    d = datetime.now(calendar.NY).date()
    for _ in range(trading_days):
        d = calendar.next_trading_day(d)
    return calendar.session_times(d)["close"].astimezone(timezone.utc).replace(tzinfo=None)


def open_calls(user_id: str) -> List[Dict]:
    return list(calls_col().find({"user_id": str(user_id), "status": "open"}))


def has_open_call(user_id: str) -> bool:
    return calls_col().count_documents({"user_id": str(user_id), "status": "open"}) > 0


def _notify(user_id: str, title: str, message: str, kind: str = "margin_call") -> None:
    get_collection(NOTIFICATIONS_COLLECTION).insert_one({
        "title": title, "message": message, "notification_type": "warning", "target_type": "specific",
        "target_user_id": str(user_id), "is_dismissed": False, "created_at": datetime.utcnow(), "source": "trading"})
    events.publish(str(user_id), "notice", {"kind": kind, "title": title, "message": message})


def _issue(user_id: str, kind: str, amount: D, days: int) -> Dict:
    doc = {"_id": ObjectId(), "user_id": str(user_id), "type": kind, "status": "open",
           "amount": f"{amount:.2f}", "issued_at": datetime.utcnow(), "due_at": _due(days)}
    calls_col().insert_one(doc)
    label = "Maintenance call" if kind == "maintenance" else "Fed (Reg T) call"
    _notify(user_id, f"{label}: ${amount:,.2f} due",
            f"Your account needs ${amount:,.2f} of additional equity by "
            f"{doc['due_at'].replace(tzinfo=timezone.utc).astimezone(calendar.NY):%a %b %d, %I:%M %p ET}. "
            "Deposit funds or close positions. Positions may be liquidated if the call is not met.")
    events.publish(str(user_id), "margin_call", serialize(doc))
    return doc


def serialize(c: Dict) -> Dict:
    return {"id": str(c["_id"]), "type": c["type"], "status": c["status"], "amount": c["amount"],
            "issued_at": c["issued_at"].isoformat() + "Z", "due_at": c["due_at"].isoformat() + "Z",
            "resolved_at": c["resolved_at"].isoformat() + "Z" if c.get("resolved_at") else None,
            "resolution": c.get("resolution")}


def _resolve(call: Dict, resolution: str) -> None:
    calls_col().update_one({"_id": call["_id"], "status": "open"}, {"$set": {
        "status": "met" if resolution == "met" else "liquidated", "resolution": resolution,
        "resolved_at": datetime.utcnow()}})
    events.publish(call["user_id"], "margin_call", serialize(calls_col().find_one({"_id": call["_id"]})))


def after_fill(user_id: str) -> None:
    """Reg T: a margin fill that leaves equity under the initial requirement creates a Fed call."""
    user = ledger.ensure_account(user_id)
    if margin.account_type(user) != "margin":
        return
    st = margin.account_state(user_id)
    deficit = st.initial_req - st.equity
    if deficit > D("0.005") and not any(c["type"] == "fed" for c in open_calls(user_id)):
        _issue(user_id, "fed", deficit, 4)


def check_user(user_id: str) -> Dict:
    """Update calls and liquidate if needed. Sync; call from a worker thread."""
    from app.trading import orders
    with orders.user_lock(user_id):
        st = margin.account_state(user_id)
        calls = open_calls(user_id)
        result = {"user_id": user_id, "equity": st.equity, "maintenance": st.maint_req, "actions": []}
        # --- maintenance call
        maint_call = next((c for c in calls if c["type"] == "maintenance"), None)
        if st.maint_req > 0 and st.excess_liquidity < 0:
            if not maint_call:
                maint_call = _issue(user_id, "maintenance", -st.excess_liquidity, 2)
                result["actions"].append("maintenance_call")
            elif D(maint_call["amount"]) < -st.excess_liquidity:
                calls_col().update_one({"_id": maint_call["_id"]}, {"$set": {"amount": f"{-st.excess_liquidity:.2f}"}})
        elif maint_call:
            _resolve(maint_call, "met")
            result["actions"].append("maintenance_met")
        # --- Fed call is met once equity covers the initial requirement
        for c in calls:
            if c["type"] == "fed" and st.equity >= st.initial_req:
                _resolve(c, "met")
                result["actions"].append("fed_met")
        # --- liquidation
        now = datetime.utcnow()
        overdue = [c for c in open_calls(user_id) if c["due_at"] <= now]
        severe = st.maint_req > 0 and st.equity < st.maint_req * LIQUIDATION_THRESHOLD
        if (severe or overdue) and not _liquidation_pending(user_id):
            placed = _liquidate_one(user_id, st)
            if placed:
                result["actions"].append(f"liquidated:{placed}")
                for c in overdue:
                    _resolve(c, "liquidated")
        return result


def _liquidation_pending(user_id: str) -> bool:
    from app.trading import orders
    from app.trading.models import OPEN_STATUSES
    return orders.orders_col().count_documents({"user_id": str(user_id), "source": "liquidation",
                                                "status": {"$in": list(OPEN_STATUSES)}}) > 0


def _liquidate_one(user_id: str, st: margin.State) -> Optional[str]:
    """Close the position with the largest maintenance requirement at market."""
    from app.trading import orders
    from app.trading.models import OrderRequest
    candidates = []
    for p in positions.col().find({"user_id": str(user_id), "open": True}):
        qty = D(p["qty"])
        if p["asset_class"] == "crypto" or (p["asset_class"] == "option" and qty > 0):
            continue  # fully paid: closing them does not reduce the deficit
        mark = margin.mark_for(p)
        if p["asset_class"] == "option":
            o = opt.parse_occ(p["symbol"])
            spot = margin._spot(o["root"]) or mark
            weight = margin.naked_requirement(o["right"], D(str(o["strike"])), spot, mark, -qty)
        else:
            weight = margin.stock_requirement(p["symbol"], qty, mark)[1]
        candidates.append((weight, p))
    if not candidates:
        return None
    _, p = max(candidates, key=lambda c: c[0])
    qty = D(p["qty"])
    if p["asset_class"] == "option":
        side = "buy_to_close" if qty < 0 else "sell_to_close"
    else:
        side = "buy_to_cover" if qty < 0 else "sell"
    quote = bus.get(p["symbol"])
    if not quote:
        return None
    req = OrderRequest(client_order_id=f"liq-{uuid.uuid4()}", symbol=p["symbol"], side=side, qty=abs(qty),
                       type="market", tif="day")
    try:
        orders.place(user_id, req, quote, source="liquidation", bucket=p.get("bucket", "self"))
    except orders.OrderError as exc:
        print(f"liquidation order failed for {user_id} {p['symbol']}: {exc}")
        return None
    _notify(user_id, "Position liquidated",
            f"To meet a margin requirement, {abs(qty)} {p['symbol'].strip()} was closed at market.", "liquidation")
    return p["symbol"]


def users_to_watch() -> List[str]:
    users = {str(u["_id"]) for u in get_collection("users").find(
        {"$or": [{"account_type": "margin"}, {"cash_cents": {"$lt": 0}}]}, {"_id": 1})}
    users |= {c["user_id"] for c in calls_col().find({"status": "open"}, {"user_id": 1})}
    return sorted(users)


async def run() -> int:
    n = 0
    for uid in await asyncio.to_thread(users_to_watch):
        try:
            if not await asyncio.to_thread(lambda: positions.col().count_documents({"user_id": uid, "open": True})) \
                    and not await asyncio.to_thread(has_open_call, uid):
                continue
            await asyncio.to_thread(check_user, uid)
            n += 1
        except Exception as exc:
            print(f"risk monitor error {uid}: {exc}")
    return n
