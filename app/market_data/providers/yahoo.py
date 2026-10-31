"""Yahoo Finance via yfinance: candles, option chains, and a last-resort quote.

yfinance is unofficial and synchronous. Call these functions through
`asyncio.to_thread`, cache results, and expect occasional failures.
Option chains are snapshot data, roughly 15 minutes delayed.
"""
from __future__ import annotations

import math
from typing import Dict, List

from app.market_data.cache import CircuitBreaker
from app.market_data.providers import ProviderError
from app.market_data.quotes import make_quote

SOURCE = "Yahoo Finance"
breaker = CircuitBreaker(threshold=3, cooldown=120)


def yahoo_symbol(symbol: str) -> str:
    return symbol.replace(".", "-")  # BRK.B -> BRK-B; crypto already BASE-USD


def _yf():
    if not breaker.available:
        raise ProviderError("Yahoo temporarily disabled after errors")
    import yfinance  # imported lazily: heavy (pandas)
    return yfinance


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) else f


def quote_from_history(symbol: str, asset_class: str, df, meta: Dict) -> dict:
    """Build a quote from 1-minute bars (including pre/post market) and chart metadata.

    The price is the last bar's close and the timestamp is that bar's real time, so
    an old price is never presented as fresh. Reference close for the day change:
    before today's regular session starts it is the last regular close
    (regularMarketPrice); afterwards it is previousClose.
    """
    rows = [(ts, r) for ts, r in df.iterrows() if _num(r.get("Close")) is not None]
    if not rows:
        raise ProviderError(f"Yahoo has no recent bars for {symbol}")
    last_ts, last_row = rows[-1]
    regular = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    reg_start = regular.get("start")
    reg_time = meta.get("regularMarketTime")
    if asset_class != "crypto" and reg_start and reg_time and reg_time < reg_start:
        prev = meta.get("regularMarketPrice")
    else:
        prev = meta.get("previousClose") or meta.get("chartPreviousClose")
    session_rows = [r for ts, r in rows if not reg_start or ts.timestamp() >= reg_start] or [r for _, r in rows]
    return make_quote(
        symbol, asset_class,
        last=_num(last_row.get("Close")),
        prev_close=_num(prev),
        open_=_num(session_rows[0].get("Open")),
        high=_num(meta.get("regularMarketDayHigh")) or max(_num(r.get("High")) or 0 for r in session_rows),
        low=_num(meta.get("regularMarketDayLow")) or min(_num(r.get("Low")) or float("inf") for r in session_rows),
        volume=_num(meta.get("regularMarketVolume")),
        ts=last_ts.timestamp(), source=SOURCE, delayed=False,
    )


def fetch_quote(symbol: str, asset_class: str) -> dict:
    yf = _yf()
    try:
        t = yf.Ticker(yahoo_symbol(symbol))
        df = t.history(period="1d", interval="1m", prepost=asset_class != "crypto", auto_adjust=False, actions=False)
        q = quote_from_history(symbol, asset_class, df, t.history_metadata or {})
    except ProviderError:
        breaker.fail()
        raise
    except Exception as exc:
        breaker.fail()
        raise ProviderError(f"Yahoo quote failed for {symbol}: {type(exc).__name__}: {exc}") from exc
    if not q["last"]:
        breaker.fail()
        raise ProviderError(f"Yahoo has no price for {symbol}")
    breaker.ok()
    return q


def frame_to_candles(df) -> List[dict]:
    out = []
    for ts, row in df.iterrows():
        o, h, l, c = (_num(row.get(k)) for k in ("Open", "High", "Low", "Close"))
        if None in (o, h, l, c):
            continue
        out.append({"t": int(ts.timestamp()), "o": o, "h": h, "l": l, "c": c, "v": _num(row.get("Volume")) or 0})
    return out


def fetch_candles(symbol: str, period: str, interval: str, prepost: bool = False) -> List[dict]:
    yf = _yf()
    try:
        df = yf.Ticker(yahoo_symbol(symbol)).history(period=period, interval=interval, prepost=prepost,
                                                     auto_adjust=False, actions=False)
    except Exception as exc:
        breaker.fail()
        raise ProviderError(f"Yahoo candles failed for {symbol}: {exc}") from exc
    candles = frame_to_candles(df)
    if not candles:
        raise ProviderError(f"Yahoo returned no candles for {symbol} {period}/{interval}")
    breaker.ok()
    return candles


def fetch_expiries(symbol: str) -> List[str]:
    yf = _yf()
    try:
        exps = list(yf.Ticker(yahoo_symbol(symbol)).options)
    except Exception as exc:
        breaker.fail()
        raise ProviderError(f"Yahoo expiries failed for {symbol}: {exc}") from exc
    breaker.ok()
    return exps


def fetch_chain(symbol: str, expiry: str) -> Dict[str, List[dict]]:
    """{'calls': [...], 'puts': [...]} with raw Yahoo fields normalised to plain floats."""
    yf = _yf()
    try:
        chain = yf.Ticker(yahoo_symbol(symbol)).option_chain(expiry)
    except Exception as exc:
        breaker.fail()
        raise ProviderError(f"Yahoo chain failed for {symbol} {expiry}: {exc}") from exc
    breaker.ok()

    def rows(df) -> List[dict]:
        out = []
        for _, r in df.iterrows():
            last_trade = r.get("lastTradeDate")
            out.append({
                "contract": str(r.get("contractSymbol")),
                "strike": _num(r.get("strike")),
                "bid": _num(r.get("bid")) or 0.0,
                "ask": _num(r.get("ask")) or 0.0,
                "last": _num(r.get("lastPrice")) or 0.0,
                "change": _num(r.get("change")) or 0.0,
                # Missing volume / open interest stay unknown (None), not zero.
                "volume": None if _num(r.get("volume")) is None else int(_num(r.get("volume"))),
                "open_interest": None if _num(r.get("openInterest")) is None else int(_num(r.get("openInterest"))),
                "iv": _num(r.get("impliedVolatility")),
                "last_trade_ts": int(last_trade.timestamp()) if hasattr(last_trade, "timestamp") else None,
            })
        return out

    return {"calls": rows(chain.calls), "puts": rows(chain.puts)}


def fetch_dividends(symbol: str) -> Dict:
    """Recent ex-dividend dates/amounts and the next announced ex-date (if any)."""
    yf = _yf()
    try:
        t = yf.Ticker(yahoo_symbol(symbol))
        series = t.dividends
        history = [(ts.date().isoformat(), float(v)) for ts, v in series.tail(8).items()] if len(series) else []
        cal = {}
        try:
            cal = t.calendar or {}
        except Exception:
            cal = {}
        nxt = cal.get("Ex-Dividend Date") if isinstance(cal, dict) else None
    except Exception as exc:
        breaker.fail()
        raise ProviderError(f"Yahoo dividends failed for {symbol}: {exc}") from exc
    breaker.ok()
    return {"history": history, "next_ex_date": nxt.isoformat() if hasattr(nxt, "isoformat") else None,
            "last_amount": history[-1][1] if history else None}
