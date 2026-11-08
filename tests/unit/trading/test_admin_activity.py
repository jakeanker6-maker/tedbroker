"""Read-only admin trading-activity monitor: /api/admin/trading/activity/* and app/trading/admin_activity.py.

Runs on mongomock (fresh_db) with market data monkeypatched, so no network is used.
"""
import time
from datetime import date, datetime, timedelta
from decimal import Decimal as D
from urllib.parse import quote

import pytest
from bson import ObjectId

from app.auth import create_access_token, get_password_hash
from app.database import get_collection
from app.market_data import service
from app.market_data.quotes import make_quote
from app.market_data.service import MarketDataError
from app.trading import options as opt

BASE = "/api/admin/trading/activity"
OCC = opt.format_occ("AAPL", date(2026, 12, 18), "C", 200.0)  # "AAPL  261218C00200000"
# symbol -> (asset_class, last, bid, ask, prev_close); MSFT is deliberately left unpriced.
QUOTES = {
    "AAPL": ("stock", 100.0, 99.9, 100.1, 98.0),
    "SPY": ("etf", 500.0, 499.5, 500.5, 495.0),
    OCC: ("option", 3.0, 2.9, 3.1, 2.5),
}
COLLECTIONS = ["users", "fills", "positions", "orders", "ledger_entries", "portfolio_snapshots", "copy_links"]


def _ago(**kw) -> datetime:
    return datetime.utcnow() - timedelta(**kw)


# ------------------------------------------------------------------ fixtures
@pytest.fixture
def db(fresh_db, client):
    return fresh_db


@pytest.fixture
def admin(db):
    admin_id = ObjectId()
    get_collection("admins").insert_one({
        "_id": admin_id, "username": "monitor-admin", "email": "monitor@test.com",
        "hashed_password": get_password_hash("x" * 12), "full_name": "Monitor", "role": "admin",
        "is_active": True, "created_at": None, "updated_at": None, "last_login": None,
    })
    token = create_access_token(data={"sub": "monitor-admin", "user_id": str(admin_id), "role": "admin"})
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def market(monkeypatch):
    state = {"quotes": dict(QUOTES), "candles_error": None}

    async def fake_get_quotes(symbols):
        out = {}
        for s in symbols:
            if s in state["quotes"]:
                ac, last, bid, ask, prev = state["quotes"][s]
                out[s] = make_quote(s, ac, last=last, bid=bid, ask=ask, prev_close=prev, ts=time.time(),
                                    source="test")
        return out

    async def fake_get_candles(symbol, range_="1D"):
        if state["candles_error"]:
            raise MarketDataError(state["candles_error"])
        return {"symbol": symbol, "range": range_, "interval": "5m", "source": "test", "delayed": False,
                "candles": [{"t": 1767052800, "o": 99, "h": 101, "l": 98, "c": 100.0, "v": 1},
                            {"t": 1767053100, "o": 100, "h": 102, "l": 99, "c": 101.5, "v": 1}]}

    monkeypatch.setattr(service, "get_quotes", fake_get_quotes)
    monkeypatch.setattr(service, "get_candles", fake_get_candles)
    return state


def _get(client, headers, path, **params):
    return client.get(BASE + path, headers=headers, params=params)


# ------------------------------------------------------------------ seeding helpers
def make_user(email, *, system=False, cash=10000.0, migrated=True):
    uid = ObjectId()
    doc = {"_id": uid, "email": email, "full_name": email.split("@")[0].title(), "is_system": system,
           "wallet_balance": cash}
    if migrated:
        cents = int(round(cash * 100))
        doc.update({"cash_cents": cents, "reserved_cents": 0, "available_cents": cents})
    get_collection("users").insert_one(doc)
    return str(uid)


