# TED Brokers Trading Hub: how the simulation works

TED Brokers is a **school project**. It shows **real market prices** and executes every order
**in a simulator, with simulated funds**. Nothing is routed to an exchange or a broker, and no
real money is invested or paid out. The "School project notice" is shown on the home page, on
every Trading Hub page and in the wallet, portfolio, copy-trader and plan pages.

This document describes the rules the simulator follows, where its prices come from, and what
is deliberately simplified. It is written for the project report; file references point to the
code that implements each rule.

---

## 1. Architecture at a glance

```
 Finnhub WS ─┐                           ┌─> SSE /api/stream/prices  (browser quotes, 4/s max)
 Coinbase WS ┼─> PriceBus (in-process) ──┼─> Matching engine ──> orders / fills / positions
 REST polls ─┘   newest quote per symbol └─> Copy engine, risk monitor, portfolio valuation
 (Finnhub, Coinbase, Yahoo)                                │
                                                           v
                                     Ledger (integer cents, append-only, idempotent)
                                                           │
                                          SSE /api/stream/account (balance, fill, order …)
```

* **Backend:** FastAPI with synchronous pymongo (MongoDB Atlas), Python 3.9.
  Mutations run in worker threads under a per-user lock (`orders.user_lock`).
* **Frontend:** plain HTML, CSS and ES modules, with no build step
  (`public/copytradingbroker.io/app/trade.html`, `assets/js/trade/*`).
* **One process:** the PriceBus and the engine live in memory, so run Uvicorn with
  **one worker**. Redis pub/sub would be the upgrade path for more.

## 2. Money: one ledger for everything

Every cash change is a row in `ledger_entries` (`app/trading/ledger.py`). Each row records:

* `cash_delta_cents`: the change in cash.
* `reserved_delta_cents`: the change in held cash.
* `idempotency_key`: a unique key, so retrying an operation can never double-post it.

The user document keeps `cash_cents`, `reserved_cents` and `available_cents = cash − reserved`.
`wallet_balance` is a mirror kept for the old pages.

| Concept | Meaning |
|---|---|
| Cash | Everything the account holds in dollars. |
| Reserved / held | Cash set aside for open buy orders, copy allocations and pending withdrawals. |
| Available | What can be spent or withdrawn right now. |
| Buying power | Available cash (cash account), or a margin calculation (margin account, §7). |

Entry types include deposits, withdrawals, trades, fees, option premiums, exercise and
assignment, dividends, borrow fees, margin interest, order holds, copy allocations, plans,
bonuses, admin adjustments and liquidations.

`ledger.reconcile(user)` re-adds every posted entry and compares the sum with the stored
balances. `integrity.reservation_audit(user)` checks that every held cent belongs to one of:

* an open order,
* a live copy allocation,
* a pending withdrawal.

Both checks are exposed to admins (§12).

**Funding** uses the existing request flow: a deposit request is approved by an admin and then
credited; a withdrawal is held when requested and settled or released by an admin. No payment
processor is integrated. New accounts start at $0.

## 3. Market data

| Asset | Live (streaming) | Fallback (REST polling) | Notes |
|---|---|---|---|
| US stocks and ETFs | Finnhub WebSocket trades | Finnhub quote → Yahoo Finance | Finnhub free tier: about 50 streamed symbols, 60 REST calls/min |
| Crypto | Coinbase WebSocket ticker (when reachable) | Coinbase REST → Finnhub `BINANCE:<coin>USDT` → Yahoo | Our school network blocks Coinbase and Kraken DNS, so crypto runs on Finnhub's Binance feed (USDT ≈ USD) |
| Options | none | Yahoo chain snapshot, about 15 min delayed | Re-marked from the live underlying; Black-Scholes value when a contract has no usable bid/ask (shown in italics as "theoretical") |
| Candles | none | Coinbase (crypto, short ranges) → Yahoo | Cached |

* **Only demanded symbols** are streamed: those watched in a browser, held, or with open
  orders. The poller refreshes any demanded symbol whose quote is older than its freshness
  window, oldest first (`app/market_data/feeds.py`).
* **Stale quotes:** a quote older than 15 s (stock, ETF, crypto) or 120 s (options) is
  *stale*. Market orders never fill on a stale quote.
* **"Delayed" label:** every quote carries `feed` (`streaming` or `delayed`). It is
  `streaming` only while a healthy WebSocket is delivering that symbol. During market hours
  the Trading Hub shows a **Delayed** tag otherwise, for example when Finnhub is down and
  prices come from REST polling.
* **Synthetic spread:** when a provider gives only a last price, the quote gets a synthetic
  spread around it (stocks ±2 bps, ETFs ±1, crypto ±5). It is marked `spread_model:
  "synthetic"`, and the UI shows "Estimated spread".
