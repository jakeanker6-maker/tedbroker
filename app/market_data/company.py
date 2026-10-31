"""Company page data for the Trading Hub: profile, key statistics, earnings dates and news.

Sources (cached; each part fails independently and is reported as unavailable):
  profile   Finnhub /stock/profile2 (stocks); ETFs and missing profiles fall back to
            Yahoo Finance (fund/company summary, category, expense ratio, net assets)
  stats     Finnhub /stock/metric (P/E, EPS, 52-week range, beta, dividend yield, margins)
  earnings  Finnhub /calendar/earnings, one year back and one year ahead
  news      Finnhub /company-news (last 7 days); crypto uses Finnhub's crypto news category
Only http(s) links are passed to the browser.
"""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional
from urllib.parse import urlparse

from app.market_data import universe
from app.market_data.cache import TTLCache
from app.market_data.providers import ProviderError, finnhub

_cache = TTLCache(max_items=3000)
TTL = {"profile": 24 * 3600, "stats": 6 * 3600, "earnings": 6 * 3600, "news": 15 * 60}
STAT_KEYS = {
    "peTTM": "pe_ttm", "epsTTM": "eps_ttm", "52WeekHigh": "week52_high", "52WeekLow": "week52_low",
    "52WeekHighDate": "week52_high_date", "52WeekLowDate": "week52_low_date", "beta": "beta",
    "dividendYieldIndicatedAnnual": "dividend_yield", "marketCapitalization": "market_cap_millions",
    "10DayAverageTradingVolume": "avg_volume_10d_millions", "revenueGrowthTTMYoy": "revenue_growth_ttm",
    "epsGrowthTTMYoy": "eps_growth_ttm", "netProfitMarginTTM": "net_margin_ttm", "roeTTM": "roe_ttm",
    "pbAnnual": "price_to_book", "psTTM": "price_to_sales",
}


def safe_url(u) -> Optional[str]:
    try:
        p = urlparse(str(u or ""))
    except Exception:
        return None
    return str(u) if p.scheme in ("http", "https") and p.netloc else None


async def _cached(kind: str, symbol: str, fn):
    key = (kind, symbol)
    hit = _cache.get(key)
    if hit is not None:
        return hit
    try:
        val = await fn()
    except (ProviderError, asyncio.TimeoutError, Exception) as exc:  # noqa: B014
        stale = _cache.get(key, allow_stale=True)
        if stale is not None:
            return stale
        return {"available": False, "error": str(exc)[:160] or type(exc).__name__}
    _cache.set(key, val, ttl=TTL[kind])
    return val


def _yahoo_profile(symbol: str) -> Dict:
    import yfinance as yf
    info = yf.Ticker(symbol).info or {}
    return {
        "available": bool(info), "source": "Yahoo Finance",
        "name": info.get("longName") or info.get("shortName"),
        "description": (info.get("longBusinessSummary") or "")[:1500] or None,
        "industry": info.get("industry") or info.get("category"), "sector": info.get("sector"),
        "country": info.get("country"), "website": safe_url(info.get("website")),
        "employees": info.get("fullTimeEmployees"), "exchange": info.get("fullExchangeName") or info.get("exchange"),
        "fund_family": info.get("fundFamily"), "expense_ratio": info.get("netExpenseRatio") or info.get("annualReportExpenseRatio"),
        "net_assets": info.get("totalAssets") or info.get("netAssets"), "ipo": None, "logo": None,
        "market_cap": info.get("marketCap"),
    }


async def profile(symbol: str, asset_class: str) -> Dict:
    async def fetch():
        if asset_class == "stock":
            p = await finnhub.fetch_json("/stock/profile2", {"symbol": symbol})
            if p:
                out = {
                    "available": True, "source": "Finnhub", "name": p.get("name"), "industry": p.get("finnhubIndustry"),
                    "country": p.get("country"), "exchange": p.get("exchange"), "ipo": p.get("ipo"),
                    "website": safe_url(p.get("weburl")), "logo": safe_url(p.get("logo")),
                    "market_cap": (p.get("marketCapitalization") or 0) * 1_000_000 or None,
                    "shares_outstanding": (p.get("shareOutstanding") or 0) * 1_000_000 or None,
                }
                try:     # Finnhub has no business description: add Yahoo's when it answers
                    y = await asyncio.wait_for(asyncio.to_thread(_yahoo_profile, symbol), timeout=8)
                    out.update({k: y[k] for k in ("description", "sector", "employees") if y.get(k)})
                except Exception:
                    pass
                return out
        return await asyncio.wait_for(asyncio.to_thread(_yahoo_profile, symbol), timeout=10)
    return await _cached("profile", symbol, fetch)


