"""Short-sale locates, borrow fees and margin interest (simulated securities lending).

Locate
  * stocks/ETFs priced at $1 or more can be shorted; crypto cannot
  * easy to borrow (ETB): popular large caps and ETFs; no borrow fee
  * hard to borrow (HTB): configured high short-interest names, and every other symbol,
    with a borrow APR and a limited pool of shares shared by all accounts
Short-sale restriction (Rule 201 / SSR): when a stock is down 10% or more from the prior
close, short sales must be limit orders priced above the current bid.
Daily charges (once per day after 17:00 ET; catch up missed days)
  * borrow fee on HTB shorts: shares x price x APR / 360 per calendar day
  * margin interest accrues daily on the debit balance (tiered APR / 360) and is posted
    to the ledger monthly as `margin_interest`
"""
from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, Optional

from app.database import get_collection
from app.market_data import calendar, universe
from app.trading import ledger, margin

D = Decimal
HTB = {  # symbol: (borrow APR %, lendable shares pool)
    "GME": (D("18"), 800_000), "AMC": (D("35"), 1_500_000), "BYND": (D("55"), 400_000), "CVNA": (D("12"), 300_000),
    "UPST": (D("16"), 250_000), "MSTR": (D("6"), 500_000), "RIVN": (D("4"), 2_000_000), "LCID": (D("9"), 3_000_000),
    "PLUG": (D("14"), 1_200_000), "SMCI": (D("5"), 600_000), "SOFI": (D("3"), 2_500_000), "HOOD": (D("2.5"), 1_000_000),
    "COIN": (D("2.5"), 700_000), "NIO": (D("6"), 2_000_000), "DKNG": (D("2"), 900_000),
}
DEFAULT_HTB_APR = D("8")
SSR_DROP_PERCENT = -10.0


def _lendable(symbol: str) -> int:
    """Deterministic pool size for symbols without configuration (10k - 500k shares)."""
    h = int(hashlib.sha256(symbol.encode()).hexdigest()[:8], 16)
    return 10_000 + h % 490_000


def shares_shorted(symbol: str) -> D:
    total = D("0")
    for p in get_collection("positions").find({"symbol": symbol, "open": True}, {"qty": 1}):
        q = D(p["qty"])
        if q < 0:
            total += -q
    return total


def locate(symbol: str, price: Optional[float] = None) -> Dict:
    item = universe.lookup(symbol)
    if not item or item["asset_class"] not in ("stock", "etf"):
        return {"symbol": symbol, "shortable": False, "reason": "Only US stocks and ETFs can be sold short."}
    if price is not None and price < 1:
        return {"symbol": symbol, "shortable": False, "reason": "Stocks priced under $1 cannot be sold short."}
    if symbol in HTB:
        apr, pool = HTB[symbol]
        etb = False
    elif item.get("rank"):
        apr, pool, etb = D("0"), None, True
    else:
        apr, pool, etb = DEFAULT_HTB_APR, _lendable(symbol), False
    available = None if pool is None else max(0, int(pool - shares_shorted(symbol)))
    return {"symbol": symbol, "shortable": etb or (available or 0) > 0, "easy_to_borrow": etb,
            "borrow_rate_apr": f"{apr:.2f}", "available_shares": available,
            "reason": None if (etb or available) else "No shares available to borrow right now."}


def ssr_active(quote: Optional[Dict]) -> bool:
    if not quote:
        return False
    cp = quote.get("change_percent")
    return cp is not None and cp <= SSR_DROP_PERCENT


# ------------------------------------------------------------------ daily charges
def _cents(x: D) -> int:
    return int((x * 100).quantize(D("1"), rounding=ROUND_HALF_UP))


def charge_user(user: Dict, through: date) -> Dict:
    """Accrue/post interest and borrow fees for one user up to and including `through`."""
    uid = str(user["_id"])
    last = user.get("charges_through")
    start = (date.fromisoformat(last) + timedelta(days=1)) if last else through
    if start > through:
        return {"days": 0}
    days = (through - start).days + 1
    out = {"days": days, "interest": D("0"), "borrow": D("0")}
    # --- borrow fees on hard-to-borrow shorts
    from app.trading import positions as positions_mod
    for p in positions_mod.col().find({"user_id": uid, "open": True, "asset_class": {"$in": ["stock", "etf"]}}):
        qty = D(p["qty"])
        if qty >= 0:
            continue
        info = locate(p["symbol"])
        apr = D(info.get("borrow_rate_apr") or "0") / 100
        if apr <= 0:
            continue
        fee = (-qty) * margin.mark_for(p) * apr / 360 * days
        cents = _cents(fee)
        if cents > 0:
            ledger.post(uid, type="borrow_fee", cash_delta_cents=-cents, allow_negative_cash=True,
                        idempotency_key=f"borrow:{uid}:{p['symbol']}:{p.get('bucket', 'self')}:{through}",
                        ref_type="position", ref_id=str(p["_id"]),
                        description=f"Stock borrow fee - {p['symbol']} ({info['borrow_rate_apr']}% APR, {days}d)")
            out["borrow"] += D(cents) / 100
    # --- margin interest accrual (daily) and posting (monthly)
    fresh = get_collection("users").find_one({"_id": user["_id"]})
    month = through.strftime("%Y-%m")
    stored_month = fresh.get("interest_month") or month
    accrued = D(fresh.get("margin_interest_accrued") or "0")
    if stored_month != month:          # a month ended since the last run: bill it first
        _post_interest(uid, accrued, stored_month)
        accrued = D("0")
    debit = D(max(0, -int(fresh.get("cash_cents", 0)))) / 100
    accrued += margin.daily_interest(debit) * days
    out["interest"] = accrued
    if _is_month_end(through):         # bill on the last day of the month
        _post_interest(uid, accrued, month)
        accrued = D("0")
        month = (through + timedelta(days=1)).strftime("%Y-%m")
    get_collection("users").update_one({"_id": user["_id"]}, {"$set": {
        "charges_through": through.isoformat(), "interest_month": month,
        "margin_interest_accrued": str(accrued.quantize(D("0.000001")))}})
    return out


def _post_interest(uid: str, accrued: D, month: str) -> None:
    cents = _cents(accrued)
    if cents > 0:
        ledger.post(uid, type="margin_interest", cash_delta_cents=-cents, allow_negative_cash=True,
                    idempotency_key=f"margin-interest:{uid}:{month}", description=f"Margin interest - {month}")


def _is_month_end(d: date) -> bool:
    return (d + timedelta(days=1)).month != d.month


def run_daily(now: Optional[datetime] = None) -> int:
    """Charge every margin account and every account with a short position."""
    now = (now or datetime.now(calendar.NY)).astimezone(calendar.NY)
    through = now.date() if now.hour >= 17 else now.date() - timedelta(days=1)
    short_users = {p["user_id"] for p in get_collection("positions").find({"open": True}, {"user_id": 1, "qty": 1})
                   if D(p["qty"]) < 0}
    from bson import ObjectId
    users = list(get_collection("users").find({"$or": [{"account_type": "margin"},
                                                       {"_id": {"$in": [ObjectId(u) for u in short_users]}}]}))
    n = 0
    for u in users:
        if charge_user(u, through)["days"]:
            n += 1
    return n