* **Reconnects:** WebSocket feeds reconnect with exponential backoff (1 s up to 5 min, with
  jitter) and resubscribe everything they were streaming. A DNS check avoids hammering hosts
  the network blocks.
* **Timestamps:** a provider failure never produces a fresh timestamp. The last good quote is
  served with its real time.

## 4. Orders

**Order types** (`app/trading/models.py`, `orders.py`):

* market
* limit
* stop
* stop-limit
* trailing stop (by % or $)
* dollar-amount orders (fractional)
* multi-leg option orders (§8)

**Time in force:**

* DAY (stock and ETF market orders are always DAY).
* GTC (expires after 60 days).
* IOC and FOK (need an open market).
* Crypto orders are always GTC, because crypto trades 24/7.

**Sessions:**

* Regular hours: 09:30–16:00 ET, using the NYSE holiday and early-close calendar.
* Stocks and ETFs can also trade pre-market (from 04:00) and after hours (until 20:00, or
  17:00 on early-close days) with the "extended hours" flag. Fractional shares are
  regular-session only.
* Stops trigger on regular-session prints only. Crypto stops trigger at any time.

Every order reserves what it could cost before it is accepted: price × quantity, plus the
estimated fee and a slippage buffer for market buys. The unused hold is released when the
order fills, is canceled or expires.

## 5. How fills are simulated

The engine (`app/trading/engine.py`) subscribes to the PriceBus for every symbol with open
orders or positions. On each quote:

1. **In-memory pre-screen.** Open orders are checked with the pure matching rules
   (`matching.evaluate`). Orders that cannot fill or trigger on this quote do not touch the
   database.
2. **Authoritative path.** Orders that could act are processed in one worker thread under the
   user's lock. The order is re-read and re-evaluated there, and a fill is applied atomically:
   ledger, position, order status, then events.

**Fill rules** (`app/trading/matching.py`):

* **Market:** a buy fills at the **ask** and a sell at the **bid**, plus size-dependent
  slippage of `k × √(notional / $1,000)` basis points (k = 0.5 for stocks/ETFs, 0.8 for
  crypto, capped at 50 bps). Options fill at the quoted bid/ask with no extra slippage.
* **Limit:** a buy fills when ask ≤ limit, at min(limit, ask); a sell fills when bid ≥ limit,
  at max(limit, bid).
* **Stop and stop-limit:** the stop triggers when the last trade crosses it, then the order
  becomes a market or limit order. A trailing stop moves its stop with the best price
  seen (its "watermark").
* **Fill size:** the whole remaining quantity fills at once. There is no order-book depth;
  size only changes the slippage.

**Crash safety:** a fill is first written as `pending`, then applied step by step with
idempotency keys. At startup the engine finishes any pending fill exactly once
(`orders.recover_pending_fills`) and rebuilds its index of open orders.

**Settlement:** stocks, ETFs and options settle T+1 (the US rule since May 2024). Crypto
settles immediately. Proceeds are usable straight away, as at most retail brokers.

## 6. Fees (`app/trading/fees.py`)

| Asset | Fee |
|---|---|
| Stocks / ETFs | $0 commission. Sells pay the pass-through SEC fee (0.00278% of proceeds) and the FINRA TAF ($0.000166 per share, max $8.30). |
| Options | $0.65 per contract. |
| Crypto | 0.50% of notional (in line with retail crypto spreads and fees). |

The rates are configuration values modelled on current US schedules, not live regulatory
values.

## 7. Margin, short selling and interest

* **Account types** (`app/trading/margin.py`): cash (default) or margin. The upgrade has
  simulated suitability checks.
* **Long stocks:** 50% initial requirement and 30% maintenance. Below $3 a stock is not
  marginable. Leveraged ETFs are 75%/75%.
* **Margin limits:** borrowing needs at least $2,000 of equity. Stock buying power is 2×.
  Pattern-day-trader day-trading buying power (4×) applies from $25,000 of equity.
* **Shorts:**
  * Requirements: 150% initial. Maintenance is max(30%, $5/share), or max(100%, $2.50/share)
    for stocks under $5.
  * Locates: every short needs one. Large caps and ETFs are easy to borrow. Other names are
    hard to borrow, with a borrow APR and a shared pool of lendable shares.
  * Rule 201 (SSR): when a stock is down 10% or more, short sales must be limit orders above
    the bid.
  * Crypto cannot be shorted.
* **Charges:**
  * Borrow fees are charged daily on hard-to-borrow shorts.
  * Margin interest accrues daily on the debit balance at tiered rates (13.25% APR under
    $25k, down to 8.5% above $1M) and is posted monthly.
