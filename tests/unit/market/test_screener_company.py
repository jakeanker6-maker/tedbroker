"""Screener and company page, with the upstream providers mocked."""
import pytest

from app.market_data import company, screener
from app.market_data.cache import CircuitBreaker
from app.market_data.providers import ProviderError, finnhub


@pytest.fixture(autouse=True)
def reset(monkeypatch):
    screener._cache._data.clear()
    company._cache._data.clear()
    monkeypatch.setattr(screener, "breaker", CircuitBreaker(threshold=2, cooldown=60))


def test_query_building_and_validation():
    q = screener.build_query(screener.validate({"sectors": ["Technology", "Energy"], "price_min": 5, "change_max": -2,
                                                "volume_min": 1e6, "sort": "change"}))
    text = str(q.to_dict())
    assert "'OR'" in text and "Technology" in text and "Energy" in text and "percentchange" in text and "NYQ" in text
    with pytest.raises(screener.ScreenerError):
        screener.validate({"sectors": ["Crypto"]})
    with pytest.raises(screener.ScreenerError):
        screener.validate({"price_min": 10, "price_max": 5})


async def test_screen_filters_untradable_caches_and_breaks(monkeypatch):
    calls = []

    def fake_fetch(f, limit, offset):
        calls.append(f)
        rows = [screener._row(x) for x in ({"symbol": "AAPL", "regularMarketPrice": 200, "marketCap": 3e12},
                                          {"symbol": "ZZZZZOTC", "regularMarketPrice": 1})]
        return {"total": 2, "rows": [r for r in rows if r]}
    monkeypatch.setattr(screener, "_fetch", fake_fetch)
    out = await screener.screen({"sort": "market_cap"}, 10)
    assert [r["symbol"] for r in out["rows"]] == ["AAPL"] and out["delayed"]
    await screener.screen({"sort": "market_cap"}, 10)
    assert len(calls) == 1                                             # cached

    def boom(*a):
        raise RuntimeError("yahoo down")
    monkeypatch.setattr(screener, "_fetch", boom)
    for _ in range(2):
        with pytest.raises(screener.ScreenerError):
            await screener.screen({"sort": "price"}, 10)
    with pytest.raises(screener.ScreenerError) as exc:
        await screener.screen({"sort": "volume"}, 10)
    assert "busy" in str(exc.value)                                    # breaker open


async def test_company_parts_fail_independently_and_links_are_safe(monkeypatch):
    async def fake_json(path, params, timeout=5):
        if path == "/stock/profile2":
            return {"name": "Apple Inc.", "finnhubIndustry": "Technology", "weburl": "javascript:alert(1)",
                    "logo": "https://x.test/a.png", "marketCapitalization": 10}
        if path == "/stock/metric":
            raise ProviderError("rate limited")
        if path == "/calendar/earnings":
            return {"earningsCalendar": [{"symbol": "AAPL", "date": "2099-01-30", "hour": "amc", "epsEstimate": 2.1}]}
        return [{"headline": "Good", "url": "https://news.test/1", "datetime": 1700000000, "source": "X"},
                {"headline": "Bad link", "url": "javascript:evil()", "datetime": 1700000000}]
    monkeypatch.setattr(finnhub, "fetch_json", fake_json)
    monkeypatch.setattr(company, "_yahoo_profile", lambda s: {"description": "Makes phones.", "sector": "Technology"})
    c = await company.company("aapl")
    assert c["symbol"] == "AAPL" and c["profile"]["website"] is None and c["profile"]["logo"] == "https://x.test/a.png"
    assert c["profile"]["description"] == "Makes phones." and c["profile"]["market_cap"] == 10_000_000
    assert c["stats"]["available"] is False and "rate limited" in c["stats"]["error"]
    assert c["earnings"]["next"]["time"] == "After the close"
    assert [n["headline"] for n in c["news"]["items"]] == ["Good"]
    btc = await company.company("BTC-USD")
    assert btc["stats"]["available"] is False and btc["profile"]["available"]
