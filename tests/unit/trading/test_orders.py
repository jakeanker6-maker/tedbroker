"""Order engine: placement, fills, reservations, P&L, sessions, expiry, recovery."""
import threading
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal as D

import pytest
from bson import ObjectId

from app.database import get_collection
from app.market_data import calendar
from app.market_data.quotes import make_quote
from app.trading import expiration, fees, funding, ledger, matching, orders, positions
from app.trading import options as opt
from app.trading.models import OrderRequest


@pytest.fixture
def db(fresh_db, monkeypatch):
    ledger.ensure_indexes()
    orders.ensure_indexes()
    monkeypatch.setattr(calendar, "equity_session", lambda now=None: "open")
    return fresh_db


def user(cash=10_000.0):
    uid = ObjectId()
    get_collection("users").insert_one({"_id": uid, "email": f"{uid}@t.io", "wallet_balance": cash})
    return str(uid)


def q(symbol="AAPL", last=100.0, bid=None, ask=None, ac="stock", **kw):
    return make_quote(symbol, ac, last=last, bid=bid, ask=ask, ts=time.time(), source="test", **kw)


def req(**kw):
    kw.setdefault("client_order_id", str(uuid.uuid4()))
    kw.setdefault("symbol", "AAPL")
    kw.setdefault("side", "buy")
    return OrderRequest(**kw)


def bal(uid):
    return ledger.get_balances(uid)


def recon(uid):
    assert ledger.reconcile(uid)["ok"], ledger.reconcile(uid)


# ------------------------------------------------------------------ market orders
def test_market_buy_fills_at_ask_with_slippage(db):
    uid = user(10_000)
    o = orders.place(uid, req(qty=D("10")), q(bid=99.98, ask=100.02))
    assert o["status"] == "filled"
    slip = matching.slippage_bps("stock", 10 * 100.02)
    expected = (D("100.02") * (1 + D(str(slip)) / 10000)).quantize(D("0.0001"))
    assert D(o["avg_fill_price"]) == expected
    b = bal(uid)
    assert b["reserved_cents"] == 0 and b["cash_cents"] == 1_000_000 - int((expected * 10 * 100).quantize(D("1")))
    p = positions.get(uid, "AAPL")
    assert p["open"] and D(p["qty"]) == 10 and D(p["cost_basis"]) == expected * 10
    recon(uid)


def test_insufficient_buying_power_rejected_and_recorded(db):
    uid = user(500)
    with pytest.raises(orders.OrderError) as e:
        orders.place(uid, req(qty=D("10")), q())
    assert e.value.code == "insufficient_buying_power"
    o = get_collection("orders").find_one({"user_id": uid})
    assert o["status"] == "rejected" and bal(uid)["reserved_cents"] == 0


def test_duplicate_client_order_id_is_idempotent(db):
    uid = user()
    r = req(qty=D("1"), type="limit", limit_price=D("90"))
    a = orders.place(uid, r, q())
    b = orders.place(uid, r, q())
    assert a["_id"] == b["_id"] and bal(uid)["reserved_cents"] == 9000
    assert get_collection("orders").count_documents({"user_id": uid}) == 1