def add_fill(uid, symbol, asset_class, *, buy=True, qty=10, price=100.0, ts=None, status="applied",
             bucket="self", realized="0", fee="0", mult=1, kind="trade", source="manual"):
    ts = ts or _ago(hours=1)
    gross = D(str(qty)) * D(str(price)) * mult
    cents = int(gross * 100) * (-1 if buy else 1)
    doc = {"_id": ObjectId(), "order_id": ObjectId(), "user_id": uid, "bucket": bucket, "symbol": symbol,
           "asset_class": asset_class, "multiplier": mult, "side": "buy" if buy else "sell", "is_buy": buy,
           "qty": str(qty), "price": str(price), "gross": f"{gross:.2f}", "fee": fee, "fee_items": {},
           "cash_delta_cents": cents, "reserved_release_cents": 0, "kind": kind, "liquidity": "taker",
           "settles_at": ts, "source": source, "status": status, "ts": ts, "realized_pnl": realized}
    get_collection("fills").insert_one(doc)
    return doc


def add_position(uid, symbol, asset_class, qty, cost, *, bucket="self", mult=1, realized="0", open_=True):
    get_collection("positions").insert_one({
        "user_id": uid, "symbol": symbol, "bucket": bucket, "asset_class": asset_class, "multiplier": mult,
        "qty": str(qty), "cost_basis": str(cost), "realized_pnl": realized, "open": open_, "version": 0,
        "applied_fills": [], "opened_at": _ago(hours=2), "created_at": _ago(hours=2),
        "updated_at": _ago(hours=2)})


def add_snapshot(uid, total_cents, ts):
    get_collection("portfolio_snapshots").insert_one({
        "user_id": uid, "ts": ts, "kind": "daily", "date": ts.date().isoformat(),
        "total_value_cents": total_cents, "equity_cents": total_cents, "cash_cents": 0,
        "positions_value_cents": 0})


def user_token(uid, role="user"):
    return {"Authorization": "Bearer " + create_access_token({"sub": "u", "user_id": uid, "role": role})}


# ------------------------------------------------------------------ validation & auth
def test_invalid_parameters_return_400(client, admin, db, market):
    assert _get(client, admin, "/summary", range="2Y").json()["detail"]["code"] == "invalid_range"
    assert _get(client, admin, "/summary", asset_class="bond").json()["detail"]["code"] == "invalid_asset_class"
    assert _get(client, admin, "/trades", side="sideways").json()["detail"]["code"] == "invalid_side"
    assert _get(client, admin, "/trades", bucket="x").json()["detail"]["code"] == "invalid_bucket"
    assert _get(client, admin, "/trades", user_id="not-an-id").json()["detail"]["code"] == "invalid_user_id"
    assert _get(client, admin, "/holdings", sort="foo").json()["detail"]["code"] == "invalid_sort"
    assert _get(client, admin, "/traders", sort="bogus").json()["detail"]["code"] == "invalid_sort"
    assert _get(client, admin, "/assets/AAPL", range="5Y").json()["detail"]["code"] == "invalid_range"
    assert _get(client, admin, "/trades", limit=0).status_code == 422
    assert _get(client, admin, "/trades", limit=201).status_code == 422
    assert _get(client, admin, "/trades", offset=-1).status_code == 422
    assert _get(client, admin, "/holdings", limit=500).status_code == 422


def test_range_defaults_to_1m(client, admin, db, market):
    r = _get(client, admin, "/summary")
    assert r.status_code == 200 and r.json()["range"] == "1M" and r.json()["asset_class"] == "all"


def test_requires_admin(client, db, market):
    uid = make_user("plain@test.com")
    paths = ["/summary", "/trades", "/holdings", "/assets/AAPL", "/traders", f"/traders/{uid}/portfolio"]
    for p in paths:
        assert client.get(BASE + p).status_code == 401, p
        assert client.get(BASE + p, headers=user_token(uid, role="user")).status_code == 403, p


