"""Realized gains: FIFO / average cost, holding periods, shorts, wash sales, CSV."""
from datetime import datetime, timedelta
from decimal import Decimal as D

from bson import ObjectId

from app.trading import taxlots

T0 = datetime(2025, 3, 3, 15, 0)


def fill(symbol, side, qty, price, days=0, fee="0", ac="stock", bucket="self", mult=1):
    buy = side.startswith("buy")
    gross = D(str(qty)) * D(str(price)) * mult
    return {"_id": ObjectId(), "symbol": symbol, "asset_class": ac, "bucket": bucket, "side": side, "is_buy": buy,
            "qty": str(qty), "price": str(price), "gross": f"{gross:.2f}", "fee": fee, "multiplier": mult,
            "ts": T0 + timedelta(days=days), "status": "applied", "kind": "trade"}


def test_fifo_vs_average_cost():
    fills = [fill("AAPL", "buy", 10, 100), fill("AAPL", "buy", 10, 120, days=1), fill("AAPL", "sell", 10, 130, days=2)]
    fifo = taxlots.compute_disposals(fills, "fifo")
    assert len(fifo) == 1 and fifo[0].cost == D("1000") and fifo[0].gain == D("300")
    avg = taxlots.compute_disposals(fills, "average")
    assert avg[0].cost == D("1100") and avg[0].gain == D("200")


def test_fees_partial_lots_and_terms():
    fills = [fill("MSFT", "buy", 5, 200, fee="1.00"), fill("MSFT", "buy", 5, 210, days=400),
             fill("MSFT", "sell", 8, 250, days=420, fee="0.80")]
    d = taxlots.compute_disposals(fills)
    assert [x.qty for x in d] == [D("5"), D("3")]
    assert d[0].term == "long" and d[1].term == "short"
    assert d[0].cost == D("1001.00")                       # buy fee in basis
    assert d[0].proceeds == D("5") * (D("2000") - D("0.80")) / D("8")   # sell fee shared pro rata
    total = sum((x.gain for x in d), D("0"))
    assert total == (D("2000") - D("0.80")) - (D("1001") + D("630"))


def test_short_sale_is_short_term_and_profit_when_covered_lower():
    fills = [fill("TSLA", "sell_short", 4, 300), fill("TSLA", "buy_to_cover", 4, 250, days=500)]
    d = taxlots.compute_disposals(fills)
    assert len(d) == 1 and d[0].short and d[0].term == "short" and d[0].gain == D("200")


def test_wash_sale_flag_and_ratio():
    fills = [fill("NVDA", "buy", 10, 100), fill("NVDA", "sell", 10, 80, days=10),   # loss of 200
             fill("NVDA", "buy", 4, 85, days=25)]                                    # 4 replacement shares
    rep = taxlots.report(fills, 2025)
    row = rep["rows"][0]
    assert row["gain_loss"] == "-200.00" and row["wash_sale"] and row["wash_sale_disallowed"] == "80.00"
    assert rep["net_after_wash_sales"] == "-120.00"
    # outside the 30-day window: no wash sale
    late = [fill("NVDA", "buy", 10, 100), fill("NVDA", "sell", 10, 80, days=10), fill("NVDA", "buy", 4, 85, days=45)]
    assert not taxlots.report(late, 2025)["rows"][0]["wash_sale"]


def test_crypto_is_not_subject_to_wash_sales_and_gains_are_not_flagged():
    fills = [fill("BTC-USD", "buy", "0.5", 60000, ac="crypto"), fill("BTC-USD", "sell", "0.5", 50000, days=3, ac="crypto"),
             fill("BTC-USD", "buy", "0.5", 51000, days=4, ac="crypto")]
    assert not taxlots.report(fills, 2025)["rows"][0]["wash_sale"]
    gain = [fill("AMD", "buy", 1, 10), fill("AMD", "sell", 1, 20, days=2), fill("AMD", "buy", 1, 19, days=3)]
    assert not taxlots.report(gain, 2025)["rows"][0]["wash_sale"]


def test_flip_long_to_short_and_buckets_are_separate():
    fills = [fill("SPY", "buy", 2, 500), fill("SPY", "sell", 5, 510, days=1),       # closes 2 long, opens 3 short
             fill("SPY", "buy", 3, 505, days=2),
             fill("SPY", "buy", 1, 400, bucket="copy:x"), fill("SPY", "sell", 1, 450, days=3, bucket="copy:x")]
    d = taxlots.compute_disposals(fills)
    assert [(x.bucket, x.short, x.qty, x.gain) for x in d] == [
        ("self", False, D("2"), D("20")), ("self", True, D("3"), D("15")), ("copy:x", False, D("1"), D("50"))]


def test_option_expiring_worthless_and_year_filter_and_csv():
    fills = [fill("AAPL  260116C00200000", "buy_to_open", 1, "2.50", ac="option", mult=100),
             fill("AAPL  260116C00200000", "sell_to_close", 1, 0, days=300, ac="option", mult=100)]
    rep = taxlots.report(fills, 2025)
    assert rep["rows"] and rep["rows"][0]["gain_loss"] == "-250.00"
    assert taxlots.report(fills, 2024)["rows"] == []
    text = taxlots.to_csv(rep)
    assert "not tax advice" in text and "AAPL  260116C00200000" in text
    assert taxlots._csv_safe("=HYPERLINK(1)") == "'=HYPERLINK(1)" and taxlots._csv_safe("-250.00") == "-250.00"


def test_full_close_matches_average_cost_positions_engine():
    """Over a complete round trip both methods realise the same total, equal to cash in - cash out."""
    fills = [fill("KO", "buy", 3, 60, fee="0.10"), fill("KO", "buy", 7, 62, days=5, fee="0.20"),
             fill("KO", "sell", 4, 65, days=9, fee="0.05"), fill("KO", "sell", 6, 59, days=20, fee="0.07")]
    cash = sum(((-1 if f["is_buy"] else 1) * D(f["gross"]) - D(f["fee"]) for f in fills), D("0"))
    for method in ("fifo", "average"):
        total = sum((x.gain for x in taxlots.compute_disposals(fills, method)), D("0"))
        assert abs(total - cash) < D("0.000001"), method