def test_concurrent_buys_cannot_overspend(db):
    uid = user(1_000)
    results = []

    def buy():
        try:
            results.append(orders.place(uid, req(qty=D("4"), type="limit", limit_price=D("101")), q())["status"])
        except orders.OrderError as exc:
            results.append(exc.code)
    ts = [threading.Thread(target=buy) for _ in range(5)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert results.count("filled") == 2 and results.count("insufficient_buying_power") == 3
    assert bal(uid)["cash_cents"] >= 0
    recon(uid)


# ------------------------------------------------------------------ limit orders
def test_limit_buy_rests_then_fills_at_better_price(db):
    uid = user()
    o = orders.place(uid, req(qty=D("5"), type="limit", limit_price=D("95"), tif="gtc"), q(bid=99.9, ask=100.1))
    assert o["status"] == "accepted" and bal(uid)["reserved_cents"] == 47_500
    assert orders.process(o["_id"], q(last=96, bid=95.9, ask=96.1)) is None
    f = orders.process(o["_id"], q(last=94.5, bid=94.4, ask=94.6))
    assert D(f["price"]) == D("94.6")                      # min(limit, ask)
    o = orders.orders_col().find_one({"_id": o["_id"]})
    assert o["status"] == "filled" and o["reserved_cents"] == 0 and bal(uid)["reserved_cents"] == 0
    recon(uid)


def test_limit_sell_and_realized_pnl_with_regulatory_fees(db):
    uid = user()
    orders.place(uid, req(qty=D("10")), q(bid=99.99, ask=100.0))
    basis = D(positions.get(uid, "AAPL")["cost_basis"])
    s = orders.place(uid, req(side="sell", qty=D("4"), type="limit", limit_price=D("110")), q(bid=110.5, ask=110.6))
    fill = orders.fills_col().find_one({"order_id": s["_id"]})
    assert D(fill["price"]) == D("110.5")                  # max(limit, bid)
    gross = D("110.5") * 4
    fee = fees.compute("stock", True, D("4"), gross)["total"]
    assert fee == D("0.03") and fill["fee_items"] == {"sec_fee": "0.02", "finra_taf": "0.01"}
    realized = D(fill["realized_pnl"])
    assert realized == (gross - basis * D("0.4") - D(fill["fee"])).quantize(D("0.0000000001"))
    p = positions.get(uid, "AAPL")
    assert D(p["qty"]) == 6 and D(p["realized_pnl"]) == realized
    # sale proceeds settle T+1: buying power yes, withdrawal no
    assert funding.withdrawable_cents(uid) == bal(uid)["available_cents"] - fill["cash_delta_cents"]
    recon(uid)


def test_cannot_sell_more_than_free_position(db):
    uid = user()
    orders.place(uid, req(qty=D("10")), q())
    with pytest.raises(orders.OrderError) as e:
        orders.place(uid, req(side="sell", qty=D("11")), q())
    assert e.value.code == "insufficient_position"
    orders.place(uid, req(side="sell", qty=D("7"), type="limit", limit_price=D("120"), tif="gtc"), q())
    with pytest.raises(orders.OrderError):
        orders.place(uid, req(side="sell", qty=D("4")), q())   # 7 already committed
    with pytest.raises(orders.OrderError) as e:
        orders.place(uid, req(symbol="MSFT", side="sell", qty=D("1")), q("MSFT"))
    assert e.value.code == "no_position"


# ------------------------------------------------------------------ stops
def test_stop_sell_triggers_and_fills_at_bid(db):
    uid = user()
    orders.place(uid, req(qty=D("10")), q())
    o = orders.place(uid, req(side="sell", qty=D("10"), type="stop", stop_price=D("95"), tif="gtc"), q())
    assert orders.process(o["_id"], q(last=96)) is None
    f = orders.process(o["_id"], q(last=94.9, bid=94.85, ask=94.95))
    assert f and D(f["price"]) < D("94.85")                # market after trigger, with slippage
    o = orders.orders_col().find_one({"_id": o["_id"]})
    assert [h["status"] for h in o["status_history"]][-2:] == ["triggered", "filled"]
    assert not positions.get(uid, "AAPL")["open"]


def test_stop_limit_becomes_resting_limit(db):
    uid = user()
    o = orders.place(uid, req(qty=D("1"), type="stop_limit", stop_price=D("105"), limit_price=D("106"), tif="gtc"), q())
    assert orders.process(o["_id"], q(last=105.5, bid=106.4, ask=106.5)) is None   # triggered, ask > limit
    assert orders.orders_col().find_one({"_id": o["_id"]})["status"] == "triggered"
    f = orders.process(o["_id"], q(last=105.8, bid=105.7, ask=105.9))
    assert D(f["price"]) == D("105.9")


def test_trailing_stop_follows_high(db):
    uid = user()
    orders.place(uid, req(qty=D("10")), q())
    o = orders.place(uid, req(side="sell", qty=D("10"), type="trailing_stop", trail_percent=D("5"), tif="gtc"), q())
    for px in (100, 110, 120):
        assert orders.process(o["_id"], q(last=px)) is None
    o2 = orders.orders_col().find_one({"_id": o["_id"]})
    assert o2["trail_watermark"] == 120 and D(o2["stop_price"]) == D("114")
    assert orders.process(o["_id"], q(last=115)) is None
    assert orders.process(o["_id"], q(last=113.9)) is not None


def test_stops_do_not_trigger_outside_regular_session(db, monkeypatch):
    uid = user()
    orders.place(uid, req(qty=D("10")), q())
    o = orders.place(uid, req(side="sell", qty=D("10"), type="stop", stop_price=D("95"), tif="gtc"), q())
    monkeypatch.setattr(calendar, "equity_session", lambda now=None: "post")
    assert orders.process(o["_id"], q(last=90)) is None
    assert not orders.orders_col().find_one({"_id": o["_id"]})["triggered"]


@pytest.mark.parametrize("side,stop", [("sell", "101"), ("buy", "99")])
def test_stop_on_wrong_side_of_market_rejected(db, side, stop):
    uid = user()
    orders.place(uid, req(qty=D("10")), q())
    with pytest.raises(orders.OrderError) as e:
        orders.place(uid, req(side=side, qty=D("1"), type="stop", stop_price=D(stop), tif="gtc"), q())
    assert e.value.code == "invalid_stop"


# ------------------------------------------------------------------ sessions, TIF, validation
def test_market_order_queued_when_closed_then_fills_at_open(db, monkeypatch):
    uid = user()
    monkeypatch.setattr(calendar, "equity_session", lambda now=None: "closed")
    o = orders.place(uid, req(qty=D("2")), q())
    assert o["status"] == "accepted" and any("queued" in w for w in o["warnings"])
    assert orders.process(o["_id"], q(last=101, bid=101, ask=101.1)) is None
    monkeypatch.setattr(calendar, "equity_session", lambda now=None: "open")
    assert orders.process(o["_id"], q(last=103, bid=103, ask=103.1))["price"].startswith("103.1")


def test_extended_hours_limit_fills_in_premarket(db, monkeypatch):
    uid = user()
    monkeypatch.setattr(calendar, "equity_session", lambda now=None: "pre")
    o = orders.place(uid, req(qty=D("1"), type="limit", limit_price=D("101"), extended_hours=True), q(bid=100, ask=100.5))
    assert o["status"] == "filled"
    with pytest.raises(ValueError):
        req(qty=D("1"), extended_hours=True)                 # market + extended rejected by the model


def test_ioc_not_marketable_is_canceled_and_released(db):
    uid = user()
    o = orders.place(uid, req(qty=D("1"), type="limit", limit_price=D("90"), tif="ioc"), q())
    assert o["status"] == "canceled" and o["final_reason"] == "not_immediately_marketable"
    assert bal(uid)["reserved_cents"] == 0
    recon(uid)


@pytest.mark.parametrize("kw,code", [
    (dict(qty=D("1.5"), type="stop", stop_price=D("110"), tif="gtc"), "fractional_not_allowed"),
    (dict(qty=D("0.0000001")), "invalid_qty"),
    (dict(qty=D("1"), type="limit", limit_price=D("100.001")), "invalid_price"),
    (dict(qty=D("1"), type="limit", limit_price=D("10")), "price_collar"),
    (dict(qty=D("1"), side="sell_short"), "margin_required"),
    (dict(qty=D("1"), tif="gtc"), "invalid_tif"),
    (dict(symbol="NOTREAL", qty=D("1")), "unknown_symbol"),
    (dict(qty=D("0.001")), "invalid_qty"),                  # below $1 minimum
])
def test_validation_errors(db, kw, code):
    uid = user()
    with pytest.raises(orders.OrderError) as e:
        orders.place(uid, req(**kw), q())
    assert e.value.code == code


def test_fractional_market_buy_and_notional_crypto(db):
    uid = user(10_000)
    o = orders.place(uid, req(qty=D("0.5")), q(bid=100, ask=100))
    assert o["status"] == "filled" and positions.open_qty(uid, "AAPL") == D("0.5")
    btc = q("BTC-USD", last=50_000, bid=49_990, ask=50_010, ac="crypto")
    o = orders.place(uid, req(symbol="BTC-USD", notional=D("1000"), tif="gtc"), btc)
    fill = orders.fills_col().find_one({"order_id": o["_id"]})
    assert o["status"] == "filled" and o["tif"] == "gtc"
    assert abs(fill["cash_delta_cents"] + 100_000) <= 2      # $1,000 total incl. 0.5% fee
    assert D(fill["fee"]) == (D(fill["gross"]) * D("0.005")).quantize(D("0.01"))
    recon(uid)


def test_cancel_releases_and_cannot_cancel_twice(db):
    uid = user()
    o = orders.place(uid, req(qty=D("10"), type="limit", limit_price=D("90"), tif="gtc"), q())
    assert bal(uid)["reserved_cents"] == 90_000
    orders.cancel(uid, str(o["_id"]))
    assert bal(uid)["reserved_cents"] == 0
    with pytest.raises(orders.OrderError) as e:
        orders.cancel(uid, str(o["_id"]))
    assert e.value.status == 409
    with pytest.raises(orders.OrderError):
        orders.cancel(user(), str(o["_id"]))                # other users cannot see it


def test_replace_links_orders_and_moves_reservation(db):
    uid = user()
    o = orders.place(uid, req(qty=D("10"), type="limit", limit_price=D("90"), tif="gtc"), q())
    new = orders.replace(uid, str(o["_id"]), {"limit_price": D("92"), "qty": D("5")}, q())
    old = orders.orders_col().find_one({"_id": o["_id"]})
    assert old["status"] == "canceled" and old["replaced_by"] == str(new["_id"]) and new["replaces"] == str(o["_id"])
    assert bal(uid)["reserved_cents"] == 46_000
    recon(uid)


def test_day_orders_expire(db):
    uid = user()
    o = orders.place(uid, req(qty=D("1"), type="limit", limit_price=D("90")), q())
    assert o["expires_at"] is not None
    assert orders.expire_due(now=o["expires_at"] + timedelta(seconds=1)) == 1
    o = orders.orders_col().find_one({"_id": o["_id"]})
    assert o["status"] == "expired" and bal(uid)["reserved_cents"] == 0


def test_stale_quote_never_fills(db):
    uid = user()
    o = orders.place(uid, req(qty=D("1"), type="limit", limit_price=D("95"), tif="gtc"), q())
    old = make_quote("AAPL", "stock", last=90, ts=time.time() - 600, source="t")
    assert orders.process(o["_id"], old) is None


# ------------------------------------------------------------------ options
def _occ(right="C", strike=100, days=30):
    return opt.format_occ("AAPL", date.today() + timedelta(days=days), right, strike)


def oq(symbol, bid, ask):
    return make_quote(symbol, "option", last=(bid + ask) / 2, bid=bid, ask=ask, ts=time.time(), source="test")


def test_option_buy_uses_multiplier_and_commission(db):
    uid = user(10_000)
    occ = _occ()
    o = orders.place(uid, req(symbol=occ, side="buy", qty=D("2")), oq(occ, 4.9, 5.0))
    fill = orders.fills_col().find_one({"order_id": o["_id"]})
    assert o["side"] == "buy_to_open" and D(fill["price"]) == D("5.00")
    assert fill["cash_delta_cents"] == -(2 * 500 * 100 + 130)        # $1,000 + 2 x $0.65
    with pytest.raises(orders.OrderError) as e:
        orders.place(uid, req(symbol=occ, side="buy", qty=D("1.5")), oq(occ, 4.9, 5.0))
    assert e.value.code == "invalid_qty"
    with pytest.raises(orders.OrderError) as e:            # naked call from a fresh cash account
        orders.place(user(10_000), req(symbol=occ, side="sell_to_open", qty=D("1")), oq(occ, 4.9, 5.0))
    assert e.value.code == "options_level"


def test_expiration_exercise_cash_settle_and_worthless(db, monkeypatch):
    uid = user(20_000)
    call, put, otm = _occ("C", 100), _occ("P", 100), _occ("C", 150)
    for s in (call, put, otm):
        orders.place(uid, req(symbol=s, side="buy", qty=D("1")), oq(s, 1.0, 1.0))
    cash_before = bal(uid)["cash_cents"]
    for p in list(positions.col().find({"user_id": uid, "asset_class": "option", "open": True})):
        expiration.settle_position(p, 112.0)
    # call exercised: +100 shares, cash down exactly the strike x 100
    assert positions.open_qty(uid, "AAPL") == 100
    # put ITM? no: spot 112 > strike 100 -> worthless; OTM call worthless
    assert bal(uid)["cash_cents"] == cash_before - 100 * 100 * 100
    for s in (call, put, otm):
        assert not positions.get(uid, s)["open"]
    stock = positions.get(uid, "AAPL")
    assert D(stock["cost_basis"]) == D("11200")                       # settlement price basis
    recon(uid)


def test_itm_put_without_shares_closes_at_intrinsic(db):
    uid = user(5_000)
    put = _occ("P", 100)
    orders.place(uid, req(symbol=put, side="buy", qty=D("1")), oq(put, 2.0, 2.0))
    before = bal(uid)["cash_cents"]
    fills = expiration.settle_position(positions.get(uid, put), 90.0)
    assert len(fills) == 1 and D(fills[0]["price"]) == D("10.00")
    assert bal(uid)["cash_cents"] == before + 1000 * 100
    assert positions.open_qty(uid, "AAPL") == 0
    assert expiration.settle_position(positions.get(uid, put), 90.0) == []   # idempotent


def test_expiry_timing():
    d = date(2026, 11, 20)
    ny = calendar.NY
    assert not expiration.is_due(d, datetime(2026, 11, 20, 16, 14, tzinfo=ny))
    assert expiration.is_due(d, datetime(2026, 11, 20, 16, 15, tzinfo=ny))
    assert expiration.is_due(d, datetime(2026, 11, 23, 9, 0, tzinfo=ny))


# ------------------------------------------------------------------ crash recovery
def test_pending_fill_is_recovered_exactly_once(db):
    uid = user()
    o = orders.place(uid, req(qty=D("3"), type="limit", limit_price=D("90"), tif="gtc"), q())
    fill = {"_id": ObjectId(), "order_id": o["_id"], "user_id": uid, "bucket": "self", "symbol": "AAPL",
            "asset_class": "stock", "multiplier": 1, "side": "buy", "is_buy": True, "qty": "3", "price": "89",
            "gross": "267.00", "fee": "0", "fee_items": {}, "cash_delta_cents": -26700,
            "reserved_release_cents": 26700, "kind": "trade", "liquidity": "maker", "quote": None,
            "settles_at": None, "source": "manual", "status": "pending", "ts": datetime.utcnow()}
    orders.fills_col().insert_one(fill)
    assert orders.recover_pending_fills() == 1
    orders.apply_fill(dict(fill))                       # replay again: no double effects
    assert positions.open_qty(uid, "AAPL") == 3
    o = orders.orders_col().find_one({"_id": o["_id"]})
    assert o["status"] == "filled" and len(o["applied_fills"]) == 1
    assert bal(uid)["cash_cents"] == 1_000_000 - 26_700 and bal(uid)["reserved_cents"] == 0
    recon(uid)


# ------------------------------------------------------------------ pure position math
@pytest.mark.parametrize("start,delta,price,fee,expect_qty,expect_basis,expect_realized", [
    ((0, 0), 10, 100, 0, 10, 1000, 0),
    ((10, 1000), -4, 110, 1, 6, 600, 39),
    ((10, 1000), 10, 120, 0, 20, 2200, 0),
    ((0, 0), -10, 100, 0, -10, -1000, 0),          # short (Phase 2B)
    ((-10, -1000), 10, 90, 0, 0, 0, 100),
    ((10, 1000), -15, 110, 0, -5, -550, 100),       # flip
])
def test_position_math(start, delta, price, fee, expect_qty, expect_basis, expect_realized):
    qty, basis, realized, _ = positions.apply_fill_math(D(start[0]), D(start[1]), D(0), D(delta), D(price), 1, D(fee))
    assert (qty, basis, realized) == (D(expect_qty), D(expect_basis), D(expect_realized))