* **Margin calls and liquidation** (`app/trading/risk_monitor.py`):
  * A maintenance call is due in 2 trading days; a Reg T call in 4.
  * If equity falls below 90% of maintenance, or a call passes its due time, the house
    closes the position with the largest requirement at market, one at a time.
  * Withdrawals are blocked while a call is open.

## 8. Options

* **Approval levels** (simulated rules):
  * Level 1: covered calls and cash-secured puts.
  * Level 2: also buying calls and puts.
  * Level 3: spreads.
  * Level 4: naked options (needs a margin account and $5k equity).
* **Strategies:** verticals, calendars, diagonals, straddles, strangles, iron condors,
  butterflies, collars and covered calls. Each is placed as one multi-leg order with a net
  debit or credit, filled all-or-none against the legs' quotes (`app/trading/multileg.py`).
* **Requirements:** spreads are margined at their maximum loss. Naked options use the CBOE
  formula. Cash accounts hold the maximum loss as collateral.
* **Expiration** (`app/trading/expiration.py`), processed at 16:15 ET on expiry day:
  * Long contracts in the money by $0.01 or more are exercised with physical delivery (100
    shares). If the account cannot take delivery, the contract is closed at intrinsic value.
  * Short in-the-money contracts are assigned.
  * Out-of-the-money contracts expire worthless.
* **Early assignment:** short in-the-money calls are assigned before an ex-dividend date when
  their time value is below the dividend (`app/trading/dividends.py`).
* **Pricing:** Greeks and theoretical values use Black-Scholes. Implied volatility comes from
  the quoted mid price, or from a chain-level fallback (historical volatility) when a
  contract has no usable quote (`app/trading/options.py`, `app/market_data/service.py`).

## 9. Dividends

On the ex-dividend date, long holders are credited and short holders are charged the cash
dividend. This is booked on the ex-date rather than the pay date, a simplification. Dividend
data comes from Yahoo Finance.

## 10. ETF baskets

These are curated or custom model portfolios of up to 20 ETFs (`app/trading/baskets.py`).

* Investing $X places one fractional dollar-amount market order per ETF. The holdings sit in
  their own position bucket, so each basket has its own P&L.
* A basket can be sold in part or in full, rebalanced to its targets (sells first, then
  buys), or set to invest automatically each week or month.

The managed investment plans (Robo Advisor, ETF, DeFi and Options plans) are unchanged and
separate. They use their plan model, not market prices.

## 11. Copy trading

* **Traders are bots** (`app/trading/bots.py`). Every expert trader is a system account
  (`is_system=True`) with its own cash. It runs a strategy matched to its specialization:
  * Momentum: hold the strongest names of a universe.
  * Fixed weights: rebalance when a holding drifts.
  * Income: SPY plus covered calls.

  The bots trade through the same order pipeline at real prices, every 8–20 minutes while
  their market is open. Their YTD return, win rate, drawdown and AUM are computed from their
  own fills and snapshots, as a live track record.
* **Copying** (`app/trading/copy_engine.py`):
  * Allocating moves cash from the follower's free cash into a copy link (a hold).
  * Each trader fill creates a durable job. The engine places proportional child orders in
    the follower's `copy:<link>` bucket. A buy uses qty × (link equity / trader equity),
    within the link's cash. A sell sells the same fraction of the follower's position.
  * Pause stops mirroring. Stop sells the copy's positions at market and returns the cash.
  * An optional copy stop-loss stops the copy automatically.

## 12. Portfolio, history and admin tools

* **Portfolio** (`app/trading/portfolio.py`): positions are valued at the live mid or last
  price. Account value is cash + positions + copies + baskets + plan value, split by source
  and asset class. A snapshot is stored every minute while the account holds positions and
  at each close; the equity chart is drawn from these snapshots.
* **Admin → user → "Trading Hub" tab** (`/api/admin/trading/*`) shows:
  * balances and holds,
  * the ledger reconciliation and reservation audit,
  * positions, copies, recent orders and the ledger.
* **Reset simulated account:**
  * It cancels orders, stops copies and closes positions, baskets and strategies without
    trading. It then posts one `adjustment` so cash equals the user's net funding
    (deposits − withdrawals ± bonuses and plan flows).
  * Pending withdrawals stay held, and the ledger history is kept.
  * The admin confirms by typing the user's email. Trader bot accounts cannot be reset.
* **Other admin endpoints:**
  * `GET /api/admin/trading/integrity` checks every account.
  * `GET /api/admin/trading/engine` shows engine and feed status, including tick times.

## 12b. Documents, alerts, screener and recurring investments

