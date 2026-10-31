import time
from datetime import date, datetime, timedelta

import pandas as pd
import pytest

from app.market_data import calendar, service
from app.market_data.providers import ProviderError, coinbase, finnhub, yahoo
from app.market_data.quotes import make_quote
from app.trading import options as opt


def q(symbol, ac, last, ts=None, source="t", **kw):
    return make_quote(symbol, ac, last=last, ts=ts or time.time(), source=source, **kw)


# ------------------------------------------------------------------ provider chains
async def test_crypto_falls_back_from_coinbase_to_finnhub(monkeypatch, clean_market):
    async def cb_down(symbol):
        raise ProviderError("dns")

    async def fh(symbol, ac):
        return q(symbol, ac, 50000, source="Finnhub (Binance USDT)", prev_close=49000)
    monkeypatch.setattr(coinbase, "fetch_quote", cb_down)
    monkeypatch.setattr(finnhub, "fetch_quote", fh)
    got = await service.get_quote("BTC-USD")
    assert got["source"].startswith("Finnhub") and clean_market.get("BTC-USD")["last"] == 50000
    assert "dns" in service.provider_errors["BTC-USD"]


@pytest.mark.parametrize("session,first", [("open", "finnhub"), ("pre", "yahoo"), ("closed", "yahoo")])
async def test_equity_provider_order_by_session(monkeypatch, session, first):
    order = []

    async def fh(symbol, ac):
        order.append("finnhub")
        return q(symbol, ac, 100, source="Finnhub")

    def yh(symbol, ac):
        order.append("yahoo")
        return q(symbol, ac, 101, source="Yahoo Finance")
    monkeypatch.setattr(finnhub, "fetch_quote", fh)
    monkeypatch.setattr(yahoo, "fetch_quote", yh)
    monkeypatch.setattr(calendar, "equity_session", lambda now=None: session)
    await service.get_quote("AAPL")
    assert order == [first]


async def test_serves_last_good_value_when_providers_fail(monkeypatch, clean_market):
    old = q("AAPL", "stock", 150, ts=time.time() - 3600, source="Finnhub")
    clean_market.publish(old)

    async def down(*a):
        raise ProviderError("down")
    monkeypatch.setattr(finnhub, "fetch_quote", down)
    monkeypatch.setattr(yahoo, "fetch_quote", lambda *a: (_ for _ in ()).throw(ProviderError("down")))
    got = await service.get_quote("AAPL")
    assert got["last"] == 150 and got["ts"] == old["ts"]   # real old timestamp, not "now"
    clean_market.latest.clear()
    with pytest.raises(service.MarketDataError):
        await service.get_quote("AAPL")


async def test_fresh_bus_quote_avoids_rest(monkeypatch, clean_market):
    clean_market.publish(q("ETH-USD", "crypto", 3000))
    service._snapshot_at["ETH-USD"] = time.time()
    got = await service.get_quote("ETH-USD")   # no provider is patched: would raise if called
    assert got["last"] == 3000


def test_merge_snapshot_keeps_newer_streamed_price(clean_market):
    live = q("AAPL", "stock", 200, ts=time.time())
    clean_market.publish(live)
    snap = q("AAPL", "stock", 190, ts=time.time() - 60, prev_close=180, open_=185, high=205, low=184)
    merged = service.merge_snapshot(snap)
    assert merged["last"] == 200 and merged["prev_close"] == 180 and merged["high"] == 205
    assert merged["change"] == pytest.approx(20)


# ------------------------------------------------------------------ yahoo parsing
def _frame(rows):
    idx = pd.DatetimeIndex([pd.Timestamp(t, unit="s", tz="UTC") for t, _ in rows])
    return pd.DataFrame([{"Open": c, "High": c + 1, "Low": c - 1, "Close": c, "Volume": 10} for _, c in rows], index=idx)


def test_yahoo_premarket_quote_uses_real_bar_time_and_last_close():
    reg_start = 1_000_000
    df = _frame([(reg_start - 600, 101.0), (reg_start - 60, 102.5)])
    meta = {"regularMarketPrice": 100.0, "regularMarketTime": reg_start - 60_000, "previousClose": 98.0,
            "currentTradingPeriod": {"regular": {"start": reg_start}}}
    got = yahoo.quote_from_history("AAPL", "stock", df, meta)
    assert got["last"] == 102.5 and got["ts"] == reg_start - 60
    assert got["prev_close"] == 100.0 and got["change"] == pytest.approx(2.5)


def test_yahoo_regular_session_uses_previous_close():
    reg_start = 1_000_000
    df = _frame([(reg_start - 60, 99.0), (reg_start + 60, 101.0), (reg_start + 120, 103.0)])
    meta = {"regularMarketPrice": 103.0, "regularMarketTime": reg_start + 120, "previousClose": 100.0,
            "currentTradingPeriod": {"regular": {"start": reg_start}}}
    got = yahoo.quote_from_history("AAPL", "stock", df, meta)
    assert got["prev_close"] == 100.0 and got["open"] == 101.0 and got["high"] == 104.0


