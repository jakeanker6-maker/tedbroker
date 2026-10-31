"""Single entry point for prices. The Trading Hub UI, the order engine and copy
trading all read prices through these functions so they agree on every number.

Provider order
  stock / etf : bus (live WS) -> Finnhub REST -> Yahoo
  crypto      : bus (live WS) -> Coinbase REST -> Finnhub (Binance) REST -> Yahoo
  candles     : Coinbase (crypto, short ranges) -> Yahoo
  options     : Yahoo chain snapshot, re-marked from the live underlying; Black-Scholes
                theoretical values when the chain has no usable bid/ask (e.g. pre-market)

Rules: never invent a fresh timestamp; serve the last good value with its real `ts`
when providers fail; mark delayed/theoretical/synthetic data as such.
"""
from __future__ import annotations

import asyncio
import math
import statistics
import time
from datetime import date, datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional

from app.market_data import calendar, universe
from app.market_data.bus import bus
from app.market_data.cache import TTLCache
from app.market_data.providers import ProviderError, coinbase, finnhub, yahoo
from app.market_data.quotes import make_quote
from app.trading import options as opt

_candles = TTLCache(max_items=1500)
_chains = TTLCache(max_items=300)
_expiries = TTLCache(max_items=500)
_hv = TTLCache(max_items=500)
_snapshot_at: Dict[str, float] = {}
# Last provider errors per symbol (diagnostics shown by /api/market/feeds).
provider_errors: Dict[str, str] = {}

# range -> (yahoo period, yahoo interval, ttl seconds, coinbase granularity or None, seconds back)
RANGES = {
    "1D": ("1d", "5m", 60, 300, 86_400),
    "5D": ("5d", "15m", 300, 3600, 5 * 86_400),
    "1M": ("1mo", "60m", 900, 21600, 30 * 86_400),
    "3M": ("3mo", "1d", 3600, None, None),
    "6M": ("6mo", "1d", 3600, None, None),
    "YTD": ("ytd", "1d", 3600, None, None),
    "1Y": ("1y", "1d", 3600, None, None),
    "5Y": ("5y", "1wk", 6 * 3600, None, None),
}
MIN_PLAUSIBLE_IV = 0.05
INTERVAL_SECONDS = {"5m": 300, "15m": 900, "60m": 3600, "1d": 86_400, "1wk": 604_800}


class MarketDataError(Exception):
    pass


# =========================================================================== quotes
def freshness_seconds(asset_class: str, now: Optional[datetime] = None) -> float:
    """How old a cached quote may be before a REST refresh is attempted."""
    if asset_class == "crypto":
        return 5
    session = calendar.equity_session(now)
    return {"open": 10, "pre": 30, "post": 30}.get(session, 600)


async def _fetch_quote(symbol: str, asset_class: str) -> dict:
    errors = []
    fh = lambda: finnhub.fetch_quote(symbol, asset_class)  # noqa: E731
    yh = lambda: asyncio.to_thread(yahoo.fetch_quote, symbol, asset_class)  # noqa: E731
    if asset_class == "crypto":
        chain = [lambda: coinbase.fetch_quote(symbol), fh, yh]
    elif calendar.equity_session() == "open":
        chain = [fh, yh]
    else:
        # Outside regular hours Finnhub only reports the regular close; Yahoo's 1-minute
        # bars include pre/post-market trades, which is what pro platforms display.
        chain = [yh, fh]
    for fetch in chain:
        try:
            q = await fetch()
            if errors:
                provider_errors[symbol] = "; ".join(errors)
            return q
        except ProviderError as exc:
            errors.append(str(exc))
        except Exception as exc:  # defensive: a provider bug must not break quotes
            errors.append(f"{type(exc).__name__}: {exc}")
    provider_errors[symbol] = "; ".join(errors)
    raise MarketDataError("; ".join(errors))