async def stats(symbol: str) -> Dict:
    async def fetch():
        m = (await finnhub.fetch_json("/stock/metric", {"symbol": symbol, "metric": "all"})).get("metric") or {}
        out = {v: m.get(k) for k, v in STAT_KEYS.items() if m.get(k) is not None}
        return {"available": bool(out), "source": "Finnhub", **out}
    return await _cached("stats", symbol, fetch)


async def earnings(symbol: str) -> Dict:
    async def fetch():
        today = date.today()
        data = await finnhub.fetch_json("/calendar/earnings", {"symbol": symbol, "from": str(today - timedelta(days=370)),
                                                                "to": str(today + timedelta(days=370))})
        rows = sorted((r for r in data.get("earningsCalendar") or [] if r.get("symbol") == symbol), key=lambda r: r["date"])
        hour = {"bmo": "Before the open", "amc": "After the close", "dmh": "During market hours"}
        clean = [{"date": r["date"], "time": hour.get(r.get("hour") or "", ""), "quarter": r.get("quarter"),
                  "year": r.get("year"), "eps_estimate": r.get("epsEstimate"), "eps_actual": r.get("epsActual"),
                  "revenue_estimate": r.get("revenueEstimate"), "revenue_actual": r.get("revenueActual")} for r in rows]
        upcoming = [r for r in clean if r["date"] >= str(today)]
        past = [r for r in clean if r["date"] < str(today)][-4:][::-1]
        return {"available": True, "source": "Finnhub", "next": upcoming[0] if upcoming else None, "recent": past}
    return await _cached("earnings", symbol, fetch)


async def news(symbol: str, asset_class: str, limit: int = 8) -> Dict:
    async def fetch():
        if asset_class == "crypto":
            base = symbol.split("-")[0]
            items = await finnhub.fetch_json("/news", {"category": "crypto"})
            # Only headlines that name this coin; general crypto news is not this symbol's news.
            items = [n for n in items if base.lower() in (n.get("headline", "") + n.get("related", "")).lower()]
        else:
            today = date.today()
            items = await finnhub.fetch_json("/company-news", {"symbol": symbol, "from": str(today - timedelta(days=7)),
                                                                "to": str(today)})
        out = []
        for n in items or []:
            url = safe_url(n.get("url"))
            if not url or not n.get("headline"):
                continue
            out.append({"headline": str(n["headline"])[:300], "summary": str(n.get("summary") or "")[:400],
                        "source": str(n.get("source") or "")[:60], "url": url,
                        "published_at": datetime.fromtimestamp(int(n.get("datetime") or 0), tz=timezone.utc).isoformat()})
            if len(out) >= limit:
                break
        return {"available": True, "source": "Finnhub", "items": out}
    return await _cached("news", symbol, fetch)


async def company(symbol: str) -> Dict:
    sym = universe.normalize(symbol)
    d = universe.describe(sym)
    ac = d.get("asset_class")
    if ac == "option":
        raise ValueError("Company data is for stocks, ETFs and crypto, not option contracts.")
    tasks = {"profile": profile(sym, ac) if ac != "crypto" else _crypto_profile(sym, d),
             "stats": stats(sym) if ac == "stock" else _na("Key statistics are available for stocks."),
             "earnings": earnings(sym) if ac == "stock" else _na("Earnings dates are available for stocks."),
             "news": news(sym, ac)}
    results = await asyncio.gather(*tasks.values())
    return {"symbol": sym, "name": d.get("name"), "asset_class": ac, **dict(zip(tasks.keys(), results))}


async def _na(reason: str) -> Dict:
    return {"available": False, "reason": reason}


async def _crypto_profile(sym: str, d: Dict) -> Dict:
    return {"available": True, "source": "Curated symbol list", "name": d.get("name"),
            "description": f"{d.get('name') or sym} is a cryptocurrency that trades 24/7 against USD."}