# ------------------------------------------------------------------ summary
def test_summary_counts_only_applied_non_system_fills(client, admin, db, market):
    alice = make_user("alice@test.com")
    bob = make_user("bob@test.com")
    bot = make_user("bot@test.com", system=True)
    add_fill(alice, "AAPL", "stock", buy=True, qty=10, price=100)
    add_fill(alice, "AAPL", "stock", buy=False, qty=4, price=110, realized="40")
    add_fill(alice, "AAPL", "stock", buy=True, qty=5, price=100, status="pending")
    add_fill(alice, "AAPL", "stock", buy=True, qty=5, price=100, status="void")
    add_fill(alice, "AAPL", "stock", buy=True, qty=1, price=100, ts=_ago(days=40))  # outside 1M
    add_fill(bob, "SPY", "etf", buy=True, qty=2, price=500)
    add_fill(bot, "AAPL", "stock", buy=True, qty=100, price=100)
    add_position(alice, "AAPL", "stock", 6, 600)
    add_position(bob, "SPY", "etf", 2, 1000)
    add_position(bot, "AAPL", "stock", 100, 10000)

    s = _get(client, admin, "/summary", range="1M").json()
    assert s["trades"] == {"count": 3, "buys": 2, "sells": 1, "volume": "2440.00", "fees": "0.00",
                           "realized_pnl": "40.00"}
    assert [c["asset_class"] for c in s["by_asset_class"]] == ["stock", "etf"]   # volume desc
    assert s["by_asset_class"][0] == {"asset_class": "stock", "trades": 2, "buys": 1, "sells": 1,
                                      "volume": "1440.00"}
    assert s["active_traders"] == 2
    assert s["open_positions"] == 2 and s["traders_holding"] == 2

    all_ = _get(client, admin, "/summary", range="ALL").json()
    assert all_["trades"]["count"] == 4 and all_["trades"]["volume"] == "2540.00"

    opt_only = _get(client, admin, "/summary", range="ALL", asset_class="option").json()
    assert opt_only["trades"]["count"] == 0 and opt_only["by_asset_class"] == []
    assert opt_only["open_positions"] == 0 and opt_only["traders_holding"] == 0


# ------------------------------------------------------------------ trades
def test_trades_filters_pagination_and_shape(client, admin, db, market):
    alice = make_user("alice@test.com")
    bot = make_user("bot@test.com", system=True)
    for h in (1, 2, 3):
        add_fill(alice, "AAPL", "stock", buy=True, qty=1, price=100, ts=_ago(hours=h))
    for h in (4, 5):
        add_fill(alice, "AAPL", "stock", buy=False, qty=1, price=110, ts=_ago(hours=h), realized="10")
    add_fill(bot, "AAPL", "stock", buy=True, qty=1, price=100)
    add_fill(alice, "AAPL", "stock", buy=True, qty=1, price=100, status="pending")

    body = _get(client, admin, "/trades").json()
    assert body["total"] == 5 and len(body["items"]) == 5
    stamps = [i["ts"] for i in body["items"]]
    assert stamps == sorted(stamps, reverse=True)
    assert all(t.endswith("Z") for t in stamps)
    buy = body["items"][0]
    assert buy["direction"] == "buy" and buy["net_cash"] == "-100.00" and buy["realized_pnl"] is None
    assert buy["user"]["email"] == "alice@test.com" and buy["bucket_label"] == "Self-directed"
    sell = next(i for i in body["items"] if i["direction"] == "sell")
    assert sell["net_cash"] == "110.00" and sell["realized_pnl"] == "10.00" and sell["price"] == "110.0000"

    assert _get(client, admin, "/trades", side="buy").json()["total"] == 3
    assert _get(client, admin, "/trades", side="sell").json()["total"] == 2

    page = _get(client, admin, "/trades", limit=2, offset=0).json()
    assert page["total"] == 5 and len(page["items"]) == 2
    assert page["items"][0]["id"] == body["items"][0]["id"]
    tail = _get(client, admin, "/trades", limit=2, offset=4).json()
    assert tail["total"] == 5 and len(tail["items"]) == 1

    assert _get(client, admin, "/trades", user_id=alice).json()["total"] == 5
    assert _get(client, admin, "/trades", user_id=bot).json()["total"] == 0
    assert _get(client, admin, "/trades", user_id=str(ObjectId())).json()["total"] == 0
    assert _get(client, admin, "/trades", symbol="spy").json()["total"] == 0
    assert _get(client, admin, "/trades", bucket="copy").json()["total"] == 0
    assert _get(client, admin, "/trades", range="1D", side="sell").json()["total"] == 2