def merge_snapshot(fetched: dict) -> dict:
    """Publish a REST quote without letting it overwrite a newer streamed price."""
    sym = fetched["symbol"]
    _snapshot_at[sym] = time.time()
    live = bus.get(sym)
    if live and float(live["ts"]) > float(fetched["ts"]):
        merged = dict(live)
        for k in ("prev_close", "open"):
            if fetched.get(k):
                merged[k] = fetched[k]
        merged["high"] = max(filter(None, [live.get("high"), fetched.get("high")]), default=None)
        merged["low"] = min(filter(None, [live.get("low"), fetched.get("low")]), default=None)
        merged = make_quote(sym, live["asset_class"], last=merged["last"],
                            bid=None if live.get("spread_model") == "synthetic" else live.get("bid"),
                            ask=None if live.get("spread_model") == "synthetic" else live.get("ask"),
                            prev_close=merged.get("prev_close"), open_=merged.get("open"), high=merged.get("high"),
                            low=merged.get("low"), volume=live.get("volume") or fetched.get("volume"),
                            ts=live["ts"], source=live["source"], delayed=live.get("delayed", False))
        bus.publish(merged)
        return merged
    bus.publish(fetched)
    return fetched


def snapshot_age(symbol: str) -> float:
    return time.time() - _snapshot_at.get(symbol, 0)


async def get_quote(symbol: str, asset_class: Optional[str] = None, max_age: Optional[float] = None) -> dict:
    """Latest quote for a canonical symbol (see universe.normalize)."""
    asset_class = asset_class or universe.asset_class_of(symbol)
    if asset_class == "option":
        return await get_option_quote(symbol)
    cached = bus.get(symbol)
    limit = freshness_seconds(asset_class) if max_age is None else max_age
    if cached and time.time() - float(cached["ts"]) < limit and snapshot_age(symbol) < 900:
        return cached
    try:
        return merge_snapshot(await _fetch_quote(symbol, asset_class))
    except MarketDataError:
        if cached:
            return cached  # last good value, with its real timestamp
        raise


async def get_quotes(symbols: Iterable[str]) -> Dict[str, dict]:
    syms = list(dict.fromkeys(symbols))
    results = await asyncio.gather(*(get_quote(s) for s in syms), return_exceptions=True)
    return {s: r for s, r in zip(syms, results) if not isinstance(r, Exception)}


# =========================================================================== candles
async def get_candles(symbol: str, range_: str = "1D") -> dict:
    range_ = range_.upper()
    if range_ not in RANGES:
        raise MarketDataError(f"Unsupported range {range_}. Use one of {', '.join(RANGES)}")
    asset_class = universe.asset_class_of(symbol)
    if asset_class == "option":
        raise MarketDataError("Candles are not available for option contracts")
    period, interval, ttl, cb_gran, back = RANGES[range_]

    async def load() -> dict:
        if asset_class == "crypto" and cb_gran and coinbase.enabled():
            try:
                end = time.time()
                candles = await coinbase.fetch_candles(symbol, cb_gran, end - back, end)
                if candles:
                    gran_name = {300: "5m", 3600: "60m", 21600: "6h"}[cb_gran]
                    return {"symbol": symbol, "range": range_, "interval": gran_name, "candles": candles,
                            "source": coinbase.SOURCE, "delayed": False}
            except ProviderError:
                pass
        yp = "2d" if (asset_class == "crypto" and range_ == "1D") else period
        candles = await asyncio.to_thread(yahoo.fetch_candles, symbol, yp, interval,
                                          asset_class != "crypto" and range_ in ("1D", "5D"))
        if asset_class == "crypto" and range_ == "1D":
            cutoff = time.time() - 86_400
            candles = [c for c in candles if c["t"] >= cutoff]
        return {"symbol": symbol, "range": range_, "interval": interval, "candles": candles,
                "source": yahoo.SOURCE, "delayed": False}

    try:
        data = await _candles.get_or_load((symbol, range_), ttl, load)
    except ProviderError as exc:
        raise MarketDataError(str(exc)) from exc
    return {**data, "interval_seconds": INTERVAL_SECONDS.get(data["interval"], 0)}


