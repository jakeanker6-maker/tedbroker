import asyncio
import json
import threading
import time
from datetime import timedelta

import pytest
from bson import ObjectId

from app.auth import create_access_token
from app.database import get_collection
from app.market_data import feeds, service
from app.market_data.quotes import make_quote
from app.routes import stream
from app.trading import events, ledger


# ------------------------------------------------------------------ feeds
def test_finnhub_trade_message_updates_bus(clean_market):
    clean_market.publish(make_quote("AAPL", "stock", last=100, prev_close=99, ts=1, source="Finnhub"))
    ws = feeds.FinnhubWS(clean_market)
    ws._map["AAPL"] = "AAPL"
    now_ms = time.time() * 1000
    ws.handle({"type": "trade", "data": [{"s": "AAPL", "p": 101, "t": now_ms - 10, "v": 1},
                                         {"s": "AAPL", "p": 102, "t": now_ms, "v": 1},
                                         {"s": "BINANCE:BTCUSDT", "p": 50000, "t": now_ms, "v": 1}]})
    aapl = clean_market.get("AAPL")
    assert aapl["last"] == 102 and aapl["prev_close"] == 99 and aapl["high"] == 102
    assert clean_market.get("BTC-USD")["source"] == "Finnhub (Binance USDT)"
    ws.handle({"type": "ping"})


def test_fresh_coinbase_quote_wins_over_binance_prints(clean_market):
    cb = make_quote("BTC-USD", "crypto", last=50000, bid=49999, ask=50001, ts=time.time(), source="Coinbase")
    clean_market.publish(cb)
    feeds.apply_trade(clean_market, "BTC-USD", 50100, time.time())
    assert clean_market.get("BTC-USD")["source"] == "Coinbase"
    stale = dict(cb, ts=time.time() - 60)
    clean_market.latest["BTC-USD"] = stale
    feeds.apply_trade(clean_market, "BTC-USD", 50100, time.time())
    assert clean_market.get("BTC-USD")["last"] == 50100


def test_manager_routes_symbols(clean_market, monkeypatch):
    m = feeds.FeedManager(clean_market)
    monkeypatch.setattr(feeds.coinbase, "enabled", lambda: True)
    m.on_demand({"AAPL", "BTC-USD", "AAPL  261218C00200000", "SPY"})
    assert m.coinbase.wanted == {"BTC-USD"}
    assert m.finnhub.wanted == {"AAPL", "SPY", "BTC-USD"}       # Coinbase not healthy yet
    assert m.poller.symbols == {"AAPL", "BTC-USD", "SPY"}        # option -> its underlying
    m.coinbase.connected, m.coinbase.last_message_at = True, time.time()
    m.assign()
    assert m.finnhub.wanted == {"AAPL", "SPY"}


def test_poller_due_oldest_snapshot_first(clean_market, monkeypatch):
    p = feeds.Poller(clean_market)
    p.symbols = {"AAPL", "SPY", "ETH-USD"}
    now = time.time()
    for s, ac in (("AAPL", "stock"), ("SPY", "etf"), ("ETH-USD", "crypto")):
        clean_market.publish(make_quote(s, ac, last=1, ts=now, source="t"))
    service._snapshot_at.update({"AAPL": now, "SPY": now - 1000, "ETH-USD": now - 400})
    assert p.due(now) == ["SPY", "ETH-USD"]


# ------------------------------------------------------------------ stream auth
def _user():
    uid = ObjectId()
    get_collection("users").insert_one({"_id": uid, "email": f"{uid}@t.io", "wallet_balance": 100.0})
    return str(uid)


def test_stream_token_flow(fresh_db, client):
    uid = _user()
    bearer = {"Authorization": "Bearer " + create_access_token({"sub": "x@t.io", "user_id": uid})}
    r = client.post("/api/stream/token", headers=bearer)
    assert r.status_code == 200 and r.json()["expires_in"] == stream.STREAM_TOKEN_TTL
    st = r.json()["token"]
    assert client.get("/api/wallet/balance", headers={"Authorization": f"Bearer {st}"}).status_code == 401
    assert stream.stream_user(st) == uid
    with pytest.raises(Exception):
        stream.stream_user(create_access_token({"sub": "x", "user_id": uid}))       # normal JWT rejected
    expired = create_access_token({"typ": "stream", "uid": uid}, expires_delta=timedelta(seconds=-1))
    assert client.get(f"/api/stream/prices?symbols=AAPL&st={expired}").status_code == 401
    assert client.get(f"/api/stream/prices?symbols=NOPE1,NOPE2&st={st}").status_code == 400


