"""Read-only admin MANUAL trading-activity monitor: /api/admin/trading/activity/* and
app/trading/admin_activity.py.

Only applied fills with source "manual" count. Automated fills (bot, copy, basket, recurring,
liquidation, system) are excluded everywhere. Runs on mongomock (fresh_db) with market data
monkeypatched, so no network is used.
"""
import asyncio
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
from app.trading import admin_activity as aa
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
TRADER_FIELDS = {"user", "open_positions", "positions_value", "unrealized_pnl", "realized_pnl", "trades",
                 "volume", "realized_pnl_range", "last_trade_at"}
PORTFOLIO_SUMMARY_FIELDS = {"positions_value", "unrealized_pnl", "realized_pnl_lifetime",
                            "realized_pnl_range", "trades_range", "volume_range"}


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
def make_user(email, *, system=False, cash=10000.0):
    uid = ObjectId()
    cents = int(round(cash * 100))
    get_collection("users").insert_one({
        "_id": uid, "email": email, "full_name": email.split("@")[0].title(), "is_system": system,
        "wallet_balance": cash, "cash_cents": cents, "reserved_cents": 0, "available_cents": cents})
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


def add_position(uid, symbol, asset_class, qty, cost, *, bucket="self", mult=1, realized="0", open_=True,
                 fill=False):
    """Insert a position. fill=True also books one manual fill that opens it (so it is manual)."""
    if fill and qty:
        add_fill(uid, symbol, asset_class, buy=qty > 0, qty=abs(qty),
                 price=float(abs(D(str(cost))) / abs(D(str(qty))) / mult), ts=_ago(hours=2),
                 bucket=bucket, mult=mult)
    get_collection("positions").insert_one({
        "user_id": uid, "symbol": symbol, "bucket": bucket, "asset_class": asset_class, "multiplier": mult,
        "qty": str(qty), "cost_basis": str(cost), "realized_pnl": realized, "open": open_, "version": 0,
        "applied_fills": [], "opened_at": _ago(hours=2), "created_at": _ago(hours=2),
        "updated_at": _ago(hours=2)})


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
def test_summary_counts_only_applied_manual_non_system_fills(client, admin, db, market):
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


def test_automated_activity_is_excluded_everywhere(client, admin, db, market):
    carol = make_user("carol@test.com")
    # Automated fills of every non-manual source, on a real (non-system) account.
    add_fill(carol, "AAPL", "stock", buy=True, qty=1, price=100, source="bot")
    add_fill(carol, "AAPL", "stock", buy=True, qty=1, price=100, source="copy", bucket="copy:L1")
    add_fill(carol, "AAPL", "stock", buy=True, qty=1, price=100, source="recurring")
    add_fill(carol, "SPY", "etf", buy=True, qty=1, price=500, source="basket", bucket="basket:B1")
    add_fill(carol, "AAPL", "stock", buy=False, qty=1, price=100, source="liquidation")
    add_position(carol, "AAPL", "stock", 5, 500)                  # only automated fills behind it
    add_position(carol, "SPY", "etf", 1, 500, bucket="copy:L1")   # automated copy position

    s = _get(client, admin, "/summary", range="ALL").json()
    assert s["trades"]["count"] == 0 and s["by_asset_class"] == []
    assert s["active_traders"] == 0 and s["open_positions"] == 0 and s["traders_holding"] == 0
    assert _get(client, admin, "/trades", range="ALL").json()["total"] == 0
    assert _get(client, admin, "/trades", range="ALL", bucket="copy").json()["total"] == 0
    assert _get(client, admin, "/holdings").json()["items"] == []
    assert _get(client, admin, "/traders", range="ALL").json()["items"] == []
    p = _get(client, admin, f"/traders/{carol}/portfolio", range="ALL").json()
    assert p["positions"] == [] and p["trades"] == [] and p["allocation"] == []
    assert p["summary"]["positions_value"] == "0.00"
    assert _get(client, admin, f"/assets/AAPL", range="ALL").json()["holders"] == []


