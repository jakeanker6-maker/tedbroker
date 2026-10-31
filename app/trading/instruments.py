"""Instrument rules: quantity steps, price ticks, multipliers, trading sessions, settlement."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from typing import Optional

from app.market_data import calendar, universe
from app.trading import options as opt

D = Decimal
QTY_STEP = {"stock": D("0.000001"), "etf": D("0.000001"), "crypto": D("0.00000001"), "option": D("1")}
MIN_NOTIONAL = {"stock": D("1.00"), "etf": D("1.00"), "crypto": D("1.00"), "option": D("0")}
GTC_DAYS = 60


def asset_class_of(symbol: str) -> str:
    return universe.asset_class_of(symbol)


def multiplier(asset_class: str) -> int:
    return opt.MULTIPLIER if asset_class == "option" else 1


def round_qty(qty: Decimal, asset_class: str) -> Decimal:
    return qty.quantize(QTY_STEP[asset_class], rounding=ROUND_DOWN)


def price_tick(asset_class: str, price: float) -> Decimal:
    if asset_class == "option":
        return D("0.01")
    if asset_class == "crypto":
        return D("0.01") if price >= 1 else D("0.000001")
    return D("0.01") if price >= 1 else D("0.0001")


def round_price(price: float, asset_class: str) -> Decimal:
    """Execution prices: options to the cent, everything else to 4 dp (sub-penny fills)."""
    q = D("0.01") if asset_class == "option" else D("0.0001")
    return D(str(price)).quantize(q, rounding=ROUND_HALF_UP)


def on_tick(price: Decimal, asset_class: str) -> bool:
    tick = price_tick(asset_class, float(price))
    return (price / tick) == (price / tick).to_integral_value()


def cents(amount: Decimal) -> int:
    return int((amount * 100).quantize(D("1"), rounding=ROUND_HALF_UP))


# ------------------------------------------------------------------ sessions
def can_trade_now(asset_class: str, extended_hours: bool = False, now: Optional[datetime] = None) -> bool:
    if asset_class == "crypto":
        return True
    session = calendar.equity_session(now)
    if session == "open":
        return True
    return asset_class in ("stock", "etf") and extended_hours and session in ("pre", "post")


def stops_can_trigger(asset_class: str, now: Optional[datetime] = None) -> bool:
    """Stops trigger on regular-session prints only (crypto: always)."""
    return asset_class == "crypto" or calendar.equity_session(now) == "open"


def order_expiry(asset_class: str, tif: str, extended_hours: bool, now: Optional[datetime] = None) -> Optional[datetime]:
    now = (now or datetime.now(timezone.utc)).astimezone(calendar.NY)
    if tif == "gtc":
        return now + timedelta(days=GTC_DAYS)
    if tif in ("ioc", "fok"):
        return None
    # DAY: today's session if it has not ended yet, otherwise the next trading day.
    d = now.date()
    if calendar.is_trading_day(d):
        times = calendar.session_times(d)
        end = times["post_close"] if extended_hours else times["close"]
        if now < end:
            return end
    nxt = calendar.session_times(calendar.next_trading_day(d))
    return nxt["post_close"] if extended_hours else nxt["close"]


def settlement_time(asset_class: str, trade_time: Optional[datetime] = None) -> datetime:
    """Equities and options settle T+1 (US, since May 2024); crypto settles immediately."""
    t = (trade_time or datetime.now(timezone.utc)).astimezone(calendar.NY)
    if asset_class == "crypto":
        return t
    d = t.date()
    # a trade after the close counts as next trading day's trade
    if not calendar.is_trading_day(d) or t >= calendar.session_times(d)["close"]:
        d = calendar.next_trading_day(d)
    settle_day = calendar.next_trading_day(d)
    return calendar.session_times(settle_day)["open"]
