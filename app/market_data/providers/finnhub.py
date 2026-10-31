"""Finnhub: US stock/ETF quotes and trades, plus crypto via its Binance feed.

REST free tier: 60 calls/min (we budget 50). WebSocket free tier: ~50 symbols.
Finnhub has no free NBBO, so quotes carry a synthetic spread (see quotes.py).
Crypto uses BINANCE:<BASE>USDT; USDT is treated as USD and labelled in `source`.
"""
from __future__ import annotations

import os
from typing import Dict, Optional

from app.market_data.cache import CircuitBreaker, TokenBucket
from app.market_data.providers import ProviderError, http
from app.market_data.quotes import make_quote

REST_URL = "https://finnhub.io/api/v1"
WS_URL = "wss://ws.finnhub.io"
WS_MAX_SYMBOLS = 50

bucket = TokenBucket(rate=50 / 60, capacity=8)
breaker = CircuitBreaker(threshold=3, cooldown=60)


def api_key() -> str:
    return os.getenv("FINNHUB_API_KEY", "")


def provider_symbol(symbol: str, asset_class: str) -> str:
    if asset_class == "crypto":
        return f"BINANCE:{symbol.split('-')[0]}USDT"
    return symbol


def canonical_from_provider(psym: str) -> Optional[str]:
    if psym.startswith("BINANCE:") and psym.endswith("USDT"):
        return psym[len("BINANCE:"):-4] + "-USD"
    return psym


def source_label(asset_class: str) -> str:
    return "Finnhub (Binance USDT)" if asset_class == "crypto" else "Finnhub"


def parse_quote(symbol: str, asset_class: str, data: Dict) -> dict:
    """Finnhub /quote -> normalised quote. {"c":0} means unknown symbol."""
    if not data or not data.get("c"):
        raise ProviderError(f"Finnhub has no quote for {symbol}")
    return make_quote(symbol, asset_class, last=data["c"], prev_close=data.get("pc"), open_=data.get("o"),
                      high=data.get("h"), low=data.get("l"), ts=data.get("t"),
                      source=source_label(asset_class))


async def fetch_quote(symbol: str, asset_class: str) -> dict:
    key = api_key()
    if not key:
        raise ProviderError("FINNHUB_API_KEY not configured")
    if not breaker.available:
        raise ProviderError("Finnhub temporarily disabled after errors")
    if not await bucket.acquire(timeout=5):
        raise ProviderError("Finnhub rate budget exhausted")
    try:
        res = await http().get(f"{REST_URL}/quote", params={"symbol": provider_symbol(symbol, asset_class), "token": key})
    except Exception as exc:
        breaker.fail()
        raise ProviderError(f"Finnhub request failed: {type(exc).__name__}: {exc!r}") from exc
    if res.status_code == 429:
        breaker.fail()
        raise ProviderError("Finnhub rate limited (429)")
    if res.status_code != 200:
        breaker.fail()
        raise ProviderError(f"Finnhub HTTP {res.status_code}")
    breaker.ok()
    return parse_quote(symbol, asset_class, res.json())


async def fetch_profile(symbol: str) -> dict:
    """Company profile (name, industry, market cap, logo, weburl). Empty dict for ETFs/unknown."""
    key = api_key()
    if not key or not await bucket.acquire(timeout=5):
        return {}
    try:
        res = await http().get(f"{REST_URL}/stock/profile2", params={"symbol": symbol, "token": key})
        return res.json() if res.status_code == 200 else {}
    except Exception:
        return {}


async def fetch_json(path: str, params: Dict, timeout: float = 5):
    """Generic Finnhub REST GET within the shared rate budget. Raises ProviderError."""
    key = api_key()
    if not key:
        raise ProviderError("FINNHUB_API_KEY not configured")
    if not breaker.available:
        raise ProviderError("Finnhub temporarily disabled after errors")
    if not await bucket.acquire(timeout=timeout):
        raise ProviderError("Finnhub rate budget exhausted")
    try:
        res = await http().get(f"{REST_URL}{path}", params={**params, "token": key})
    except Exception as exc:
        breaker.fail()
        raise ProviderError(f"Finnhub request failed: {type(exc).__name__}") from exc
    if res.status_code == 429:
        breaker.fail()
        raise ProviderError("Finnhub rate limited (429)")
    if res.status_code != 200:
        raise ProviderError(f"Finnhub HTTP {res.status_code}")
    breaker.ok()
    return res.json()
