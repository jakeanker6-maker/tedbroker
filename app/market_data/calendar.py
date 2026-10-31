"""US equity market calendar (NYSE/Nasdaq). Crypto trades 24/7.

Sessions (America/New_York):
  pre     04:00 - 09:30
  regular 09:30 - 16:00   (13:00 on early-close days)
  post    16:00 - 20:00   (13:00 - 17:00 on early-close days)
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, Optional
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")

# NYSE full-day closures. Extend each year.
HOLIDAYS = {
    # 2026
    date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16), date(2026, 4, 3), date(2026, 5, 25),
    date(2026, 6, 19), date(2026, 7, 3), date(2026, 9, 7), date(2026, 11, 26), date(2026, 12, 25),
    # 2027
    date(2027, 1, 1), date(2027, 1, 18), date(2027, 2, 15), date(2027, 3, 26), date(2027, 5, 31),
    date(2027, 6, 18), date(2027, 7, 5), date(2027, 9, 6), date(2027, 11, 25), date(2027, 12, 24),
}
EARLY_CLOSES = {date(2026, 11, 27), date(2026, 12, 24), date(2027, 11, 26)}

PRE_OPEN = time(4, 0)
REGULAR_OPEN = time(9, 30)
REGULAR_CLOSE = time(16, 0)
EARLY_CLOSE = time(13, 0)
POST_CLOSE = time(20, 0)
EARLY_POST_CLOSE = time(17, 0)


def is_trading_day(d: date) -> bool:
    return d.weekday() < 5 and d not in HOLIDAYS


def _at(d: date, t: time) -> datetime:
    return datetime.combine(d, t, NY)


def session_times(d: date) -> Dict[str, datetime]:
    early = d in EARLY_CLOSES
    return {
        "pre_open": _at(d, PRE_OPEN),
        "open": _at(d, REGULAR_OPEN),
        "close": _at(d, EARLY_CLOSE if early else REGULAR_CLOSE),
        "post_close": _at(d, EARLY_POST_CLOSE if early else POST_CLOSE),
    }


def equity_session(now: Optional[datetime] = None) -> str:
    """'pre' | 'open' | 'post' | 'closed'."""
    now = (now or datetime.now(timezone.utc)).astimezone(NY)
    d = now.date()
    if not is_trading_day(d):
        return "closed"
    s = session_times(d)
    if s["pre_open"] <= now < s["open"]:
        return "pre"
    if s["open"] <= now < s["close"]:
        return "open"
    if s["close"] <= now < s["post_close"]:
        return "post"
    return "closed"


def is_regular_session(now: Optional[datetime] = None) -> bool:
    return equity_session(now) == "open"


def next_trading_day(d: date) -> date:
    d = d + timedelta(days=1)
    while not is_trading_day(d):
        d += timedelta(days=1)
    return d


def previous_trading_day(d: date) -> date:
    d = d - timedelta(days=1)
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d


def next_open(now: Optional[datetime] = None) -> datetime:
    """Next regular-session open strictly after `now` (or today's open if before it)."""
    now = (now or datetime.now(timezone.utc)).astimezone(NY)
    d = now.date()
    if is_trading_day(d) and now < session_times(d)["open"]:
        return session_times(d)["open"]
    return session_times(next_trading_day(d))["open"]


def current_or_next_close(now: Optional[datetime] = None) -> datetime:
    now = (now or datetime.now(timezone.utc)).astimezone(NY)
    d = now.date()
    if is_trading_day(d) and now < session_times(d)["close"]:
        return session_times(d)["close"]
    return session_times(next_trading_day(d))["close"]


def market_status(now: Optional[datetime] = None) -> dict:
    now = (now or datetime.now(timezone.utc)).astimezone(NY)
    session = equity_session(now)
    d = now.date()
    out = {
        "equities": session,
        "options": "open" if session == "open" else "closed",
        "crypto": "open",
        "is_trading_day": is_trading_day(d),
        "early_close": d in EARLY_CLOSES,
        "next_open": next_open(now).isoformat(),
        "next_close": current_or_next_close(now).isoformat(),
        "as_of": now.isoformat(),
        "timezone": "America/New_York",
    }
    if is_trading_day(d):
        out["today"] = {k: v.isoformat() for k, v in session_times(d).items()}
    return out
