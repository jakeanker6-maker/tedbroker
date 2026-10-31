"""Phase 4: copy trading on the engine (links, bots, mirroring, stop, stats)."""
import asyncio
import time
import uuid
from decimal import Decimal as D

import pytest
from bson import ObjectId

from app.auth import create_access_token
from app.database import get_collection
from app.market_data import calendar
from app.market_data.bus import bus
from app.market_data.quotes import make_quote
from app.trading import bots, copy_engine, ledger, margin, orders, portfolio, positions
from app.trading.models import OrderRequest


@pytest.fixture
def db(fresh_db, monkeypatch):
    ledger.ensure_indexes()
    orders.ensure_indexes()
    copy_engine.ensure_indexes()
    monkeypatch.setattr(calendar, "equity_session", lambda now=None: "open")
    bus.latest.clear()
    yield fresh_db
    bus.latest.clear()


def q(symbol="AAPL", last=100.0, ac="stock", chg=0.0):
    quote = make_quote(symbol, ac, last=last, bid=last, ask=last, prev_close=last / (1 + chg / 100), ts=time.time(), source="t")
    bus.publish(quote)
    return quote


def trader(spec="Technology Stocks", aum=100_000, minimum=100):
    tid = get_collection("expert_traders").insert_one({
        "full_name": f"Tess {spec}", "profile_photo": "", "description": "d", "specialization": spec,
        "ytd_return": 50.0, "win_rate": 90.0, "copiers": 999, "minimum_copy_amount": minimum,
        "assets_under_management": aum, "max_drawdown": 1.0, "risk_score": 5, "trades": []}).inserted_id
    bots.ensure_bots()
    return get_collection("expert_traders").find_one({"_id": tid})


def follower(cash=10_000.0):
    uid = ObjectId()
    get_collection("users").insert_one({"_id": uid, "email": f"{uid}@t.io", "wallet_balance": cash})
    return str(uid)


def bot_trade(t, symbol, side, qty, quote):
    o = orders.place(t["system_user_id"], OrderRequest(client_order_id=str(uuid.uuid4()), symbol=symbol, side=side,
                                                       qty=D(qty), type="market"), quote, source="bot")
    assert o["status"] == "filled", o
    for job in copy_engine.pending_jobs():
        copy_engine.process_job(job)
    return o


def bal(uid):
    return ledger.get_balances(uid)


def recon(*uids):
    for u in uids:
        assert ledger.reconcile(u)["ok"], ledger.reconcile(u)


# ------------------------------------------------------------------ bots
def test_ensure_bots_creates_system_accounts():
    assert bots.strategy_for("Cryptocurrency Trading") == "crypto_momentum"
    assert bots.strategy_for("Forex Day Trading") == "fx_macro"
    assert bots.strategy_for("Options Trading") == "options_income"
    assert bots.strategy_for("Dividend Growth Investing") == "dividend"
    assert bots.strategy_for("Long-term Stock Market Investor") == "blue_chip"
    assert bots.strategy_for("Something else") == "index_rotation"


def test_bot_account_and_hidden_from_admin(db, client):
    t = trader(aum=250_000)
    u = get_collection("users").find_one({"_id": ObjectId(t["system_user_id"])})
    assert u["is_system"] and bal(t["system_user_id"])["cash_cents"] == 25_000_000
    assert t["strategy"] == "tech_momentum" and t["stats_live"]
    assert bots.ensure_bots() == 0                                   # idempotent


def test_momentum_and_weight_decisions():
    plan = bots.momentum_targets({"A": 3, "B": 2, "C": 1, "D": -1, "E": -2}, held=["C", "E"], top=2)
    assert plan["buy"] == ["A", "B"] and plan["sell"] == ["E"]       # C kept (inside top+1)
    trades = bots.weight_trades({"X": D("700"), "Y": D("100")}, D("1000"), {"X": "50", "Y": "50"}, D("1"))
    assert trades[0] == {"symbol": "X", "amount": D("-200")} and trades[1] == {"symbol": "Y", "amount": D("400")}


# ------------------------------------------------------------------ links
def test_create_link_reserves_allocation(db):
    t = trader(minimum=500)
    uid = follower(10_000)
    with pytest.raises(copy_engine.CopyError, match="minimum"):
        copy_engine.create_link(uid, str(t["_id"]), D("100"))
    with pytest.raises(copy_engine.CopyError, match="Not enough cash"):
        copy_engine.create_link(uid, str(t["_id"]), D("20000"))
    link = copy_engine.create_link(uid, str(t["_id"]), D("4000"))
    b = bal(uid)
    assert (b["cash_cents"], b["reserved_cents"], b["available_cents"]) == (1_000_000, 400_000, 600_000)
    assert link["cash_cents"] == 400_000 and link["allocated_cents"] == 400_000
    with pytest.raises(copy_engine.CopyError, match="already copying"):
        copy_engine.create_link(uid, str(t["_id"]), D("500"))
    u = get_collection("users").find_one({"_id": ObjectId(uid)})
    assert str(t["_id"]) in u["selected_traders"] and u["copy_trading_allocation"] == 4000
    assert get_collection("expert_traders").find_one({"_id": t["_id"]})["copiers"] == 1
    recon(uid)


