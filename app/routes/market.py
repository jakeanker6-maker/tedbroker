"""Live market prices for the dashboard ticker tape.

Sources:
  - Finnhub quote API (stocks, Binance crypto pairs) - requires FINNHUB_API_KEY.
  - European Central Bank reference rates (daily XML, no key) - for fiat FX.
Values are cached briefly so the tape does not hit provider rate limits.
"""
import asyncio
import os
import time
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends

from app.auth import get_current_user_token

router = APIRouter(prefix="/api/market", tags=["Market"])

FINNHUB_QUOTE_URL = "https://finnhub.io/api/v1/quote"
CACHE_SECONDS = 60
PARTIAL_RETRY_SECONDS = 10

# Order and labels match the existing tape. Proxies are labelled as what they are.
TAPE = [
    {"symbol": "EUR/USD", "kind": "fx", "currency": "EUR"},
    {"symbol": "BTC/USD", "kind": "quote", "ticker": "BINANCE:BTCUSDT"},
    {"symbol": "ETH/USD", "kind": "quote", "ticker": "BINANCE:ETHUSDT"},
    {"symbol": "AAPL", "kind": "quote", "ticker": "AAPL"},
    {"symbol": "PAXG/USD", "kind": "quote", "ticker": "BINANCE:PAXGUSDT"},
    {"symbol": "SPY", "kind": "quote", "ticker": "SPY"},
    {"symbol": "GBP/USD", "kind": "fx", "currency": "GBP"},
]

_cache: dict = {"at": 0.0, "payload": None, "ttl": CACHE_SECONDS}


async def _finnhub_quote(client: httpx.AsyncClient, key: str, ticker: str) -> dict:
    try:
        res = await client.get(FINNHUB_QUOTE_URL, params={"symbol": ticker, "token": key})
        data = res.json()
        price = float(data.get("c") or 0)
        if res.status_code != 200 or price <= 0:
            return {"price": None, "change_percent": None, "as_of": None}
        ts = data.get("t")
        return {
            "price": price,
            "change_percent": float(data.get("dp")) if data.get("dp") is not None else None,
            "as_of": datetime.fromtimestamp(ts, tz=timezone.utc).isoformat() if ts else None,
        }
    except Exception:
        return {"price": None, "change_percent": None, "as_of": None}


ECB_HISTORY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml"


async def _fx_rates(client: httpx.AsyncClient, currencies: list[str]) -> dict:
    """Return {currency: {price (USD per unit), change_percent, as_of}} from ECB reference rates.

    The ECB publishes EUR-based rates (official, no key). USD per unit of currency C is
    (USD per EUR) / (C per EUR). The latest day gives the price, the day before gives the change.
    """
    import xml.etree.ElementTree as ET
    out = {c: {"price": None, "change_percent": None, "as_of": None} for c in currencies}
    try:
        res = await client.get(ECB_HISTORY_URL)
        res.raise_for_status()
        root = ET.fromstring(res.content)
    except Exception:
        return out
    days = []   # (date, {currency: rate per EUR}), newest first
    for node in root.iter():
        if node.tag.endswith("Cube") and node.get("time"):
            rates = {c.get("currency"): float(c.get("rate")) for c in node if c.get("currency")}
            days.append((node.get("time"), rates))
    days.sort(key=lambda d: d[0], reverse=True)
    if not days or "USD" not in days[0][1]:
        return out

    def usd_per(day_rates, c):
        if c == "EUR":
            return day_rates["USD"]
        if c not in day_rates:
            return None
        return day_rates["USD"] / day_rates[c]

    last_date, last_rates = days[0]
    prev_rates = days[1][1] if len(days) > 1 else None
    for c in currencies:
        price = usd_per(last_rates, c)
        if price is None:
            continue
        change = None
        if prev_rates:
            prev = usd_per(prev_rates, c)
            if prev:
                change = (price - prev) / prev * 100
        out[c] = {"price": price, "change_percent": change, "as_of": f"{last_date}T00:00:00+00:00"}
    return out