def test_finnhub_and_coinbase_parsers():
    fq = finnhub.parse_quote("AAPL", "stock", {"c": 10, "pc": 9, "o": 9.5, "h": 11, "l": 9, "t": 123})
    assert fq["ts"] == 123 and fq["spread_model"] == "synthetic"
    with pytest.raises(ProviderError):
        finnhub.parse_quote("NOPE", "stock", {"c": 0})
    cq = coinbase.parse_ticker_message({"type": "ticker", "product_id": "BTC-USD", "price": "100", "best_bid": "99.5",
                                        "best_ask": "100.5", "open_24h": "90", "high_24h": "101", "low_24h": "89",
                                        "volume_24h": "5", "time": "2026-10-29T11:00:00.000000Z"})
    assert cq["spread_model"] == "quoted" and cq["bid"] == 99.5 and cq["change"] == 10
    assert finnhub.provider_symbol("SOL-USD", "crypto") == "BINANCE:SOLUSDT"
    assert finnhub.canonical_from_provider("BINANCE:SOLUSDT") == "SOL-USD"


# ------------------------------------------------------------------ candles
async def test_crypto_1d_candles_trimmed_to_24h(monkeypatch):
    now = time.time()
    monkeypatch.setattr(coinbase, "enabled", lambda: False)
    rows = [{"t": int(now - h * 3600), "o": 1, "h": 1, "l": 1, "c": 1, "v": 1} for h in (30, 20, 1)]
    calls = []

    def fake(symbol, period, interval, prepost):
        calls.append((period, interval, prepost))
        return rows
    monkeypatch.setattr(yahoo, "fetch_candles", fake)
    data = await service.get_candles("BTC-USD", "1D")
    assert len(data["candles"]) == 2 and calls == [("2d", "5m", False)]
    await service.get_candles("BTC-USD", "1D")
    assert len(calls) == 1                                 # cached
    with pytest.raises(service.MarketDataError):
        await service.get_candles("BTC-USD", "2W")


async def test_stock_intraday_candles_include_extended_hours(monkeypatch):
    seen = {}

    def fake(symbol, period, interval, prepost):
        seen.update(period=period, prepost=prepost)
        return [{"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]
    monkeypatch.setattr(yahoo, "fetch_candles", fake)
    await service.get_candles("AAPL", "1D")
    assert seen == {"period": "1d", "prepost": True}


# ------------------------------------------------------------------ options
def _chain_rows(spot):
    return {
        "calls": [{"strike": k, "bid": b, "ask": a, "last": 1.0, "change": 0, "volume": 1, "open_interest": 10,
                   "iv": iv, "last_trade_ts": None}
                  for k, b, a, iv in [(95, 6.0, 6.2, 0.30), (100, 0.0, 0.0, 1e-5), (105, 1.0, 1.2, 0.28),
                                     (110, 0.0, 0.0, 0.03125)]],
        "puts": [{"strike": 100, "bid": 2.0, "ask": 2.2, "last": 2.1, "change": 0, "volume": 1, "open_interest": 5,
                  "iv": 0.29, "last_trade_ts": None}],
    }


async def test_chain_quoted_and_theoretical_rows(monkeypatch, clean_market):
    clean_market.publish(q("AAPL", "stock", 100.0))
    service._snapshot_at["AAPL"] = time.time()
    expiry = (date.today() + timedelta(days=30)).isoformat()
    monkeypatch.setattr(yahoo, "fetch_chain", lambda s, e: _chain_rows(100))
    chain = await service.get_chain("AAPL", expiry)
    by_strike = {r["strike"]: r for r in chain["calls"]}
    assert not by_strike[95]["theoretical"] and by_strike[95]["bid"] == 6.0
    atm = by_strike[100]
    assert atm["theoretical"] and atm["iv"] == pytest.approx(chain["fallback_iv"])
    assert atm["bid"] < atm["mid"] < atm["ask"] and 0.4 < atm["delta"] < 0.65
    assert by_strike[110]["iv"] == pytest.approx(chain["fallback_iv"])   # placeholder IV ignored
    assert atm["symbol"] == opt.format_occ("AAPL", date.fromisoformat(expiry), "C", 100)
    assert chain["delayed"] is True and chain["multiplier"] == 100


async def test_option_quote_remarks_with_underlying(monkeypatch, clean_market):
    clean_market.publish(q("AAPL", "stock", 100.0))
    service._snapshot_at["AAPL"] = time.time()
    exp = date.today() + timedelta(days=30)
    monkeypatch.setattr(yahoo, "fetch_chain", lambda s, e: _chain_rows(100))
    occ = opt.format_occ("AAPL", exp, "C", 105)
    first = await service.get_option_quote(occ)
    assert first["asset_class"] == "option" and first["bid"] == 1.0 and first["ask"] == 1.2
    clean_market.publish(q("AAPL", "stock", 102.0))      # underlying +2
    second = await service.get_option_quote(occ)
    assert second["mid"] > first["mid"] + 0.4               # moved by ~delta * 2
    assert clean_market.get(occ)["mid"] == second["mid"]    # published for streams/engine


async def test_unlisted_contract_priced_theoretically(monkeypatch, clean_market):
    clean_market.publish(q("AAPL", "stock", 100.0))
    service._snapshot_at["AAPL"] = time.time()
    monkeypatch.setattr(yahoo, "fetch_chain", lambda s, e: _chain_rows(100))

    async def hv(symbol):
        return 0.25
    monkeypatch.setattr(service, "historical_volatility", hv)
    occ = opt.format_occ("AAPL", date.today() + timedelta(days=30), "P", 90)
    got = await service.get_option_quote(occ)
    assert got["theoretical"] and got["iv"] == 0.25 and got["mid"] > 0
