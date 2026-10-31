# Trading Hub + Unified Portfolio Implementation Plan

> **For agentic workers:** Work one task at a time. Every task names its owner subagent
> (`trading-backend`, `market-data`, `trading-ui`, `trading-qa`, `ui-designer`,
> `ui-reviewer`). Load the skills listed in that agent's prompt. Tick `- [ ]` boxes as
> you complete steps. Do not start a phase until the previous phase's QA gate passes.

**Goal:** Add a pro-grade self-directed trading platform (the **Trading Hub**) for
stocks, ETFs, crypto and options. It runs on real market prices, with simulated
execution and simulated funds. It shares one cash balance, one ledger and one
portfolio with copy trading, so the user sees a single, live, unified account,
just as on E*TRADE or Robinhood.

**School-project constraint:** this is not a real broker. No real money flows. The
`.school-notice` stays on the dashboard home and on every Trading Hub page.
The existing funding mechanism is **kept and integrated as-is**:
- The deposit request goes through admin approval, then the wallet is credited.
- Withdrawals keep code verification and admin approval.

The mechanism now writes to the unified ledger, so funded cash is immediately
buying power in the Trading Hub. No new payment processors are added (see
Phase 0, task 0.4).

**Stack:** FastAPI + sync pymongo (MongoDB Atlas) + vanilla HTML/CSS/ES modules.
Prices come from Finnhub (stocks/ETFs, existing key), the Coinbase Exchange public
feed (crypto) and yfinance (candles, options chains). Live updates reach the browser
over Server-Sent Events. Charts use TradingView Lightweight Charts, vendored locally.

---

## 1. Current state (what we are integrating with)

| Area | Today | Problem |
|---|---|---|
| Cash | `users.wallet_balance` (float dollars). It is written directly at `admin.py:709,1451,2059,2277`, `investments.py:186`, `etf_plans.py:143`, `defi_plans.py:143`, `options_plans.py:143` and `referrals_service.py:161`. | No ledger. Writes are read-then-set and not atomic. Floats are used for money. |
| Copy trading | `POST /api/traders/select/{id}` only pushes onto `users.selected_traders`. | No allocation, no mirrored trades, no P&L. `copy_trading_allocation` is a number the admin sets by hand. |
| Trader activity | `app/trade_scheduler.py` overwrites `expert_traders.recent_trades` with random fake trades every 1-5 h. | Not tied to prices or to followers. |
| Prices | `GET /api/market/ticker` (Finnhub, 60 s cache). | No quotes per symbol, no candles, no options, no streaming. |
| Portfolio page | `app/portfolio.html` + `live/portfolio.js` show plan investments using a straight-line "modelled" value. | Not market-driven. |
| Real time | Polling only. SSE is used only by the AI chat. | — |

## 2. Target architecture

```
                 +-------------------- app/market_data -------------------+
 Finnhub WS/REST |  feeds/*  ->  PriceBus (latest quote per symbol, pub/sub)|---> /api/stream/prices (SSE)
 Coinbase WS     |  service.get_quote/candles/chain/search  + cache        |---> /api/market/* (REST)
 yfinance        +---------------------------+-----------------------------+
                                             | quotes
                 +-------------------- app/trading ------------------------+
 /api/trading -->|  orders.py (validate, reserve)  -> matching.py loop     |
                 |  positions.py, options.py (expiry job), portfolio.py   |---> /api/stream/account (SSE)
                 |  copy_engine.py  <- trader system accounts orders      |
                 |  ledger.py  (ONLY writer of cash)                      |
                 +---------------------------+-----------------------------+
                                             |
         users{cash_cents,reserved_cents,wallet_balance mirror}, ledger_entries,
         orders, fills, positions, copy_links, portfolio_snapshots, watchlists
```

### Unification model (the core of the integration)
- **One cash balance per user**: `users.cash_cents`. The legacy `wallet_balance` is
  updated by the ledger in the same write, so every existing page keeps working.
- **One ledger**: deposits (simulated), withdrawals, plan purchases, referral bonus,
  trades, fees, copy allocations and copy P&L are all `ledger_entries` rows.
  `/api/wallet/transactions` becomes a view over the ledger.
- **One positions table with buckets**:
  - `bucket="self"` holds positions from the user's own Trading Hub orders.
  - `bucket="copy:<link_id>"` holds positions mirrored from a copied trader.
  - The portfolio total is the sum over all buckets. The UI filters by source.
- **Copy trading becomes real trading**:
  - Each expert trader is a system account that places real simulated orders
    against live prices. The rewritten `trade_scheduler.py` acts as a
    strategy bot per trader, with a style taken from `specialization`.
  - When a trader fill occurs, the copy engine places proportional child orders
    for followers through the same order pipeline. Copy P&L is therefore real,
    and it is driven by the market.
  - Trader stats (`ytd_return`, `win_rate`, `max_drawdown`, `copiers`, AUM) are
    computed from the trader's own snapshots instead of being typed in by the admin.
- **Plans** (Robo Advisor / ETF / DeFi / Options plans) stay **exactly as they are**.
  They show in the unified portfolio as a source called "Managed plans", valued
  with the existing model. Any money moving in or out of a plan goes through the
  ledger.
- **ETF baskets** are a Trading Hub feature, separate from plans, modelled on
  M1 Finance "pies" and E*TRADE Core portfolios.
  - Curated or custom weighted baskets of real ETFs, bought with one order that
    fans out into child orders.
  - They are held in bucket `basket:<basket_holding_id>`, with drift tracking and
    one-click rebalance.

### Key decisions (confirmed 2026-10-29)
1. **Account types:** each user has one brokerage account with `account_type`
   `cash` or `margin`.
   - A margin upgrade follows a margin agreement step, like the E*TRADE upgrade
     flow.
   - Margin follows Reg T rules:
     - Initial requirement 50%, maintenance 25% for longs and 30% for shorts.
     - House surcharges apply to volatile names.
     - Margin interest accrues daily on the debit balance, using a tiered APR
       table.
     - Margin calls (Fed and maintenance) with a deadline; forced liquidation
       if a call is not met.
     - Pattern day trader rule: accounts under $25k are limited to 3 day trades
       in 5 days.
   - **Short selling of stocks and ETFs** on margin accounts:
     - Simulated locate (easy-to-borrow list or hard-to-borrow list).
     - Daily borrow fee charged on hard-to-borrow names.
     - Short-sale proceeds are held as a credit.
     - Buy-to-cover orders.
     - Short positions are marked to market, and dividends are owed.
   - Crypto is cash-only, with no margin, as at Robinhood and E*TRADE.
