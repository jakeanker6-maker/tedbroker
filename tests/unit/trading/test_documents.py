"""Documents center: statements, confirmations and the realized gains report."""
import time
import uuid
from datetime import datetime
from decimal import Decimal as D

import pytest
from bson import ObjectId

from app.auth import create_access_token
from app.database import get_collection
from app.market_data import calendar
from app.market_data.quotes import make_quote
from app.trading import funding, ledger, orders, statements
from app.trading.models import OrderRequest


def q(sym="AAPL", last=100.0):
    return make_quote(sym, "stock", last=last, bid=last, ask=last, prev_close=last, ts=time.time(), source="t")


@pytest.fixture
def trader(fresh_db, monkeypatch):
    ledger.ensure_indexes()
    orders.ensure_indexes()
    monkeypatch.setattr(calendar, "equity_session", lambda now=None: "open")
    uid = ObjectId()
    get_collection("users").insert_one({"_id": uid, "email": "doc@t.io", "full_name": "Doc Tester", "wallet_balance": 0.0})
    uid = str(uid)
    funding.credit_deposit(str(ObjectId()), uid, 5000.0, "bank")
    buy = orders.place(uid, OrderRequest(client_order_id=str(uuid.uuid4()), symbol="AAPL", side="buy", qty=D("10"),
                                         type="market"), q(last=100))
    sell = orders.place(uid, OrderRequest(client_order_id=str(uuid.uuid4()), symbol="AAPL", side="sell", qty=D("4"),
                                          type="market"), q(last=110))
    return uid, buy, sell


def hdr(uid):
    return {"Authorization": "Bearer " + create_access_token({"sub": "doc@t.io", "user_id": uid})}


def test_statement_data_balances_and_holdings(trader):
    uid, buy, sell = trader
    ym = datetime.now(calendar.NY).strftime("%Y-%m")
    data = statements.statement_data(uid, ym)
    assert data["opening_cash_cents"] == 0
    assert data["closing_cash_cents"] == ledger.get_balances(uid)["cash_cents"]
    assert data["by_category"]["Deposits"] == 500_000
    assert [h["symbol"] for h in data["holdings"]] == ["AAPL"] and data["holdings"][0]["qty"] == D("6")
    assert len(data["fills"]) == 2 and len(data["realized"]) == 1
    assert data["realized_total"] > 0
    pdf = statements.render_statement(data)
    assert pdf.startswith(b"%PDF") and len(pdf) > 2000


def test_documents_api(trader, client):
    uid, buy, sell = trader
    h = hdr(uid)
    idx = client.get("/api/documents", headers=h).json()
    ym = datetime.now(calendar.NY).strftime("%Y-%m")
    assert idx["statements"][0] == {"period": ym, "partial": True}
    assert {c["order_id"] for c in idx["confirmations"]} == {str(buy["_id"]), str(sell["_id"])}
    assert idx["tax_years"] == [datetime.now(calendar.NY).year]

    r = client.get(f"/api/documents/statements/{ym}.pdf", headers=h)
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf" and r.content.startswith(b"%PDF")
    assert "attachment" in r.headers["content-disposition"]
    assert client.get("/api/documents/statements/1999-01.pdf", headers=h).status_code == 404
    assert client.get("/api/documents/statements/2026-13.pdf", headers=h).status_code == 400

    r = client.get(f"/api/documents/confirmations/{buy['_id']}.pdf", headers=h)
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    other = hdr(str(ObjectId()))
    assert client.get(f"/api/documents/confirmations/{buy['_id']}.pdf", headers=other).status_code == 404

    year = datetime.now(calendar.NY).year
    rep = client.get(f"/api/documents/realized-gains?year={year}", headers=h).json()
    assert len(rep["rows"]) == 1 and rep["rows"][0]["quantity"] == "4" and D(rep["net_gain_loss"]) > 0
    avg = client.get(f"/api/documents/realized-gains?year={year}&method=average", headers=h).json()
    assert avg["method"] == "average"
    r = client.get(f"/api/documents/realized-gains.csv?year={year}", headers=h)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv") and "AAPL" in r.text
    assert client.get("/api/documents/realized-gains?year=2026&method=lifo", headers=h).status_code == 422
