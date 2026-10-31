"""Phase 6 security checks: ownership on every per-object trading route, auth on every
trading/copy/market route, CORS never `*`, stream-connection cap."""
import time

import pytest
from bson import ObjectId
from fastapi import HTTPException

from app.auth import create_access_token
from app.database import get_collection
from app.market_data import calendar, service
from app.market_data.quotes import make_quote
from app.trading import copy_engine, ledger, orders


@pytest.fixture
def two_users(fresh_db, client, monkeypatch):
    ledger.ensure_indexes()
    orders.ensure_indexes()
    monkeypatch.setattr(calendar, "equity_session", lambda now=None: "open")

    async def fake_quote(symbol, asset_class=None, max_age=None):
        return make_quote(symbol, "stock", last=100.0, bid=100.0, ask=100.0, prev_close=99.0, ts=time.time(), source="test")

    async def fake_quotes(symbols):
        return {s: await fake_quote(s) for s in symbols}
    monkeypatch.setattr(service, "get_quote", fake_quote)
    monkeypatch.setattr(service, "get_quotes", fake_quotes)
    out = []
    for _ in range(2):
        uid = ObjectId()
        get_collection("users").insert_one({"_id": uid, "email": f"{uid}@t.io", "wallet_balance": 10_000.0})
        out.append((str(uid), {"Authorization": "Bearer " + create_access_token({"sub": f"{uid}@t.io", "user_id": str(uid)})}))
    return client, out


def test_other_users_objects_are_invisible(two_users):
    client, [(a_id, a), (b_id, b)] = two_users
    lim = client.post("/api/trading/orders", headers=a, json={"symbol": "AAPL", "side": "buy", "qty": "1",
                                                              "type": "limit", "limit_price": "50", "tif": "gtc"}).json()
    oid = lim["id"]
    assert client.get(f"/api/trading/orders/{oid}", headers=b).status_code == 404
    assert client.delete(f"/api/trading/orders/{oid}", headers=b).status_code == 404
    assert client.patch(f"/api/trading/orders/{oid}", headers=b, json={"limit_price": "60"}).status_code == 404
    assert client.get("/api/trading/orders", headers=b).json()["orders"] == []
    assert client.get(f"/api/trading/orders/{oid}", headers=a).json()["status"] == "accepted"

    wl = client.get("/api/trading/watchlists", headers=a).json()["watchlists"][0]
    assert client.delete(f"/api/trading/watchlists/{wl['id']}", headers=b).status_code == 404
    assert client.post(f"/api/trading/watchlists/{wl['id']}/symbols", headers=b, json={"symbol": "TSLA"}).status_code == 404

    lid = copy_engine.links().insert_one({"user_id": a_id, "trader_id": str(ObjectId()), "status": "active",
                                          "allocated_cents": 0, "cash_cents": 0}).inserted_id
    for call in (lambda: client.get(f"/api/copy/links/{lid}", headers=b),
                 lambda: client.patch(f"/api/copy/links/{lid}", headers=b, json={"status": "paused"}),
                 lambda: client.delete(f"/api/copy/links/{lid}", headers=b)):
        assert call().status_code == 404
    assert client.get("/api/copy/links", headers=b).json()["links"] == []

    fake = str(ObjectId())
    assert client.post(f"/api/trading/baskets/{fake}/rebalance", headers=b).status_code == 404
    # a user_id smuggled into the body is ignored: the order belongs to the token's user
    r = client.post("/api/trading/orders", headers=b, json={"symbol": "AAPL", "side": "buy", "qty": "1", "user_id": a_id})
    assert r.status_code in (201, 422)
    if r.status_code == 201:
        assert orders.orders_col().find_one({"_id": ObjectId(r.json()["id"])})["user_id"] == b_id


def test_every_trading_route_requires_auth(client):
    from main import app

    def deps(d):
        names = []
        for x in d.dependencies:
            names.append(getattr(x.call, "__name__", ""))
            names += deps(x)
        return names
    for r in app.routes:
        path = getattr(r, "path", "")
        if not path.startswith(("/api/trading", "/api/copy", "/api/market")):
            continue
        assert any("current_user" in n or "admin" in n for n in deps(r.dependant)), path


def test_cors_never_wildcard(client, monkeypatch):
    import main
    monkeypatch.setenv("CORS_ORIGINS", "*,https://school.example/")
    assert main.cors_origins() == ["https://school.example"]
    monkeypatch.delenv("CORS_ORIGINS")
    assert "*" not in main.cors_origins()
    r = client.options("/api/market/status", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert r.headers.get("access-control-allow-origin") not in ("*", "https://evil.example")


def test_stream_connection_cap():
    from app.routes import stream
    uid = str(ObjectId())
    for _ in range(stream.MAX_STREAMS_PER_USER):
        stream._claim(uid)
    with pytest.raises(HTTPException) as exc:
        stream._claim(uid)
    assert exc.value.status_code == 429
    for _ in range(stream.MAX_STREAMS_PER_USER):
        stream._release(uid)
    assert uid not in stream._open
