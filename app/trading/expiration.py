"""Options expiration processing (runs from the engine sweep).

At 16:15 ET on expiration day (or at the first sweep after it, e.g. after a restart):
  * open orders on the contract are canceled
  * long ITM by >= $0.01 is exercised with physical delivery (100 shares per contract):
      call -> buys shares at the strike (needs the cash);  put -> sells shares at the
      strike (needs the shares). Booked as: option closed at intrinsic value plus the
      stock trade at the settlement price, which nets to exactly the strike.
    If the account cannot take delivery (no cash for calls / no shares for puts), the
    contract is closed at intrinsic value instead, as brokers do to avoid exercising
    into a position the account cannot hold.
  * long OTM expires worthless (closed at $0)
  * short positions (assignment) arrive with Phase 2B.
"""
from __future__ import annotations

import asyncio
from datetime import datetime, time, timezone
from decimal import Decimal
from typing import Dict, List, Optional

from app.market_data import calendar, service
from app.trading import events, ledger, orders, positions
from app.trading import options as opt

D = Decimal
PROCESS_AT = time(16, 15)
MIN_ITM = D("0.01")


def is_due(expiry, now: Optional[datetime] = None) -> bool:
    now = (now or datetime.now(timezone.utc)).astimezone(calendar.NY)
    if expiry < now.date():
        return True
    return expiry == now.date() and now.time() >= PROCESS_AT


def due_positions(now: Optional[datetime] = None) -> List[Dict]:
    out = []
    for p in positions.col().find({"open": True, "asset_class": "option"}):
        if is_due(opt.parse_occ(p["symbol"])["expiry"], now):
            out.append(p)
    return out


def settle_position(pos: Dict, spot: float) -> List[Dict]:
    """Settle one expiring option position at the given underlying price. Sync, idempotent
    (a closed position is skipped)."""
    user_id, symbol, bucket = pos["user_id"], pos["symbol"], pos.get("bucket", "self")
    fills = []
    with orders.user_lock(user_id):
        pos = positions.get(user_id, symbol, bucket)
        if not pos or not pos.get("open"):
            return fills
        for o in orders.open_orders(symbol):
            if o["user_id"] == user_id:
                orders._finalize(o, "canceled", "contract_expired")
        qty = D(pos["qty"])
        p = opt.parse_occ(symbol)
        strike, right, root = D(str(p["strike"])), p["right"], p["root"]
        spot_d = D(str(spot)).quantize(D("0.0001"))
        intrinsic = (max(D("0"), spot_d - strike) if right == "C" else max(D("0"), strike - spot_d)).quantize(D("0.01"))
        settle_quote = {"bid": float(spot_d), "ask": float(spot_d), "last": float(spot_d), "source": "expiration"}
        if qty < 0:
            return assign_short(user_id, symbol, -qty, intrinsic, strike, right, root, bucket, settle_quote,
                                "at expiration")
        shares = qty * opt.MULTIPLIER
        if intrinsic < MIN_ITM:
            f = orders.system_fill(user_id, symbol, "sell_to_close", qty, D("0"), "expiration",
                                   f"Expired worthless (underlying ${spot_d} vs strike ${strike})", bucket=bucket)
            return [f] if f else []
        can_deliver = False
        if right == "C":
            can_deliver = ledger.get_balances(user_id)["available_cents"] >= int(strike * shares * 100)
        else:
            free = positions.open_qty(user_id, root, bucket) - orders.committed_sell_qty(user_id, root, bucket)
            can_deliver = free >= shares
        if not can_deliver:
            f = orders.system_fill(user_id, symbol, "sell_to_close", qty, intrinsic, "expiration",
                                   f"In the money at expiration; closed at intrinsic value ${intrinsic} because the "
                                   f"account could not take delivery of {shares} shares", bucket=bucket)
            return [f] if f else []
        note = f"Exercised at expiration: {'bought' if right == 'C' else 'sold'} {shares} {root} at strike ${strike}"
        f1 = orders.system_fill(user_id, symbol, "sell_to_close", qty, intrinsic, "exercise", note, bucket=bucket)
        # Stock leg at strike +/- intrinsic (= settlement price to the cent), so the pair nets to the strike.
        stock_px = strike + intrinsic if right == "C" else strike - intrinsic
        f2 = orders.system_fill(user_id, root, "buy" if right == "C" else "sell", shares, stock_px, "exercise", note,
                                quote=settle_quote, bucket=bucket)
        return [f for f in (f1, f2) if f]


def assign_short(user_id: str, symbol: str, contracts: D, intrinsic: D, strike: D, right: str, root: str,
                 bucket: str, settle_quote: Dict, when: str) -> List[Dict]:
    """Short option: expire (OTM) or assignment with physical delivery (ITM). Caller holds the lock.

    Call assigned -> you sell 100 shares per contract at the strike (from shares held, the
    rest becomes a short stock position). Put assigned -> you buy 100 shares at the strike.
    Booked as buy-to-close at intrinsic plus the stock leg at strike +/- intrinsic, which
    nets to exactly the strike.
    """
    if intrinsic < MIN_ITM:
        f = orders.system_fill(user_id, symbol, "buy_to_close", contracts, D("0"), "expiration",
                               "Expired worthless; the premium received is kept", bucket=bucket)
        return [f] if f else []
    shares = contracts * opt.MULTIPLIER
    note = f"Assigned {when}: {'sold' if right == 'C' else 'bought'} {shares} {root} at strike ${strike}"
    out = [orders.system_fill(user_id, symbol, "buy_to_close", contracts, intrinsic, "assignment", note, bucket=bucket)]
    if right == "C":
        px = strike + intrinsic
        held = max(D("0"), positions.open_qty(user_id, root, bucket))
        from_long = min(held, shares)
        if from_long > 0:
            out.append(orders.system_fill(user_id, root, "sell", from_long, px, "assignment", note,
                                          quote=settle_quote, bucket=bucket))
        if shares - from_long > 0:
            out.append(orders.system_fill(user_id, root, "sell_short", shares - from_long, px, "assignment", note,
                                          quote=settle_quote, bucket=bucket))
    else:
        out.append(orders.system_fill(user_id, root, "buy", shares, strike - intrinsic, "assignment", note,
                                      quote=settle_quote, bucket=bucket))
    events.publish(user_id, "notice", {"kind": "assignment", "message": note, "symbol": symbol})
    _notify(user_id, "Option assignment", note)
    return [f for f in out if f]


def _notify(user_id: str, title: str, message: str) -> None:
    from app.database import NOTIFICATIONS_COLLECTION, get_collection
    get_collection(NOTIFICATIONS_COLLECTION).insert_one({
        "title": title, "message": message, "notification_type": "warning", "target_type": "specific",
        "target_user_id": str(user_id), "is_dismissed": False, "created_at": datetime.utcnow(), "source": "trading"})


async def run_due(now: Optional[datetime] = None) -> int:
    due = await asyncio.to_thread(due_positions, now)
    done = 0
    for pos in due:
        root = opt.parse_occ(pos["symbol"])["root"]
        try:
            q = await service.get_quote(root)
        except Exception:
            continue  # try again on the next sweep
        spot = q.get("last") or q.get("mid")
        if spot:
            await asyncio.to_thread(settle_position, pos, spot)
            done += 1
    return done
