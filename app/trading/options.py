"""Equity options helpers: OCC symbols, Black-Scholes pricing, greeks, implied vol.

OCC symbol layout (21 chars): ROOT padded to 6 + YYMMDD + C/P + strike*1000 padded to 8
    "AAPL  261218C00200000"  ->  AAPL, 2026-12-18, Call, $200.00
Yahoo and many APIs use the unpadded form "AAPL261218C00200000"; both parse.
Contract multiplier is 100.
"""
from __future__ import annotations

import math
import os
import re
from datetime import date, datetime, time, timezone
from typing import Dict, Optional
from zoneinfo import ZoneInfo

MULTIPLIER = 100
NY = ZoneInfo("America/New_York")
RISK_FREE_RATE = float(os.getenv("RISK_FREE_RATE", "0.04"))  # ~3-month T-bill; config constant
_OCC = re.compile(r"^([A-Z][A-Z0-9.]{0,5})\s*(\d{2})(\d{2})(\d{2})([CP])(\d{8})$")
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# --------------------------------------------------------------------- OCC symbols
def looks_like_occ(s: str) -> bool:
    return bool(_OCC.match((s or "").strip().upper()))


def parse_occ(s: str) -> Dict:
    m = _OCC.match((s or "").strip().upper())
    if not m:
        raise ValueError(f"Not an OCC option symbol: {s!r}")
    root, yy, mm, dd, right, strike = m.groups()
    return {"root": root, "expiry": date(2000 + int(yy), int(mm), int(dd)),
            "right": right, "strike": int(strike) / 1000.0}


def format_occ(root: str, expiry: date, right: str, strike: float) -> str:
    right = right.upper()[0]
    if right not in "CP":
        raise ValueError("right must be C or P")
    return f"{root.upper():<6}{expiry:%y%m%d}{right}{int(round(strike * 1000)):08d}"


def friendly_name(s: str) -> str:
    p = parse_occ(s)
    e = p["expiry"]
    strike = f"{p['strike']:,.2f}".rstrip("0").rstrip(".")
    return f"{p['root']} {_MONTHS[e.month - 1]} {e.day} '{e:%y} ${strike} {'Call' if p['right'] == 'C' else 'Put'}"


def expiry_close(expiry: date) -> datetime:
    """Options stop trading at 16:00 ET on expiration day."""
    return datetime.combine(expiry, time(16, 0), NY)


def years_to_expiry(expiry: date, now: Optional[datetime] = None) -> float:
    now = now or datetime.now(timezone.utc)
    secs = (expiry_close(expiry) - now.astimezone(NY)).total_seconds()
    return max(secs, 0.0) / (365.0 * 24 * 3600)


def intrinsic(right: str, spot: float, strike: float) -> float:
    return max(0.0, spot - strike) if right == "C" else max(0.0, strike - spot)


# --------------------------------------------------------------------- Black-Scholes
def _ncdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _npdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def bs_price(right: str, spot: float, strike: float, t: float, vol: float,
             r: float = RISK_FREE_RATE, q: float = 0.0) -> float:
    if t <= 0 or vol <= 0 or spot <= 0 or strike <= 0:
        return intrinsic(right, spot, strike)
    st = vol * math.sqrt(t)
    d1 = (math.log(spot / strike) + (r - q + 0.5 * vol * vol) * t) / st
    d2 = d1 - st
    if right == "C":
        return spot * math.exp(-q * t) * _ncdf(d1) - strike * math.exp(-r * t) * _ncdf(d2)
    return strike * math.exp(-r * t) * _ncdf(-d2) - spot * math.exp(-q * t) * _ncdf(-d1)


def greeks(right: str, spot: float, strike: float, t: float, vol: float,
           r: float = RISK_FREE_RATE, q: float = 0.0) -> Dict[str, float]:
    """delta, gamma, theta (per calendar day), vega (per 1 vol point), rho (per 1%)."""
    if t <= 0 or vol <= 0 or spot <= 0 or strike <= 0:
        itm = intrinsic(right, spot, strike) > 0
        sign = 1.0 if right == "C" else -1.0
        return {"delta": sign if itm else 0.0, "gamma": 0.0, "theta": 0.0, "vega": 0.0, "rho": 0.0}
    st = vol * math.sqrt(t)
    d1 = (math.log(spot / strike) + (r - q + 0.5 * vol * vol) * t) / st
    d2 = d1 - st
    disc_q, disc_r = math.exp(-q * t), math.exp(-r * t)
    gamma = disc_q * _npdf(d1) / (spot * st)
    vega = spot * disc_q * _npdf(d1) * math.sqrt(t) / 100.0
    common = -spot * disc_q * _npdf(d1) * vol / (2 * math.sqrt(t))
    if right == "C":
        delta = disc_q * _ncdf(d1)
        theta = common - r * strike * disc_r * _ncdf(d2) + q * spot * disc_q * _ncdf(d1)
        rho = strike * t * disc_r * _ncdf(d2) / 100.0
    else:
        delta = -disc_q * _ncdf(-d1)
        theta = common + r * strike * disc_r * _ncdf(-d2) - q * spot * disc_q * _ncdf(-d1)
        rho = -strike * t * disc_r * _ncdf(-d2) / 100.0
    return {"delta": delta, "gamma": gamma, "theta": theta / 365.0, "vega": vega, "rho": rho}


def implied_vol(right: str, price: float, spot: float, strike: float, t: float,
                r: float = RISK_FREE_RATE, q: float = 0.0) -> Optional[float]:
    """Bisection on [0.01, 5.0]. None when the price is below intrinsic or not solvable."""
    if price <= 0 or t <= 0 or spot <= 0:
        return None
    lo, hi = 0.01, 5.0
    if price < bs_price(right, spot, strike, t, lo, r, q) - 1e-6 or price > bs_price(right, spot, strike, t, hi, r, q):
        return None
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        if bs_price(right, spot, strike, t, mid, r, q) > price:
            hi = mid
        else:
            lo = mid
        if hi - lo < 1e-6:
            break
    return 0.5 * (lo + hi)


def remark(last_mark: float, delta: float, gamma: float, d_spot: float) -> float:
    """Second-order re-price between chain refreshes so option P&L tracks the live underlying."""
    return max(0.0, last_mark + delta * d_spot + 0.5 * gamma * d_spot * d_spot)