async def historical_volatility(symbol: str) -> Optional[float]:
    """Annualised close-to-close volatility over the last year (fallback IV)."""
    async def load():
        data = await get_candles(symbol, "1Y")
        closes = [c["c"] for c in data["candles"] if c["c"] > 0]
        rets = [math.log(b / a) for a, b in zip(closes, closes[1:])]
        if len(rets) < 20:
            return None
        return statistics.pstdev(rets[-60:]) * math.sqrt(252)
    try:
        return await _hv.get_or_load(symbol, 3600, load)
    except Exception:
        return None


# =========================================================================== search
def search(query: str, limit: int = 15, asset_class: Optional[str] = None) -> List[dict]:
    return universe.search(query, limit=limit, asset_class=asset_class)


# =========================================================================== options
async def get_expiries(root: str) -> List[str]:
    if universe.asset_class_of(root) not in ("stock", "etf"):
        raise MarketDataError("Options are available on US stocks and ETFs only")

    async def load():
        return await asyncio.to_thread(yahoo.fetch_expiries, root)
    try:
        exps = await _expiries.get_or_load(root, 3600, load)
    except ProviderError as exc:
        raise MarketDataError(str(exc)) from exc
    today = datetime.now(calendar.NY).date().isoformat()
    return [e for e in exps if e >= today]


def _tick(price: float) -> float:
    return round(max(price, 0.01), 2)


def _price_row(root: str, expiry: date, right: str, raw: dict, spot: float, t: float,
               fallback_iv: float) -> dict:
    strike = raw["strike"]
    bid, ask, last = raw["bid"], raw["ask"], raw["last"]
    iv = raw.get("iv")
    quoted = bid > 0 and ask > 0 and ask >= bid
    if quoted:
        mid = (bid + ask) / 2
        if not iv or not (MIN_PLAUSIBLE_IV <= iv <= 5.0):
            iv = opt.implied_vol(right, mid, spot, strike, t) or fallback_iv
        theoretical = False
    else:
        # Without live quotes Yahoo reports placeholder IVs (1e-5, 0.03125, 0.0625...),
        # so the provider IV is ignored and the chain-level fallback is used.
        iv = fallback_iv
        mid = opt.bs_price(right, spot, strike, t, iv)
        half = max(0.025, mid * 0.02)
        bid, ask = _tick(mid - half) if mid - half > 0.01 else 0.0, _tick(mid + half)
        theoretical = True
    g = opt.greeks(right, spot, strike, t, iv)
    symbol = opt.format_occ(root, expiry, right, strike)
    return {
        "symbol": symbol,
        "name": opt.friendly_name(symbol),
        "strike": strike,
        "right": right,
        "bid": round(bid, 2),
        "ask": round(ask, 2),
        "mid": round(mid, 4),
        "last": last,
        "change": raw.get("change", 0.0),
        "volume": raw.get("volume", 0),
        "open_interest": raw.get("open_interest", 0),
        "iv": round(iv, 4),
        "in_the_money": opt.intrinsic(right, spot, strike) > 0,
        "theoretical": theoretical,
        "last_trade_ts": raw.get("last_trade_ts"),
        **{k: round(v, 6) for k, v in g.items()},
    }