def test_option_fill_uses_multiplier_and_friendly_name(client, admin, db, market):
    dave = make_user("dave@test.com")
    add_fill(dave, OCC, "option", buy=True, qty=2, price=2.5, mult=100)
    item = _get(client, admin, "/trades", asset_class="option").json()["items"][0]
    assert item["gross"] == "500.00" and item["asset_class"] == "option"
    assert item["name"].startswith("AAPL") and "Call" in item["name"]


# ------------------------------------------------------------------ holdings
def test_holdings_aggregates_options_and_unpriced(client, admin, db, market):
    alice = make_user("alice@test.com")
    bob = make_user("bob@test.com")
    carol = make_user("carol@test.com")
    dave = make_user("dave@test.com")
    erin = make_user("erin@test.com")
    bot = make_user("bot@test.com", system=True)
    add_position(alice, "AAPL", "stock", 10, 1000, realized="40")
    add_position(bob, "AAPL", "stock", 5, 480)
    add_position(carol, "AAPL", "stock", -2, -200)            # short
    add_position(dave, OCC, "option", 2, 500, mult=100)      # option, mid 3.00 -> 600
    add_position(erin, "MSFT", "stock", 3, 1200)              # no quote -> unpriced
    add_position(bot, "AAPL", "stock", 100, 10000)            # excluded

    h = _get(client, admin, "/holdings").json()
    syms = [i["symbol"] for i in h["items"]]
    assert syms == ["AAPL", OCC, "MSFT"]                     # market value desc, unpriced last
    aapl = h["items"][0]
    assert aapl["holders"] == 3 and aapl["long_holders"] == 2 and aapl["short_holders"] == 1
    assert aapl["net_qty"] == "13" and aapl["cost_basis"] == "1280.00"
    assert aapl["market_value"] == "1300.00" and aapl["unrealized_pnl"] == "20.00"
    assert aapl["unrealized_pnl_percent"] == "1.56"
    assert aapl["mark"] == "100.0000" and aapl["change_percent"] == "2.04"
    assert aapl["realized_pnl"] == "40.00" and aapl["unpriced_positions"] == 0

    opt_row = h["items"][1]
    assert opt_row["market_value"] == "600.00" and opt_row["unrealized_pnl"] == "100.00"
    assert opt_row["mark"] == "3.0000" and opt_row["asset_class"] == "option"

    msft = h["items"][2]
    assert msft["market_value"] is None and msft["unrealized_pnl"] is None
    assert msft["unrealized_pnl_percent"] is None and msft["mark"] is None and msft["change_percent"] is None
    assert msft["unpriced_positions"] == 1 and msft["cost_basis"] == "1200.00"

    assert [i["symbol"] for i in _get(client, admin, "/holdings", sort="holders").json()["items"]][0] == "AAPL"
    only_opt = _get(client, admin, "/holdings", asset_class="option").json()["items"]
    assert [i["symbol"] for i in only_opt] == [OCC]


def test_holdings_realized_pnl_is_lifetime_across_closed_positions(client, admin, db, market):
    alice = make_user("alice@test.com")
    add_position(alice, "AAPL", "stock", 1, 100)
    add_position(alice, "AAPL", "stock", 0, 0, bucket="copy:old", open_=False, realized="25.5")
    item = _get(client, admin, "/holdings").json()["items"][0]
    assert item["symbol"] == "AAPL" and item["realized_pnl"] == "25.50"


