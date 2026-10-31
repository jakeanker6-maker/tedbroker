"""Phase 2B: margin requirements, short selling, PDT, margin calls, spreads, assignment."""
import time
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal as D

import pytest
from bson import ObjectId

from app.database import get_collection
from app.market_data import calendar
from app.market_data.bus import bus
from app.market_data.quotes import make_quote
from app.trading import borrow, dividends, expiration, ledger, margin, multileg, orders, positions, risk_monitor
from app.trading import options as opt
from app.trading.margin import Leg, naked_requirement, option_book, stock_requirement
from app.trading.models import OrderRequest


# ====================================================================== pure requirement math
@pytest.mark.parametrize("sym,qty,px,init,maint", [
    ("AAPL", 100, 100, 5000, 3000),          # long 50% / 30%
    ("AAPL", 100, 2.5, 250, 250),            # under $3: not marginable
    ("TQQQ", 100, 50, 3750, 3750),           # leveraged ETF 75%
    ("AAPL", -200, 50, 5000, 3000),          # short: 50% initial, 30% maintenance
    ("AAPL", -100, 10, 500, 500),            # short >= $5: $5/share minimum
    ("AAPL", -100, 4, 400, 400),             # short < $5: max(100%, $2.50/share)
])
def test_stock_requirements(sym, qty, px, init, maint):
    i, m = stock_requirement(sym, D(qty), D(str(px)))
    assert (i, m) == (D(init), D(maint))


@pytest.mark.parametrize("right,k,s,prem,expected", [
    ("C", 100, 100, 3, 2300),     # max(20 - 0 + 3, 10 + 3) = 23 / share
    ("C", 110, 100, 3, 1300),     # OTM by 10: max(13, 13)
    ("P", 90, 100, 2, 1200),      # max(20 - 10 + 2, 9 + 2) = 12
    ("P", 50, 100, 0.1, 510),     # deep OTM put: 10% of strike floor
])
def test_naked_option_cboe(right, k, s, prem, expected):
    assert naked_requirement(right, D(k), D(s), D(str(prem)), D(1)) == D(expected)


def L(right, k, qty, mark=1, exp=None):
    return Leg(right, D(k), D(qty), D(str(mark)), exp)


def test_option_books():
    credit_put = option_book([L("P", 100, -1, 3), L("P", 95, 1, 1)], D(100))
    assert credit_put["max_loss"] == 500 and not credit_put["unbounded"] and credit_put["net_mv"] == -200
    assert margin.option_requirement(credit_put, "margin") == 300          # width - credit
    assert margin.option_requirement(credit_put, "cash") == 500            # collateral (credit already in cash)
    covered = option_book([L("C", 110, -1, 2)], D(100), stock_qty=D(100))
    assert covered["covered_calls"] == 1 and covered["max_loss"] == 0 and not covered["unbounded"]
    naked = option_book([L("C", 110, -1, 2)], D(100))
    assert naked["unbounded"] and margin.option_requirement(naked, "margin") == naked["naked"] - 200
    condor = option_book([L("P", 90, 1), L("P", 95, -1), L("C", 105, -1), L("C", 110, 1)], D(100))
    assert condor["max_loss"] == 500 and not condor["unbounded"]
    fly = option_book([L("C", 95, 1), L("C", 100, -2), L("C", 105, 1)], D(100))
    assert fly["max_loss"] == 0
    long_call = option_book([L("C", 100, 2, 4)], D(100))
    assert margin.option_requirement(long_call, "margin") == 800             # no loan value on long options
    csp = option_book([L("P", 90, -1, 1.5)], D(100))
    assert margin.option_requirement(csp, "cash") == 9000


def test_buying_power_margin_vs_cash():
    pos = [margin.Pos("AAPL", "stock", "self", D(150), D(100))]
    m = margin.compute("margin", D("-5000"), D(0), D(0), pos)        # $10k equity, $15k stock
    assert m.equity == 10_000 and m.initial_req == 7_500 and m.maint_req == 4_500
    bp = m.buying_power()
    assert bp["stock"] == 5_000 and bp["option"] == 2_500 and bp["crypto"] == 0
    c = margin.compute("cash", D("10000"), D("1000"), D(0), [])
    assert c.buying_power()["stock"] == 9_000