2. **Options levels:**
   - 1: covered calls and cash-secured puts.
   - 2: long calls and puts.
   - 3: spreads. Vertical, calendar, diagonal, straddle, strangle, iron condor
     and butterfly, entered as **multi-leg orders** and filled at a net debit or
     credit.
   - 4: naked short options, margin accounts only, using the CBOE requirement
     formula.
   - Spreads are margined at max loss for defined-risk positions.
   - Expiry: ITM long options auto-exercise, and short options can be assigned.
     Equity options settle into shares (physical delivery). Index-style
     settlement is not needed.
3. **Funding: integrate the existing mechanism unchanged.**
   - Keep the current endpoints, UI and admin tools:
     - Deposits: `POST /api/wallet/deposit`, `POST /api/deposits/request`, and
       the admin approve/reject at `admin.py:1346-1600`.
     - Funding methods: the crypto-wallets and bank-account settings.
     - Withdrawals: request, verification code, then admin approve/complete.
     - The admin "set balance" control.
   - What changes: every approval, withdrawal and admin adjustment posts a
     `ledger_entries` row through `ledger.py`. As a result:
     - Funds appear as Trading Hub buying power right away.
     - Withdrawals are checked against withdrawable cash. That excludes cash
       reserved for open orders, margin debit and short proceeds.
     - Transfers show in the unified activity feed and on statements.
   - No new payment processors are added.
4. **Fractional shares:** allowed for stocks and ETFs (to 6 dp) and crypto (to
   8 dp), long only and cash-funded. Short sales must be whole shares.
5. **Starting balance:** $0, as today. Users fund through the existing deposit
   flow.

## 3. API contract (frontend and backend agree on this)