async def build_ticker() -> dict:
    key = os.getenv("FINNHUB_API_KEY", "")
    async with httpx.AsyncClient(timeout=8.0) as client:
        fx_currencies = sorted({i["currency"] for i in TAPE if i["kind"] == "fx"})
        quote_tasks = [
            _finnhub_quote(client, key, i["ticker"]) if key else asyncio.sleep(0, result={"price": None, "change_percent": None, "as_of": None})
            for i in TAPE if i["kind"] == "quote"
        ]
        quotes, fx = await asyncio.gather(
            asyncio.gather(*quote_tasks),
            _fx_rates(client, fx_currencies),
        )

    items = []
    quote_iter = iter(quotes)
    for spec in TAPE:
        if spec["kind"] == "quote":
            data = next(quote_iter)
            source = "Finnhub"
        else:
            data = fx[spec["currency"]]
            source = "ECB reference rate"
        items.append({"symbol": spec["symbol"], "source": source, **data})

    return {
        "items": items,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/ticker")
async def get_ticker(current_user: dict = Depends(get_current_user_token)):
    """Latest prices for the dashboard tape. Cached for CACHE_SECONDS."""
    now = time.time()
    if _cache["payload"] is None or now - _cache["at"] > _cache["ttl"]:
        payload = await build_ticker()
        complete = all(i["price"] is not None for i in payload["items"])
        _cache["payload"] = payload
        _cache["at"] = now
        # A partial result is retried soon instead of being cached for the full minute.
        _cache["ttl"] = CACHE_SECONDS if complete else PARTIAL_RETRY_SECONDS
    return _cache["payload"]


CATEGORY_KEYWORDS = [
    ("crypto", ("bitcoin", "crypto", "ethereum", "blockchain", "stablecoin", "altcoin", "solana", "dogecoin")),
    ("forex", ("forex", "currency", "currencies", "dollar", "euro", "yen", "sterling", "exchange rate", "eur/usd")),
    ("commodities", ("gold", "silver", "oil", "crude", "commodit", "copper", "natural gas", "opec")),
    ("stocks", ("stock", "shares", "nasdaq", "s&p", "earnings", "equity", "equities", "ipo", "dow jones")),
]


def classify_article(title: Optional[str], description: Optional[str]) -> str:
    """Assign a news category from title/description keywords. Defaults to 'markets'."""
    text = f"{title or ''} {description or ''}".lower()
    for category, words in CATEGORY_KEYWORDS:
        if any(w in text for w in words):
            return category
    return "markets"


# =====================================================================================
# Trading Hub market data (real prices; execution is simulated elsewhere)
# =====================================================================================
from fastapi import HTTPException, Query, Request  # noqa: E402

from app.market_data import calendar as market_calendar  # noqa: E402
from app.market_data import service as md  # noqa: E402
from app.market_data import universe  # noqa: E402
from app.market_data.quotes import public  # noqa: E402
from app.rate_limiter import limiter  # noqa: E402


def _symbol_or_404(raw: str, asset_class: Optional[str] = None) -> str:
    try:
        return universe.normalize(raw, asset_class)
    except (universe.UnknownSymbol, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))


def _quote_response(q: dict) -> dict:
    out = public(q)
    try:
        info = universe.describe(q["symbol"])
        out.setdefault("name", info["name"])
        out["exchange"] = info["exchange"]
    except universe.UnknownSymbol:
        pass
    if q["asset_class"] in ("stock", "etf", "option"):
        out["session"] = market_calendar.equity_session()
    else:
        out["session"] = "open"
    return out


@router.get("/status")
async def market_status(current_user: dict = Depends(get_current_user_token)):
    """US equity/options session (pre, open, post, closed) and crypto (always open)."""
    return market_calendar.market_status()


@router.get("/search")
@limiter.limit("120/minute")
async def search_symbols(request: Request, q: str = Query(..., min_length=1, max_length=40),
                         asset_class: Optional[str] = Query(None, pattern="^(stock|etf|crypto)$"),
                         limit: int = Query(15, ge=1, le=50),
                         current_user: dict = Depends(get_current_user_token)):
    return {"results": md.search(q, limit=limit, asset_class=asset_class)}


@router.get("/quote/{symbol}")
@limiter.limit("240/minute")
async def get_quote(request: Request, symbol: str, asset_class: Optional[str] = None,
                    current_user: dict = Depends(get_current_user_token)):
    sym = _symbol_or_404(symbol, asset_class)
    try:
        return _quote_response(await md.get_quote(sym))
    except md.MarketDataError as exc:
        raise HTTPException(status_code=503, detail=f"Price unavailable: {exc}")


@router.get("/quotes")
@limiter.limit("120/minute")
async def get_quotes(request: Request, symbols: str = Query(..., max_length=2000),
                     current_user: dict = Depends(get_current_user_token)):
    wanted, unknown = [], []
    for raw in symbols.split(",")[:60]:
        raw = raw.strip()
        if not raw:
            continue
        try:
            wanted.append(universe.normalize(raw))
        except (universe.UnknownSymbol, ValueError):
            unknown.append(raw)
    quotes = await md.get_quotes(wanted)
    return {"quotes": {s: _quote_response(q) for s, q in quotes.items()},
            "unavailable": [s for s in wanted if s not in quotes], "unknown": unknown}


