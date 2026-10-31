---
name: market-data
description: How the TED Brokers Trading Hub gets real-world prices - provider choice per asset class (Finnhub, Coinbase Exchange public feed, Yahoo Finance via yfinance), quote/candle/options-chain normalisation, caching and rate limits, the in-process price bus, and streaming to browsers over Server-Sent Events. Use when writing or reviewing app/market_data/, /api/market/* or /api/stream/* routes, symbol search, charts data, options chains, or anything that needs a live or historical price.
---

# Market data

Prices are **real**; only execution is simulated. All price access goes through
`app/market_data/` so the engine, UI and copy trading all see the same number.

## Providers (free tiers, verify limits before relying on them)
| Need | Primary | Fallback | Notes |
|---|---|---|---|
| US stock/ETF real-time trades | Finnhub WebSocket `wss://ws.finnhub.io?token=` (`FINNHUB_API_KEY`) | Finnhub REST `/quote` (60 req/min) | Free WS: up to ~50 symbols subscribed. Subscribe only to symbols that someone is watching or holding. |
| Stock/ETF quote snapshot, prev close | Finnhub `/quote` | yfinance `fast_info` | `/quote` returns c, d, dp, h, l, o, pc, t. |
| Stock/ETF candles (1m-1D, history) | yfinance `Ticker.history()` | - | Finnhub candles are premium on the free plan. yfinance is unofficial; cache aggressively and handle failures. |
| Crypto real-time | Coinbase Exchange public WS `wss://ws-feed.exchange.coinbase.com`, `ticker` channel, products like `BTC-USD` (no key) | Coinbase REST `/products/{id}/ticker` | Gives best_bid / best_ask / price / volume_24h. 24/7. |
| Crypto candles | Coinbase REST `/products/{id}/candles?granularity=` | yfinance `BTC-USD` | Max 300 candles per call. |
| Options chains (expiries, strikes, bid/ask, IV, OI, volume) | yfinance `Ticker.options` + `option_chain(date)` | Black-Scholes theoretical from underlying + last IV | Snapshot data (~15 min delayed). Refresh a chain at most every 60 s, only on demand. Between refreshes, re-price the option by delta-adjusting from the live underlying so the P&L moves in real time. |
| Symbol search / profile | Finnhub `/search`, `/stock/profile2` | local seed list in `app/market_data/universe.json` | Keep a curated universe (S&P 500, top ETFs, top 50 crypto) so search works offline. |

yfinance is synchronous: always call it via `asyncio.to_thread`.

## As built (Phase 1) - read this before changing anything
- Entry point for every price: `app/market_data/service.py` (`get_quote`, `get_quotes`,
  `get_candles`, `get_expiries`, `get_chain`, `get_option_quote`, `search`). Never call a
  provider directly from routes or the engine.
- Provider order is in `service._fetch_quote`: crypto Coinbase -> Finnhub(BINANCE:<B>USDT)
  -> Yahoo; equities Finnhub -> Yahoo during the regular session, Yahoo -> Finnhub
  outside it (Yahoo 1-minute bars with `prepost=True` carry real pre/post trades; Finnhub
  `/quote` only has the regular close). Yahoo quotes come from `history(1d, 1m)` so `ts`
  is the real bar time; `fast_info` has no timestamp, do not use it.
- Free equity feeds have no NBBO: `make_quote` adds a synthetic spread and sets
  `spread_model="synthetic"`. The fill engine must use `bid`/`ask` from the quote and may
  show the spread model in confirmations.
- Option chains: rows without a live bid/ask are Black-Scholes `theoretical` using the
  chain ATM median IV (else 1Y historical vol). Yahoo reports placeholder IVs
  (1e-5, 0.03125, 0.0625) when unquoted - ignore them (`MIN_PLAUSIBLE_IV`).
- `host_reachable()` DNS gate: some networks NXDOMAIN crypto exchanges, slowly. Unchecked
  retries saturate the resolver pool and stall every feed. Gate any new provider host.
- The dev network used for this project blocks Coinbase; crypto there runs on Finnhub's
  Binance feed. Do not "fix" that by removing the Coinbase path.
- `GET /api/market/feeds` shows feed connection state and recent provider errors.
- Tests live in `tests/unit/market/`; `conftest.py` there makes any real network call
  fail the test. Keep it that way.

## Feed state (Phase 6)
- `quotes.public(q)` adds `feed`: `streaming` only when a healthy WS (`WSFeed.healthy`: connected and
  a message within 60 s) has the symbol subscribed; otherwise `delayed` (REST polling, delayed or
  theoretical data, options, stale quotes). The Trading Hub shows "Delayed" from this field.
- Drills in `tests/unit/market/test_failure_drills.py` (WS drop -> reconnect + resubscribe, feed
  state, poller REST refresh). Keep them passing when touching `feeds.py`.

## Screener and company data (Phase 7)
- `app/market_data/screener.py`: yfinance `EquityQuery` (region us, exchanges NMS/NGM/NCM/NYQ/ASE/PCX/BTS),
  rows filtered through `universe.normalize`, 60 s TTL cache, circuit breaker (`breaker.available` is a property).
- `app/market_data/company.py`: Finnhub via `finnhub.fetch_json` (shared token bucket) + Yahoo fallback;
  each part cached separately, failures return `{available: False, error}`; links filtered by `safe_url`.

## Normalised shapes (all providers map to these)
```python
Quote = {"symbol": "AAPL", "asset_class": "stock", "bid": 189.12, "ask": 189.14,
         "last": 189.13, "prev_close": 187.40, "open": ..., "high": ..., "low": ...,
         "volume": ..., "ts": 1767052800.123, "source": "finnhub", "delayed": False}
Candle = {"t": 1767052800, "o": ..., "h": ..., "l": ..., "c": ..., "v": ...}
OptionQuote = {"occ": "AAPL  261218C00200000", "underlying": "AAPL", "expiry": "2026-12-18",
               "strike": 200.0, "right": "C", "bid": ..., "ask": ..., "last": ...,
               "iv": 0.27, "oi": ..., "volume": ..., "delta": ..., "gamma": ...,
               "theta": ..., "vega": ..., "ts": ..., "source": "yfinance", "delayed": True}
```
Symbols: stocks/ETFs plain ticker (`AAPL`, `SPY`); crypto `BTC-USD`; options OCC.
Asset class comes from `universe.json` (`asset_class`: stock | etf | crypto); options are detected by OCC format.

## Architecture
```
app/market_data/
  service.py      get_quote(), get_quotes(), get_candles(), get_chain(), search()
  cache.py        In-memory TTL cache + Mongo `price_cache` for candles (survives restarts)
  bus.py          PriceBus: asyncio pub/sub; latest quote per symbol; subscriber refcounts
  feeds/finnhub_ws.py, feeds/coinbase_ws.py   Long-lived tasks with reconnect + backoff
  feeds/rest_poll.py   Poll fallback when WS is down or a symbol exceeds WS limits
  universe.json
app/routes/market.py   extend: /quote, /quotes, /candles, /search, /chain, /expiries
app/routes/stream.py   GET /api/stream/prices?symbols=AAPL,BTC-USD  (SSE)
                       GET /api/stream/account                      (SSE: orders, fills, balances)
```
- One upstream connection per provider, fanned out in-process. Never open a
  provider socket per browser.
- The matching engine subscribes to the bus for every symbol with open orders,
  open positions, or active copy links.
- SSE auth: `EventSource` cannot set headers, so issue a short-lived (60 s) stream
  token from `POST /api/stream/token` and pass it as `?st=`. Do not put the main JWT
  in the URL.
- SSE format: `event: quote\ndata: {json}\n\n`; send `: ping` every 15 s; throttle
  each symbol to max 4 updates/s per client.
- Deploy note: Uvicorn single worker is required for the in-process bus. If more
  workers are needed later, move the bus to Redis pub/sub.

## Rules
- Mark data `delayed: true` and show a "Delayed" badge in the UI when it is.
- When a provider fails, serve the last cached value with its real `ts`; never fake
  a fresh timestamp. The UI shows staleness from `ts`.
- Respect rate limits with a token bucket per provider. Log 429s.
- Keep API keys server-side only; the browser never talks to providers directly.
- Market-closed hours: stocks show last trade and after-hours flag; the engine
  must not fill regular orders.