def test_mixed_self_position_is_not_manual_but_its_manual_fill_is_a_trade(client, admin, db, market):
    dan = make_user("dan@test.com")
    erin = make_user("erin@test.com")
    add_fill(dan, "AAPL", "stock", buy=True, qty=10, price=100)                      # manual
    add_fill(dan, "AAPL", "stock", buy=True, qty=5, price=100, source="recurring")  # automated, same key
    add_position(dan, "AAPL", "stock", 15, 1500)
    add_position(erin, "AAPL", "stock", 2, 200, fill=True)                           # manual only

    h = _get(client, admin, "/holdings").json()["items"][0]
    assert h["symbol"] == "AAPL" and h["holders"] == 1
    assert h["net_qty"] == "2" and h["cost_basis"] == "200.00"

    # The position is excluded, but the manual fill itself is still a manual trade.
    assert _get(client, admin, "/trades", user_id=dan).json()["total"] == 1
    traders = {t["user"]["email"]: t for t in _get(client, admin, "/traders").json()["items"]}
    assert traders["dan@test.com"]["open_positions"] == 0
    assert traders["dan@test.com"]["positions_value"] == "0.00"
    p = _get(client, admin, f"/traders/{dan}/portfolio").json()
    assert p["positions"] == [] and p["summary"]["trades_range"] == 1


def test_manual_only_position_is_included(client, admin, db, market):
    frank = make_user("frank@test.com")
    add_position(frank, "AAPL", "stock", 3, 300, fill=True)
    h = _get(client, admin, "/holdings").json()["items"]
    assert [i["symbol"] for i in h] == ["AAPL"] and h[0]["holders"] == 1 and h[0]["net_qty"] == "3"


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
    assert buy["source"] == "manual"
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
    assert _get(client, admin, "/trades", range="1D", side="sell").json()["total"] == 2


def test_bucket_copy_and_basket_are_valid_and_empty(client, admin, db, market):
    alice = make_user("alice@test.com")
    add_fill(alice, "AAPL", "stock", buy=True, qty=1, price=100)
    for b in ("copy", "basket"):
        r = _get(client, admin, "/trades", bucket=b)
        assert r.status_code == 200 and r.json()["total"] == 0 and r.json()["items"] == []
    assert _get(client, admin, "/trades", bucket="self").json()["total"] == 1


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
    add_position(alice, "AAPL", "stock", 10, 1000, realized="40", fill=True)
    add_position(bob, "AAPL", "stock", 5, 480, fill=True)
    add_position(carol, "AAPL", "stock", -2, -200, fill=True)       # short
    add_position(dave, OCC, "option", 2, 500, mult=100, fill=True)  # mid 3.00 -> 600
    add_position(erin, "MSFT", "stock", 3, 1200, fill=True)         # no quote -> unpriced
    add_position(bot, "AAPL", "stock", 100, 10000, fill=True)       # system: excluded

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
    bob = make_user("bob@test.com")
    add_position(alice, "AAPL", "stock", 1, 100, realized="25.5", fill=True)
    # bob closed out AAPL: a manual round trip, no longer holding it
    add_fill(bob, "AAPL", "stock", buy=True, qty=1, price=100, ts=_ago(hours=5))
    add_fill(bob, "AAPL", "stock", buy=False, qty=1, price=95, ts=_ago(hours=4), realized="-5")
    add_position(bob, "AAPL", "stock", 0, 0, realized="-5", open_=False)
    item = _get(client, admin, "/holdings").json()["items"][0]
    assert item["symbol"] == "AAPL" and item["holders"] == 1
    assert item["realized_pnl"] == "20.50"