async def get_chain(root: str, expiry: str) -> dict:
    try:
        exp_date = date.fromisoformat(expiry)
    except ValueError as exc:
        raise MarketDataError("expiry must be YYYY-MM-DD") from exc
    underlying = await get_quote(root)

    async def load():
        raw = await asyncio.to_thread(yahoo.fetch_chain, root, expiry)
        spot = underlying["mid"] or underlying["last"]
        t = opt.years_to_expiry(exp_date)
        valid_ivs = [r["iv"] for side in ("calls", "puts") for r in raw[side]
                     if r.get("iv") and MIN_PLAUSIBLE_IV <= r["iv"] <= 5.0 and r["bid"] > 0 and r["ask"] > 0
                     and abs(r["strike"] / spot - 1) < 0.1]
        fallback = statistics.median(valid_ivs) if valid_ivs else (await historical_volatility(root) or 0.30)
        calls = [_price_row(root, exp_date, "C", r, spot, t, fallback) for r in raw["calls"] if r["strike"]]
        puts = [_price_row(root, exp_date, "P", r, spot, t, fallback) for r in raw["puts"] if r["strike"]]
        return {"underlying": root, "expiry": expiry, "spot_at_snapshot": spot, "snapshot_ts": time.time(),
                "fallback_iv": round(fallback, 4), "calls": calls, "puts": puts}

    try:
        chain = await _chains.get_or_load((root, expiry), 60, load)
    except ProviderError as exc:
        raise MarketDataError(str(exc)) from exc
    spot_now = underlying["mid"] or underlying["last"]
    d_spot = spot_now - chain["spot_at_snapshot"]
    out = dict(chain)
    if abs(d_spot) > 1e-9:  # keep the chain moving with the live underlying between refreshes
        out["calls"] = [_remarked(r, d_spot) for r in chain["calls"]]
        out["puts"] = [_remarked(r, d_spot) for r in chain["puts"]]
    out.update({
        "underlying_quote": underlying,
        "days_to_expiry": max(0, (exp_date - datetime.now(calendar.NY).date()).days),
        "source": yahoo.SOURCE,
        "delayed": True,
        "multiplier": opt.MULTIPLIER,
    })
    return out


def _remarked(row: dict, d_spot: float) -> dict:
    mid = opt.remark(row["mid"], row["delta"], row["gamma"], d_spot)
    shift = mid - row["mid"]
    r = dict(row)
    r["mid"] = round(mid, 4)
    r["bid"] = round(max(0.0, row["bid"] + shift), 2) if row["bid"] else 0.0
    r["ask"] = round(max(0.01, row["ask"] + shift), 2)
    r["delta"] = round(row["delta"] + row["gamma"] * d_spot, 6)
    return r


async def get_option_quote(symbol: str) -> dict:
    """Quote for one contract, re-marked from the live underlying."""
    p = opt.parse_occ(symbol)
    occ_symbol = opt.format_occ(p["root"], p["expiry"], p["right"], p["strike"])
    expiry = p["expiry"].isoformat()
    row = None
    try:
        chain = await get_chain(p["root"], expiry)
        side = chain["calls"] if p["right"] == "C" else chain["puts"]
        row = next((r for r in side if abs(r["strike"] - p["strike"]) < 1e-6), None)
        underlying = chain["underlying_quote"]
    except MarketDataError:
        underlying = await get_quote(p["root"])
    if row is None:  # contract not listed in the snapshot: price it theoretically
        spot = underlying["mid"] or underlying["last"]
        t = opt.years_to_expiry(p["expiry"])
        iv = await historical_volatility(p["root"]) or 0.30
        row = _price_row(p["root"], p["expiry"], p["right"],
                         {"strike": p["strike"], "bid": 0.0, "ask": 0.0, "last": 0.0, "iv": iv},
                         spot, t, iv)
    q = make_quote(occ_symbol, "option", last=row["last"] or row["mid"], bid=row["bid"] or None, ask=row["ask"],
                   ts=underlying["ts"], source=yahoo.SOURCE, delayed=True,
                   underlying=p["root"], underlying_price=underlying["last"], strike=p["strike"],
                   right=p["right"], expiry=expiry, iv=row["iv"], delta=row["delta"], gamma=row["gamma"],
                   theta=row["theta"], vega=row["vega"], open_interest=row.get("open_interest"),
                   theoretical=row["theoretical"], multiplier=opt.MULTIPLIER, name=row["name"])
    # Options can legitimately have no bid; keep the chain's bid/ask rather than a synthetic spread.
    q.update(bid=row["bid"], ask=row["ask"], mid=row["mid"],
             spread_model="theoretical" if row["theoretical"] else "quoted")
    bus.publish(q)
    return q
