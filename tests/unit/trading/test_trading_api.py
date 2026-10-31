"""Trading Hub routes, portfolio valuation and the async matching engine."""
import asyncio
import time
from decimal import Decimal as D

import pytest
from bson import ObjectId

from app.auth import create_access_token
from app.database import get_collection
from app.market_data import bus as bus_mod
from app.market_data import calendar, service
from app.market_data.quotes import make_quote
from app.trading import engine as engine_mod
from app.trading import events, ledger, orders, portfolio, positions

PRICES = {"AAPL": 100.0, "MSFT": 400.0, "BTC-USD": 50_000.0, "SPY": 500.0}


@pytest.fixture
def env(fresh_db, client, monkeypatch):
    ledger.ensure_indexes()
    orders.ensure_indexes()
    monkeypatch.setattr(calendar, "equity_session", lambda now=None: "open")

    async def fake_quote(symbol, asset_class=None, max_age=None):
        ac = "crypto" if symbol.endswith("-USD") else "stock"
        last = PRICES.get(symbol, 50.0)
        return make_quote(symbol, ac, last=last, bid=last, ask=last, prev_close=last * 0.98, ts=time.time(), source="test")

    async def fake_quotes(symbols):
        return {s: await fake_quote(s) for s in symbols}
    monkeypatch.setattr(service, "get_quote", fake_quote)
    monkeypatch.setattr(service, "get_quotes", fake_quotes)
    uid = ObjectId()
    get_collection("users").insert_one({"_id": uid, "email": f"{uid}@t.io", "wallet_balance": 20_000.0})
    h = {"Authorization": "Bearer " + create_access_token({"sub": "u@t.io", "user_id": str(uid)})}
    return client, h, str(uid)


