"""Admin Trading Hub views and "reset simulated account"."""
import time
import uuid
from decimal import Decimal as D

import pytest
from bson import ObjectId

from app.auth import create_access_token
from app.database import get_collection
from app.market_data import calendar
from app.market_data.quotes import make_quote
from app.trading import bots, copy_engine, funding, integrity, ledger, orders, positions, reset
from app.trading.models import OrderRequest


def q(sym="AAPL", last=100.0):
    return make_quote(sym, "stock", last=last, bid=last - 0.01, ask=last + 0.01, prev_close=last, ts=time.time(), source="t")


@pytest.fixture
def busy_user(fresh_db, monkeypatch):
    ledger.ensure_indexes()
    orders.ensure_indexes()
    copy_engine.ensure_indexes()
    monkeypatch.setattr(calendar, "equity_session", lambda now=None: "open")
    uid = ObjectId()
    get_collection("users").insert_one({"_id": uid, "email": "kid@school.test", "wallet_balance": 0.0})
    uid = str(uid)
    funding.credit_deposit(str(ObjectId()), uid, 10_000.0, "bank")
    o = orders.place(uid, OrderRequest(client_order_id=str(uuid.uuid4()), symbol="AAPL", side="buy", qty=D("20"),
                                       type="market"), q())
    assert o["status"] == "filled"
    orders.place(uid, OrderRequest(client_order_id=str(uuid.uuid4()), symbol="MSFT", side="buy", qty=D("1"),
                                   type="limit", limit_price=D("300"), tif="gtc"), q("MSFT", 400))
    tid = get_collection("expert_traders").insert_one({
        "full_name": "Tess", "profile_photo": "", "description": "d", "specialization": "Technology Stocks",
        "ytd_return": 1.0, "win_rate": 1.0, "copiers": 1, "minimum_copy_amount": 100,
        "assets_under_management": 100_000, "max_drawdown": 1.0, "risk_score": 5, "trades": []}).inserted_id
    bots.ensure_bots()
    copy_engine.create_link(uid, str(tid), D("1000"))
    wd = str(ObjectId())
    funding.hold_withdrawal(wd, uid, 500.0, "bank")
    return uid


def test_reset_restores_net_funding_and_keeps_withdrawal_hold(busy_user):
    uid = busy_user
    assert ledger.get_balances(uid)["cash_cents"] < 1_000_000      # bought AAPL + fees
    out = reset.reset_account(uid, "adm")
    assert out["integrity_ok"], out["integrity"]
    assert out["orders_canceled"] == 1 and out["copies_stopped"] == 1 and out["positions_closed"] == 1
    bal = ledger.get_balances(uid)
    assert bal["cash_cents"] == 1_000_000                           # back to the $10,000 deposit
    assert bal["reserved_cents"] == 50_000                          # the pending withdrawal stays on hold
    assert positions.col().count_documents({"user_id": uid, "open": True}) == 0
    assert copy_engine.links().find_one({"user_id": uid})["status"] == "stopped"
    # a second reset is a no-op on cash and still reconciles
    again = reset.reset_account(uid, "adm")
    assert again["cash_adjustment"] == "0.00" and again["integrity_ok"]
    assert integrity.check_user(uid)["ok"]


def test_admin_trading_routes(busy_user, client):
    uid = busy_user
    aid = ObjectId()
    get_collection("admins").insert_one({"_id": aid, "username": "a", "email": "a@a.a", "hashed_password": "x",
                                         "full_name": "A", "role": "admin", "is_active": True, "created_at": None})
    h = {"Authorization": "Bearer " + create_access_token({"sub": "a", "user_id": str(aid), "role": "admin"})}
    r = client.get(f"/api/admin/trading/users/{uid}", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["integrity"]["ok"] and body["net_funding"] == "10000.00"
    assert body["positions"] and body["orders"] and body["ledger"] and body["copy_links"]
    assert client.post(f"/api/admin/trading/users/{uid}/reset", headers=h, json={"confirm": "nope"}).status_code == 400
    r = client.post(f"/api/admin/trading/users/{uid}/reset", headers=h, json={"confirm": "KID@school.test"})
    assert r.status_code == 200 and r.json()["balances"]["cash"] == "10000.00" and r.json()["integrity_ok"]
    assert client.get("/api/admin/trading/integrity", headers=h).json()["failures"] == []
    assert client.get("/api/admin/trading/engine", headers=h).status_code == 200
    bot = get_collection("users").find_one({"is_system": True})
    r = client.post(f"/api/admin/trading/users/{bot['_id']}/reset", headers=h, json={"confirm": bot.get("email", "")})
    assert r.status_code == 409
    user_h = {"Authorization": "Bearer " + create_access_token({"sub": "kid@school.test", "user_id": uid})}
    assert client.get(f"/api/admin/trading/users/{uid}", headers=user_h).status_code == 403