* **Documents center** (`app/documents.html`):
  * **Monthly statements (PDF):** cash summary by category, holdings at month end, trades,
    realized gains and every cash movement, for New York calendar months.
  * **Trade confirmations (PDF):** one per order, with fills, itemized fees and the
    settlement date.
  * **Realized gains report:** CSV or on screen, built from fills (`app/trading/taxlots.py`).
    * Lots are tracked per position source.
    * The cost basis method is FIFO or average cost.
    * Long-term means held more than one year; short sales are always short-term.
    * Wash sales: losses on stocks, ETFs or options are flagged when the same symbol was bought
      within 30 days. Crypto is exempt. The disallowed amount is shown but not carried into the
      replacement shares' basis.
    * This is an educational report, not tax advice.
* **Alerts:**
  * Kinds: price at or above / at or below (one-time), a daily % move from the previous close
    (at most once per day), and order filled (any order, or one symbol).
  * Delivery: the bell menu, a live toast, and optionally an email.
  * Never triggered by stale quotes.
* **Screener:** Yahoo Finance's screener over US-listed stocks. Filters are sector, market cap,
  price, change today, volume and P/E. Results are cached for 60 s and limited to symbols the
  hub can trade. The data may be delayed by up to 15 minutes.
* **Company tab:** profile, key statistics, earnings dates and estimates, and news from
  Finnhub, with Yahoo Finance descriptions for ETFs. It is cached, and each part can fail on
  its own without breaking the others.
* **Recurring investments:**
  * A fixed dollar amount of a stock, ETF, crypto or ETF basket, weekly, every two weeks or
    monthly, at 10:00 ET.
  * Stocks, ETFs and baskets run on trading days; crypto runs any day.
  * Each run is one dollar-amount market order, or one basket investment.
  * A skipped run (for example, not enough cash) notifies the user. Three failures in a row
    pause the plan.

## 13. Security

* Every trading, copy and market route requires a signed-in user. Each object is looked up
  by its id *and* the token's user id, so another user's order, link, watchlist or basket
  returns 404. This is covered by `tests/unit/trading/test_security.py`.
* Business-rule errors return 400/409 with `{detail: {code, message}}`, never 401/403.
* **Rate limits:**

  | Action | Limit |
  |---|---|
  | Order placement | 60/min |
  | Previews and cancels | 120/min |
  | Multi-leg orders | 30/min |
  | Baskets | 20–30/min |
  | Copy changes | 20–60/min |
  | Account changes | 10/min |

* **Streams:** they use short-lived stream tokens, and a user can hold at most 12 open stream
  connections.
* **CORS:** allowed origins come from `CORS_ORIGINS`, never `*`. Credentials are not used,
  because auth is a Bearer token. The dashboard itself is served from the same origin.
* **No `innerHTML`:** the Trading Hub never inserts server data as HTML; it builds DOM nodes
  and sets text.

## 14. Testing and performance

* **Test suite:** `venv/bin/python -m pytest -q` runs about 265 unit and API tests against an
  in-memory database, so `.env` is never touched. They cover:
  * ledger and funding,
  * matching, margin and options math,
  * copy trading,
  * security,
  * failure drills: WebSocket drop and reconnect, Delayed labelling, REST polling, and a
    restart with a half-applied fill.
* **Load test:** `venv/bin/python scripts/load_test_engine.py` runs 500 resting orders over
  25 symbols, with 50 stream subscribers and every symbol quoted 10×/s.

  | Measurement | Result |
  |---|---|
  | Evaluation ticks, p95 | about 4 ms (target < 50 ms) |
  | Subscriber delivery, p95 | about 23 ms |
  | Ledger | reconciles after 500 fills |
  | Database calls per fill | about 25 |

  Fill-heavy ticks are slow in the test harness because the in-memory database scans
  without indexes. On MongoDB with an index the cost is network round trips, about 0.5 s per
  fill on a remote Atlas cluster.
* **Demo data:** `scripts/seed_demo.py` prepares the presentation account:
  * $100,000 of simulated funds,
  * six positions bought at real prices,
  * two copies.

  It is a dry run by default; `--apply` writes and `--memory` rehearses in memory.

## 15. Simplifications (on purpose)

* Orders fill completely against the top of book. There is no depth, queue position or
  partial fills from liquidity, and no auctions (opening/closing crosses).
* Quotes from the free data tiers can be a few seconds old. Crypto uses Binance USDT pairs as
  USD prices, and option chains are about 15 minutes delayed.
* Dividends are booked on the ex-date, and corporate actions (splits, mergers) are not
  modelled.
* Settlement dates are recorded, but unsettled proceeds can be reused. Good-faith and
  free-riding violations are not enforced.
* Interest and borrow rates, fees and approval rules are realistic configuration values, not
  live data.
* The trader bots are algorithms, not people. Their history starts when the bot starts.