# ------------------------------------------------------------------ asset detail
def test_asset_detail_with_candles_markers_and_holders(client, admin, db, market):
    alice = make_user("alice@test.com")
    bot = make_user("bot@test.com", system=True)
    add_fill(alice, "AAPL", "stock", buy=True, qty=10, price=100, ts=_ago(hours=2))
    add_fill(bot, "AAPL", "stock", buy=True, qty=100, price=100, ts=_ago(hours=1))
    add_position(alice, "AAPL", "stock", 10, 1000)
    add_position(bot, "AAPL", "stock", 100, 10000)

    a = _get(client, admin, "/assets/aapl", range="1M").json()
    assert a["symbol"] == "AAPL" and a["name"] and a["asset_class"] == "stock"
    assert a["quote"]["last"] == "100.0000" and a["quote"]["bid"] == "99.9000"
    assert a["quote"]["change_percent"] == "2.04" and a["quote"]["stale"] is False
    assert a["candles"]["interval"] == "5m" and a["candles"]["source"] == "test"
    assert a["candles"]["points"][1] == {"t": 1767053100, "c": "101.5000"}
    assert a["candles_unavailable_reason"] is None
    assert a["trades_summary"]["count"] == 1 and a["trades_summary"]["buy_volume"] == "1000.00"
    assert [m["user_email"] for m in a["trade_markers"]] == ["alice@test.com"]
    assert a["holders"][0]["user"]["email"] == "alice@test.com"
    assert a["holders"][0]["market_value"] == "1000.00" and a["holders"][0]["mark"] == "100.0000"
    assert a["totals"]["holders"] == 1 and a["totals"]["market_value"] == "1000.00"
    assert a["totals"]["unrealized_pnl"] == "0.00" and a["totals"]["realized_pnl"] == "0.00"


