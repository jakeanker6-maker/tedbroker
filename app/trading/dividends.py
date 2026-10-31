"""Cash dividends on stock/ETF positions, and early assignment before ex-dividend dates.

  * On an ex-dividend date, positions held before that day (opened before midnight ET)
    are credited (long) or charged (short, "dividend owed") amount x shares.
    Simplification: booked on the ex-date rather than the later pay date.
  * After the close on the day before an ex-date, short ITM calls whose remaining time
    value is below the dividend are assigned early (call holders exercise to capture
    the dividend), using the same assignment booking as expiration.
Dividend data: Yahoo Finance (cached 12 h).
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, Optional

from app.market_data import calendar, service
from app.market_data.cache import TTLCache
from app.market_data.providers import yahoo
from app.trading import ledger, orders, positions
from app.trading import options as opt
from app.trading.portfolio import day_start_utc

D = Decimal
_cache = TTLCache(max_items=2000)
_ran: set = set()


async def dividend_info(symbol: str) -> Dict:
    async def load():
        return await asyncio.to_thread(yahoo.fetch_dividends, symbol)
    return await _cache.get_or_load(symbol, 12 * 3600, load)


def book_dividend(pos: Dict, amount: D, ex_date: str) -> Optional[Dict]:
    qty = D(pos["qty"])
    cents = int((abs(qty) * amount * 100).quantize(D("1"), rounding=ROUND_HALF_UP))
    if cents <= 0:
        return None
    long_side = qty > 0
    return ledger.post(
        pos["user_id"], type="dividend" if long_side else "dividend_owed",
        cash_delta_cents=cents if long_side else -cents, allow_negative_cash=not long_side,
        idempotency_key=f"div:{pos['user_id']}:{pos['symbol']}:{pos.get('bucket', 'self')}:{ex_date}",
        ref_type="position", ref_id=str(pos["_id"]),
        description=(f"Dividend {pos['symbol']} ${amount}/share x {abs(qty)}" if long_side else
                     f"Dividend owed on short {pos['symbol']} ${amount}/share x {abs(qty)}"),
        meta={"symbol": pos["symbol"], "ex_date": ex_date, "per_share": str(amount)})


async def run_ex_dates(today: Optional[date] = None) -> int:
    """Book dividends for positions whose symbol goes ex-dividend today."""
    today = today or datetime.now(calendar.NY).date()
    key = f"ex:{today}"
    if key in _ran:
        return 0
    start = day_start_utc()
    held = await asyncio.to_thread(lambda: list(positions.col().find(
        {"open": True, "asset_class": {"$in": ["stock", "etf"]}, "opened_at": {"$lt": start}})))
    n = 0
    for sym in sorted({p["symbol"] for p in held}):
        try:
            info = await dividend_info(sym)
        except Exception:
            continue
        todays = [amt for d, amt in info["history"] if d == today.isoformat()]
        if not todays:
            continue
        amount = D(str(todays[-1]))
        for p in (p for p in held if p["symbol"] == sym):
            await asyncio.to_thread(book_dividend, p, amount, today.isoformat())
            n += 1
    _ran.add(key)
    return n


async def run_early_assignment(today: Optional[date] = None) -> int:
    """After today's close: assign short ITM calls whose time value < tomorrow's dividend."""
    from app.trading.expiration import assign_short
    today = today or datetime.now(calendar.NY).date()
    key = f"early:{today}"
    if key in _ran:
        return 0
    tomorrow = calendar.next_trading_day(today).isoformat()
    shorts = await asyncio.to_thread(lambda: [p for p in positions.col().find({"open": True, "asset_class": "option"})
                                              if D(p["qty"]) < 0 and opt.parse_occ(p["symbol"])["right"] == "C"])
    n = 0
    for p in shorts:
        o = opt.parse_occ(p["symbol"])
        try:
            info = await dividend_info(o["root"])
        except Exception:
            continue
        if info.get("next_ex_date") != tomorrow or not info.get("last_amount"):
            continue
        dividend = D(str(info["last_amount"]))
        try:
            underlying = await service.get_quote(o["root"])
            option_q = await service.get_option_quote(p["symbol"])
        except Exception:
            continue
        spot = D(str(underlying["last"]))
        strike = D(str(o["strike"]))
        intrinsic = max(D("0"), spot - strike).quantize(D("0.01"))
        extrinsic = D(str(option_q.get("mid") or 0)) - intrinsic
        if intrinsic > 0 and extrinsic < dividend:
            def assign():
                with orders.user_lock(p["user_id"]):
                    fresh = positions.get(p["user_id"], p["symbol"], p.get("bucket", "self"))
                    if fresh and fresh.get("open") and D(fresh["qty"]) < 0:
                        settle = {"bid": float(spot), "ask": float(spot), "last": float(spot), "source": "assignment"}
                        assign_short(p["user_id"], p["symbol"], -D(fresh["qty"]), intrinsic, strike, "C", o["root"],
                                     p.get("bucket", "self"), settle, "early (before ex-dividend date)")
            await asyncio.to_thread(assign)
            n += 1
    _ran.add(key)
    return n


async def run_due(now: Optional[datetime] = None) -> None:
    now = (now or datetime.now(calendar.NY)).astimezone(calendar.NY)
    if not calendar.is_trading_day(now.date()):
        return
    times = calendar.session_times(now.date())
    if now >= times["pre_open"] + timedelta(hours=5):       # 09:00 ET
        await run_ex_dates(now.date())
    if now >= times["close"] + timedelta(minutes=20):       # after the expiration job
        await run_early_assignment(now.date())
