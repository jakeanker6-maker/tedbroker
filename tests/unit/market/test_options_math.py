from datetime import date, datetime, timezone

import pytest

from app.trading import options as opt


def test_occ_roundtrip_and_forms():
    s = opt.format_occ("AAPL", date(2026, 12, 18), "C", 200)
    assert s == "AAPL  261218C00200000" and len(s) == 21
    assert opt.parse_occ(s) == {"root": "AAPL", "expiry": date(2026, 12, 18), "right": "C", "strike": 200.0}
    assert opt.parse_occ("AAPL261218C00200000") == opt.parse_occ(s)        # Yahoo unpadded form
    assert opt.parse_occ("spy 270115p00512500")["strike"] == 512.5
    assert opt.friendly_name(s) == "AAPL Dec 18 '26 $200 Call"
    assert opt.friendly_name("SPY   270115P00512500") == "SPY Jan 15 '27 $512.5 Put"
    assert not opt.looks_like_occ("AAPL") and opt.looks_like_occ(s)
    with pytest.raises(ValueError):
        opt.parse_occ("AAPL 2612C200")


def test_black_scholes_reference_values():
    # Hull, S=100 K=100 T=1 r=5% vol=20%: call 10.4506, put 5.5735, call delta 0.6368
    c = opt.bs_price("C", 100, 100, 1.0, 0.2, r=0.05)
    p = opt.bs_price("P", 100, 100, 1.0, 0.2, r=0.05)
    assert c == pytest.approx(10.4506, abs=1e-3)
    assert p == pytest.approx(5.5735, abs=1e-3)
    g = opt.greeks("C", 100, 100, 1.0, 0.2, r=0.05)
    assert g["delta"] == pytest.approx(0.6368, abs=1e-3)
    assert g["gamma"] == pytest.approx(0.01876, abs=1e-4)
    assert g["vega"] == pytest.approx(0.3752, abs=1e-3)      # per vol point
    assert g["theta"] == pytest.approx(-6.414 / 365, abs=1e-3)  # per day


def test_put_call_parity():
    import math
    for k in (80, 100, 125):
        c = opt.bs_price("C", 100, k, 0.5, 0.35, r=0.04)
        p = opt.bs_price("P", 100, k, 0.5, 0.35, r=0.04)
        assert c - p == pytest.approx(100 - k * math.exp(-0.04 * 0.5), abs=1e-9)


def test_implied_vol_roundtrip_and_bounds():
    price = opt.bs_price("P", 50, 55, 0.25, 0.42)
    assert opt.implied_vol("P", price, 50, 55, 0.25) == pytest.approx(0.42, abs=1e-4)
    assert opt.implied_vol("C", 0.0, 50, 55, 0.25) is None
    assert opt.implied_vol("C", 60, 50, 55, 0.25) is None        # above any possible price


def test_expiry_and_intrinsic():
    assert opt.bs_price("C", 110, 100, 0, 0.3) == 10
    assert opt.greeks("P", 90, 100, 0, 0.3)["delta"] == -1.0
    now = datetime(2026, 12, 18, 21, 0, tzinfo=timezone.utc)   # 16:00 ET on expiry day
    assert opt.years_to_expiry(date(2026, 12, 18), now) == 0


def test_remark_second_order():
    assert opt.remark(5.0, 0.5, 0.04, 2.0) == pytest.approx(5.0 + 1.0 + 0.08)
    assert opt.remark(0.05, 0.1, 0.0, -10) == 0.0
