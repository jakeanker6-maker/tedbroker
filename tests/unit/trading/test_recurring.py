"""Recurring investments: schedule maths, runs, failures and the API."""
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal as D

import pytest
from bson import ObjectId

from app.auth import create_access_token
from app.database import get_collection
from app.market_data import calendar
from app.market_data.quotes import make_quote
from app.trading import baskets, ledger, orders, positions, recurring


def ny(dt):
    return dt.replace(tzinfo=timezone.utc).astimezone(calendar.NY)


def utc(y, m, d, h=12):
    return datetime(y, m, d, h, tzinfo=calendar.NY).astimezone(timezone.utc).replace(tzinfo=None)


def test_schedule_weekly_biweekly_monthly_and_holidays():
    after = utc(2026, 10, 29, 12)                                     # Thursday noon ET
    nxt = ny(recurring.next_run("weekly", 3, False, after))         # Thursdays: today's 10:00 has passed
    assert (nxt.date(), nxt.hour) == (date(2026, 11, 5), 10)
    assert ny(recurring.next_run("weekly", 4, False, after)).date() == date(2026, 10, 30)
    assert ny(recurring.next_run("weekly", 3, False, utc(2026, 10, 29, 9))).date() == date(2026, 10, 29)
    assert ny(recurring.next_run("biweekly", 0, False, after, anchor=date(2026, 10, 26))).date() == date(2026, 11, 9)
    assert ny(recurring.next_run("monthly", 15, False, after)).date() == date(2026, 11, 16)   # Nov 15 is a Sunday
    assert ny(recurring.next_run("monthly", 15, True, after)).date() == date(2026, 11, 15)    # crypto runs any day
    assert ny(recurring.next_run("weekly", 3, False, utc(2026, 11, 20, 12))).date() == date(2026, 11, 27)  # after Thanksgiving


@pytest.fixture
def acct(fresh_db, monkeypatch):
    ledger.ensure_indexes()
    orders.ensure_indexes()
    recurring.ensure_indexes()
    monkeypatch.setattr(calendar, "equity_session", lambda now=None: "open")
    uid = ObjectId()
    get_collection("users").insert_one({"_id": uid, "email": "r@t.io", "wallet_balance": 300.0})
    return str(uid)


def q(sym, last):
    ac = "crypto" if sym.endswith("-USD") else "etf" if sym in ("SPY", "QQQ", "VTI", "BND") else "stock"
    return make_quote(sym, ac, last=last, bid=last - 0.01, ask=last + 0.01, prev_close=last, ts=time.time(), source="t")


def test_run_buys_dollar_amount_once_and_advances(acct):
    p = recurring.create(acct, "symbol", "weekly", 2, "100", symbol="spy")
    assert p["target"]["symbol"] == "SPY" and p["status"] == "active"
    p["next_run"] = datetime.utcnow() - timedelta(minutes=1)
    recurring.col().update_one({"_id": p["_id"]}, {"$set": {"next_run": p["next_run"]}})
    out = recurring.run(p, {"SPY": q("SPY", 500)})
    assert out["ok"] and out["next_run"] > datetime.utcnow()
    assert positions.open_qty(acct, "SPY") > D("0.19")
    again = recurring.run(p, {"SPY": q("SPY", 500)})                 # same slot: no second order
    assert orders.orders_col().count_documents({"user_id": acct, "source": "recurring"}) == 1
    stored = recurring.col().find_one({"_id": p["_id"]})
    assert stored["runs"] == 1 and stored["invested"] == "100.00" and again["ok"]


def test_failures_notify_and_pause_after_three(acct):
    p = recurring.create(acct, "symbol", "weekly", 1, "1000", symbol="AAPL")    # only $300 of cash
    for i in range(3):
        p = recurring.col().find_one({"_id": p["_id"]})
        recurring.col().update_one({"_id": p["_id"]}, {"$set": {"next_run": datetime.utcnow() - timedelta(minutes=1)}})
        p = recurring.col().find_one({"_id": p["_id"]})
        out = recurring.run(p, {"AAPL": q("AAPL", 100)})
        assert not out["ok"]
    stored = recurring.col().find_one({"_id": p["_id"]})
    assert stored["status"] == "paused" and stored["failures"] == 3
    titles = [n["title"] for n in get_collection("notifications").find({"target_user_id": acct, "source": "recurring"})]
    assert titles == ["Recurring investment skipped", "Recurring investment skipped", "Recurring investment paused"]
    resumed = recurring.update(acct, str(p["_id"]), status="active")
    assert resumed["failures"] == 0 and resumed["next_run"] > datetime.utcnow()


def test_basket_target(acct):
    get_collection("users").update_one({"_id": ObjectId(acct)}, {"$set": {"wallet_balance": 300.0}})
    b = baskets.create(acct, "Core", [{"symbol": "VTI", "weight": "60"}, {"symbol": "BND", "weight": "40"}])
    p = recurring.create(acct, "basket", "monthly", 3, "50", basket_id=str(b["_id"]))
    p["next_run"] = datetime.utcnow() - timedelta(minutes=1)
    recurring.col().update_one({"_id": p["_id"]}, {"$set": {"next_run": p["next_run"]}})
    assert recurring.run(p, {"VTI": q("VTI", 300), "BND": q("BND", 70)})["ok"]


def test_api(acct, client):
    h = {"Authorization": "Bearer " + create_access_token({"sub": "r@t.io", "user_id": acct})}
    r = client.post("/api/trading/recurring", headers=h, json={"symbol": "BTC-USD", "amount": "25", "frequency": "monthly", "day": 1})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["description"] == "$25.00 of BTC-USD monthly on day 1" and body["next_run"]
    assert client.post("/api/trading/recurring", headers=h, json={"symbol": "BTC-USD", "amount": "1", "frequency": "weekly", "day": 1}).status_code == 400
    assert client.post("/api/trading/recurring", headers=h, json={"symbol": "BTC-USD", "amount": "10", "frequency": "monthly", "day": 0}).status_code == 400
    pid = body["id"]
    assert client.patch(f"/api/trading/recurring/{pid}", headers=h, json={"status": "paused"}).json()["status"] == "paused"
    assert client.patch(f"/api/trading/recurring/{pid}", headers=h, json={"amount": "40", "frequency": "weekly", "day": 4}).json()["description"] \
        == "$40.00 of BTC-USD every Friday"
    other = {"Authorization": "Bearer " + create_access_token({"sub": "o@t.io", "user_id": str(ObjectId())})}
    assert client.delete(f"/api/trading/recurring/{pid}", headers=other).status_code == 404
    assert client.delete(f"/api/trading/recurring/{pid}", headers=h).json() == {"deleted": True}
    assert client.get("/api/trading/recurring", headers=h).json()["plans"] == []
