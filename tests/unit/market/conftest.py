import pytest

from app.market_data import bus as bus_mod
from app.market_data import service
from app.market_data.providers import coinbase, finnhub, yahoo
from app.market_data.cache import CircuitBreaker


@pytest.fixture(autouse=True)
def clean_market(monkeypatch):
    """Fresh bus, caches and breakers for every test; no real network calls."""
    fresh = bus_mod.PriceBus()
    monkeypatch.setattr(bus_mod, "bus", fresh)
    monkeypatch.setattr(service, "bus", fresh)
    for c in (service._candles, service._chains, service._expiries, service._hv):
        c.clear()
    service._snapshot_at.clear()
    service.provider_errors.clear()
    for mod in (coinbase, finnhub, yahoo):
        monkeypatch.setattr(mod, "breaker", CircuitBreaker())

    async def no_network(*a, **k):
        raise AssertionError("test tried to reach the network")
    monkeypatch.setattr(coinbase, "fetch_quote", no_network)
    monkeypatch.setattr(coinbase, "fetch_candles", no_network)
    monkeypatch.setattr(finnhub, "fetch_quote", no_network)
    for name in ("fetch_quote", "fetch_candles", "fetch_expiries", "fetch_chain"):
        monkeypatch.setattr(yahoo, name, lambda *a, **k: (_ for _ in ()).throw(AssertionError("network")))
    yield fresh