# ------------------------------------------------------------------ asset detail
def test_asset_detail_with_candles_markers_and_holders(client, admin, db, market):
    alice = make_user("alice@test.com")
    bot = make_user("bot@test.com", system=True)
    add_fill(alice, "AAPL", "stock", buy=True, qty=10, price=100, ts=_ago(hours=2))
    add_fill(bot, "AAPL", "stock", buy=True, qty=100, price=100, ts=_ago(hours=1), source="bot")
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
    add_position(dave, OCC, "option", 2, 500, mult=100, fill=True)
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
    alice = make_user("alice@test.com")
    carol = make_user("carol@test.com")
    make_user("bob@test.com")                       # no activity: must not be listed
    bot = make_user("bot@test.com", system=True)
    add_position(alice, "AAPL", "stock", 10, 1000, fill=True)
    add_position(carol, "SPY", "etf", 4, 1800, fill=True)   # worth 2000, unrealized 200
    add_position(bot, "AAPL", "stock", 100, 10000, fill=True)
    return alice, carol, bot


def test_traders_rows_fields_and_valuation(client, admin, db, market):
    alice, carol, bot = _seed_traders(db)
    body = _get(client, admin, "/traders").json()
    assert body["total"] == 2
    emails = [t["user"]["email"] for t in body["items"]]
    assert emails == ["carol@test.com", "alice@test.com"]        # positions value desc (equity sort)
    c, a = body["items"]
    assert set(c) == TRADER_FIELDS                                 # account-level fields are gone
    assert a["positions_value"] == "1000.00" and a["unrealized_pnl"] == "0.00"
    assert a["open_positions"] == 1 and a["trades"] == 1 and a["volume"] == "1000.00"
    assert a["realized_pnl"] == "0.00" and a["last_trade_at"].endswith("Z")
    assert c["positions_value"] == "2000.00" and c["unrealized_pnl"] == "200.00"


def test_traders_sort_mapping_and_removed_fields(client, admin, db, market):
    _seed_traders(db)
    by_return = _get(client, admin, "/traders", sort="return").json()["items"]   # -> unrealized
    assert [t["user"]["email"] for t in by_return] == ["carol@test.com", "alice@test.com"]
    by_equity = _get(client, admin, "/traders", sort="equity").json()
    assert by_equity["sort"] == "equity" and by_equity["items"][0]["user"]["email"] == "carol@test.com"
    for t in by_equity["items"]:
        for gone in ("cash", "equity", "total_value", "return_percent", "change"):
            assert gone not in t


def test_traders_asset_class_filter_and_paging(client, admin, db, market):
    _seed_traders(db)
    stock = _get(client, admin, "/traders", asset_class="stock").json()
    assert stock["asset_class"] == "stock" and stock["total"] == 1
    assert stock["items"][0]["user"]["email"] == "alice@test.com"
    assert stock["items"][0]["positions_value"] == "1000.00" and stock["items"][0]["trades"] == 1

    page1 = _get(client, admin, "/traders", limit=1, offset=0).json()
    page2 = _get(client, admin, "/traders", limit=1, offset=1).json()
    assert page1["total"] == 2 and page2["total"] == 2
    assert page1["items"][0]["user"]["email"] == "carol@test.com"
    assert page2["items"][0]["user"]["email"] == "alice@test.com"


# ------------------------------------------------------------------ trader portfolio
def test_trader_portfolio_detail(client, admin, db, market):
    alice, carol, bot = _seed_traders(db)
    # alice's AAPL position is manual and realized 40; a manual sell realized 10; plus automated noise
    get_collection("positions").update_one({"user_id": alice, "symbol": "AAPL"}, {"$set": {"realized_pnl": "40"}})
    add_fill(alice, "AAPL", "stock", buy=False, qty=1, price=110, ts=_ago(hours=3), realized="10")
    add_fill(alice, "AAPL", "stock", buy=True, qty=1, price=100, ts=_ago(hours=1), source="copy",
             bucket="copy:L1")
    add_fill(alice, "SPY", "etf", buy=True, qty=1, price=500, ts=_ago(hours=1), source="recurring")

    r = _get(client, admin, f"/traders/{alice}/portfolio", range="1M")
    assert r.status_code == 200, r.text
    b = r.json()
    assert set(b) == {"user", "as_of", "summary", "allocation", "history", "positions", "trades"}
    assert b["user"] == {"id": alice, "email": "alice@test.com", "full_name": "Alice", "is_system": False}
    s = b["summary"]
    assert set(s) == PORTFOLIO_SUMMARY_FIELDS
    assert s["positions_value"] == "1000.00" and s["unrealized_pnl"] == "0.00"
    assert s["realized_pnl_lifetime"] == "40.00" and s["realized_pnl_range"] == "10.00"
    assert s["trades_range"] == 2 and s["volume_range"] == "1110.00"
    assert b["allocation"] == [{"asset_class": "stock", "value": "1000.00", "percent": "100.00"}]
    assert [p["symbol"] for p in b["positions"]] == ["AAPL"]
    assert [t["direction"] for t in b["trades"]] == ["buy", "sell"]   # copy/recurring excluded
    assert b["trades"][0]["user"]["id"] == alice