All routes need a Bearer JWT. Money in responses is a decimal string in dollars
(`"1234.56"`). Quantities are decimal strings.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/market/search?q=` | `[{symbol, name, asset_class, exchange}]` |
| GET | `/api/market/quote/{symbol}` | Quote shape (see market-data skill) |
| GET | `/api/market/quotes?symbols=A,B` | `{symbol: Quote}` |
| GET | `/api/market/candles/{symbol}?range=1D\|5D\|1M\|3M\|1Y\|5Y` | `{symbol, interval, candles[]}` |
| GET | `/api/market/options/{symbol}/expiries` | `["2026-11-06", ...]` |
| GET | `/api/market/options/{symbol}/chain?expiry=` | `{underlying_quote, calls[], puts[], delayed}` |
| GET | `/api/market/status` | `{equities: open\|pre\|post\|closed, next_open, crypto: open}` |
| POST | `/api/stream/token` | `{token, expires_in}` (60 s; used as `?st=`) |
| GET | `/api/stream/prices?symbols=&st=` | SSE `quote` events |
| GET | `/api/stream/account?st=` | SSE `order`, `fill`, `balance`, `position` events |
| POST | `/api/trading/orders/preview` | Body: order request. Returns `{est_price, est_cost, est_fee, buying_power_after, warnings[]}` |
| POST | `/api/trading/orders` | Body: `{client_order_id, symbol, asset_class, side: buy\|sell\|sell_short\|buy_to_cover\|buy_to_open\|sell_to_open\|buy_to_close\|sell_to_close, qty \| notional, type, limit_price?, stop_price?, trail_percent?, tif, extended_hours}`. Returns Order |
| POST | `/api/trading/orders/multileg` | `{client_order_id, strategy, legs:[{occ, side, ratio}], qty, type: market\|net_limit, net_price?, tif}`. Returns parent Order with legs |
| GET | `/api/trading/account` | `{account_type, options_level, cash, margin_debit, short_proceeds, equity, maintenance_req, excess_liquidity, buying_power:{stock, option, crypto}, sma, day_trades_5d, pdt_flag, margin_calls[]}` |
| POST | `/api/trading/account/margin-upgrade` | Accepts margin agreement; `{accepted: true}` |
| POST | `/api/trading/account/options-level` | Request level 1-4 with questionnaire (auto-approved by rules) |
| GET | `/api/trading/locate/{symbol}` | `{shortable, easy_to_borrow, borrow_rate_apr, available_shares}` |
| GET | `/api/trading/baskets/templates` | Curated ETF baskets `[{id, name, risk, holdings:[{symbol, weight}]}]` |
| POST | `/api/trading/baskets` | `{template_id? , name, holdings[], amount}` buys a basket |
| GET | `/api/trading/baskets` | Owned baskets with value, P&L, drift |
| POST | `/api/trading/baskets/{id}/rebalance` / `/invest` / `/sell` | Basket actions |
| GET | `/api/trading/orders?status=open\|filled\|all&source=&limit=&cursor=` | Orders |
| DELETE | `/api/trading/orders/{id}` | Cancel |
| PATCH | `/api/trading/orders/{id}` | Replace (qty / prices) |
| GET | `/api/trading/positions?bucket=all\|self\|copy:<id>` | Positions with mark, market value, unrealized and day P&L |
| GET | `/api/trading/portfolio/summary` | `{equity, cash, buying_power, reserved, day_pnl, day_pnl_pct, total_pnl, by_source[], by_asset_class[]}` |
| GET | `/api/trading/portfolio/history?range=` | `[{t, equity}]` from snapshots |
| GET | `/api/trading/activity` | Ledger entries, paginated (also used by the wallet page) |
| GET/POST/DELETE | `/api/trading/watchlists[/{id}[/symbols/{sym}]]` | Watchlists |
| (existing) | `/api/wallet/*`, `/api/deposits/*`, `/api/withdrawals/*`, `/api/crypto-wallets/*` | Contracts unchanged; internally routed through the ledger |
| GET | `/api/wallet/balance` (existing, extended) | Adds `withdrawable`, `buying_power`, `equity` alongside the existing `balance` field |
| POST | `/api/copy/links` | `{trader_id, allocation}` starts copying (replaces `traders/select`) |
| PATCH | `/api/copy/links/{id}` | `{allocation? , status: active\|paused}` |
| DELETE | `/api/copy/links/{id}?close_positions=true` | Stop copying |
| GET | `/api/copy/links` | Links with allocation, equity, P&L, positions count |

`/api/traders/select` and `/api/traders/unselect` stay as thin wrappers around
`/api/copy/links` (using the trader's `minimum_copy_amount` as the default
allocation), so the existing copy-traders page keeps working during the migration.

---

## Phase 0 - Foundations: ledger, money, safety (owner: trading-backend) - DONE 2026-10-29

### Task 0.1 Test harness
- [x] `tests/conftest.py` uses a relative path and installs an in-memory **mongomock**
      database before the app is imported. No test touches the `.env` database (the
      old fixtures inserted and deleted users in production). `fresh_db` fixture
      gives a test an empty database.
- [x] `requirements-dev.txt` (pytest, pytest-asyncio, mongomock, freezegun) and
      `pytest.ini` (`testpaths = tests`, so root-level ad-hoc scripts are ignored).
- [x] `app/database.py` reads `MONGODB_DB`, falling back to `DATABASE_NAME`.

### Task 0.2 Ledger service `app/trading/ledger.py`
- [x] `post()` plus `credit/debit/reserve/release/settle_reserved`; fields
      `users.{cash_cents, reserved_cents, available_cents}` with `wallet_balance`
      kept as a mirror.
- [x] Crash-safe **without** Mongo transactions (so it also runs on mongomock and a
      standalone mongod): pending entry, then one guarded `find_one_and_update`
      that pushes the entry id onto `users.ledger_recent`, then posted.
      `recover_pending()` finishes or discards interrupted postings.
- [x] Lazy `ensure_account()` seeds cash from `wallet_balance` with an
      `opening_balance` entry (deviation: the plan said `adjustment`).
- [x] Indexes: unique `idempotency_key`, `(user_id, created_at)`, `(status, created_at)`, `(ref_type, ref_id)`.
- [x] Tests: concurrent debits cannot overdraw, duplicate keys are no-ops,
      reconcile (balance == sum of entries), crash recovery.

### Task 0.3 Migrate existing cash writers to the ledger
- [x] `scripts/migrate_cash_to_ledger.py` (dry run by default, `--apply` to write;
      also places holds on withdrawal requests still pending; reconciles at the end).
- [x] All direct `wallet_balance` writes replaced: admin deposit approve, admin
      withdrawal approve, admin transaction complete, admin set balance, the four
      plan purchase routes, the referral bonus. Only `ledger._sync_mirror` writes
      `wallet_balance` now.
- [x] Deposit requests store `transaction_id`; approval/rejection update exactly that
      row (legacy requests fall back to the oldest matching pending row).
- [x] Approve/reject claim the request atomically (`pending -> processing`), so
      concurrent double approvals are impossible (also enforced by idempotency keys).
- [~] Withdrawal password check: the wallet UI never sends a password, so enforcing
      it would block every withdrawal. Now verified against `hashed_password`
      **only when a password is supplied**; withdrawals stay protected by the
      8-character code + admin approval. Adding a password field to the dialog is
      a product decision, left open.
- [x] Verification codes use `secrets` instead of `random`.

### Task 0.4 Integrate the existing funding flow with the ledger (owner: trading-backend + trading-ui)
- [x] Deposit approval credits through `funding.credit_deposit` (key `deposit:<request_id>`).
      Rejection posts nothing.
- [x] Withdrawals **hold** funds when requested (`/api/wallet/withdraw` and
      `/api/withdrawals/request`), release them on reject / expired code / too many
      attempts, and settle from the hold on approve (both admin endpoints share the
      key, so one withdrawal can never be paid twice). Holds created before the ledger
      existed fall back to debiting available cash. Margin-call blocking and short
      proceeds are added in Phase 2B (`funding.withdrawable_cents`).
- [x] Admin "set balance" posts an `adjustment` for the difference and cannot go below held funds.
- [~] `/api/wallet/transactions` and `/pending-transactions` are **unchanged**; the
      transactions collection remains the transfer journal. The full cash history is
      the new `GET /api/wallet/activity` (ledger, cursor pagination by entry id).
- [x] `GET /api/wallet/balance` adds `cash, reserved, withdrawable, buying_power, equity`
      (`balance` keeps its meaning).
- [x] Wallet page: "Cash balance", buying power line, "Available to withdraw" with
      held amount; withdraw dialog validates against withdrawable.
- [ ] Trading Hub "Deposit" button -> moved to Task 3.2 (the hub page does not exist yet).
- [ ] `balance` SSE event -> moved to Task 1.5 (`ledger.add_listener` hook is ready).
- [x] `.school-notice` on wallet (footer and deposit dialog), portfolio, copy-traders, plans.
- [x] Gate: 72 tests pass. Browser smoke on the real app against mongomock: deposit ->
      admin approve (second approve refused), withdraw -> hold -> verify code -> admin
      approve, 1440 and 390 px, no console errors.

## Phase 1 - Market data (owner: market-data) - DONE 2026-10-29

### Task 1.1 Service, cache, universe
- [x] `app/market_data/` package: `service.py` (the only price entry point), `quotes.py`
      (normalised quote shape), `cache.py` (TTL cache with single-flight, token bucket,
      circuit breaker), `universe.py` + `universe.json`.
- [x] Universe: 11,131 symbols (all NYSE/Nasdaq/Arca/Cboe/NYSE American common stocks,
      ADRs and ETFs from Finnhub, plus 30 curated crypto pairs), with curated names
      for popular tickers. Regenerate with `scripts/build_universe.py`. Search is local
      (popular symbols ranked first) and works offline.
- [x] Quote provider chains with fallback and the last good value served with its
      real timestamp when every provider fails:
  - Crypto: Coinbase, then Finnhub (Binance USDT feed), then Yahoo.
  - Equities in the regular session: Finnhub, then Yahoo.
  - Equities outside the regular session: Yahoo (its 1-minute bars include pre/post
    trades), then Finnhub.
- [x] Candles: 1D/5D (with extended hours for equities), 1M, 3M, 6M, YTD, 1Y, 5Y.
      Coinbase serves short crypto ranges when reachable; Yahoo serves the rest.
      Cached in memory per range (60 s to 6 h). Deviation: no Mongo `price_cache`;
      the in-memory stale-on-error fallback was enough.

### Task 1.2 PriceBus and live feeds
- [x] `bus.py`: latest quote per symbol, coalescing subscriptions (a slow client only
      sees the newest quote), demand tracking. An older quote never overwrites a newer one.
- [x] `feeds.py`:
  - Finnhub WS trades for equities (and for crypto while Coinbase is unhealthy).
  - Coinbase WS ticker for crypto, with real bid/ask.
  - REST poller for anything stale or missing its prev-close snapshot.
  - Option re-marks driven by underlying ticks.
  - Reconnect with backoff throughout. Feeds start in `main.py`; disable with
    `MARKET_FEEDS=0`.
- [x] Free feeds have no NBBO for US equities, so quotes carry a **synthetic spread**
      (2 bps stocks, 1 bp ETFs, 5 bps crypto) labelled `spread_model: "synthetic"`.
- [x] DNS gate (`providers.host_reachable`): blocked hosts are probed once with a 3 s
      timeout and skipped for 10 minutes. Without it, failing lookups saturated the
      resolver pool and stalled healthy feeds. Finding: this development network
      blocks Coinbase/Kraken/Binance.US at DNS level, so crypto runs on Finnhub's
      Binance feed here; on a normal host Coinbase is used automatically.

### Task 1.3 Market calendar
- [x] `calendar.py`: pre/regular/post/closed sessions, NYSE holidays and early closes
      for 2026-2027, next open/close. **Add 2028 dates before 2028.**

### Task 1.4 Options
- [x] `app/trading/options.py`: OCC parse/format (padded and Yahoo forms), friendly
      names, Black-Scholes price and greeks, implied-vol solver, second-order re-mark.
- [x] Chains via Yahoo (expiries cached 1 h, chains 60 s, ~15 min delayed, flagged
      `delayed`). Rows without a live bid/ask (e.g. pre-market) are priced with
      Black-Scholes using the chain's ATM median IV, falling back to 1-year historical
      volatility. They are flagged `theoretical`, and Yahoo's placeholder IVs are ignored.
- [x] Between refreshes, chain rows and option quotes are re-marked from the live
      underlying, so option P&L moves in real time. Contracts missing from the snapshot
      are priced theoretically.

### Task 1.5 REST and SSE routes
- [x] `/api/market/{status, search, quote/{s}, quotes, option-quote?occ=, candles/{s},
      options/{s}/expiries, options/{s}/chain, feeds}`. All need auth and are rate
      limited; `/feeds` shows diagnostics.
- [x] `/api/stream/token` returns a 120 s token (`typ=stream`). It is rejected as an API
      Bearer token because it has no `sub`/`user_id`.
- [x] `/api/stream/prices` sends `quote`, `status` and `error` events (at most 4 flushes/s,
      15 s pings). `/api/stream/account` sends `balance` events from
      `ledger.add_listener` (carried over from Task 0.4) and is thread-safe through
      `app/trading/events.py`.
- [x] Gate: 135 tests pass (63 market tests, all offline with fixtures). Live checks
      against real providers:
  - Quotes, candles for every range, the AAPL chain, option quotes.
  - Browser `EventSource` (19 quotes in 8 s, no errors).
  - Account stream receiving `balance` within the request that approved a deposit.

## Phase 2 - Order engine (owner: trading-backend) - DONE 2026-10-29

### Task 2.1 Models and instruments
- [x] `models.py` (`OrderRequest` with cross-field validation, `ReplaceRequest`, watchlists),
      `instruments.py` (qty steps: 1e-6 stocks/ETFs, 1e-8 crypto, whole contracts; ticks;
      multiplier 100; session tradability; DAY/GTC expiry; T+1 settlement times),
      `fees.py` (stocks $0 + SEC/FINRA TAF on sells, options $0.65/contract, crypto 0.5%).

### Task 2.2 Pre-trade checks and placement
- [x] `orders.normalize_request` covers the following (no separate `risk.py`):
  - Sides per asset class. Short-opening sides return `margin_required` /
    `options_level` until 2B.
  - Options level (default 2).
  - Expired contracts.
  - TIF rules (crypto DAY becomes GTC with a warning; no GTC market orders).
  - Extended hours: limit orders, stocks/ETFs only.
  - Quantity step; fractional shares on regular-session market/limit orders only.
  - $1 minimum.
  - Tick size.
  - ±50% collar.
  - Stop on the correct side of the market.
  - Holdings net of other open sells.
- [x] Placement:
  - Idempotent on `client_order_id`.
  - Buys reserve cash: limit at limit price; market at ask + 1% (crypto 3%, options 5%).
  - Marketable orders execute immediately.
  - IOC/FOK that can't fill are canceled.
- [x] Every status change goes into `status_history`.
- [x] Cancel releases the hold.
- [x] Cancel-replace links `replaces` / `replaced_by`.
- [x] Every rejection is stored for the audit trail.
- [x] `/api/trading/*` routes with rate limits. Errors are `{detail: {code, message}}`
      for inline ticket messages.

### Task 2.3 Matching loop
- [x] `matching.py`: pure fill rules (market with square-root size slippage capped at
      50 bps, limit, stop, stop-limit, trailing; stops trigger only on regular-session
      prints; stale quotes never fill).
- [x] `engine.py`:
  - Subscribes to the bus for open-order symbols and open-position symbols, so
    positions keep streaming.
  - 1 s sweep: expiry, index refresh, re-evaluation on session change, options
    expiration, snapshots.
- [x] Per-user `threading.RLock`: placement, fills and cancels for one account are
      serialised.
- [x] Fill pipeline: pending fill → ledger (keyed by fill id) → position (versioned,
      keyed) → order (keyed). `recover_pending_fills()` runs at startup.
- [x] Account SSE events: `order`, `fill`, `position`, `balance`.
- [x] Orders queued while the market is closed execute at the first fresh quote after the open.

### Task 2.4 Positions and portfolio
- [x] `positions.py`: signed average-cost math (long, short, flip), realized P&L, fees in basis.
- [x] `portfolio.py`:
  - Summary: total value incl. managed plans, equity, cash, reserved, buying power,
    withdrawable (minus unsettled T+1 proceeds), day P&L, by asset class, by source
    bucket.
  - Positions view.
  - Snapshots: minute snapshots with 30-day TTL; daily snapshot after 16:05 ET for
    all funded accounts, which also records option `prev_mark`.
  - History for 1D/1W/1M/3M/1Y/ALL.
- [x] `/api/wallet/balance` now reports `equity`, `positions_value`, `total_value`.
- [x] `/api/trading/activity` hides internal order holds/releases unless `include_holds=true`.

### Task 2.5 Options lifecycle
- [x] `expiration.py`: at 16:15 ET (or the first sweep after), ITM long contracts by
      >= $0.01 are exercised with physical delivery. This is booked as the option
      closed at intrinsic value plus the stock leg at strike ± intrinsic, so the pair
      nets to exactly the strike.
  - If the account cannot take delivery, the contract is closed at intrinsic value.
  - OTM contracts expire worthless.
  - Open orders on the contract are canceled.
- [ ] Short-option assignment and early assignment before ex-dividend → moved to
      Phase 2B (no shorts exist until then).
- [x] Gate: 180 tests pass (45 new engine/API tests). Live run against real prices:
  - Crypto notional buy filled at the ask ($1,000.00 including the 0.5% fee).
  - SPY extended-hours limit filled pre-market.
  - AAPL market order queued for the open.
  - A resting ETH limit filled by the engine on a live tick when the ask crossed the limit.
  - Snapshots and history recorded; no engine errors.

## Phase 2B - Margin, short selling, option spreads (owner: trading-backend) - DONE 2026-10-29

### Task 2B.1 Account model and margin math (`app/trading/margin.py`)
- [x] `users.account_type` (cash/margin), `options_level` (default 2), `margin_agreement_at`.
  - Deviation: there is no stored `margin_debit_cents`/`short_proceeds_cents`. Debit is
    negative cash (`ledger.post(..., allow_negative_cash=True)`, margin fills only), and
    equity = cash + long - short + options.
  - Withdrawals are capped by excess equity, so neither borrowed money nor short
    proceeds can leave the account.
- [x] One pure requirement engine:
  - Long stock 50%/30%; under $3 100%; leveraged ETFs 75%.
  - Short 150% initial; maintenance 30% (min $5/share), or 100% (min $2.50/share) under $5.
  - Crypto 100%.
  - Options per underlying use payoff-at-expiry max loss after pairing covered
    calls/puts, which covers verticals, condors, butterflies, calendars and CSPs.
  - Uncovered short calls use the CBOE naked formula.
  - Net option value is included, so long options give no loan value and credits are applied.
- [x] Buying power:
  - Cash accounts: available - option collateral - holds.
  - Margin accounts: stock 2× excess (borrowing only at equity >= $2,000); options 1×;
    crypto limited to cash; day-trade BP 4× for accounts >= $25k.
  - Margin accounts hold buying power on open orders (`bp_hold_cents`) instead of
    reserving cash.
- [x] Interest: tiered APR / 360, accrued daily, posted on month end as `margin_interest`.

### Task 2B.2 Short selling (`app/trading/borrow.py`)
- [x] Locate:
  - ETB = popular names, no fee.
  - HTB = configured high-short-interest names plus every other symbol, with a borrow
    APR and a lendable pool shared by all accounts.
  - Not shortable under $1 or for crypto.
  - Exposed as `GET /api/trading/locate/{symbol}`.
- [x] `sell_short` / `buy_to_cover`: margin accounts only, whole shares. Rule 201 SSR:
      at -10% on the day, short sales must be limits above the bid.
- [x] Daily HTB borrow fees, with catch-up for missed days.
- [x] Dividends (`dividends.py`): longs credited and shorts charged `dividend_owed` on the
      ex-date (simplification: booked on the ex-date, not the pay date). Data from Yahoo.
- [x] Assignment: short ITM options at expiry are assigned with physical delivery, a
      short call short-selling any shares not held. OTM shorts expire and keep the premium.
- [x] Early assignment: deep-ITM short calls are assigned after the close before an
      ex-date when time value < dividend.
- [ ] Recall/buy-in of HTB shorts: not done (no real lending data to drive it). Optional.

### Task 2B.3 Margin calls and liquidation (`app/trading/risk_monitor.py`)
- [x] The engine runs it every 5 s (not on every tick) for margin accounts, negative-cash
      accounts and accounts with open calls.
- [x] Fed call after a margin fill leaves equity < initial requirement (due T+4). Maintenance
      call when equity < maintenance (due T+2). Both are met automatically once compliant.
  - Notifications go to the existing notifications collection plus `margin_call`/`notice`
    SSE events.
- [x] Liquidation at < 90% of maintenance or when a call is overdue: one market order per
      pass on the largest-requirement position, `source="liquidation"`. Withdrawals are
      blocked while a call is open.
- [x] PDT: round trips in 5 trading days. Margin accounts under $25k are blocked on the
      4th; `day_trades_left` is shown on the account.

### Task 2B.4 Multi-leg options orders (`app/trading/multileg.py`)
- [x] Strategy templates with structural validation: vertical, calendar, diagonal,
      straddle, strangle, iron condor, iron butterfly, butterfly (1:2:1, even spacing),
      covered call, collar, custom (2-4 legs).
- [x] Required options level is derived from the what-if:
  - Naked: 4, plus a margin account.
  - Short legs: 3.
  - Long-only: 2.
  - Covered call: 1.
- [x] Fills:
  - Net limit: each option leg at mid ± $0.01.
  - Market: at the natural price.
  - Fills are written first and credits applied first; parents are finished by
    `multileg.finish`, and recovery replays the legs.
- [x] `strategy_groups` collection: strategy, legs, qty, open nets, for showing a spread
      as one line in the UI.
- [x] Payoff (`POST /api/trading/strategies/payoff`): P/L curve at expiry, breakevens,
      max profit/loss, unlimited flags, net cost.
- [x] Account routes:
  - `POST /account/margin-upgrade` (both agreements required).
  - `POST /account/cash-downgrade` (only when there is no debit, short or call).
  - `POST /account/options-level` (simulated suitability rules: level 4 needs margin,
    1+ years of experience, a speculation objective and $5k equity).
  - `GET /margin-calls`.
  - `GET /strategies`.
- [x] Gate: 213 tests pass (33 new for 2B, including hand-checked requirement tables). Live
      pre-market run:
  - Margin upgrade doubled buying power.
  - An extended-hours SPY short filled.
  - A margin limit held 50% buying power.
  - A spread was blocked at level 2, then approved at level 3 and rested until the
    open with its requirement held.

## Phase 3 - Trading Hub UI (owner: ui-designer, then trading-ui, then ui-reviewer) - DONE 2026-10-29

### Task 3.1 Design
- [x] `design/DESIGN.md` section 10 (Trading Hub components and layout) and `design/decisions.md`
      (three columns only from 1600px, inline mobile ticket, compact chain, Trade in the tab bar).
      No Stitch mockups were needed.

### Task 3.2 Shell and navigation
- [x] `app/trade.html`, with "trade" added to `APP_PAGES`.
  - "Trade" is in the rail on every page.
  - In the mobile tab bar "Trade" replaces "Plans"; plans stay in the rail.
- [x] Lightweight Charts 4.2.3 vendored to `assets/vendor/lightweight-charts-4.2.3/` (Apache-2.0,
      LICENSE kept, TradingView attribution logo left on).
- [x] JS modules in `assets/js/trade/`: `dom` (safe DOM builder, formatters), `stream` (SSE with
      stream tokens and reconnect), `chart` (price and payoff charts, ET axes, theme-aware).
- [x] `api.js` surfaces `{code, message}` errors.
- [x] Business-rule refusals return 400, never 403. The dashboard logs the user out on 401/403.

### Task 3.3 Quote header, chart, symbol search, watchlist rail
- [x] Quote header: live SSE price, change, bid/ask/OHLC/prev close, session tag, stream tag,
      an "Estimated spread" honesty tag, and as-of time.
- [x] Tick flash (color only). Chart ranges 1D-5Y in area or candles, last bar updated live.
- [x] ARIA combobox search with sequenced requests (Alt+F). Watchlists with live prices and
      add/remove for the current symbol.

### Task 3.4 Order ticket
- [x] Actions depend on the account and position (Buy / Sell / Sell short / Buy to cover / option
      open/close), as a radiogroup with roving tabindex.
- [x] Shares/Dollars toggle; market/limit/stop/stop-limit/trailing; TIF rules per asset class;
      extended hours.
- [x] Live server-side estimate, including slippage. Review dialog showing the hold, buying power
      after, quote and warnings.
- [x] Stable `client_order_id` per draft. Inline, focused errors chosen by the API code.
- [x] Shortcuts Alt+B / Alt+S.

### Task 3.5 Blotters
- [x] Positions repriced live, with spread groups as a parent row plus legs and Close/Cover.
- [x] Open orders with Cancel and inline Edit (cancel-replace; Escape/Cancel; deferred re-render
      while editing).
- [x] History with rejection reasons, and the ledger Activity feed.

### Task 3.6 Options chain and strategy builder
- [x] Expiry selector, calls | strike | puts, ITM shading plus an edge marker, a spot line, and
      theoretical prices marked with "*".
- [x] Compact columns via container queries. Bid/ask buttons pre-fill the ticket and never
      silently flip the side.
- [x] Strategy builder:
  - 11 templates built from real chain strikes at a chosen width.
  - Server preview for net mid/natural, max profit/loss, breakevens and requirement.
  - Payoff chart, a net-limit order, and a stable order id per draft.

### Task 3.7 Margin and shorting UI
- [x] Account panel: type, options level, buying power by kind, margin used, excess liquidity,
      day trades left, day P&L.
- [x] Sell short / Buy to cover with a locate badge (ETB, or HTB with APR and shares) and SSR notice.
- [x] Margin-call band on the Trading Hub (announced only on change) and on every dashboard
      page (`live/margin-banner.js`, loaded by `header.js`).
- [x] Settings > Trading account (`live/trading-settings.js`): margin upgrade with both
      agreements, downgrade, and the options-level application with result and reasons.
      `settings.html#trading` deep link.

### Task 3.8 ETF baskets
- [x] `app/trading/baskets.py`:
  - Five curated templates.
  - Custom baskets of up to 20 ETFs with weights totalling 100%.
  - Invest (fractional dollar orders per weight into `basket:<id>`), sell %, rebalance (sells
    first).
  - Weekly/monthly auto-invest run by the engine.
  - Routes under `/api/trading/baskets`.
- [x] Baskets tab: owned baskets (value, P&L, drift, actual vs target weight bars, Invest /
      Rebalance / Sell / Auto-invest), model portfolios, custom builder.
- [x] Gate:
  - 217 tests pass (4 new basket tests).
  - The ui-reviewer audit raised 25 findings, including 2 Critical and 10 High:
    - Fixed: every Critical and High finding.
    - Fixed among the Mediums: shared toast error tone, chart theme recolor and light-mode
      contrast (`--chart-line` teal-700), and ticket overflow on short screens.
    - Recorded in `decisions.md`: the departures from DESIGN.md.
  - Browser checks at 1440/768/390 px with no page overflow and no console errors:
    - Order placement, review, rejections, keyboard navigation and search race.
    - OCC deep link, chain and builder.
    - Settings flows, margin-call band, light theme.
  - Live regular session: a SPY call market buy filled at the ask; a SPY 768/773 vertical
    filled at a $2.81 net debit.

## Phase 4 - Copy trading on the engine (owner: trading-backend) - DONE 2026-10-29

### Task 4.1 Copy links (`app/trading/copy_engine.py`, `app/routes/copy.py`)
- [x] `copy_links`: allocation, link cash, status (active / paused / stopping / stopped),
      optional stop-loss %.
  - Allocating funds is a ledger `copy_allocate` reservation: equity is unchanged, but the
    cash can't be spent elsewhere or withdrawn.
  - Copy positions live in the bucket `copy:<link_id>`.
- [x] `/api/copy/links` routes:
  - GET: list links.
  - POST: start copying (minimum copy amount enforced).
  - PATCH: add funds, withdraw unused cash, pause/resume, stop-loss.
  - DELETE: stop, which closes the bucket at market and releases the cash once flat.
  - GET `/{id}`: positions and trades.
- [x] `/api/traders/select`, `/unselect` and `/selected/list` are now wrappers. Select
      allocates the trader's minimum; selected/list returns the copy details.
- [x] Old `users.selected_traders` are migrated lazily to links. A link is funded with the
      minimum when cash allows, otherwise it is created paused with a note.
- [x] `selected_traders`, `copy_trading_allocation` and trader `copiers` are kept in sync
      from the links (derived, not typed in).

### Task 4.2 Trader system accounts and strategy bots (`app/trading/bots.py`)
- [x] Each expert trader gets a system user:
  - `is_system`, hidden from admin user lists and statistics.
  - Cash = AUM clamped to $100k-$2M.
- [x] Strategy by specialization:
  - Crypto momentum.
  - Currency momentum via currency ETFs (the platform has no spot FX).
  - Tech momentum.
  - Index/sector rotation.
  - Dividend and blue-chip fixed weights with drift rebalancing.
  - Options income (SPY shares plus covered calls).
- [x] Bots evaluate every 8-20 min while their market is open (crypto 24/7), place at most
      3 orders, and go through the normal pipeline (`source="bot"`).
- [x] Bot universes are kept streaming.
- [x] `app/trade_scheduler.py` (random fake trades) is no longer started.
      `recent_trades` is filled from real bot executions.

### Task 4.3 Copy engine
- [x] A bot fill becomes a durable `copy_jobs` row (unique per fill), processed by the engine
      sweep every second.
  - Buys are mirrored at link equity ÷ trader equity, within the link's cash.
  - Sells close the same fraction of the follower's bucket position.
  - Fractional sizes for stocks/ETFs/crypto; option children only with whole contracts
    (otherwise skipped, with `last_skip` recorded).
- [x] Link cash accounting:
  - Child buys hold from the link.
  - Leftover holds and sale proceeds return to the link (proceeds are re-reserved).
  - Every change is idempotent (keyed by order or fill id).
- [x] Pause (no new mirrors), stop (liquidate, then release), stop-loss check every 30 s.

### Task 4.4 Computed trader stats
- [x] `bots.compute_stats`: YTD return, max drawdown (from snapshots), win rate (closing
      fills), copiers, AUM (bot equity plus followers' copy equity).
  - Refreshed every 30 min and labelled `stats_live` / `stats_since`.
  - The track record starts when the bot starts.
- [x] Admin `PUT /traders/{id}` no longer overwrites these computed fields for live traders.
- [x] Unified portfolio: copy buckets are labelled "Copying <trader>"; copy-source value
      includes the link cash, and "Cash" shows free cash only.
- [x] Gate: 229 tests pass (12 new copy tests). Live run with the six seeded traders:
  - Six bot evaluations placed 16 real orders. The options bot bought SPY and wrote a
    SPY $793 call.
  - Two $1,500 copies mirrored into three crypto and three tech fractional positions each.
  - Link P&L tracked live, and the $3,000 allocated was correctly excluded from withdrawable.
- [ ] Follow-up for Phase 5 (Task 5.2): the copy-traders page still uses the select
      wrapper, so "Copy" allocates the minimum. It needs the allocation dialog, live P&L per
      copy, pause/stop and add/withdraw funds. Its explanatory text is now outdated.
- [ ] Optional: backtest-seeded track records, so new bots don't start at 0% (labelled
      "simulated history").

## Phase 5 - Unified portfolio and home (owner: trading-ui) - DONE 2026-10-29

### Task 5.1 Portfolio page rework
- [x] Equity curve from the snapshots.
- [x] Allocation by asset class and by source (Self-directed, each copied trader,
      Managed plans).
- [x] Holdings table with a bucket filter, plus plan holdings.

### Task 5.2 Copy-traders page
- [x] The "Copy" button opens an allocation dialog that calls `POST /api/copy/links`.
- [x] Each copied trader card shows the user's live P&L for that trader.
- [x] Add pause, stop and adjust-allocation actions.

### Task 5.3 Home page
- [x] `overview.js` reads `/api/trading/portfolio/summary` and the history.
- [x] Replace the sample "Recent activity" rows with real ledger activity.
- [x] Keep the school notice.

### Task 5.4 Wallet page
- [x] Transactions come from the ledger, with filters by type.
- [x] Gate: ui-reviewer audit (all High/Medium fixed) plus a live regression on the mock
      server at 1440/768/390.

### As built (Phase 5)
- `app/portfolio.html` + `live/portfolio.js` (rewritten). Data: `/api/trading/portfolio/{summary,history}`,
  `/api/trading/positions`, `/api/copy/links`, `/api/investments/portfolio`. Chart: `trade/chart.js`
  `PriceChart`. Refreshes on the account stream (`balance`/`fill`/`position`) and every 30 s.
- `live/copy-traders.js` (rewritten): each trader row is either the start form (amount + copy
  stop-loss, validated inline, `#copy-confirm` dialog, `POST /api/copy/links`) or a `.copy-manage`
  panel (value, P&L, uninvested cash, stop-loss, pause/resume, add/withdraw funds, stop). Controls
  are disabled until links and balance load, and while a request is running.
- `live/overview.js`: hero = summary total value + day P&L; chart = portfolio history; donut =
  `by_asset_class` with `--chart-cat-1..6` tokens (new in tokens.css); activity = `/api/wallet/activity`.
- `live/wallet.js`: history merges deposit/withdrawal requests (with their status) and posted ledger
  entries. Tabs: all/deposit/withdrawal/trade/copy/plan.
- Ledger API: `serialize_entry` now returns `bucket` (from `meta.bucket`, recorded on fills, or
  looked up from the fill) and `internal` (copy sale proceeds re-reserved inside the allocation;
  hidden in the UI). Copy reservations have `amount` 0, so the UI shows `-reserved_change`.

## Phase 6 - Hardening and demo readiness (owner: trading-qa, then fixes by owners) - DONE 2026-10-29
- [x] Load test: 50 SSE clients, 500 open orders. The matching loop should take
      under 50 ms per tick. (`scripts/load_test_engine.py`: evaluation-only ticks p95 ~4 ms.)
- [x] Failure drills:
  - Finnhub down: falls back to polling, and the UI shows "Delayed".
  - Coinbase WS drop: reconnects.
  - Server restart: open orders resume, and no reservation leaks.
- [x] Security:
  - Every trading route checks ownership (`user_id` comes from the token, never
    from the body).
  - Rate limits are in place.
  - No `innerHTML` with server data.
  - CORS is tightened from `*` to the site origin.
- [x] Admin views: the ledger per user, orders per user, and a "reset simulated
      account" button.
- [x] Demo seed script: a coordinator account with $100k, a few positions, and two
      active copy links.
- [x] Write `docs/TRADING_HUB.md`: how the simulation works (fills, fees, options
      settlement, data sources and delays) for the project write-up.

### As built (Phase 6)
- Engine (`app/trading/engine.py`): in-memory pre-screen with `matching.evaluate` on cached order
  docs (`Engine.docs`); only orders that could fill/trigger/update go to `orders.process`, in one
  `to_thread` batch per symbol. Tick timing in `stats` + `tick_summary()` (eval-only vs with fills).
  Multi-leg orders are indexed under every leg symbol on `watch()` too.
- Quotes carry `feed: streaming|delayed` (`feeds.feed_state`, healthy WS + subscribed symbol);
  the Trading Hub shows a "Delayed" tag while the instrument trades and `feed == "delayed"`.
- `app/trading/integrity.py`: `reservation_audit` (held cash = open-order holds + live copy cash +
  pending withdrawals; flags closed orders still holding cash), `check_user`, `check_all`.
- `app/trading/reset.py` + `app/routes/admin_trading.py` (`/api/admin/trading/users/{id}`,
  `/users/{id}/reset` confirmed by email, `/integrity`, `/engine`); admin UI tab in
  `admin-dashboard.html` via `assets/js/admin-trading.js` (wraps `viewUser`/`switchUserTab`).
- Security: `CORS_ORIGINS` env (never `*`, no credentials), rate limits on every trading/copy
  mutation, max 12 SSE connections per user (429), `tests/unit/trading/test_security.py`.
- Drills/tests: `tests/unit/market/test_failure_drills.py`, `tests/unit/trading/test_restart_drill.py`,
  `tests/unit/trading/test_reset_admin.py`, engine pre-screen test in `test_trading_api.py`.
- `scripts/seed_demo.py` (dry run by default, `--apply`, `--memory`), `docs/TRADING_HUB.md`.

Plans (Robo Advisor / ETF / DeFi / Options plans) are intentionally left
unchanged. ETF baskets (Task 3.8) are the market-driven alternative in the
Trading Hub.

## Phase 7 - Pro-platform polish (owner: trading-ui + trading-backend) - DONE 2026-10-29
- [x] Documents center:
  - Monthly statements (PDF) generated from the ledger.
  - Trade confirmations.
  - A year-end realized gains report with FIFO/avg-cost lots, wash-sale flags,
    and a CSV export.
- [x] Alerts: price, % move, and order-filled alerts, sent through the
      notifications and email channels.
- [x] Screener: filter the universe by sector, market cap, price, % change and
      volume.
- [x] Company page tab: profile, key stats, earnings dates and news (Finnhub).
- [x] Recurring investments into a stock, ETF or basket.

### As built (Phase 7)
- `app/trading/taxlots.py`: lots per (symbol, bucket) replayed from fills; FIFO or average cost
  (holding period by FIFO); shorts short-term; wash sales (stocks/ETFs/options, +-30 days, ratio of
  replacement shares) flagged, not carried into basis; CSV with formula-injection guard.
- `app/trading/statements.py` (reportlab): `statement_data` / `render_statement` (NY calendar month:
  summary by category, holdings at end, trades, realized, cash activity) and `confirmation_data` /
  `render_confirmation`. Routes `app/routes/documents.py` (`/api/documents`, `/statements/{YYYY-MM}.pdf`,
  `/confirmations/{order_id}.pdf`, `/realized-gains`, `/realized-gains.csv`). `reportlab` added to requirements.
- `app/trading/alerts.py` + `/api/trading/alerts`: price_above/below (one-shot), pct_move (once per
  trading day), order_filled (stays active; `orders.apply_fill` -> `alerts.on_fill`, idempotent via
  notification `fill_id`). Engine keeps alert symbols streaming and pre-screens with `alerts.hit`;
  atomic claim before delivery (notification + SSE `alert` + optional email `email_templates.trading_alert`).
- `app/market_data/screener.py` (yfinance `EquityQuery`, US exchanges, 60 s cache, breaker) and
  `app/market_data/company.py` (Finnhub profile/metric/earnings/news + Yahoo profile fallback, cached,
  parts fail independently, http(s)-only links); routes in `app/routes/market.py`.
- `app/trading/recurring.py` + `/api/trading/recurring`: weekly/biweekly/monthly at 10:00 ET (trading
  days for stocks/ETFs/baskets), dollar-amount market order `recurring-<id>-<date>` or basket invest,
  failures notify, pause after 3; engine `_recurring()` every 60 s.
- UI: `app/documents.html` (`live/documents.js`), `app/screener.html` (`live/screener.js`), Trading Hub
  tabs Company / Alerts / Recurring (`trade/company.js`, `trade/alerts.js`, `trade/recurring.js`),
  rail links on every app page, `api.download()` for authenticated PDF/CSV downloads.
- Gate: ui-reviewer audit (High: client-side URL scheme check added; Medium items fixed), live check
  at 390/768/1440, tests in `tests/unit/trading/test_{taxlots,documents,alerts,recurring}.py`,
  `tests/unit/market/test_screener_company.py`.

---

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| Free data limits (Finnhub 60/min REST, ~50 WS symbols) | Subscribe only to symbols that are watched, held or have orders. Cache quotes. Use a REST poll rotation. Coinbase is unlimited for crypto. |
| yfinance breaks (it is unofficial) | Cache candles and chains in Mongo. Fall back to Black-Scholes theoretical chains and show "Theoretical" labels. |
| Mongo transactions need a replica set | Atlas has one. For local development, run `mongod --replSet rs0` (documented in the README). |
| Single-process PriceBus | Run Uvicorn with 1 worker (documented). Redis is the upgrade path. |
| Margin/short engine correctness (largest new risk) | Requirements are a pure function `(positions, quotes) -> requirements`, with exhaustive unit tests. The risk monitor and the order checks share it. Liquidation is logged and can be replayed. |
| Real money entering the system | Execution is simulated, so deposited money is never actually invested. The school notice stays on the home and wallet pages, including next to the deposit instructions. Deposit details are whatever the admin enters in bank/crypto settings, so the owner is responsible for what is shown. |
| Existing uncommitted changes in the repo | Commit or stash them before Phase 0 so the trading work stays reviewable. |