def test_asset_detail_option_has_no_candles_but_a_quote(client, admin, db, market):
    dave = make_user("dave@test.com")
    add_position(dave, OCC, "option", 2, 500, mult=100)
    r = _get(client, admin, f"/assets/{quote(OCC)}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["asset_class"] == "option" and body["candles"] is None
    assert body["candles_unavailable_reason"] == "Candles are not available for option contracts"
    assert body["quote"]["mid"] == "3.0000"
    assert body["holders"][0]["market_value"] == "600.00"


def test_candle_failure_does_not_fail_the_request(client, admin, db, market):
    market["candles_error"] = "provider down"
    body = _get(client, admin, "/assets/AAPL").json()
    assert body["candles"] is None and body["candles_unavailable_reason"] == "provider down"
    assert body["quote"]["last"] == "100.0000"


def test_asset_detail_unknown_symbol_is_404(client, admin, db, market):
    r = _get(client, admin, "/assets/NOSUCHTHING")
    assert r.status_code == 404 and r.json()["detail"]["code"] == "unknown_symbol"


# ------------------------------------------------------------------ traders
def _seed_traders(db_):
    alice = make_user("alice@test.com", cash=9000.0)
    carol = make_user("carol@test.com", cash=3000.0)
    bob = make_user("bob@test.com", cash=5000.0)      # no activity: must not be listed
    bot = make_user("bot@test.com", system=True, cash=0.0)
    add_position(alice, "AAPL", "stock", 10, 1000)
    add_fill(alice, "AAPL", "stock", buy=True, qty=10, price=100, ts=_ago(hours=1))
    add_snapshot(alice, 900_000, _ago(days=10))
    add_position(carol, "SPY", "etf", 2, 1000)
    add_fill(carol, "SPY", "etf", buy=True, qty=2, price=500, ts=_ago(hours=1))
    add_position(bot, "AAPL", "stock", 100, 10000)
    return alice, carol, bob, bot


def test_traders_valuation_return_and_membership(client, admin, db, market):
    alice, carol, bob, bot = _seed_traders(db)
    body = _get(client, admin, "/traders").json()
    assert body["total"] == 2
    emails = [t["user"]["email"] for t in body["items"]]
    assert emails == ["alice@test.com", "carol@test.com"]          # equity desc
    a = body["items"][0]
    assert a["cash"] == "9000.00" and a["positions_value"] == "1000.00" and a["equity"] == "10000.00"
    assert a["total_value"] == "10000.00" and a["unrealized_pnl"] == "0.00"
    assert a["trades"] == 1 and a["volume"] == "1000.00" and a["open_positions"] == 1
    assert a["return_percent"] == "11.11" and a["change"] == "1000.00"    # 10000 vs 9000 baseline
    assert a["last_trade_at"].endswith("Z")
    c = body["items"][1]
    assert c["return_percent"] is None and c["change"] is None            # no snapshot: not measured
    assert c["equity"] == "4000.00"

    by_return = _get(client, admin, "/traders", sort="return").json()["items"]
    assert [t["user"]["email"] for t in by_return] == ["alice@test.com", "carol@test.com"]


def test_traders_asset_class_filter_and_paging(client, admin, db, market):
    _seed_traders(db)
    stock = _get(client, admin, "/traders", asset_class="stock").json()
    assert stock["asset_class"] == "stock" and stock["total"] == 1
    assert stock["items"][0]["user"]["email"] == "alice@test.com"
    assert stock["items"][0]["positions_value"] == "1000.00"
    assert stock["items"][0]["trades"] == 1

    page1 = _get(client, admin, "/traders", limit=1, offset=0).json()
    page2 = _get(client, admin, "/traders", limit=1, offset=1).json()
    assert page1["total"] == 2 and page2["total"] == 2
    assert page1["items"][0]["user"]["email"] == "alice@test.com"
    assert page2["items"][0]["user"]["email"] == "carol@test.com"


# ------------------------------------------------------------------ trader portfolio
def test_trader_portfolio_detail(client, admin, db, market):
    alice, carol, bob, bot = _seed_traders(db)
    add_position(alice, "AAPL", "stock", 0, 0, bucket="copy:old", open_=False, realized="40")
    add_fill(alice, "AAPL", "stock", buy=False, qty=1, price=110, ts=_ago(hours=3), realized="10")
    r = _get(client, admin, f"/traders/{alice}/portfolio", range="1M")
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["user"] == {"id": alice, "email": "alice@test.com", "full_name": "Alice",
                         "is_system": False}
    s = b["summary"]
    assert s["total_value"] == "10000.00" and s["cash"] == "9000.00" and s["positions_value"] == "1000.00"
    assert s["unrealized_pnl"] == "0.00" and s["realized_pnl_lifetime"] == "40.00"  # from positions
    assert s["realized_pnl_range"] == "10.00" and s["trades_range"] == 2 and s["volume_range"] == "1110.00"
    assert "buying_power" in s
    alloc = {a["asset_class"]: a for a in b["allocation"]}
    assert alloc["cash"]["value"] == "9000.00" and alloc["stock"]["value"] == "1000.00"
    assert b["history"]["range"] == "1M" and b["history"]["points"][-1]["value"] == "10000.00"
    assert len(b["positions"]) == 1 and b["positions"][0]["symbol"] == "AAPL"
    assert [t["direction"] for t in b["trades"]] == ["buy", "sell"]   # newest first (buy 1h ago)
    assert b["trades"][0]["user"]["id"] == alice


def test_trader_portfolio_404_and_409(client, admin, db, market):
    bot = make_user("bot@test.com", system=True)
    raw = make_user("raw@test.com", migrated=False)
    assert _get(client, admin, f"/traders/{bot}/portfolio").status_code == 404
    assert _get(client, admin, f"/traders/{ObjectId()}/portfolio").status_code == 404
    assert _get(client, admin, "/traders/not-an-object-id/portfolio").status_code == 404
    r = _get(client, admin, f"/traders/{raw}/portfolio")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "ledger_not_initialised"
    assert "cash_cents" not in get_collection("users").find_one({"_id": ObjectId(raw)})


def test_read_only_no_writes(client, admin, db, market):
    alice, carol, bob, bot = _seed_traders(db)
    raw = make_user("raw@test.com", migrated=False)
    before = {c: list(get_collection(c).find({}, sort=[("_id", 1)])) for c in COLLECTIONS}
    for path, params in [("/summary", {}), ("/trades", {"side": "buy"}), ("/holdings", {}),
                         (f"/assets/AAPL", {}), ("/traders", {"sort": "return"}),
                         (f"/traders/{alice}/portfolio", {}), (f"/traders/{raw}/portfolio", {})]:
        assert _get(client, admin, path, **params).status_code in (200, 409), path
    after = {c: list(get_collection(c).find({}, sort=[("_id", 1)])) for c in COLLECTIONS}
    assert before == after


# ------------------------------------------------------------------ module helpers
def test_money_and_quantity_formatting():
    from app.trading import admin_activity as aa
    assert aa.money(D("-0.001")) == "0.00"
    assert aa.money(D("1234.565")) == "1234.57"          # half up
    assert aa.qty_str(D("0E-10")) == "0" and aa.qty_str(D("10.50000")) == "10.5"
    assert aa.px(None) is None and aa.px(3) == "3.0000"
