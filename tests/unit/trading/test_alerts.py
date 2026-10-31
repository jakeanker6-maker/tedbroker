"""Price, % move and order-filled alerts."""
import asyncio
import time
import uuid
from decimal import Decimal as D

import pytest
from bson import ObjectId

from app.auth import create_access_token
from app.database import get_collection
from app.market_data import calendar
from app.market_data.bus import PriceBus
from app.market_data.quotes import make_quote
from app.trading import alerts, events, ledger, orders
from app.trading import engine as engine_mod
from app.trading.models import OrderRequest


def q(sym="AAPL", last=100.0, prev=100.0):
    return make_quote(sym, "stock", last=last, bid=last - 0.01, ask=last + 0.01, prev_close=prev, ts=time.time(), source="t")


@pytest.fixture
def user(fresh_db, monkeypatch):
    ledger.ensure_indexes()
    orders.ensure_indexes()
    alerts.ensure_indexes()
    monkeypatch.setattr(calendar, "equity_session", lambda now=None: "open")
    sent = []
    from app import email_service
    monkeypatch.setattr(email_service.email_service, "send_email", lambda *a, **k: sent.append(a) or True)
    uid = ObjectId()
    get_collection("users").insert_one({"_id": uid, "email": "al@t.io", "full_name": "Al", "wallet_balance": 10_000.0})
    return str(uid), sent


def notes(uid):
    return list(get_collection("notifications").find({"target_user_id": uid, "source": "alert"}))


def test_api_validation_and_ownership(user, client):
    uid, _ = user
    h = {"Authorization": "Bearer " + create_access_token({"sub": "al@t.io", "user_id": uid})}
    r = client.post("/api/trading/alerts", headers=h, json={"kind": "price_above", "symbol": "aapl", "threshold": "150"})
    assert r.status_code == 201 and r.json()["symbol"] == "AAPL" and r.json()["description"] == "AAPL at or above $150.00"
    assert client.post("/api/trading/alerts", headers=h, json={"kind": "price_above", "symbol": "AAPL"}).status_code == 400
    assert client.post("/api/trading/alerts", headers=h, json={"kind": "pct_move", "symbol": "AAPL", "threshold": "500"}).status_code == 400
    assert client.post("/api/trading/alerts", headers=h, json={"kind": "price_below", "symbol": "NOPE!!", "threshold": "1"}).status_code == 404
    assert client.post("/api/trading/alerts", headers=h, json={"kind": "order_filled"}).status_code == 201
    assert client.post("/api/trading/alerts", headers=h, json={"kind": "order_filled"}).status_code == 409
    rows = client.get("/api/trading/alerts", headers=h).json()["alerts"]
    assert len(rows) == 2
    other = {"Authorization": "Bearer " + create_access_token({"sub": "x@t.io", "user_id": str(ObjectId())})}
    assert client.delete(f"/api/trading/alerts/{rows[0]['id']}", headers=other).status_code == 404
    assert client.delete(f"/api/trading/alerts/{rows[0]['id']}", headers=h).json() == {"deleted": True}
    assert len(client.get("/api/trading/alerts", headers=h).json()["alerts"]) == 1


def test_price_alert_fires_once_with_email(user):
    uid, sent = user
    a = alerts.create(uid, "price_above", "AAPL", "150", email=True, note="take profit")
    assert not alerts.check_quote([a], q(last=149.99))
    assert len(alerts.check_quote([a], q(last=151))) == 1
    assert alerts.check_quote([a], q(last=152)) == []                     # one-shot (claimed)
    stored = alerts.col().find_one({"_id": a["_id"]})
    assert stored["status"] == "triggered" and stored["trigger_value"] == "151.0"
    n = notes(uid)
    assert len(n) == 1 and n[0]["title"] == "AAPL is above $150.00"
    assert len(sent) == 1 and sent[0][0] == "al@t.io" and "take profit" in sent[0][3]
    stale = make_quote("MSFT", "stock", last=999, ts=time.time() - 3600, source="t")
    b = alerts.create(uid, "price_above", "MSFT", "1")
    assert alerts.check_quote([b], stale) == []                           # never on stale data


def test_pct_move_fires_once_per_day_and_stays_active(user):
    uid, sent = user
    a = alerts.create(uid, "pct_move", "TSLA", "5")
    assert alerts.check_quote([a], q("TSLA", last=104, prev=100)) == []
    fired = alerts.check_quote([a], q("TSLA", last=94, prev=100))
    assert len(fired) == 1 and fired[0]["status"] == "active" and fired[0]["trigger_value"] == "-6.00"
    assert alerts.check_quote(fired, q("TSLA", last=90, prev=100)) == []  # already today
    assert notes(uid)[0]["title"] == "TSLA down 6.00% today" and sent == []


def test_order_filled_alert_and_replay_is_not_renotified(user):
    uid, _ = user
    alerts.create(uid, "order_filled")
    o = orders.place(uid, OrderRequest(client_order_id=str(uuid.uuid4()), symbol="AAPL", side="buy", qty=D("2"),
                                       type="market"), q())
    assert o["status"] == "filled"
    n = notes(uid)
    assert len(n) == 1 and n[0]["title"] == "Bought 2 AAPL"
    fill = orders.fills_col().find_one({"order_id": o["_id"]})
    orders.apply_fill(dict(fill))                                         # replay
    assert len(notes(uid)) == 1
    assert alerts.col().find_one({"kind": "order_filled"})["status"] == "active"


async def test_engine_streams_alert_symbols_and_fires(user, monkeypatch):
    uid, _ = user
    from app.trading import portfolio, risk_monitor

    async def nothing(*a, **k):
        return 0
    monkeypatch.setattr(portfolio, "snapshot_all", nothing)
    monkeypatch.setattr(risk_monitor, "run", nothing)
    bus = PriceBus()
    eng = engine_mod.Engine(bus)

    class NoBots:
        stats = {}
        async def start(self): pass
        async def tick(self): pass
        def stop(self): pass
    eng.bots = NoBots()
    events.bind_loop(asyncio.get_running_loop())
    await eng.start()
    try:
        await asyncio.to_thread(alerts.create, uid, "price_below", "NVDA", "100")
        for _ in range(40):
            await asyncio.sleep(0.02)
            if "NVDA" in bus.demand():
                break
        assert "NVDA" in bus.demand()
        bus.publish(q("NVDA", last=99, prev=101))
        for _ in range(60):
            await asyncio.sleep(0.05)
            if notes(uid):
                break
        assert notes(uid) and notes(uid)[0]["title"] == "NVDA is below $100.00"
        assert not eng.alerts.get("NVDA")
    finally:
        await eng.stop()