@router.get("/option-quote")
@limiter.limit("240/minute")
async def get_option_quote(request: Request, occ: str = Query(..., description="OCC symbol, e.g. AAPL  261218C00200000"),
                           current_user: dict = Depends(get_current_user_token)):
    sym = _symbol_or_404(occ, "option")
    try:
        return _quote_response(await md.get_option_quote(sym))
    except md.MarketDataError as exc:
        raise HTTPException(status_code=503, detail=f"Option price unavailable: {exc}")


@router.get("/candles/{symbol}")
@limiter.limit("120/minute")
async def get_candles(request: Request, symbol: str, range: str = Query("1D"),
                      asset_class: Optional[str] = None,
                      current_user: dict = Depends(get_current_user_token)):
    sym = _symbol_or_404(symbol, asset_class)
    try:
        return await md.get_candles(sym, range)
    except md.MarketDataError as exc:
        raise HTTPException(status_code=503 if "Unsupported" not in str(exc) else 400, detail=str(exc))


@router.get("/options/{symbol}/expiries")
@limiter.limit("60/minute")
async def get_option_expiries(request: Request, symbol: str, current_user: dict = Depends(get_current_user_token)):
    sym = _symbol_or_404(symbol)
    try:
        return {"underlying": sym, "expiries": await md.get_expiries(sym)}
    except md.MarketDataError as exc:
        raise HTTPException(status_code=400 if "only" in str(exc) else 503, detail=str(exc))


@router.get("/options/{symbol}/chain")
@limiter.limit("60/minute")
async def get_option_chain(request: Request, symbol: str, expiry: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
                           current_user: dict = Depends(get_current_user_token)):
    sym = _symbol_or_404(symbol)
    if universe.asset_class_of(sym) not in ("stock", "etf"):
        raise HTTPException(status_code=400, detail="Options are available on US stocks and ETFs only")
    try:
        chain = await md.get_chain(sym, expiry)
    except md.MarketDataError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    chain = dict(chain)
    chain["underlying_quote"] = _quote_response(chain["underlying_quote"])
    return chain


@router.get("/feeds")
async def feed_status(current_user: dict = Depends(get_current_user_token)):
    """Diagnostics: which upstream feeds are connected."""
    from app.market_data import feeds
    out = feeds.manager.status() if feeds.manager else {"running": False}
    out["recent_provider_errors"] = dict(list(md.provider_errors.items())[-20:])
    return out


# ------------------------------------------------------------------ screener + company page
from app.market_data import company as company_data  # noqa: E402
from app.market_data import screener as screener_mod  # noqa: E402


@router.get("/screener/options")
async def screener_options(current_user: dict = Depends(get_current_user_token)):
    return {"sectors": screener_mod.SECTORS, "sorts": list(screener_mod.SORTS), "max_page": screener_mod.MAX_PAGE}


@router.get("/screener")
@limiter.limit("30/minute")
async def run_screener(
    request: Request,
    sector: Optional[str] = Query(None, description="Comma-separated Yahoo sectors"),
    market_cap_min: Optional[float] = Query(None, ge=0), market_cap_max: Optional[float] = Query(None, ge=0),
    price_min: Optional[float] = Query(None, ge=0), price_max: Optional[float] = Query(None, ge=0),
    change_min: Optional[float] = Query(None, ge=-100, le=1000), change_max: Optional[float] = Query(None, ge=-100, le=1000),
    volume_min: Optional[float] = Query(None, ge=0),
    pe_min: Optional[float] = Query(None), pe_max: Optional[float] = Query(None),
    sort: str = Query("market_cap"), ascending: bool = False,
    limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0, le=5000),
    current_user: dict = Depends(get_current_user_token),
):
    filters = {"sectors": [s.strip() for s in sector.split(",") if s.strip()] if sector else [],
               "market_cap_min": market_cap_min, "market_cap_max": market_cap_max, "price_min": price_min,
               "price_max": price_max, "change_min": change_min, "change_max": change_max, "volume_min": volume_min,
               "pe_min": pe_min, "pe_max": pe_max, "sort": sort, "ascending": ascending}
    try:
        return await screener_mod.screen(filters, limit, offset)
    except screener_mod.ScreenerError as exc:
        raise HTTPException(status_code=exc.status, detail={"code": exc.code, "message": str(exc)})


@router.get("/company/{symbol}")
@limiter.limit("60/minute")
async def company_page(request: Request, symbol: str, current_user: dict = Depends(get_current_user_token)):
    try:
        return await company_data.company(symbol)
    except universe.UnknownSymbol as exc:
        raise HTTPException(status_code=404, detail={"code": "unknown_symbol", "message": str(exc)})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"code": "not_supported", "message": str(exc)})