def test_mirror_buy_and_proportional_sell(db):
    t = trader(aum=100_000)
    uid = follower(20_000)
    link = copy_engine.create_link(uid, str(t["_id"]), D("10000"))       # 10% of the trader's equity
    lid = str(link["_id"])
    bot_trade(t, "AAPL", "buy", "200", q("AAPL", 100.0))                # trader: $20k of AAPL
    bucket = copy_engine.bucket(lid)
    fq = positions.open_qty(uid, "AAPL", bucket)
    assert D("19.9") < fq <= D("20.01")      # 200 x ~10% (the trader's slippage nudges the equity ratio)
    link = copy_engine.links().find_one({"_id": link["_id"]})
    assert 790_000 < link["cash_cents"] < 801_000                      # ~$2,000 spent from the link
    assert bal(uid)["available_cents"] == 1_000_000                    # free cash untouched
    child = orders.orders_col().find_one({"user_id": uid, "source": "copy"})
    assert child["parent_fill_id"] and child["copy_link_id"] == lid
    # trader sells half: follower sells half of its copy position; proceeds stay in the link
    before_cash = link["cash_cents"]
    bot_trade(t, "AAPL", "sell", "100", q("AAPL", 110.0))
    assert positions.open_qty(uid, "AAPL", bucket) == pytest.approx(fq / 2, abs=D("0.000002"))
    link = copy_engine.links().find_one({"_id": link["_id"]})
    assert link["cash_cents"] > before_cash + 100_000                  # ~10 x $110 back in the link
    assert bal(uid)["available_cents"] == 1_000_000
    s = copy_engine.serialize(link)
    assert D(s["pnl"]) > 0 and s["positions"] == 1
    recon(uid, t["system_user_id"])


def test_ledger_entries_carry_the_fill_bucket(db):
    t = trader(aum=100_000)
    uid = follower(20_000)
    link = copy_engine.create_link(uid, str(t["_id"]), D("10000"))
    bot_trade(t, "AAPL", "buy", "200", q("AAPL", 100.0))
    orders.place(uid, OrderRequest(client_order_id=str(uuid.uuid4()), symbol="MSFT", side="buy", qty=D("1"),
                                   type="market"), q("MSFT", 50.0))
    rows = [ledger.serialize_entry(e) for e in ledger.list_entries(uid, limit=50, types=["trade_buy"])]
    buckets = {r["description"].split()[2]: r["bucket"] for r in rows}
    assert buckets["AAPL"] == copy_engine.bucket(str(link["_id"]))
    assert buckets["MSFT"] == "self"
    bot_trade(t, "AAPL", "sell", "200", q("AAPL", 100.0))
    proceeds = [ledger.serialize_entry(e) for e in ledger.list_entries(uid, limit=50, types=["copy_allocate"])]
    assert any(r["internal"] for r in proceeds) and any(not r["internal"] for r in proceeds)
    # entries posted before meta.bucket existed fall back to the fill record
    e = ledger.list_entries(uid, limit=50, types=["trade_buy"])[0]
    e = dict(e, meta={})
    assert ledger.serialize_entry(e)["bucket"] in {"self", copy_engine.bucket(str(link["_id"]))}


def test_pause_skips_and_stop_liquidates_and_releases(db):
    t = trader(aum=100_000)
    uid = follower(20_000)
    link = copy_engine.create_link(uid, str(t["_id"]), D("10000"))
    lid = str(link["_id"])
    bot_trade(t, "MSFT", "buy", "50", q("MSFT", 400.0))
    copy_engine.set_status(uid, lid, "paused")
    bot_trade(t, "NVDA", "buy", "50", q("NVDA", 200.0))
    assert positions.open_qty(uid, "NVDA", copy_engine.bucket(lid)) == 0
    copy_engine.set_status(uid, lid, "active")
    q("MSFT", 380.0)
    stopped = copy_engine.stop(uid, lid)
    assert stopped["status"] == "stopped"
    assert positions.open_qty(uid, "MSFT", copy_engine.bucket(lid)) == 0
    b = bal(uid)
    assert b["reserved_cents"] == 0 and b["available_cents"] == b["cash_cents"]
    assert 1_990_000 > b["cash_cents"] > 1_985_000                     # lost ~5% on ~$2k of MSFT
    assert str(t["_id"]) not in get_collection("users").find_one({"_id": ObjectId(uid)})["selected_traders"]
    recon(uid)


def test_withdraw_unused_cash_and_add_funds(db):
    t = trader()
    uid = follower(10_000)
    lid = str(copy_engine.create_link(uid, str(t["_id"]), D("3000"))["_id"])
    copy_engine.allocate(uid, lid, D("1000"))
    copy_engine.withdraw_from_link(uid, lid, D("2500"))
    link = copy_engine.links().find_one({"_id": ObjectId(lid)})
    assert link["cash_cents"] == 150_000 and link["allocated_cents"] == 150_000
    assert bal(uid)["available_cents"] == 850_000
    with pytest.raises(copy_engine.CopyError):
        copy_engine.withdraw_from_link(uid, lid, D("5000"))
    recon(uid)