def test_interest_tiers():
    assert margin.interest_rate(D(10_000)) == D("0.1325")
    assert margin.interest_rate(D(2_000_000)) == D("0.0850")
    assert margin.daily_interest(D(36_000)) == D(36_000) * D("0.1275") / 360


# ====================================================================== flows
@pytest.fixture
def db(fresh_db, monkeypatch):
    ledger.ensure_indexes()
    orders.ensure_indexes()
    risk_monitor.ensure_indexes()
    monkeypatch.setattr(calendar, "equity_session", lambda now=None: "open")
    bus.latest.clear()
    yield fresh_db
    bus.latest.clear()


def user(cash=10_000.0, account="margin", level=2):
    uid = ObjectId()
    get_collection("users").insert_one({"_id": uid, "email": f"{uid}@t.io", "wallet_balance": cash,
                                        "account_type": account, "options_level": level})
    return str(uid)


def q(symbol="AAPL", last=100.0, bid=None, ask=None, ac="stock", prev=None):
    quote = make_quote(symbol, ac, last=last, bid=bid if bid is not None else last, ask=ask if ask is not None else last,
                       prev_close=prev, ts=time.time(), source="test")
    bus.publish(quote)
    return quote


def oq(symbol, bid, ask):
    quote = make_quote(symbol, "option", last=(bid + ask) / 2, bid=bid, ask=ask, ts=time.time(), source="test")
    bus.publish(quote)
    return quote


def place(uid, quote, **kw):
    kw.setdefault("client_order_id", str(uuid.uuid4()))
    kw.setdefault("symbol", quote["symbol"])
    return orders.place(uid, OrderRequest(**kw), quote)


def cash(uid):
    return ledger.get_balances(uid)["cash_cents"] / 100


def recon(uid):
    assert ledger.reconcile(uid)["ok"]


def test_margin_buy_borrows_and_limits_withdrawal(db):
    from app.trading import funding
    uid = user(10_000)
    o = place(uid, q(last=100), side="buy", qty=D("180"))                 # $18k with $10k equity
    assert o["status"] == "filled" and o["bp_hold_cents"] > 0
    assert cash(uid) == pytest.approx(-8000, abs=10)
    st = margin.account_state(uid)
    assert st.equity == pytest.approx(10_000, abs=10) and st.margin_debit > 7_990
    assert funding.withdrawable_cents(uid) == 0                           # cash is borrowed
    with pytest.raises(orders.OrderError) as e:
        place(uid, q(last=100), side="buy", qty=D("30"))                  # $3k > remaining $2k BP
    assert e.value.code == "insufficient_buying_power"
    recon(uid)


def test_no_borrowing_below_2000_equity(db):
    uid = user(1_500)
    with pytest.raises(orders.OrderError) as e:
        place(uid, q(last=100), side="buy", qty=D("20"))
    assert e.value.code in ("margin_minimum", "insufficient_buying_power")
    assert place(uid, q(last=100), side="buy", qty=D("10"))["status"] == "filled"


def test_cash_account_cannot_short(db):
    uid = user(10_000, account="cash")
    with pytest.raises(orders.OrderError) as e:
        place(uid, q(), side="sell_short", qty=D("10"))
    assert e.value.code == "margin_required"


def test_short_sale_and_cover_with_pnl(db):
    uid = user(10_000)
    o = place(uid, q(last=50), side="sell_short", qty=D("100"))
    assert o["status"] == "filled" and positions.open_qty(uid, "AAPL") == -100
    assert cash(uid) == pytest.approx(15_000, abs=5)
    st = margin.account_state(uid)
    assert st.equity == pytest.approx(10_000, abs=5) and st.maint_req == 1_500
    with pytest.raises(orders.OrderError):
        place(uid, q(last=50), side="buy_to_cover", qty=D("101"))
    place(uid, q(last=40), side="buy_to_cover", qty=D("100"))
    p = positions.get(uid, "AAPL")
    assert not p["open"] and D(p["realized_pnl"]) == pytest.approx(D("1000"), abs=D("5"))
    recon(uid)


