"""Normalised quote shape shared by every provider.

Free data feeds give last trades but no NBBO for US equities. When a provider has
no real bid/ask, a synthetic spread around the last price is used and the quote is
marked `spread_model="synthetic"` so the UI and the fill engine can say so.
"""
from __future__ import annotations

import time
from typing import Optional

# Half-spread in basis points by asset class when no real bid/ask is available.
SYNTHETIC_HALF_SPREAD_BPS = {"stock": 2.0, "etf": 1.0, "crypto": 5.0, "option": 150.0}
# A quote older than this is "stale" for trading purposes during an open session.
# Fills never use quotes older than this. Crypto streams continuously, but REST-polled
# fallback quotes are routinely a few seconds old, so 15 s keeps the fallback usable.
STALE_AFTER_SECONDS = {"stock": 15, "etf": 15, "crypto": 15, "option": 120}


def _f(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # drop NaN


def make_quote(symbol: str, asset_class: str, *, last=None, bid=None, ask=None, prev_close=None,
               open_=None, high=None, low=None, volume=None, ts=None, source: str,
               delayed: bool = False, **extra) -> dict:
    last, bid, ask = _f(last), _f(bid), _f(ask)
    if bid is not None and bid <= 0:
        bid = None
    if ask is not None and ask <= 0:
        ask = None
    if last is None and bid and ask:
        last = (bid + ask) / 2
    spread_model = "quoted"
    if (bid is None or ask is None or ask < bid) and last:
        half = last * SYNTHETIC_HALF_SPREAD_BPS.get(asset_class, 2.0) / 10_000
        bid, ask = last - half, last + half
        spread_model = "synthetic"
    prev = _f(prev_close)
    change = (last - prev) if (last is not None and prev) else None
    q = {
        "symbol": symbol,
        "asset_class": asset_class,
        "last": last,
        "bid": bid,
        "ask": ask,
        "mid": (bid + ask) / 2 if bid is not None and ask is not None else last,
        "prev_close": prev,
        "open": _f(open_),
        "high": _f(high),
        "low": _f(low),
        "volume": _f(volume),
        "change": change,
        "change_percent": (change / prev * 100) if change is not None else None,
        "ts": float(ts) if ts else time.time(),
        "source": source,
        "delayed": bool(delayed),
        "spread_model": spread_model,
    }
    q.update(extra)
    return q


def with_last(q: dict, last: float, ts: float, source: Optional[str] = None) -> dict:
    """Apply a trade print to an existing quote (keeps prev_close/open, extends high/low).
    When the print comes from a different source, the old quoted spread is dropped."""
    asset = q["asset_class"]
    if source and source != q["source"]:
        q = dict(q, source=source, spread_model="synthetic")
    out = make_quote(
        q["symbol"], asset, last=last,
        bid=None if q.get("spread_model") == "synthetic" else q.get("bid"),
        ask=None if q.get("spread_model") == "synthetic" else q.get("ask"),
        prev_close=q.get("prev_close"), open_=q.get("open"),
        high=max(filter(None, [q.get("high"), last])), low=min(filter(None, [q.get("low"), last])),
        volume=q.get("volume"), ts=ts, source=q["source"], delayed=q.get("delayed", False),
    )
    # A trade moves the market: re-centre a quoted spread that the trade fell outside of.
    if out["spread_model"] == "quoted" and not (out["bid"] <= last <= out["ask"]):
        return make_quote(q["symbol"], asset, last=last, prev_close=q.get("prev_close"), open_=q.get("open"),
                          high=out["high"], low=out["low"], ts=ts, source=q["source"], delayed=q.get("delayed", False))
    return out


def age_seconds(q: Optional[dict], now: Optional[float] = None) -> float:
    if not q:
        return float("inf")
    return (now or time.time()) - float(q.get("ts") or 0)


def is_stale(q: Optional[dict], now: Optional[float] = None) -> bool:
    if not q:
        return True
    return age_seconds(q, now) > STALE_AFTER_SECONDS.get(q.get("asset_class"), 15)


def public(q: dict) -> dict:
    """API shape: rounded floats, ISO timestamp alongside epoch seconds."""
    from datetime import datetime, timezone
    out = {}
    for k, v in q.items():
        if isinstance(v, float) and k not in ("ts",):
            out[k] = round(v, 6 if abs(v) < 1 else 4)
        else:
            out[k] = v
    out["as_of"] = datetime.fromtimestamp(q["ts"], tz=timezone.utc).isoformat()
    out["age_seconds"] = round(age_seconds(q), 1)
    out["stale"] = is_stale(q)
    from app.market_data import feeds  # late import: feeds imports this module
    out["feed"] = feeds.feed_state(q)
    return out