def test_parse_symbols():
    good, bad = stream.parse_symbols("aapl, btc-usd,AAPL,,nope")
    assert good == ["AAPL", "BTC-USD"] and bad == ["nope"]


class FakeRequest:
    def __init__(self, seconds):
        self.until = time.monotonic() + seconds

    async def is_disconnected(self):
        return time.monotonic() > self.until


def _events(chunks):
    out = []
    for c in chunks:
        if c.startswith("event:"):
            name, data = c.split("\n")[0][7:], json.loads(c.split("\n")[1][6:])
            out.append((name, data))
    return out


async def test_price_stream_emits_quotes_and_releases_demand(clean_market, monkeypatch):
    monkeypatch.setattr(stream, "bus", clean_market)

    async def prime(symbols):
        clean_market.publish(make_quote("AAPL", "stock", last=10, ts=time.time(), source="t"))
    monkeypatch.setattr(stream, "_prime", prime)
    chunks = []

    async def later():
        await asyncio.sleep(0.4)
        clean_market.publish(make_quote("AAPL", "stock", last=11, ts=time.time(), source="t"))
    asyncio.ensure_future(later())
    async for c in stream.price_events(FakeRequest(1.5), ["AAPL"], ["BAD"]):
        chunks.append(c)
    ev = _events(chunks)
    assert ev[0][0] == "status" and ev[1] == ("stream_error", {"message": "Unknown symbols ignored", "symbols": ["BAD"]})
    assert [d["last"] for n, d in ev if n == "quote"] == [10, 11]
    assert clean_market.demand() == set()


async def test_account_stream_receives_ledger_balance_events(fresh_db):
    uid = _user()
    events.bind_loop(asyncio.get_running_loop())
    ledger.add_listener(events.on_ledger_entry)
    chunks = []
    try:
        async def consume():
            async for c in stream.account_events(FakeRequest(1.5), uid):
                chunks.append(c)
        task = asyncio.ensure_future(consume())
        await asyncio.sleep(0.3)
        # post from another thread, as admin routes / maintenance jobs may
        t = threading.Thread(target=lambda: ledger.credit(uid, 2500, type="deposit", idempotency_key="d-sse"))
        t.start()
        t.join()
        await task
    finally:
        ledger._listeners.remove(events.on_ledger_entry)
    ev = [d for n, d in _events(chunks) if n == "balance"]
    assert ev[0]["reason"] == "snapshot" and ev[0]["cash"] == "100.00"
    assert ev[1] == {"cash": "125.00", "reserved": "0.00", "available": "125.00", "reason": "deposit",
                     "description": None}


# ------------------------------------------------------------------ REST routes
def test_market_routes(fresh_db, client, monkeypatch, clean_market):
    uid = _user()
    h = {"Authorization": "Bearer " + create_access_token({"sub": "x@t.io", "user_id": uid})}

    async def fake_quote(symbol, asset_class=None, max_age=None):
        return make_quote(symbol, "stock", last=123.45, prev_close=120, ts=time.time(), source="Finnhub")
    monkeypatch.setattr(service, "get_quote", fake_quote)
    r = client.get("/api/market/quote/aapl", headers=h)
    assert r.status_code == 200 and r.json()["last"] == 123.45 and r.json()["name"] == "Apple Inc."
    assert client.get("/api/market/quote/NOTREAL", headers=h).status_code == 404
    assert client.get("/api/market/quote/AAPL").status_code == 401
    r = client.get("/api/market/quotes?symbols=AAPL,MSFT,zzzz", headers=h).json()
    assert set(r["quotes"]) == {"AAPL", "MSFT"} and r["unknown"] == ["zzzz"]
    assert client.get("/api/market/search?q=tesla", headers=h).json()["results"][0]["symbol"] == "TSLA"
    assert client.get("/api/market/status", headers=h).json()["crypto"] == "open"
    assert client.get("/api/market/options/BTC-USD/chain?expiry=2026-12-18", headers=h).status_code == 400
    assert client.get("/api/market/candles/AAPL?range=7Y", headers=h).status_code == 400