def test_short_sale_rules(db):
    uid = user(10_000)
    with pytest.raises(orders.OrderError) as e:
        place(uid, q(last=50), side="sell_short", qty=D("1.5"))
    assert e.value.code == "invalid_qty"
    with pytest.raises(orders.OrderError) as e:
        place(uid, q("BTC-USD", 50_000, ac="crypto"), side="sell_short", qty=D("1"))
    assert e.value.code in ("not_shortable", "invalid_side")
    down = q(last=90, prev=100)                                           # -10%: SSR
    with pytest.raises(orders.OrderError) as e:
        place(uid, down, side="sell_short", qty=D("10"))
    assert e.value.code == "ssr"
    assert place(uid, down, side="sell_short", qty=D("10"), type="limit", limit_price=D("91"), tif="gtc")["status"] == "accepted"
    loc = borrow.locate("GME", 25)
    assert not loc["easy_to_borrow"] and loc["borrow_rate_apr"] == "18.00"
    assert borrow.locate("AAPL", 100)["easy_to_borrow"]
    assert not borrow.locate("AAPL", 0.5)["shortable"]


def test_htb_borrow_fee_and_interest_charges(db):
    uid = user(10_000)
    place(uid, q("GME", 20.0), side="sell_short", qty=D("100"))           # $2,000 short, 18% APR
    place(uid, q("AAPL", 100.0), side="buy", qty=D("150"))                 # borrow ~$3,000
    u = get_collection("users").find_one({"_id": ObjectId(uid)})
    get_collection("users").update_one({"_id": u["_id"]}, {"$set": {"charges_through": "2026-10-26"}})
    before = cash(uid)
    out = borrow.charge_user(get_collection("users").find_one({"_id": u["_id"]}), date(2026, 10, 29))
    assert out["days"] == 3 and out["borrow"] == D("3.00")                 # 2000 * 0.18 / 360 * 3
    assert cash(uid) == pytest.approx(before - 3.00)
    assert out["interest"] > 0
    # month end posts the accrued interest
    u = get_collection("users").find_one({"_id": u["_id"]})
    borrow.charge_user(u, date(2026, 10, 31))
    entries = [e for e in ledger.list_entries(uid) if e["type"] == "margin_interest"]
    assert len(entries) == 1 and entries[0]["cash_delta_cents"] < 0
    assert get_collection("users").find_one({"_id": u["_id"]})["margin_interest_accrued"] == "0.000000"
    recon(uid)


def test_pattern_day_trader_blocks_fourth_day_trade(db):
    uid = user(10_000)
    for sym in ("AAPL", "MSFT", "NVDA"):
        place(uid, q(sym, 100), side="buy", qty=D("1"))
        place(uid, q(sym, 100), side="sell", qty=D("1"))
    assert orders.day_trades(uid) == 3
    place(uid, q("TSLA", 100), side="buy", qty=D("1"))
    with pytest.raises(orders.OrderError) as e:
        place(uid, q("TSLA", 100), side="sell", qty=D("1"))
    assert e.value.code == "pdt_limit"


def test_maintenance_call_then_liquidation(db):
    uid = user(10_000)
    place(uid, q(last=100), side="buy", qty=D("190"))                     # $19k long, $9k debit
    q(last=66)            # value 12,540, equity ~3,540 < maintenance 3,762, but above 90% of it
    r = risk_monitor.check_user(uid)
    assert "maintenance_call" in r["actions"]
    call = risk_monitor.open_calls(uid)[0]
    assert call["type"] == "maintenance" and D(call["amount"]) > 0
    assert get_collection("notifications").count_documents({"target_user_id": uid}) == 1
    # severe: equity < 90% of maintenance -> liquidation order at market
    q(last=55)
    r = risk_monitor.check_user(uid)
    assert any(a.startswith("liquidated") for a in r["actions"])
    liq = orders.orders_col().find_one({"user_id": uid, "source": "liquidation"})
    assert liq["status"] == "filled" and not positions.get(uid, "AAPL")["open"]
    # compliant again -> call met
    risk_monitor.check_user(uid)
    assert not risk_monitor.open_calls(uid)
    recon(uid)


def test_fed_call_after_fill_breaches_initial(db):
    uid = user(10_000)
    place(uid, q(last=100), side="buy", qty=D("195"))
    q(last=90)
    risk_monitor.after_fill(uid)
    calls = risk_monitor.open_calls(uid)
    assert calls and calls[0]["type"] == "fed"
    due = calls[0]["due_at"]
    assert due > datetime.utcnow() + timedelta(days=3)