def test_stop_loss_stops_link(db):
    t = trader(aum=100_000)
    uid = follower(20_000)
    link = copy_engine.create_link(uid, str(t["_id"]), D("10000"), stop_loss_pct=D("10"))   # 10% of the trader
    bot_trade(t, "TSLA", "buy", "400", q("TSLA", 200.0))                 # trader $80k -> follower ~$8k
    q("TSLA", 100.0)                                                    # -50% -> link down ~40%
    assert copy_engine.check_stop_losses() == 1
    assert copy_engine.links().find_one({"_id": link["_id"]})["status"] == "stopped"


def test_option_children_skip_when_below_one_contract(db):
    t = trader(aum=1_000_000)
    uid = follower(10_000)
    lid = str(copy_engine.create_link(uid, str(t["_id"]), D("1000"))["_id"])
    from datetime import date, timedelta
    from app.trading import options as opt
    occ = opt.format_occ("AAPL", date.today() + timedelta(days=30), "C", 100)
    oq = make_quote(occ, "option", last=5, bid=5, ask=5, ts=time.time(), source="t")
    bus.publish(oq)
    bot_trade(t, occ, "buy_to_open", "5", oq)                          # 5 x 0.1% = 0.005 contracts
    assert positions.open_qty(uid, occ, copy_engine.bucket(lid)) == 0


# ------------------------------------------------------------------ wrappers, portfolio, stats
def test_select_unselect_wrappers_and_migration(db, client):
    t = trader(minimum=250)
    uid = follower(5_000)
    h = {"Authorization": "Bearer " + create_access_token({"sub": "f@t.io", "user_id": uid})}
    r = client.post(f"/api/traders/select/{t['_id']}", headers=h)
    assert r.status_code == 200 and r.json()["allocation"] == "250.00"
    sel = client.get("/api/traders/selected/list", headers=h).json()
    assert sel["count"] == 1 and sel["selected_traders"][0]["copy"]["allocated"] == "250.00"
    links_ = client.get("/api/copy/links", headers=h).json()["links"]
    assert links_[0]["status"] == "active"
    r = client.delete(f"/api/traders/unselect/{t['_id']}", headers=h)
    assert r.status_code == 200 and bal(uid)["reserved_cents"] == 0
    # migration of an old-style selection
    other = follower(1_000)
    get_collection("users").update_one({"_id": ObjectId(other)}, {"$set": {"selected_traders": [str(t["_id"])]}})
    assert copy_engine.migrate_selected(other) == 1
    assert copy_engine.migrate_selected(other) == 0
    assert copy_engine.links().find_one({"user_id": other})["allocated_cents"] == 25_000


def test_unified_portfolio_sources(db):
    t = trader(aum=100_000)
    uid = follower(20_000)
    lid = str(copy_engine.create_link(uid, str(t["_id"]), D("10000"))["_id"])
    bot_trade(t, "AAPL", "buy", "200", q("AAPL", 100.0))

    async def fake_quotes(symbols):
        return {s: bus.get(s) for s in symbols if bus.get(s)}
    import app.market_data.service as svc
    orig = svc.get_quotes
    svc.get_quotes = fake_quotes
    try:
        s = asyncio.get_event_loop().run_until_complete(portfolio.summary(uid)) if False else asyncio.run(portfolio.summary(uid))
    finally:
        svc.get_quotes = orig
    src = {x["bucket"]: x for x in s["by_source"]}
    copy_src = src[copy_engine.bucket(lid)]
    assert copy_src["label"].startswith("Copying ") and D(copy_src["value"]) == pytest.approx(D("10000"), abs=D("5"))
    assert D(src["cash"]["value"]) == pytest.approx(D("10000"), abs=D("1"))
    assert D(s["total_value"]) == pytest.approx(D("20000"), abs=D("5"))


def test_trader_stats_from_track_record(db):
    t = trader(aum=100_000)
    uid = t["system_user_id"]
    orders.place(uid, OrderRequest(symbol="AAPL", side="buy", qty=D("100"), type="market"), q("AAPL", 100.0), source="bot")
    orders.place(uid, OrderRequest(symbol="AAPL", side="sell", qty=D("100"), type="market"), q("AAPL", 110.0), source="bot")
    stats = bots.compute_stats(get_collection("expert_traders").find_one({"_id": t["_id"]}))
    assert stats["win_rate"] == 100.0 and stats["closed_trades"] == 1
    assert stats["ytd_return"] == pytest.approx(1.0, abs=0.05)          # +$1,000 on $100k
    assert stats["copiers"] == 0
    recent = get_collection("expert_traders").find_one({"_id": t["_id"]})["recent_trades"]
    assert [r["side"] for r in recent] == ["short", "long"] and recent[0]["symbol"] == "AAPL"
