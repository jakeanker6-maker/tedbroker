import asyncio
import time

import pytest

from app.market_data import universe
from app.market_data.bus import PriceBus
from app.market_data.cache import TokenBucket, TTLCache
from app.market_data.quotes import is_stale, make_quote, public, with_last


# ------------------------------------------------------------------ universe
@pytest.mark.parametrize("raw,ac,expected", [
    ("aapl", None, "AAPL"), ("SPY", None, "SPY"), ("btc-usd", None, "BTC-USD"), ("BTC/USD", None, "BTC-USD"),
    ("ETHUSD", None, "ETH-USD"), ("sol", None, "SOL-USD"), ("BTC", None, "BTC"), ("BTC", "crypto", "BTC-USD"),
    ("AAPL261218C00200000", None, "AAPL  261218C00200000"),
])
def test_normalize(raw, ac, expected):
    assert universe.normalize(raw, ac) == expected


def test_normalize_unknown():
    for bad in ("", "NOTAREALTICKER", "ZZZZ-USD"):
        with pytest.raises(universe.UnknownSymbol):
            universe.normalize(bad)
    with pytest.raises(universe.UnknownSymbol):
        universe.normalize("SPY", "stock")  # SPY is an ETF


def test_search_ranking():
    assert universe.search("apple")[0]["symbol"] == "AAPL"
    assert universe.search("btc")[0]["symbol"] == "BTC-USD"
    assert universe.search("SPY")[0]["symbol"] == "SPY"
    assert universe.search("nvid")[0]["symbol"] == "NVDA"
    assert all(r["asset_class"] == "etf" for r in universe.search("vanguard", asset_class="etf"))
    assert universe.search("") == []


# ------------------------------------------------------------------ quotes
def test_quote_synthetic_spread_and_change():
    q = make_quote("AAPL", "stock", last=100.0, prev_close=98.0, ts=1000, source="t")
    assert q["spread_model"] == "synthetic"
    assert q["bid"] == pytest.approx(99.98) and q["ask"] == pytest.approx(100.02)
    assert q["change"] == pytest.approx(2.0) and q["change_percent"] == pytest.approx(2.0408, abs=1e-3)


def test_quote_real_spread_and_bad_values():
    q = make_quote("BTC-USD", "crypto", last="50000", bid="49990", ask="50010", prev_close=float("nan"), source="t")
    assert q["spread_model"] == "quoted" and q["mid"] == 50000 and q["prev_close"] is None
    crossed = make_quote("X", "stock", last=10, bid=11, ask=9, source="t")
    assert crossed["spread_model"] == "synthetic"


def test_with_last_extends_range_and_recentres():
    q = make_quote("BTC-USD", "crypto", last=100, bid=99.9, ask=100.1, high=101, low=99, prev_close=95, ts=1, source="Coinbase")
    q2 = with_last(q, 102.0, 2)
    assert q2["high"] == 102 and q2["prev_close"] == 95 and q2["bid"] <= 102 <= q2["ask"]
    q3 = with_last(q, 100.0, 3, source="Finnhub (Binance USDT)")
    assert q3["source"] == "Finnhub (Binance USDT)" and q3["spread_model"] == "synthetic"


def test_staleness_and_public():
    q = make_quote("BTC-USD", "crypto", last=1, ts=time.time() - 30, source="t")
    assert is_stale(q)
    p = public(q)
    assert p["stale"] is True and p["as_of"].endswith("+00:00") and p["age_seconds"] >= 30


# ------------------------------------------------------------------ bus
async def test_bus_coalesces_and_tracks_demand():
    bus = PriceBus()
    seen = []
    bus.on_demand_change(lambda s: seen.append(set(s)))
    sub = bus.subscribe(["AAPL", "SPY"])
    assert bus.demand() == {"AAPL", "SPY"}
    for p in (1, 2, 3):
        bus.publish(make_quote("AAPL", "stock", last=p, ts=p, source="t"))
    batch = await sub.next_batch(timeout=0.1)
    assert [q["last"] for q in batch] == [3]          # only the newest
    assert await sub.next_batch(timeout=0.05) == []
    bus.publish(make_quote("AAPL", "stock", last=0.5, ts=0.5, source="t"))  # older -> ignored
    assert bus.get("AAPL")["last"] == 3
    sub2 = bus.subscribe(["AAPL"])
    assert (await sub2.next_batch(timeout=0.05))[0]["last"] == 3   # primed with latest
    sub.close()
    assert bus.demand() == {"AAPL"}
    sub2.close()
    assert bus.demand() == set() and seen[-1] == set()


# ------------------------------------------------------------------ cache
async def test_ttl_cache_single_flight_and_stale_fallback():
    cache = TTLCache()
    calls = []

    async def loader():
        calls.append(1)
        await asyncio.sleep(0.01)
        return len(calls)
    results = await asyncio.gather(*(cache.get_or_load("k", 10, loader) for _ in range(5)))
    assert results == [1] * 5 and len(calls) == 1
    cache.set("k", "old", ttl=-1)

    async def failing():
        raise RuntimeError("down")
    assert await cache.get_or_load("k", 10, failing) == "old"
    with pytest.raises(RuntimeError):
        await cache.get_or_load("missing", 10, failing)


async def test_token_bucket():
    b = TokenBucket(rate=100, capacity=2)
    assert b.try_acquire() and b.try_acquire() and not b.try_acquire()
    assert await b.acquire(timeout=1)
    slow = TokenBucket(rate=0.01, capacity=1)
    slow.try_acquire()
    assert await slow.acquire(timeout=0.05) is False
