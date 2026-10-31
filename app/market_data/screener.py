"""Stock screener over the US-listed universe, using Yahoo Finance's server-side screener
(through yfinance). Filters: sector, market cap, price, % change today, volume, P/E.

Results are limited to symbols the Trading Hub can trade (`universe.normalize`), cached for
60 s per query, and protected by a circuit breaker. Data is Yahoo's (may be delayed by up to
15 minutes); rows say so.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
from typing import Dict, List, Optional

from app.market_data import universe
from app.market_data.cache import CircuitBreaker, TTLCache

EXCHANGES = ["NMS", "NGM", "NCM", "NYQ", "ASE", "PCX", "BTS"]   # Nasdaq tiers, NYSE, NYSE American, Arca, Cboe BZX
SECTORS = ["Basic Materials", "Communication Services", "Consumer Cyclical", "Consumer Defensive", "Energy",
           "Financial Services", "Healthcare", "Industrials", "Real Estate", "Technology", "Utilities"]
SORTS = {"market_cap": "intradaymarketcap", "change": "percentchange", "price": "intradayprice",
         "volume": "dayvolume", "pe": "peratio.lasttwelvemonths"}
MAX_PAGE = 100
_cache = TTLCache(max_items=200)
breaker = CircuitBreaker(threshold=3, cooldown=60)


class ScreenerError(Exception):
    def __init__(self, message: str, code: str = "screener_unavailable", status: int = 503):
        super().__init__(message)
        self.code, self.status = code, status


def build_query(f: Dict):
    """Turn validated filters into a yfinance EquityQuery."""
    from yfinance import EquityQuery as Q
    parts = [Q("eq", ["region", "us"]), Q("is-in", ["exchange", *EXCHANGES])]
    if f.get("sectors"):
        parts.append(Q("is-in", ["sector", *f["sectors"]]) if len(f["sectors"]) > 1 else Q("eq", ["sector", f["sectors"][0]]))

    def rng(field: str, lo, hi):
        if lo is not None and hi is not None:
            parts.append(Q("btwn", [field, lo, hi]))
        elif lo is not None:
            parts.append(Q("gte", [field, lo]))
        elif hi is not None:
            parts.append(Q("lte", [field, hi]))
    rng("intradaymarketcap", f.get("market_cap_min"), f.get("market_cap_max"))
    rng("intradayprice", f.get("price_min"), f.get("price_max"))
    rng("percentchange", f.get("change_min"), f.get("change_max"))
    rng("dayvolume", f.get("volume_min"), None)
    rng("peratio.lasttwelvemonths", f.get("pe_min"), f.get("pe_max"))
    return Q("and", parts)


def validate(f: Dict) -> Dict:
    out = dict(f)
    bad = [s for s in out.get("sectors") or [] if s not in SECTORS]
    if bad:
        raise ScreenerError(f"Unknown sector: {bad[0]}", "invalid_filter", 400)
    for lo, hi in (("market_cap_min", "market_cap_max"), ("price_min", "price_max"), ("change_min", "change_max"),
                   ("pe_min", "pe_max")):
        if out.get(lo) is not None and out.get(hi) is not None and out[lo] > out[hi]:
            raise ScreenerError(f"The minimum must not be above the maximum ({lo.rsplit('_', 1)[0].replace('_', ' ')}).",
                                "invalid_filter", 400)
    if out.get("sort", "market_cap") not in SORTS:
        raise ScreenerError("Unknown sort field.", "invalid_filter", 400)
    return out


def _row(x: Dict) -> Optional[Dict]:
    try:
        sym = universe.normalize(x["symbol"])
    except Exception:
        return None
    d = universe.describe(sym)
    if d.get("asset_class") not in ("stock", "etf"):
        return None
    return {
        "symbol": sym, "name": x.get("longName") or x.get("shortName") or d.get("name") or sym,
        "exchange": x.get("fullExchangeName") or x.get("exchange"),
        "price": x.get("regularMarketPrice"), "change": x.get("regularMarketChange"),
        "change_percent": x.get("regularMarketChangePercent"), "volume": x.get("regularMarketVolume"),
        "avg_volume_3m": x.get("averageDailyVolume3Month"), "market_cap": x.get("marketCap"),
        "pe": x.get("trailingPE"), "forward_pe": x.get("forwardPE"), "dividend_yield": x.get("dividendYield"),
        "week52_high": x.get("fiftyTwoWeekHigh"), "week52_low": x.get("fiftyTwoWeekLow"),
        "earnings_at": x.get("earningsTimestamp") or x.get("earningsTimestampStart"),
        "as_of": x.get("regularMarketTime"), "market_state": x.get("marketState"),
    }


def _fetch(f: Dict, limit: int, offset: int) -> Dict:
    import yfinance as yf
    res = yf.screen(build_query(f), sortField=SORTS[f.get("sort", "market_cap")], sortAsc=bool(f.get("ascending")),
                    size=limit, offset=offset)
    rows = [r for r in (_row(x) for x in res.get("quotes", [])) if r]
    return {"total": int(res.get("total") or 0), "rows": rows}


async def screen(filters: Dict, limit: int = 50, offset: int = 0) -> Dict:
    f = validate(filters)
    limit = max(1, min(limit, MAX_PAGE))
    key = hashlib.sha1(json.dumps([f, limit, offset], sort_keys=True, default=str).encode()).hexdigest()
    hit = _cache.get(key)
    if hit is not None:
        return hit
    if not breaker.available:
        raise ScreenerError("The screener's data source is busy. Try again in a minute.")
    try:
        data = await asyncio.wait_for(asyncio.to_thread(_fetch, f, limit, offset), timeout=20)
        breaker.ok()
    except ScreenerError:
        raise
    except Exception as exc:
        breaker.fail()
        raise ScreenerError(f"The screener could not load results ({type(exc).__name__}). Try again shortly.")
    out = {"filters": f, "limit": limit, "offset": offset, "total": data["total"], "rows": data["rows"],
           "source": "Yahoo Finance", "delayed": True,
           "note": "Screener data from Yahoo Finance, may be delayed up to 15 minutes. Results are US-listed stocks."}
    _cache.set(key, out, ttl=60)
    return out
