"""Coinbase Exchange public market data (no key): real best bid/ask for crypto.

REST:  /products/{id}/ticker, /products/{id}/stats, /products/{id}/candles
WS:    wss://ws-feed.exchange.coinbase.com  channel "ticker"
24h change uses Coinbase's rolling open_24h, as the Coinbase app does.
Some networks block Coinbase DNS; the service then falls back to Finnhub/Yahoo.
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import List

from app.market_data.cache import CircuitBreaker
from app.market_data.providers import ProviderError, host_reachable, http
from app.market_data.quotes import make_quote

REST_URL = "https://api.exchange.coinbase.com"
WS_URL = "wss://ws-feed.exchange.coinbase.com"
SOURCE = "Coinbase"

breaker = CircuitBreaker(threshold=2, cooldown=300)


def enabled() -> bool:
    return os.getenv("COINBASE_ENABLED", "1") not in ("0", "false", "False")


def iso_ts(s: str) -> float:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def parse_ticker_message(msg: dict) -> dict:
    """WS 'ticker' message -> normalised quote."""
    return make_quote(msg["product_id"], "crypto", last=msg.get("price"), bid=msg.get("best_bid"),
                      ask=msg.get("best_ask"), prev_close=msg.get("open_24h"), open_=msg.get("open_24h"),
                      high=msg.get("high_24h"), low=msg.get("low_24h"), volume=msg.get("volume_24h"),
                      ts=iso_ts(msg["time"]) if msg.get("time") else None, source=SOURCE)


def parse_rest(symbol: str, ticker: dict, stats: dict) -> dict:
    return make_quote(symbol, "crypto", last=ticker.get("price"), bid=ticker.get("bid"), ask=ticker.get("ask"),
                      prev_close=stats.get("open"), open_=stats.get("open"), high=stats.get("high"),
                      low=stats.get("low"), volume=stats.get("volume"),
                      ts=iso_ts(ticker["time"]) if ticker.get("time") else None, source=SOURCE)


async def _get(path: str, **params):
    if not enabled():
        raise ProviderError("Coinbase disabled")
    if not breaker.available:
        raise ProviderError("Coinbase temporarily unavailable")
    if not await host_reachable("api.exchange.coinbase.com"):
        raise ProviderError("Coinbase host not reachable from this network (DNS)")
    try:
        res = await http().get(f"{REST_URL}{path}", params=params or None)
    except Exception as exc:
        breaker.fail()
        raise ProviderError(f"Coinbase request failed: {type(exc).__name__}: {exc!r}") from exc
    if res.status_code != 200:
        breaker.fail()
        raise ProviderError(f"Coinbase HTTP {res.status_code}")
    breaker.ok()
    return res.json()


async def fetch_quote(symbol: str) -> dict:
    ticker, stats = await asyncio.gather(_get(f"/products/{symbol}/ticker"), _get(f"/products/{symbol}/stats"))
    return parse_rest(symbol, ticker, stats)


async def fetch_candles(symbol: str, granularity: int, start: float, end: float) -> List[dict]:
    rows = await _get(f"/products/{symbol}/candles", granularity=granularity,
                      start=datetime.fromtimestamp(start, timezone.utc).isoformat(),
                      end=datetime.fromtimestamp(end, timezone.utc).isoformat())
    # [time, low, high, open, close, volume], newest first
    return [{"t": int(r[0]), "o": r[3], "h": r[2], "l": r[1], "c": r[4], "v": r[5]} for r in reversed(rows)]
