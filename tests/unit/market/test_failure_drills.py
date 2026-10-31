"""Phase 6 failure drills for market data: a dropped websocket reconnects and resubscribes,
quotes are labelled 'delayed' while no stream is delivering them, and the poller keeps
stale symbols refreshed over REST."""
import asyncio
import json
import sys
import time
import types

from app.market_data import feeds, service
from app.market_data.quotes import make_quote, public


class FakeWS:
    """One websocket session: answers with `messages`, then drops the connection."""

    def __init__(self, messages):
        self.sent = []
        self._messages = list(messages)

    async def send(self, raw):
        self.sent.append(json.loads(raw))

    async def recv(self):
        if self._messages:
            return json.dumps(self._messages.pop(0))
        await asyncio.sleep(0.01)
        raise ConnectionError("dropped")

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


async def test_ws_drop_reconnects_and_resubscribes(clean_market, monkeypatch):
    sessions = []

    def connect(url, **kw):
        ws = FakeWS([{"type": "ticker", "product_id": "BTC-USD", "price": "50000", "best_bid": "49999",
                      "best_ask": "50001", "time": "2026-10-29T15:00:00Z"}])
        sessions.append(ws)
        return ws
    monkeypatch.setitem(sys.modules, "websockets", types.SimpleNamespace(connect=connect))

    async def reachable(host):
        return True
    monkeypatch.setattr(feeds, "host_reachable", reachable)

    monkeypatch.setattr(feeds.random, "random", lambda: 0.0)
    feed = feeds.CoinbaseWS(clean_market)
    monkeypatch.setattr(feed, "enabled", lambda: True)
    feed.set_wanted(["BTC-USD"])
    real_sleep = asyncio.sleep

    async def fast_sleep(delay, *a, **k):
        await real_sleep(0)
    monkeypatch.setattr(feeds.asyncio, "sleep", fast_sleep)
    task = asyncio.create_task(feed.run())
    for _ in range(400):
        await real_sleep(0.005)
        if len(sessions) >= 3:
            break
    feed.stop()
    await asyncio.wait_for(task, timeout=2)
    assert len(sessions) >= 3, "feed did not reconnect after drops"
    for ws in sessions:   # every new connection re-sends the subscription
        assert ws.sent and ws.sent[0]["type"] == "subscribe" and ws.sent[0]["product_ids"] == ["BTC-USD"]
    assert feed.last_error and "dropped" in feed.last_error
    assert not feed.connected and feed.subscribed == set()


def test_quote_feed_state_follows_stream_health(clean_market, monkeypatch):
    m = feeds.FeedManager(clean_market)
    monkeypatch.setattr(feeds, "manager", m)
    q = make_quote("AAPL", "stock", last=200, bid=199.9, ask=200.1, ts=time.time(), source="Finnhub")
    assert public(q)["feed"] == "delayed"                         # nothing streaming yet (REST)
    m.finnhub.connected, m.finnhub.last_message_at, m.finnhub.subscribed = True, time.time(), {"AAPL"}
    assert public(q)["feed"] == "streaming"
    m.finnhub.last_message_at = time.time() - 120                  # stream went silent / down
    assert public(q)["feed"] == "delayed"
    m.finnhub.last_message_at = time.time()
    assert public(dict(q, delayed=True))["feed"] == "delayed"      # delayed source is never "streaming"
    old = make_quote("AAPL", "stock", last=200, ts=time.time() - 3600, source="Finnhub")
    assert public(old)["feed"] == "delayed"                        # stale quote


async def test_poller_refreshes_stale_symbols_over_rest(clean_market, monkeypatch):
    calls = []

    async def fake_get_quote(sym, asset_class=None, max_age=None):
        calls.append((sym, max_age))
        q = make_quote(sym, "stock", last=101, ts=time.time(), source="Finnhub")
        clean_market.publish(q)
        service._snapshot_at[sym] = time.time()
        return q
    monkeypatch.setattr(service, "get_quote", fake_get_quote)
    p = feeds.Poller(clean_market, interval=0.01)
    p.symbols = {"AAPL", "MSFT"}
    clean_market.publish(make_quote("AAPL", "stock", last=100, ts=time.time() - 3600, source="Finnhub"))
    task = asyncio.create_task(p.run())
    await asyncio.sleep(0.1)
    p.stop()
    await asyncio.wait_for(task, timeout=1)
    assert {"AAPL", "MSFT"} <= {s for s, _ in calls} and all(age == 0 for _, age in calls)
    assert clean_market.get("AAPL")["last"] == 101