def test_trader_portfolio_404_and_empty_unmigrated_account(client, admin, db, market):
    bot = make_user("bot@test.com", system=True)
    raw = ObjectId()
    get_collection("users").insert_one({"_id": raw, "email": "raw@test.com", "wallet_balance": 5.0})
    assert _get(client, admin, f"/traders/{bot}/portfolio").status_code == 404
    assert _get(client, admin, f"/traders/{ObjectId()}/portfolio").status_code == 404
    assert _get(client, admin, "/traders/not-an-object-id/portfolio").status_code == 404
    r = _get(client, admin, f"/traders/{raw}/portfolio")
    assert r.status_code == 200
    assert r.json()["summary"]["positions_value"] == "0.00" and r.json()["allocation"] == []
    assert "cash_cents" not in get_collection("users").find_one({"_id": raw})


def test_removed_fields_absent_everywhere(client, admin, db, market):
    alice, carol, bot = _seed_traders(db)
    traders_text = repr(_get(client, admin, "/traders").json())
    for gone in ("'cash'", "'total_value'", "'return_percent'", "'change'", "'history'"):
        assert gone not in traders_text, gone
    portfolio_text = repr(_get(client, admin, f"/traders/{alice}/portfolio").json())
    for gone in ("'cash'", "'equity'", "'total_value'", "'buying_power'", "'return_percent'"):
        assert gone not in portfolio_text, gone
    assert "'manual_positions_value'" in portfolio_text   # history is the only series, and it is named


def test_read_only_no_writes(client, admin, db, market):
    alice, carol, bot = _seed_traders(db)
    raw = ObjectId()
    get_collection("users").insert_one({"_id": raw, "email": "raw@test.com", "wallet_balance": 5.0})
    before = {c: list(get_collection(c).find({}, sort=[("_id", 1)])) for c in COLLECTIONS}
    for path, params in [("/summary", {}), ("/trades", {"side": "buy"}), ("/holdings", {}),
                         ("/assets/AAPL", {}), ("/traders", {"sort": "return"}),
                         (f"/traders/{alice}/portfolio", {}), (f"/traders/{raw}/portfolio", {})]:
        assert _get(client, admin, path, **params).status_code == 200, path
    after = {c: list(get_collection(c).find({}, sort=[("_id", 1)])) for c in COLLECTIONS}
    assert before == after


# ------------------------------------------------------------------ module helpers
def test_money_and_quantity_formatting():
    from app.trading import admin_activity as aa
    assert aa.money(D("-0.001")) == "0.00"
    assert aa.money(D("1234.565")) == "1234.57"          # half up
    assert aa.qty_str(D("0E-10")) == "0" and aa.qty_str(D("10.50000")) == "10.5"
    assert aa.px(None) is None and aa.px(3) == "3.0000"


# ------------------------------------------------------------------ manual snapshots & history
def _snap(uid, ts, kind, value_cents, unreal=None, realized=0):
    doc = {"user_id": uid, "ts": ts, "kind": kind, "date": ts.date().isoformat(),
           "positions_value_cents": value_cents, "cost_basis_cents": value_cents,
           "unrealized_cents": unreal, "unpriced_positions": 0, "realized_cents": realized, "open_positions": 1}
    if kind == "minute":
        doc["expire_at"] = ts + timedelta(days=30)
    get_collection("manual_snapshots").insert_one(doc)


