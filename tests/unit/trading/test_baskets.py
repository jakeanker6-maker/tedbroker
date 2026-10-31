import time
from datetime import datetime, timedelta
from decimal import Decimal as D

import pytest
from bson import ObjectId

from app.database import get_collection
from app.market_data import calendar
from app.market_data.bus import bus
from app.market_data.quotes import make_quote
from app.trading import baskets, ledger, orders, positions


@pytest.fixture
def db(fresh_db, monkeypatch):
    ledger.ensure_indexes()
    orders.ensure_indexes()
    monkeypatch.setattr(calendar, "equity_session", lambda now=None: "open")
    bus.latest.clear()
    yield fresh_db
    bus.latest.clear()


def quotes(**prices):
    out = {}
    for s, p in prices.items():
        out[s] = make_quote(s, "etf", last=p, bid=p, ask=p, ts=time.time(), source="t")
        bus.publish(out[s])
    return out


def user(cash=10_000.0):
    uid = ObjectId()
    get_collection("users").insert_one({"_id": uid, "email": f"{uid}@t.io", "wallet_balance": cash})
    return str(uid)


def test_template_invest_splits_by_weight_into_basket_bucket(db):
    uid = user()
    t = baskets.template("core-60-40")
    b = baskets.create(uid, t["name"], [{"symbol": s, "weight": w} for s, w in t["holdings"]], t["id"])
    placed = baskets.invest(uid, str(b["_id"]), D("1000"), quotes(VTI=300.0, BND=75.0))
    assert [o["status"] for o in placed] == ["filled", "filled"]
    bucket = f"basket:{b['_id']}"
    # $600 / $300 and $400 / $75, less a little market-order slippage
    assert D("1.999") < positions.open_qty(uid, "VTI", bucket) <= D("2")
    assert D("5.33") < positions.open_qty(uid, "BND", bucket) <= D("5.333333")
    assert positions.open_qty(uid, "VTI", "self") == 0
    s = baskets.serialize(baskets.get(uid, str(b["_id"])), quotes(VTI=300.0, BND=75.0))
    assert abs(D(s["holdings"][0]["actual"]) - 60) < D("0.05") and s["invested"] == "1000.00"
    assert ledger.reconcile(uid)["ok"]


def test_custom_basket_validation(db):
    uid = user()
    with pytest.raises(orders.OrderError, match="add up to 100"):
        baskets.create(uid, "x", [{"symbol": "SPY", "weight": 50}, {"symbol": "QQQ", "weight": 40}])
    with pytest.raises(orders.OrderError, match="not a US-listed ETF"):
        baskets.create(uid, "x", [{"symbol": "AAPL", "weight": 100}])
    with pytest.raises(orders.OrderError, match="twice"):
        baskets.create(uid, "x", [{"symbol": "SPY", "weight": 50}, {"symbol": "spy", "weight": 50}])
    b = baskets.create(uid, "Tiny", [{"symbol": "SPY", "weight": 99}, {"symbol": "QQQ", "weight": 1}])
    with pytest.raises(orders.OrderError, match=r"\$1 minimum"):
        baskets.invest(uid, str(b["_id"]), D("50"), quotes(SPY=500.0, QQQ=400.0))
    with pytest.raises(orders.OrderError, match="Not enough cash"):
        baskets.invest(uid, str(b["_id"]), D("50000"), quotes(SPY=500.0, QQQ=400.0))


def test_sell_half_and_rebalance(db):
    uid = user()
    b = baskets.create(uid, "Two", [{"symbol": "SPY", "weight": 50}, {"symbol": "QQQ", "weight": 50}])
    bid = str(b["_id"])
    baskets.invest(uid, bid, D("2000"), quotes(SPY=500.0, QQQ=400.0))
    # SPY rallies 50%: weights drift to 60/40
    q = quotes(SPY=750.0, QQQ=400.0)
    d = baskets.drift(baskets.get(uid, bid), q)
    assert [round(r["actual"]) for r in d["rows"]] == [60, 40]
    baskets.rebalance(uid, bid, q)
    d = baskets.drift(baskets.get(uid, bid), q)
    assert all(abs(r["drift"]) < D("0.1") for r in d["rows"])
    baskets.sell(uid, bid, D("50"), q)
    d2 = baskets.drift(baskets.get(uid, bid), q)
    assert d2["total"] == pytest.approx(d["total"] / 2, rel=D("0.001"))
    baskets.sell(uid, bid, D("100"), q)
    assert baskets.get(uid, bid)["status"] == "closed" and not baskets.holdings(uid, bid)
    assert ledger.reconcile(uid)["ok"]


def test_auto_invest_schedule(db):
    uid = user()
    b = baskets.create(uid, "Auto", [{"symbol": "SPY", "weight": 100}])
    b = baskets.set_auto_invest(uid, str(b["_id"]), D("100"), "weekly")
    assert b["auto_invest"]["frequency"] == "weekly"
    assert not baskets.due_auto_invest()
    assert baskets.due_auto_invest(datetime.utcnow() + timedelta(days=8))
    baskets.mark_auto_run(b, True)
    assert baskets.get(uid, str(b["_id"]))["auto_invest"]["last_result"] == "ok"
    assert baskets.set_auto_invest(uid, str(b["_id"]), None, None)["auto_invest"] is None
