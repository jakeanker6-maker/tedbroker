from datetime import date, datetime

import pytest

from app.market_data import calendar as cal

NY = cal.NY


def at(y, m, d, hh, mm):
    return datetime(y, m, d, hh, mm, tzinfo=NY)


@pytest.mark.parametrize("when,session", [
    (at(2026, 10, 29, 3, 59), "closed"),
    (at(2026, 10, 29, 4, 0), "pre"),
    (at(2026, 10, 29, 9, 29), "pre"),
    (at(2026, 10, 29, 9, 30), "open"),
    (at(2026, 10, 29, 15, 59), "open"),
    (at(2026, 10, 29, 16, 0), "post"),
    (at(2026, 10, 29, 20, 0), "closed"),
    (at(2026, 10, 31, 12, 0), "closed"),          # Saturday
    (at(2026, 11, 26, 12, 0), "closed"),          # Thanksgiving
    (at(2026, 11, 27, 12, 59), "open"),           # early close day
    (at(2026, 11, 27, 13, 0), "post"),
    (at(2026, 11, 27, 17, 0), "closed"),
])
def test_sessions(when, session):
    assert cal.equity_session(when) == session


def test_next_open_skips_weekend_and_holidays():
    assert cal.next_open(at(2026, 10, 30, 17, 0)) == at(2026, 11, 2, 9, 30)    # Fri -> Mon
    assert cal.next_open(at(2026, 11, 25, 16, 30)) == at(2026, 11, 27, 9, 30)  # skips Thanksgiving
    assert cal.next_open(at(2026, 10, 29, 8, 0)) == at(2026, 10, 29, 9, 30)    # later today
    assert cal.next_open(at(2026, 12, 31, 18, 0)) == at(2027, 1, 4, 9, 30)     # New Year (Fri)


def test_trading_days():
    assert not cal.is_trading_day(date(2027, 7, 5))      # Independence Day observed
    assert cal.previous_trading_day(date(2026, 1, 20)) == date(2026, 1, 16)  # MLK Monday


def test_status_shape():
    s = cal.market_status(at(2026, 10, 29, 10, 0))
    assert s["equities"] == "open" and s["options"] == "open" and s["crypto"] == "open"
    assert s["next_close"].startswith("2026-10-29T16:00")