def test_snapshot_values_exclude_automated_activity(db, market):
    alice = make_user("alice@test.com")
    add_position(alice, "AAPL", "stock", 10, 900, realized="40", fill=True)   # manual, bought at 90
    add_position(alice, "SPY", "etf", 2, 1000, realized="99")                 # automated only
    add_fill(alice, "SPY", "etf", buy=True, qty=2, price=500, source="recurring")
    doc = asyncio.run(aa.build_manual_snapshot(alice, "minute"))
    assert doc["positions_value_cents"] == 100000       # 10 * 100.00 mark
    assert doc["cost_basis_cents"] == 90000
    assert doc["unrealized_cents"] == 10000
    assert doc["realized_cents"] == 4000                # SPY's 99 excluded
    assert doc["open_positions"] == 1 and doc["unpriced_positions"] == 0
    assert doc["kind"] == "minute" and doc["ts"].tzinfo is None
    assert doc["expire_at"] - doc["ts"] == timedelta(days=30)


def test_unpriced_positions_count_at_cost_and_drop_out_of_unrealized(db, market):
    erin = make_user("erin@test.com")
    add_position(erin, "MSFT", "stock", 3, 1200, fill=True)                  # no quote
    add_position(erin, "AAPL", "stock", 2, 150, fill=True)                   # priced: 200 vs 150
    doc = asyncio.run(aa.build_manual_snapshot(erin, "minute"))
    assert doc["positions_value_cents"] == 140000       # unpriced MSFT at cost 1200 + AAPL 200
    assert doc["cost_basis_cents"] == 135000
    assert doc["unrealized_cents"] == 5000              # priced only
    assert doc["unpriced_positions"] == 1

    only = make_user("only-unpriced@test.com")
    add_position(only, "MSFT", "stock", 1, 400, fill=True)
    assert asyncio.run(aa.build_manual_snapshot(only, "minute"))["unrealized_cents"] is None


def test_daily_snapshot_is_an_idempotent_upsert(db, market):
    alice = make_user("alice@test.com")
    add_position(alice, "AAPL", "stock", 10, 900, fill=True)
    asyncio.run(aa.snapshot_manual_user(alice, "daily", date_str="2026-11-06"))
    market["quotes"]["AAPL"] = ("stock", 110.0, 109.9, 110.1, 98.0)
    asyncio.run(aa.snapshot_manual_user(alice, "daily", date_str="2026-11-06"))
    docs = list(get_collection("manual_snapshots").find({"user_id": alice, "kind": "daily"}))
    assert len(docs) == 1 and docs[0]["positions_value_cents"] == 110000
    assert "expire_at" not in docs[0]


def test_eligibility_and_failure_isolation(db, market, monkeypatch):
    alice = make_user("alice@test.com")
    carol = make_user("carol@test.com")          # manual fill only, no open position: eligible
    dan = make_user("dan@test.com")              # automated only: not eligible
    make_user("bob@test.com")                    # no activity: not eligible
    bot = make_user("bot@test.com", system=True)  # system: never eligible
    add_position(alice, "AAPL", "stock", 10, 900, fill=True)
    add_fill(carol, "SPY", "etf", buy=True, qty=1, price=500)
    add_fill(dan, "SPY", "etf", buy=True, qty=1, price=500, source="copy", bucket="copy:L1")
    add_position(bot, "AAPL", "stock", 100, 10000, fill=True)

    uids, _ = aa.eligible_manual_users()
    assert sorted(uids) == sorted([alice, carol])

    original = aa.snapshot_manual_user

    async def flaky(uid, kind="minute", keys=None, date_str=None):
        if uid == carol:
            raise RuntimeError("boom")
        return await original(uid, kind, keys, date_str)

    async def no_daily(date_str):
        return 0

    monkeypatch.setattr(aa, "snapshot_manual_user", flaky)
    monkeypatch.setattr(aa, "daily_manual_close", no_daily)
    assert asyncio.run(aa.snapshot_all_manual("minute")) == 1          # logged, not raised
    assert get_collection("manual_snapshots").count_documents({"user_id": alice}) == 1
    assert get_collection("manual_snapshots").count_documents({"user_id": carol}) == 0