def test_covered_call_and_cash_secured_put_in_cash_account(db):
    uid = user(20_000, account="cash", level=1)
    place(uid, q(last=100), side="buy", qty=D("100"))
    call = opt.format_occ("AAPL", date.today() + timedelta(days=30), "C", 110)
    o = place(uid, oq(call, 2.0, 2.1), side="sell_to_open", qty=D("1"))
    assert o["status"] == "filled" and positions.open_qty(uid, call) == -1
    with pytest.raises(orders.OrderError) as e:                          # shares now cover the call
        place(uid, q(last=100), side="sell", qty=D("1"))
    assert e.value.code == "insufficient_position"
    with pytest.raises(orders.OrderError):                                # a second call would be naked
        place(uid, oq(call, 2.0, 2.1), side="sell_to_open", qty=D("1"))
    put = opt.format_occ("AAPL", date.today() + timedelta(days=30), "P", 90)
    before = margin.account_state(uid).base
    place(uid, oq(put, 1.0, 1.1), side="sell_to_open", qty=D("1"))
    after = margin.account_state(uid).base
    assert before - after == pytest.approx(D("9000") - D("100") + D("0.65"), abs=D("1"))   # collateral less premium
    recon(uid)


def test_vertical_spread_debit_and_credit(db):
    uid = user(10_000, account="cash", level=3)
    exp = date.today() + timedelta(days=30)
    c100, c105 = opt.format_occ("AAPL", exp, "C", 100), opt.format_occ("AAPL", exp, "C", 105)
    quotes = {c100: oq(c100, 3.9, 4.1), c105: oq(c105, 1.9, 2.1), "AAPL": q(last=100)}
    req = multileg.MultilegRequest(strategy="vertical", qty=2, type="net_limit", net_price=D("2.05"),
                                   price_effect="debit", legs=[{"symbol": c100, "side": "buy"},
                                                               {"symbol": c105, "side": "sell"}])
    pv = multileg.preview(uid, req, quotes)
    assert pv["price_effect"] == "debit" and pv["net_mid"] == "2.00" and pv["estimated_net"] == "2.02"
    assert pv["payoff"]["max_loss"] == "-400.00" and pv["payoff"]["max_profit"] == "600.00"
    assert pv["payoff"]["breakevens"] == [102.0]
    o = multileg.place(uid, req, quotes)
    assert o["status"] == "filled" and o["avg_fill_price"] == "2.02"
    assert positions.open_qty(uid, c100) == 2 and positions.open_qty(uid, c105) == -2
    assert cash(uid) == pytest.approx(10_000 - 404 - 4 * 0.65, abs=0.01)
    g = multileg.groups_col().find_one({"group_id": o["group_id"]})
    assert g["strategy"] == "vertical" and g["qty"] == 2
    # credit put spread reserves max-loss collateral in a cash account
    p95, p90 = opt.format_occ("AAPL", exp, "P", 95), opt.format_occ("AAPL", exp, "P", 90)
    quotes.update({p95: oq(p95, 1.9, 2.1), p90: oq(p90, 0.9, 1.1)})
    credit = multileg.MultilegRequest(strategy="vertical", qty=1, type="net_limit", net_price=D("0.95"),
                                      price_effect="credit", legs=[{"symbol": p95, "side": "sell"},
                                                                   {"symbol": p90, "side": "buy"}])
    base = margin.account_state(uid).base
    o2 = multileg.place(uid, credit, quotes)
    assert o2["status"] == "filled" and o2["price_effect"] == "credit"
    assert base - margin.account_state(uid).base == pytest.approx(D("500") - D("98") + D("1.30"), abs=D("1"))
    recon(uid)


def test_net_limit_rests_until_reachable(db):
    uid = user(10_000, account="cash", level=3)
    exp = date.today() + timedelta(days=30)
    c100, c105 = opt.format_occ("AAPL", exp, "C", 100), opt.format_occ("AAPL", exp, "C", 105)
    quotes = {c100: oq(c100, 3.9, 4.1), c105: oq(c105, 1.9, 2.1), "AAPL": q()}
    req = multileg.MultilegRequest(strategy="vertical", qty=1, net_price=D("1.80"), price_effect="debit",
                                   legs=[{"symbol": c100, "side": "buy"}, {"symbol": c105, "side": "sell"}])
    o = multileg.place(uid, req, quotes)
    assert o["status"] == "accepted" and o["bp_hold_cents"] > 0
    quotes[c100] = oq(c100, 3.6, 3.8)
    assert multileg.process(o["_id"], quotes) is True
    assert orders.orders_col().find_one({"_id": o["_id"]})["status"] == "filled"


