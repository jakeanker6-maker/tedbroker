"""Phase 6 failure drill: the server dies with resting orders, a live copy allocation, a
pending withdrawal and a half-applied fill. A fresh engine must finish the fill exactly
once, resume matching the remaining orders, and leave no reservation leaks."""
import asyncio
import time
import uuid
from datetime import datetime
from decimal import Decimal as D

from bson import ObjectId

from app.database import get_collection
from app.market_data import calendar, service
from app.market_data.bus import PriceBus
from app.market_data.quotes import make_quote
from app.trading import bots, copy_engine, funding, integrity, ledger, orders, portfolio, positions, risk_monitor
from app.trading import engine as engine_mod
from app.trading.models import OrderRequest


class NoBots:
    stats: dict = {}

    async def start(self):
        pass

    async def tick(self):
        pass

    def stop(self):
        pass


def q(sym, last):
    return make_quote(sym, "stock", last=last, bid=last - 0.01, ask=last + 0.01, prev_close=last, ts=time.time(), source="t")


async def test_restart_recovers_fill_resumes_orders_and_leaks_nothing(fresh_db, monkeypatch):
    ledger.ensure_indexes()
    orders.ensure_indexes()
    copy_engine.ensure_indexes()
    monkeypatch.setattr(calendar, "equity_session", lambda now=None: "open")
    prices = {"AAPL": 100.0, "MSFT": 400.0}

    async def fake_quote(symbol, asset_class=None, max_age=None):
        return q(symbol, prices.get(symbol, 50.0))

    async def nothing(*a, **k):
        return 0
    monkeypatch.setattr(service, "get_quote", fake_quote)
    monkeypatch.setattr(portfolio, "snapshot_all", nothing)
    monkeypatch.setattr(risk_monitor, "run", nothing)

    uid = ObjectId()
    get_collection("users").insert_one({"_id": uid, "email": "r@t.io", "wallet_balance": 20_000.0})
    uid = str(uid)
    a = orders.place(uid, OrderRequest(client_order_id=str(uuid.uuid4()), symbol="AAPL", side="buy", qty=D("3"),
                                       type="limit", limit_price=D("90"), tif="gtc"), q("AAPL", 100))
    m = orders.place(uid, OrderRequest(client_order_id=str(uuid.uuid4()), symbol="MSFT", side="buy", qty=D("2"),
                                       type="limit", limit_price=D("380"), tif="gtc"), q("MSFT", 400))
    tid = get_collection("expert_traders").insert_one({
        "full_name": "Tess", "profile_photo": "", "description": "d", "specialization": "Technology Stocks",
        "ytd_return": 1.0, "win_rate": 1.0, "copiers": 1, "minimum_copy_amount": 100,
        "assets_under_management": 100_000, "max_drawdown": 1.0, "risk_score": 5, "trades": []}).inserted_id
    bots.ensure_bots()
    copy_engine.create_link(uid, str(tid), D("1000"))
    wd = ObjectId()
    funding.hold_withdrawal(str(wd), uid, 500.0, "bank")
    assert integrity.check_user(uid)["ok"]

    # crash in the middle of filling the AAPL order: fill recorded, nothing applied yet
    fill = {"_id": ObjectId(), "order_id": a["_id"], "user_id": uid, "bucket": "self", "symbol": "AAPL",
            "asset_class": "stock", "multiplier": 1, "side": "buy", "is_buy": True, "qty": "3", "price": "89",
            "gross": "267.00", "fee": "0", "fee_items": {}, "cash_delta_cents": -26700,
            "reserved_release_cents": 27000, "kind": "trade", "liquidity": "maker", "quote": None,
            "settles_at": None, "source": "manual", "status": "pending", "ts": datetime.utcnow()}
    orders.fills_col().insert_one(fill)

    # restart: a brand-new engine on a brand-new bus
    bus = PriceBus()
    eng = engine_mod.Engine(bus)
    eng.bots = NoBots()
    await eng.start()
    try:
        assert orders.orders_col().find_one({"_id": a["_id"]})["status"] == "filled"   # recovered once
        assert positions.open_qty(uid, "AAPL") == 3
        assert m["_id"] in eng.by_symbol["MSFT"] and "MSFT" in bus.demand()          # resumed watching
        bus.publish(q("MSFT", 379.0))
        for _ in range(60):
            await asyncio.sleep(0.05)
            if orders.orders_col().find_one({"_id": m["_id"]})["status"] == "filled":
                break
        assert orders.orders_col().find_one({"_id": m["_id"]})["status"] == "filled"
    finally:
        await eng.stop()

    orders.apply_fill(dict(fill))           # a second replay changes nothing
    report = integrity.check_user(uid)
    assert report["ok"], report
    parts = report["reservations"]["parts"]
    assert parts == {"open_orders": 0, "copy_allocations": 100_000, "withdrawals": 50_000}
    funding.release_withdrawal(str(wd), uid)
    assert integrity.reservation_audit(uid)["parts"]["withdrawals"] == 0
    assert integrity.check_user(uid)["ok"]


def test_audit_flags_a_leaked_hold(fresh_db, monkeypatch):
    ledger.ensure_indexes()
    orders.ensure_indexes()
    monkeypatch.setattr(calendar, "equity_session", lambda now=None: "open")
    uid = ObjectId()
    get_collection("users").insert_one({"_id": uid, "email": "l@t.io", "wallet_balance": 5_000.0})
    uid = str(uid)
    o = orders.place(uid, OrderRequest(symbol="AAPL", side="buy", qty=D("1"), type="limit", limit_price=D("50"),
                                       tif="gtc"), q("AAPL", 100))
    # simulate a bug: the order is closed without releasing its hold
    orders.orders_col().update_one({"_id": o["_id"]}, {"$set": {"status": "canceled"}})
    audit = integrity.reservation_audit(uid)
    assert not audit["ok"] and audit["closed_orders_holding_cash"] == [str(o["_id"])]
    assert audit["difference_cents"] == 5000
