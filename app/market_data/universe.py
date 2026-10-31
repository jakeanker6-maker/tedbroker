"""Tradable symbol universe: lookup, normalisation and search.

Canonical symbol forms:
  stocks / ETFs   plain ticker            AAPL, SPY
  crypto          BASE-USD                BTC-USD
  options         OCC (see app.trading.options)
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional

from app.trading import options as occ

UNIVERSE_FILE = Path(__file__).with_name("universe.json")
ASSET_CLASSES = ("stock", "etf", "crypto", "option")
_CRYPTO_INPUT = re.compile(r"^([A-Z0-9]{2,10})[-/]?(USD|USDT|USDC)?$")


class UnknownSymbol(ValueError):
    pass


@lru_cache(maxsize=1)
def _load() -> Dict[str, dict]:
    data = json.loads(UNIVERSE_FILE.read_text())
    cols = data["columns"]
    out: Dict[str, dict] = {}
    for row in data["rows"]:
        item = dict(zip(cols, row))
        out[item["symbol"]] = item
    return out


def all_symbols() -> Dict[str, dict]:
    return _load()


def crypto_bases() -> List[str]:
    return [s[:-4] for s, v in _load().items() if v["asset_class"] == "crypto"]


def lookup(symbol: str) -> Optional[dict]:
    return _load().get(symbol)


def normalize(raw: str, asset_class: Optional[str] = None) -> str:
    """Return the canonical symbol, or raise UnknownSymbol.

    `asset_class` disambiguates tickers that exist as both (e.g. BTC is also an
    NYSE Arca ETF). Without it, equities win for bare tickers and crypto wins for
    pair forms such as BTC-USD, BTC/USD or BTCUSD.
    """
    if not raw or not raw.strip():
        raise UnknownSymbol("Empty symbol")
    s = raw.strip().upper()
    if asset_class == "option" or occ.looks_like_occ(s):
        return occ.format_occ(**occ.parse_occ(s))
    u = _load()
    if asset_class in (None, "stock", "etf"):
        eq = s.replace("/", ".")
        if eq in u and u[eq]["asset_class"] in ("stock", "etf"):
            if asset_class is None or u[eq]["asset_class"] == asset_class:
                return eq
        if asset_class in ("stock", "etf"):
            raise UnknownSymbol(f"Unknown {asset_class} symbol: {raw}")
    m = _CRYPTO_INPUT.match(s)
    if m:
        base = m.group(1)
        if base.endswith("USD") and m.group(2) is None and len(base) > 3:  # BTCUSD
            base = base[:-3]
        pair = f"{base}-USD"
        if pair in u:
            return pair
    raise UnknownSymbol(f"Unknown symbol: {raw}")


def asset_class_of(symbol: str) -> str:
    if occ.looks_like_occ(symbol):
        return "option"
    item = lookup(symbol)
    if not item:
        raise UnknownSymbol(symbol)
    return item["asset_class"]


def describe(symbol: str) -> dict:
    if occ.looks_like_occ(symbol):
        p = occ.parse_occ(symbol)
        return {"symbol": symbol, "name": occ.friendly_name(symbol), "asset_class": "option",
                "exchange": "OPRA", "underlying": p["root"]}
    item = lookup(symbol)
    if not item:
        raise UnknownSymbol(symbol)
    return {k: item[k] for k in ("symbol", "name", "asset_class", "exchange")}


def search(query: str, limit: int = 15, asset_class: Optional[str] = None) -> List[dict]:
    """Rank: exact symbol, popular symbol prefix, symbol prefix, name word prefix, name contains."""
    q = (query or "").strip().upper()
    if not q:
        return []
    qs = q.replace("/", "-")
    scored = []
    for sym, item in _load().items():
        if asset_class and item["asset_class"] != asset_class:
            continue
        name = item["name"].upper()
        base = sym[:-4] if item["asset_class"] == "crypto" else sym
        rank = item.get("rank") or 0
        pop = rank if rank else 10_000
        if sym == qs or base == q:
            score = 0
        elif sym.startswith(qs) or base.startswith(q):
            score = 1 if rank else 3
        elif any(w.startswith(q) for w in re.split(r"[^A-Z0-9]+", name) if w):
            score = 2 if rank else 4
        elif len(q) >= 3 and q in name:
            score = 5
        else:
            continue
        scored.append((score, pop, len(sym), sym))
    scored.sort()
    return [describe(s) for *_, s in scored[:limit]]