def test_hook_never_raises(monkeypatch):
    async def boom(kind="minute"):
        raise RuntimeError("provider exploded")

    monkeypatch.setattr(aa, "snapshot_all_manual", boom)
    assert asyncio.run(aa.safe_snapshot_all_manual("minute")) == -1


def test_history_zero_one_and_many_points(db, market):
    alice = make_user("alice@test.com")
    add_position(alice, "AAPL", "stock", 10, 900, fill=True)          # live: 10 * 100 = 1000.00
    live_values = {"positions_value": D("1000"), "unrealized": D("100"), "realized": D("0")}

    h0 = asyncio.run(aa.manual_history(alice, "1M", live_values))
    assert h0["series"] == "manual_positions_value" and h0["range"] == "1M"
    assert h0["count"] == 0 and h0["kinds"] == []
    assert len(h0["points"]) == 1 and h0["points"][0]["live"] is True
    assert h0["points"][0]["value"] == "1000.00" and h0["points"][0]["unrealized"] == "100.00"
    assert h0["change"] is None and h0["change_percent"] is None

    _snap(alice, _ago(days=2), "daily", 90000)
    h1 = asyncio.run(aa.manual_history(alice, "1M", live_values))
    assert h1["count"] == 1 and len(h1["points"]) == 2
    assert h1["change"] is None and h1["change_percent"] is None      # one stored point: no change

    _snap(alice, _ago(days=20), "daily", 80000)
    _snap(alice, _ago(days=10), "daily", 85000)
    same_day = _ago(days=3)
    _snap(alice, same_day, "minute", 1)                                # daily kept for that day
    _snap(alice, same_day, "daily", 95000)
    h = asyncio.run(aa.manual_history(alice, "1M", live_values))
    values = [p["value"] for p in h["points"]]
    assert values == ["800.00", "850.00", "950.00", "900.00", "1000.00"]
    assert [p["live"] for p in h["points"]] == [False, False, False, False, True]
    ts = [p["t"] for p in h["points"]]
    assert ts == sorted(ts)
    assert h["count"] == 4 and h["kinds"] == ["daily"]
    assert h["change"] == "200.00" and h["change_percent"] == "25.00"  # 1000 vs first 800


def test_history_zero_first_value_has_no_percent(db, market):
    alice = make_user("alice@test.com")
    _snap(alice, _ago(days=5), "daily", 0)
    _snap(alice, _ago(days=1), "daily", 50000)
    h = asyncio.run(aa.manual_history(alice, "1M", {"positions_value": D("600"), "unrealized": None,
                                                    "realized": D("0")}))
    assert h["change"] == "600.00" and h["change_percent"] is None   # 600 live vs 0 first
    assert h["points"][-1]["unrealized"] is None


def test_history_intraday_range_keeps_minute_points(db, market):
    alice = make_user("alice@test.com")
    _snap(alice, _ago(hours=5), "minute", 90000)
    _snap(alice, _ago(hours=2), "minute", 91000)
    h = asyncio.run(aa.manual_history(alice, "1D", {"positions_value": D("920"), "unrealized": None,
                                                    "realized": D("0")}))
    assert h["count"] == 2 and h["kinds"] == ["minute"]
    assert h["change"] == "20.00"


def test_portfolio_endpoint_returns_history(client, admin, db, market):
    alice = make_user("alice@test.com")
    add_position(alice, "AAPL", "stock", 10, 900, fill=True)
    _snap(alice, _ago(days=3), "daily", 90000)
    r = _get(client, admin, f"/traders/{alice}/portfolio", range="1M")
    assert r.status_code == 200, r.text
    h = r.json()["history"]
    assert h["series"] == "manual_positions_value" and h["count"] == 1
    assert h["points"][-1]["live"] is True and h["points"][-1]["value"] == "1000.00"
    assert h["change"] is None
    bad = _get(client, admin, f"/traders/{alice}/portfolio", range="2Y")
    assert bad.status_code == 400 and bad.json()["detail"]["code"] == "invalid_range"
