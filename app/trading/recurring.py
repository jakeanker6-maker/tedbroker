"""Recurring investments: buy a fixed dollar amount of a stock, ETF, crypto or ETF basket on a
schedule (weekly, every two weeks or monthly), from the account's cash.

  * runs at 10:00 ET on the scheduled day; stocks/ETFs/baskets move to the next trading
    day when the market is closed that day; crypto runs any day
  * each run is one dollar-amount market order (client id `recurring-<id>-<date>`, so a
    run can never be placed twice) or one basket investment
  * not enough cash or another rejection: the run is skipped, recorded, and the user is
    notified; after 3 failures in a row the plan pauses itself
  * pause / resume / delete; editing the amount or schedule recomputes the next run
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_DOWN, Decimal, InvalidOperation
from typing import Dict, List, Optional

from bson import ObjectId
from pymongo import ASCENDING

from app.database import NOTIFICATIONS_COLLECTION, get_collection
from app.market_data import calendar, universe
from app.trading import events

D = Decimal
FREQUENCIES = ("weekly", "biweekly", "monthly")
RUN_AT = time(10, 0)
MIN_AMOUNT, MAX_AMOUNT = D("5"), D("100000")
MAX_PLANS = 25
MAX_FAILURES = 3
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


class RecurringError(Exception):
    def __init__(self, message: str, code: str = "invalid_recurring", status: int = 400):
        super().__init__(message)
        self.code, self.status = code, status


def col():
    return get_collection("recurring_investments")


def ensure_indexes() -> None:
    col().create_index([("status", ASCENDING), ("next_run", ASCENDING)], name="status_next")
    col().create_index([("user_id", ASCENDING), ("status", ASCENDING)], name="user_status")


# ---------------------------------------------------------------- scheduling
def _at(d: date) -> datetime:
    """10:00 ET on `d` as naive UTC."""
    return datetime.combine(d, RUN_AT, tzinfo=calendar.NY).astimezone(timezone.utc).replace(tzinfo=None)


def _trading(d: date, crypto: bool) -> date:
    if crypto:
        return d
    while not calendar.is_trading_day(d):
        d += timedelta(days=1)
    return d


def _add_month(d: date, day: int) -> date:
    y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    return date(y, m, min(day, 28))


def next_run(frequency: str, day: int, crypto: bool, after: datetime, anchor: Optional[date] = None) -> datetime:
    """First scheduled run strictly after `after` (naive UTC).

    weekly / biweekly: `day` is the weekday (0 = Monday); biweekly keeps a two-week rhythm
    from `anchor` (the first scheduled date). monthly: `day` is the day of month (1-28)."""
    now_ny = after.replace(tzinfo=timezone.utc).astimezone(calendar.NY)
    d = now_ny.date()
    if frequency == "monthly":
        cand = date(d.year, d.month, min(day, 28))
        while _at(_trading(cand, crypto)) <= after:
            cand = _add_month(cand, day)
        return _at(_trading(cand, crypto))
    cand = d + timedelta(days=(day - d.weekday()) % 7)
    step = 7 if frequency == "weekly" else 14
    if frequency == "biweekly" and anchor:
        while cand < anchor:
            cand += timedelta(days=7)
        if (cand - anchor).days % 14:
            cand += timedelta(days=7)
    while _at(_trading(cand, crypto)) <= after:
        cand += timedelta(days=step)
    return _at(_trading(cand, crypto))


# ---------------------------------------------------------------- CRUD
def _validate(kind: str, frequency: str, day: int, amount) -> D:
    if kind not in ("symbol", "basket"):
        raise RecurringError("Choose a stock, ETF, crypto or one of your ETF baskets.")
    if frequency not in FREQUENCIES:
        raise RecurringError("Frequency must be weekly, every two weeks or monthly.")
    if frequency == "monthly" and not 1 <= int(day) <= 28:
        raise RecurringError("Pick a day of the month between 1 and 28.")
    if frequency != "monthly" and not 0 <= int(day) <= 6:
        raise RecurringError("Pick a weekday.")
    try:
        amt = D(str(amount)).quantize(D("0.01"), rounding=ROUND_DOWN)
    except (InvalidOperation, TypeError):
        raise RecurringError("Enter an amount.", "invalid_amount")
    if not MIN_AMOUNT <= amt <= MAX_AMOUNT:
        raise RecurringError(f"The amount must be between ${MIN_AMOUNT:,.0f} and ${MAX_AMOUNT:,.0f}.", "invalid_amount")
    return amt


def create(user_id: str, kind: str, frequency: str, day: int, amount, symbol: Optional[str] = None,
           basket_id: Optional[str] = None, now: Optional[datetime] = None) -> Dict:
    uid = str(user_id)
    amt = _validate(kind, frequency, day, amount)
    if col().count_documents({"user_id": uid, "status": {"$in": ["active", "paused"]}}) >= MAX_PLANS:
        raise RecurringError(f"You can have up to {MAX_PLANS} recurring investments.", "too_many")
    target: Dict = {"kind": kind}
    if kind == "symbol":
        try:
            sym = universe.normalize(symbol or "")
        except Exception:
            raise RecurringError(f"Unknown symbol: {symbol}", "unknown_symbol", 404)
        ac = universe.asset_class_of(sym)
        if ac not in ("stock", "etf", "crypto"):
            raise RecurringError("Recurring investments support stocks, ETFs and crypto.", "unsupported")
        target.update(symbol=sym, asset_class=ac, name=universe.describe(sym).get("name") or sym)
    else:
        from app.trading import baskets
        try:
            b = baskets.get(uid, basket_id or "")
        except Exception:
            raise RecurringError("Basket not found", "not_found", 404)
        if b.get("status") != "open":
            raise RecurringError("That basket is closed.", "not_found", 404)
        target.update(basket_id=str(b["_id"]), name=b.get("name") or "ETF basket", asset_class="basket")
    now = now or datetime.utcnow()
    crypto = target["asset_class"] == "crypto"
    first = next_run(frequency, int(day), crypto, now)
    anchor = first.replace(tzinfo=timezone.utc).astimezone(calendar.NY).date()
    doc = {"_id": ObjectId(), "user_id": uid, "target": target, "amount": str(amt), "frequency": frequency,
           "day": int(day), "anchor": anchor.isoformat(), "status": "active", "next_run": first, "created_at": now,
           "updated_at": now, "last_run": None, "last_result": None, "runs": 0, "failures": 0, "invested": "0.00"}
    col().insert_one(doc)
    return doc


def get(user_id: str, plan_id: str) -> Dict:
    p = col().find_one({"_id": ObjectId(plan_id), "user_id": str(user_id), "status": {"$ne": "deleted"}}) \
        if ObjectId.is_valid(plan_id) else None
    if not p:
        raise RecurringError("Recurring investment not found", "not_found", 404)
    return p


def update(user_id: str, plan_id: str, status: Optional[str] = None, amount=None, frequency: Optional[str] = None,
           day: Optional[int] = None, now: Optional[datetime] = None) -> Dict:
    p = get(user_id, plan_id)
    now = now or datetime.utcnow()
    sets: Dict = {"updated_at": now}
    freq = frequency or p["frequency"]
    d = p["day"] if day is None else int(day)
    if amount is not None or frequency is not None or day is not None:
        sets["amount"] = str(_validate(p["target"]["kind"], freq, d, amount if amount is not None else p["amount"]))
        sets.update(frequency=freq, day=d)
    if status is not None:
        if status not in ("active", "paused"):
            raise RecurringError("Status must be active or paused.")
        sets["status"] = status
        if status == "active":
            sets["failures"] = 0
    if sets.get("status", p["status"]) == "active" and (status == "active" or "frequency" in sets):
        anchor = date.fromisoformat(p["anchor"]) if p.get("anchor") and freq == p["frequency"] and d == p["day"] else None
        sets["next_run"] = next_run(freq, d, p["target"]["asset_class"] == "crypto", now, anchor)
        if anchor is None:
            sets["anchor"] = sets["next_run"].replace(tzinfo=timezone.utc).astimezone(calendar.NY).date().isoformat()
    col().update_one({"_id": p["_id"]}, {"$set": sets})
    return col().find_one({"_id": p["_id"]})


def delete(user_id: str, plan_id: str) -> None:
    p = get(user_id, plan_id)
    col().update_one({"_id": p["_id"]}, {"$set": {"status": "deleted", "updated_at": datetime.utcnow()}})


def list_for(user_id: str) -> List[Dict]:
    return list(col().find({"user_id": str(user_id), "status": {"$in": ["active", "paused"]}}).sort("created_at", 1))


def describe(p: Dict) -> str:
    amt = f"${D(p['amount']):,.2f}"
    if p["frequency"] == "monthly":
        when = f"monthly on day {p['day']}"
    else:
        when = f"{'every' if p['frequency'] == 'weekly' else 'every other'} {WEEKDAYS[p['day']]}"
    return f"{amt} of {p['target'].get('symbol') or p['target'].get('name')} {when}"


def serialize(p: Dict) -> Dict:
    iso = lambda d: d.isoformat() + "Z" if isinstance(d, datetime) else None  # noqa: E731
    t = p["target"]
    return {"id": str(p["_id"]), "kind": t["kind"], "symbol": t.get("symbol"), "basket_id": t.get("basket_id"),
            "name": t.get("name"), "asset_class": t.get("asset_class"), "amount": p["amount"], "frequency": p["frequency"],
            "day": p["day"], "status": p["status"], "next_run": iso(p.get("next_run")), "last_run": iso(p.get("last_run")),
            "last_result": p.get("last_result"), "runs": p.get("runs", 0), "failures": p.get("failures", 0),
            "invested": p.get("invested", "0.00"), "description": describe(p)}


# ---------------------------------------------------------------- execution
def due(now: Optional[datetime] = None) -> List[Dict]:
    return list(col().find({"status": "active", "next_run": {"$lte": now or datetime.utcnow()}}))


def _notify(p: Dict, title: str, message: str) -> None:
    get_collection(NOTIFICATIONS_COLLECTION).insert_one({
        "title": title, "message": message, "notification_type": "warning", "target_type": "specific",
        "target_user_id": p["user_id"], "is_dismissed": False, "created_at": datetime.utcnow(), "source": "recurring"})
    events.publish(p["user_id"], "notice", {"kind": "recurring", "title": title, "message": message})


def run(p: Dict, quotes: Dict[str, Dict], now: Optional[datetime] = None) -> Dict:
    """Execute one due run (caller supplies fresh quotes for the target's symbols)."""
    from app.trading import baskets, orders
    from app.trading.models import OrderRequest
    now = now or datetime.utcnow()
    t = p["target"]
    run_day = p["next_run"].replace(tzinfo=timezone.utc).astimezone(calendar.NY).date().isoformat()
    amount = D(p["amount"])
    ok, msg = True, "ok"
    try:
        if t["kind"] == "symbol":
            o = orders.place(p["user_id"], OrderRequest(client_order_id=f"recurring-{p['_id']}-{run_day}", symbol=t["symbol"],
                                                        side="buy", notional=amount, type="market",
                                                        tif="gtc" if t["asset_class"] == "crypto" else "day"),
                             quotes[t["symbol"]], source="recurring")
            if o["status"] == "rejected":
                ok, msg = False, (o.get("status_history") or [{}])[-1].get("reason") or "rejected"
            else:
                msg = f"order {o['status']}"
        else:
            baskets.invest(p["user_id"], t["basket_id"], amount, quotes)
            msg = "basket invested"
    except Exception as exc:     # OrderError, basket errors, missing quote
        ok, msg = False, str(exc)[:200] or type(exc).__name__
    failures = 0 if ok else int(p.get("failures", 0)) + 1
    status = "paused" if failures >= MAX_FAILURES else p["status"]
    nxt = next_run(p["frequency"], p["day"], t["asset_class"] == "crypto", max(now, p["next_run"]),
                   date.fromisoformat(p["anchor"]) if p.get("anchor") else None)
    upd = {"$set": {"next_run": nxt, "last_run": now, "last_result": msg, "failures": failures, "status": status,
                    "updated_at": now}, "$inc": {"runs": 1}}
    res = col().update_one({"_id": p["_id"], "next_run": p["next_run"]}, upd)   # claim: one run per slot
    if res.modified_count and ok:
        col().update_one({"_id": p["_id"]}, {"$set": {"invested": f"{D(p.get('invested') or '0') + amount:.2f}"}})
    if res.modified_count and not ok:
        label = describe(p)
        _notify(p, "Recurring investment skipped" if status == "active" else "Recurring investment paused",
                f"{label}: {msg}." + (" It was paused after 3 failed runs in a row." if status == "paused" else ""))
    return {"ok": ok, "message": msg, "next_run": nxt, "status": status}


def needs_open_market(p: Dict) -> bool:
    return p["target"]["asset_class"] != "crypto"