def test_place_list_cancel_via_api(env):
    client, h, uid = env
    r = client.post("/api/trading/orders", headers=h, json={"symbol": "aapl", "side": "buy", "qty": "10"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "filled" and body["symbol"] == "AAPL" and body["avg_fill_price"]
    r = client.post("/api/trading/orders", headers=h, json={"symbol": "MSFT", "side": "buy", "qty": "2",
                                                             "type": "limit", "limit_price": "350", "tif": "gtc"})
    lim = r.json()
    assert lim["status"] == "accepted" and lim["cash_reserved"] == "700.00"
    opened = client.get("/api/trading/orders?status=open", headers=h).json()["orders"]
    assert [o["id"] for o in opened] == [lim["id"]]
    detail = client.get(f"/api/trading/orders/{body['id']}", headers=h).json()
    assert len(detail["fills"]) == 1 and detail["fills"][0]["qty"] == "10"
    assert client.delete(f"/api/trading/orders/{lim['id']}", headers=h).json()["status"] == "canceled"
    assert client.delete(f"/api/trading/orders/{lim['id']}", headers=h).status_code == 409


def test_error_shape_and_preview(env):
    client, h, uid = env
    r = client.post("/api/trading/orders", headers=h, json={"symbol": "AAPL", "side": "sell_short", "qty": "1"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "margin_required"   # never 401/403: the UI logs out on those
    r = client.post("/api/trading/orders", headers=h, json={"symbol": "AAPL", "side": "buy", "qty": "500"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "insufficient_buying_power"
    r = client.post("/api/trading/orders", headers=h, json={"symbol": "AAPL", "side": "buy"})
    assert r.status_code == 422
    p = client.post("/api/trading/orders/preview", headers=h,
                    json={"symbol": "BTC-USD", "side": "buy", "notional": "500"}).json()
    assert p["tif"] == "gtc" and p["estimated_fees"] == "2.49" and p["can_place"] is True
    assert p["buying_power_after"] == "19500.00"
    p = client.post("/api/trading/orders/preview", headers=h, json={"symbol": "AAPL", "side": "buy", "qty": "1000"}).json()
    assert p["can_place"] is False and "Insufficient buying power" in p["warnings"][-1]


def test_positions_portfolio_and_balance(env):
    client, h, uid = env
    client.post("/api/trading/orders", headers=h, json={"symbol": "AAPL", "side": "buy", "qty": "10"})
    client.post("/api/trading/orders", headers=h, json={"symbol": "BTC-USD", "side": "buy", "qty": "0.01"})
    PRICES["AAPL"] = 110.0
    try:
        pos = {p["symbol"]: p for p in client.get("/api/trading/positions", headers=h).json()["positions"]}
        basis = D(pos["AAPL"]["cost_basis"])                 # includes slippage paid on the buy
        assert pos["AAPL"]["market_value"] == "1100.00"
        assert D(pos["AAPL"]["unrealized_pnl"]) == D("1100") - basis
        assert pos["AAPL"]["day_pnl"] == pos["AAPL"]["unrealized_pnl"]   # opened today -> vs cost
        assert pos["AAPL"]["bucket_label"] == "Self-directed"
        s = client.get("/api/trading/portfolio/summary", headers=h).json()
        cash = D(s["cash"])
        assert D(s["equity"]) == cash + D("1100") + D("500")
        assert {c["asset_class"] for c in s["by_asset_class"]} == {"stock", "crypto", "cash"}
        b = client.get("/api/wallet/balance", headers=h).json()
        assert b["equity"] == float(s["equity"]) and b["balance"] == float(cash)
        acct = client.get("/api/trading/account", headers=h).json()
        assert acct["account_type"] == "cash" and acct["options_level"] == 2
        hist = client.get("/api/trading/portfolio/history?range=1D", headers=h).json()
        assert hist["points"][-1]["live"] is True
        acts = client.get("/api/trading/activity", headers=h).json()["items"]
        assert acts[0]["type"] == "trade_buy" and acts[-1]["type"] == "opening_balance"
    finally:
        PRICES["AAPL"] = 100.0


def test_watchlists(env):
    client, h, uid = env
    wl = client.get("/api/trading/watchlists", headers=h).json()["watchlists"]
    assert len(wl) == 1 and "BTC-USD" in wl[0]["symbols"]
    wid = wl[0]["id"]
    assert "ARKK" in client.post(f"/api/trading/watchlists/{wid}/symbols", headers=h, json={"symbol": "arkk"}).json()["symbols"]
    assert client.post(f"/api/trading/watchlists/{wid}/symbols", headers=h, json={"symbol": "nope!"}).status_code == 404
    assert "SPY" not in client.delete(f"/api/trading/watchlists/{wid}/symbols/SPY", headers=h).json()["symbols"]
    other = {"Authorization": "Bearer " + create_access_token({"sub": "o@t.io", "user_id": str(ObjectId())})}
    assert client.delete(f"/api/trading/watchlists/{wid}", headers=other).status_code == 404


async def test_engine_fills_resting_order_on_bus_tick(fresh_db, monkeypatch):
    ledger.ensure_indexes()
    orders.ensure_indexes()
    monkeypatch.setattr(calendar, "equity_session", lambda now=None: "open")
    bus = bus_mod.PriceBus()

    async def fake_quote(symbol, asset_class=None, max_age=None):
        return make_quote(symbol, "stock", last=100, bid=100, ask=100, ts=time.time(), source="t")
    monkeypatch.setattr(service, "get_quote", fake_quote)

    async def no_snap():
        return 0
    monkeypatch.setattr(portfolio, "snapshot_all", no_snap)
    uid = ObjectId()
    get_collection("users").insert_one({"_id": uid, "email": "e@t.io", "wallet_balance": 5_000.0})
    from app.trading.models import OrderRequest
    o = await asyncio.to_thread(orders.place, str(uid), OrderRequest(symbol="AAPL", side="buy", qty=D("5"),
                                type="limit", limit_price=D("95"), tif="gtc"),
                                make_quote("AAPL", "stock", last=100, ts=time.time(), source="t"))
    eng = engine_mod.Engine(bus)
    events.bind_loop(asyncio.get_running_loop())
    stream = events.open_stream(str(uid))
    await eng.start()
    try:
        assert "AAPL" in bus.demand()                 # engine subscribed to the order's symbol
        bus.publish(make_quote("AAPL", "stock", last=94.0, bid=93.9, ask=94.1, ts=time.time(), source="t"))
        for _ in range(50):
            await asyncio.sleep(0.05)
            if orders.orders_col().find_one({"_id": o["_id"]})["status"] == "filled":
                break
        assert orders.orders_col().find_one({"_id": o["_id"]})["status"] == "filled"
        assert positions.open_qty(str(uid), "AAPL") == 5
        kinds = []
        while not stream.empty():
            kinds.append(stream.get_nowait()["event"])
        assert {"order", "fill", "position", "balance"} <= set(kinds) or {"order", "fill", "position"} <= set(kinds)
        assert eng.status()["fills"] == 1
    finally:
        await eng.stop()
        events.close_stream(str(uid), stream)


def test_margin_upgrade_options_level_locate_and_multileg_api(env, monkeypatch):
    client, h, uid = env
    acct = client.get("/api/trading/account", headers=h).json()
    assert acct["account_type"] == "cash" and acct["margin"]["buying_power"]["stock"] == "20000.00"
    r = client.post("/api/trading/account/margin-upgrade", headers=h,
                    json={"accept_margin_agreement": True, "accept_risk_disclosure": False})
    assert r.status_code == 400
    r = client.post("/api/trading/account/margin-upgrade", headers=h,
                    json={"accept_margin_agreement": True, "accept_risk_disclosure": True}).json()
    assert r["account_type"] == "margin" and r["margin"]["buying_power"]["stock"] == "40000.00"
    bad = client.post("/api/trading/account/options-level", headers=h, json={
        "level": 4, "experience": "none", "objective": "income", "understands_risk": True}).json()
    assert not bad["approved"] and bad["options_level"] == 2 and len(bad["reasons"]) >= 2
    ok = client.post("/api/trading/account/options-level", headers=h, json={
        "level": 4, "experience": "1_to_5", "objective": "speculation", "understands_risk": True}).json()
    assert ok["approved"] and ok["options_level"] == 4
    loc = client.get("/api/trading/locate/GME", headers=h).json()
    assert loc["shortable"] and not loc["easy_to_borrow"] and loc["ssr"] is False
    r = client.post("/api/trading/orders", headers=h, json={"symbol": "AAPL", "side": "sell_short", "qty": "10"})
    assert r.status_code == 201 and r.json()["status"] == "filled"
    assert client.get("/api/trading/margin-calls", headers=h).json()["margin_calls"] == []

    from datetime import date, timedelta
    from app.trading import options as opt
    exp = date.today() + timedelta(days=30)
    c100, c110 = opt.format_occ("AAPL", exp, "C", 100), opt.format_occ("AAPL", exp, "C", 110)

    async def fake_quote(symbol, asset_class=None, max_age=None):
        if opt.looks_like_occ(symbol):
            mid = 5.0 if "C00100000" in symbol else 1.0
            return make_quote(symbol, "option", last=mid, bid=mid - 0.1, ask=mid + 0.1, ts=time.time(), source="t")
        return make_quote(symbol, "stock", last=100, bid=100, ask=100, ts=time.time(), source="t")
    monkeypatch.setattr(service, "get_quote", fake_quote)
    body = {"strategy": "vertical", "qty": 1, "type": "net_limit", "net_price": "4.10", "price_effect": "debit",
            "legs": [{"symbol": c100, "side": "buy"}, {"symbol": c110, "side": "sell"}]}
    pay = client.post("/api/trading/strategies/payoff", headers=h, json=body).json()
    assert pay["max_loss"] == "-400.00" and pay["max_profit"] == "600.00" and pay["breakevens"] == [104.0]
    pv = client.post("/api/trading/orders/multileg/preview", headers=h, json=body).json()
    assert pv["required_level"] == 3 and pv["can_place"]
    o = client.post("/api/trading/orders/multileg", headers=h, json=body)
    assert o.status_code == 201, o.text
    assert o.json()["status"] == "filled" and o.json()["strategy"] == "vertical" and len(o.json()["legs"]) == 2
    groups = client.get("/api/trading/strategies", headers=h).json()["strategies"]
    assert groups[0]["strategy"] == "vertical" and groups[0]["qty"] == 1


async def test_engine_prescreen_skips_orders_that_cannot_fill(fresh_db, monkeypatch):
    """Non-actionable orders are screened in memory; only crossing orders reach the DB path."""
    ledger.ensure_indexes()
    orders.ensure_indexes()
    monkeypatch.setattr(calendar, "equity_session", lambda now=None: "open")
    from app.market_data.bus import PriceBus
    from app.trading.models import OrderRequest
    bus = PriceBus()
    uid = ObjectId()
    get_collection("users").insert_one({"_id": uid, "email": "p@t.io", "wallet_balance": 50_000.0})
    q = lambda p: make_quote("AAPL", "stock", last=p, bid=p - 0.01, ask=p + 0.01, ts=time.time(), source="t")  # noqa: E731
    ids = []
    for i in range(20):
        o = orders.place(str(uid), OrderRequest(symbol="AAPL", side="buy", qty=D("1"), type="limit",
                                               limit_price=D(str(90 - i * 0.1)), tif="gtc"), q(100))
        ids.append(o["_id"])
    eng = engine_mod.Engine(bus)
    await asyncio.to_thread(eng.refresh_index)
    calls = []
    orig = eng._process_batch
    eng._process_batch = lambda oids, quote: (calls.append(list(oids)), orig(oids, quote))[1]
    await eng._evaluate_symbol("AAPL", q(95))          # no order crosses
    assert calls == [] and eng.stats["evaluations"] == 20
    await eng._evaluate_symbol("AAPL", q(89.95))       # only the 90.00 limit crosses (ask 89.96)
    assert len(calls) == 1 and calls[0] == [ids[0]]
    assert orders.orders_col().find_one({"_id": ids[0]})["status"] == "filled"
    assert ids[0] not in eng.docs and len(eng.by_symbol["AAPL"]) == 19
    assert ledger.reconcile(str(uid))["ok"]