@pytest.mark.parametrize("strategy,legs,msg", [
    ("vertical", [("C", 100, 30, "buy"), ("P", 105, 30, "sell")], "same type"),
    ("straddle", [("C", 100, 30, "buy"), ("P", 105, 30, "buy")], "share a strike"),
    ("iron_condor", [("P", 90, 30, "buy"), ("P", 95, 30, "sell"), ("C", 95, 30, "sell"), ("C", 110, 30, "buy")], "below"),
    ("butterfly", [("C", 95, 30, "buy"), ("C", 100, 30, "sell"), ("C", 106, 30, "buy")], "ratio"),
])
def test_strategy_validation(db, strategy, legs, msg):
    uid = user(10_000, level=4)
    syms = [opt.format_occ("AAPL", date.today() + timedelta(days=d), r, k) for r, k, d, _ in legs]
    req = multileg.MultilegRequest(strategy=strategy, qty=1, net_price=D("1"), price_effect="debit",
                                   legs=[{"symbol": s, "side": side} for s, (_, _, _, side) in zip(syms, legs)])
    with pytest.raises(orders.OrderError) as e:
        multileg.validate_structure(strategy, multileg._resolve_legs(uid, req))
    assert msg in str(e.value)


def test_naked_strategy_requires_level_4_and_margin(db):
    uid = user(50_000, account="cash", level=3)
    exp = date.today() + timedelta(days=30)
    c, p = opt.format_occ("AAPL", exp, "C", 100), opt.format_occ("AAPL", exp, "P", 100)
    quotes = {c: oq(c, 4, 4.2), p: oq(p, 3.8, 4), "AAPL": q()}
    req = multileg.MultilegRequest(strategy="straddle", qty=1, net_price=D("7"), price_effect="credit",
                                   legs=[{"symbol": c, "side": "sell"}, {"symbol": p, "side": "sell"}])
    with pytest.raises(orders.OrderError) as e:
        multileg.place(uid, req, quotes)
    assert e.value.code == "options_level"


def test_short_option_assignment_and_expiry(db):
    uid = user(30_000, level=4)
    exp = date.today() + timedelta(days=5)
    call, put, otm = (opt.format_occ("AAPL", exp, "C", 100), opt.format_occ("AAPL", exp, "P", 120),
                      opt.format_occ("AAPL", exp, "C", 150))
    q(last=110)
    for s, px in ((call, 10.0), (put, 10.0), (otm, 0.5)):
        place(uid, oq(s, px, px), side="sell_to_open", qty=D("1"))
    cash_before = cash(uid)
    for p in list(positions.col().find({"user_id": uid, "asset_class": "option", "open": True})):
        expiration.settle_position(p, 110.0)
    # call assigned (no shares): short 100 delivered at the strike -> +$10,000 net
    # put assigned: buy 100 at the strike -> -$12,000 net; the stock legs offset to flat
    assert positions.open_qty(uid, "AAPL") == 0
    assert cash(uid) == pytest.approx(cash_before + 10_000 - 12_000, abs=1)
    assert all(not positions.get(uid, s)["open"] for s in (call, put, otm))
    kinds = {f["kind"] for f in orders.fills_col().find({"user_id": uid})}
    assert {"assignment", "expiration"} <= kinds
    recon(uid)


def test_dividends_long_credit_short_debit(db):
    longu, shortu = user(10_000), user(10_000)
    place(longu, q(last=100), side="buy", qty=D("50"))
    place(shortu, q(last=100), side="sell_short", qty=D("20"))
    lp, sp = positions.get(longu, "AAPL"), positions.get(shortu, "AAPL")
    dividends.book_dividend(lp, D("0.27"), "2026-11-09")
    dividends.book_dividend(lp, D("0.27"), "2026-11-09")                  # idempotent
    dividends.book_dividend(sp, D("0.27"), "2026-11-09")
    assert [e["type"] for e in ledger.list_entries(longu)][0] == "dividend"
    assert [e["cash_delta_cents"] for e in ledger.list_entries(longu) if e["type"] == "dividend"] == [1350]
    assert [e["cash_delta_cents"] for e in ledger.list_entries(shortu) if e["type"] == "dividend_owed"] == [-540]
