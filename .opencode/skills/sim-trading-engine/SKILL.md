---
name: sim-trading-engine
description: Rules and reference design for the simulated brokerage engine behind the TED Brokers Trading Hub - accounts (cash/margin), cash ledger, orders (market/limit/stop/stop-limit/trailing, multi-leg), fills and slippage, positions and cost basis, realized/unrealized P&L, margin requirements, margin calls and liquidation, PDT, short selling and borrow fees, options (levels 1-4, spreads, expiry, exercise/assignment), ETF baskets, crypto fractional trading, market hours, buying power, and copy-trading mirroring into the same portfolio. Use when writing or reviewing code in app/trading/, order/position/ledger collections, portfolio valuation, or copy-trade execution.
---

# Simulated trading engine

The engine simulates a broker against **real market prices**. Nothing leaves the
system: there is no clearing, no real custody, no real money. It must still behave
exactly like a real broker so results are believable and auditable.

## Module layout (target)
```
app/trading/
  __init__.py
  models.py        Pydantic models: Order, Fill, Position, LedgerEntry, Instrument
  instruments.py   Symbol normalisation, asset class, tick size, lot size, hours
  ledger.py        The ONLY code allowed to change cash (credit, debit, reserve,
                   release). Writes ledger_entries + users cash fields atomically.
  orders.py        Validation, placement, cancel/replace, state machine
  matching.py      Fill simulation against live quotes (async loop)
  positions.py     Position updates, cost basis, realized P&L
  options.py       OCC symbols, chains, Black-Scholes greeks, expiry processing
  portfolio.py     Valuation, buying power, equity history snapshots
  copy_engine.py   Mirrors trader orders into follower accounts
  risk.py          Pre-trade checks
  margin.py        Pure requirement / buying-power functions (Reg T style)
  borrow.py        Locate, ETB/HTB lists, borrow fees
  risk_monitor.py  Margin calls, PDT tracking, forced liquidation loop
  multileg.py      Option strategy templates, atomic multi-leg fills, payoff
  baskets.py       ETF baskets: templates, invest, rebalance, auto-invest
app/routes/trading.py   /api/trading/*  (orders, positions, portfolio, watchlists)
```

## Collections
| Collection | Key fields |
|---|---|
| `users` (existing, new fields) | `cash_cents` (source of truth), `reserved_cents`, `options_level` 0-3, `trading_enabled_at`. Legacy `wallet_balance` (float dollars) is kept as a **mirror** written by the ledger in the same update so old endpoints keep working. |
| `ledger_entries` | `user_id`, `type` (deposit, withdrawal, trade_buy, trade_sell, short_sale, short_cover, fee, option_premium, assignment, exercise, dividend, dividend_owed, borrow_fee, margin_interest, copy_allocate, copy_release, copy_pnl, plan_invest, referral_bonus, adjustment), `amount_cents` (signed), `balance_after_cents`, `ref_type`, `ref_id`, `idempotency_key` (unique), `created_at` |
| `orders` | `user_id`, `source` (`manual` or `copy`), `copy_link_id?`, `parent_order_id?` (trader's order for copies), `symbol`, `asset_class` (stock, etf, crypto, option), `side`, `type`, `qty` (Decimal128), `limit_price?`, `stop_price?`, `trail_amount?/trail_percent?`, `tif` (day, gtc, ioc, fok), `extended_hours`, `status`, `filled_qty`, `avg_fill_price`, `reserved_cents`, `client_order_id` (unique per user), timestamps |
| `fills` | `order_id`, `user_id`, `qty`, `price`, `fee_cents`, `liquidity` (taker), `quote_snapshot{bid,ask,last,ts}`, `ts` |
| `positions` | `user_id`, `symbol`, `asset_class`, `bucket` (`self` or `copy:<link_id>`), `qty` (signed; negative only for short options), `avg_cost`, `realized_pnl_cents`, `opened_at` |
| `portfolio_snapshots` | `user_id`, `ts`, `equity_cents`, `cash_cents`, `positions_value_cents`, by-bucket breakdown. Written every minute while markets are open, plus daily close. Powers the portfolio chart. |
| `copy_links` | `user_id`, `trader_id`, `allocation_cents`, `mode` (proportional), `status` (active, paused, stopped), `stop_loss_pct?`, `created_at` |
| `watchlists` | `user_id`, `name`, `symbols[]` |

Index every `user_id`, `(user_id,status)` on orders, unique `(user_id,client_order_id)`,
unique `ledger_entries.idempotency_key`, unique `(user_id,symbol,bucket)` on positions.

## As built (Phase 2) - read before changing the engine
- Mutations are **sync functions under `orders.user_lock(user_id)`** (threading.RLock),
  called via `asyncio.to_thread` from routes and the engine. Do not add asyncio locks.
- Fill pipeline in `orders._execute` / `orders.apply_fill`: pending fill doc -> ledger
  (`fill:<id>`) -> `positions.apply_fill` (version + `applied_fills` guard) -> order
  (`applied_fills` guard). Every step is idempotent; `recover_pending_fills()` replays.
- Non-market events (exercise, expiration, later assignment/liquidation) use
  `orders.system_fill(...)`, which books a filled `source="system"` order, so history,
  ledger and positions stay consistent. Use it for Phase 2B/4 system actions too.
- Pre-trade validation lives in `orders.normalize_request` (there is no `risk.py`). Phase
  2B adds margin rules there and removes the `SHORT_SIDES` rejection for margin accounts.
- Buying power today = `available_cents`; withdrawable also subtracts unsettled T+1
  sale proceeds (`funding.unsettled_proceeds_cents`).
- Position math (`positions.apply_fill_math`) already supports signed qty / shorts / flips.
- Routes in `app/routes/trading.py` must not use `from __future__ import annotations`
  (slowapi's wrapper breaks FastAPI's resolution of string annotations -> body parsed
  as query).
- Tests: `tests/unit/trading/test_orders.py` (rules, fees, expiry, recovery, concurrency),
  `test_trading_api.py` (routes, portfolio, async engine on a bus tick),
  `test_margin.py` (2B requirement tables, shorts, PDT, calls, spreads, assignment).

## As built (Phase 4: copy trading)
- `copy_engine.py` owns links. Link cash is part of the follower's `reserved_cents`; copy
  child orders (`source="copy"`, `copy_link_id`) hold from the link via
  `copy_engine.hold_for_order` (no ledger change), return leftovers via
  `copy_engine.return_leftover` (called from `orders._release_remaining`), and re-reserve sale
  proceeds in `copy_engine.after_fill`. Never let a copy order touch the follower's free cash.
- Bots are system users (`users.is_system`, `expert_traders.system_user_id`). Always exclude
  `is_system` users from customer-facing lists, totals and admin statistics.
- Mirroring is asynchronous and durable: bot fill -> `copy_jobs` (unique `fill_id`) -> engine
  sweep -> `copy_engine.process_job`. Child `client_order_id` = `copy-<fill>-<link>` (idempotent).
- Trader performance fields are computed (`bots.compute_stats`) and stored top-level; they are never
  destroyed. For `stats_live` traders, admin-entered figures go to the `stats_override` sub-document
  (`app/trading/trader_stats.py`, `effective_stats`), which wins on both admin and user dashboards.
  Figures are shown unlabelled by decision (`stats_source` stays "live"); clear with
  `DELETE /api/admin/traders/{id}/stats-override`.

## As built (Phase 2B)
- `margin.account_state(user_id, changes, cash_delta)` is THE buying-power function (also a
  what-if). `orders.risk_check` uses it for every opening order; never hand-roll a BP check.
- Margin accounts: buys/shorts keep `bp_hold_cents` on the order (no cash reservation) and
  fills post with `allow_negative_cash`. Crypto (any account) and cash accounts reserve cash.
- Shares backing short calls are locked from sale (`orders.covered_call_shares`).
- Short-option assignment / early assignment use `expiration.assign_short` (system fills).
- Multi-leg parent orders have `asset_class="multileg"` and `legs[]`; leg fills carry
  `leg_index` and skip the single-order update in `apply_fill`; `multileg.finish` closes the
  parent. The engine indexes multi-leg orders under every leg symbol.
- Daily jobs (idempotent by date keys): `borrow.run_daily` (borrow fees + interest),
  `dividends.run_due`; `risk_monitor.run` every 5 s.

## Order state machine
`new -> accepted -> (partially_filled ->)* filled`
`accepted|partially_filled -> canceled | expired | rejected`
Never go backwards. Persist every transition with a timestamp in `status_history`.

## Fill simulation
- Prices come from the market-data service only (see the `market-data` skill).
  Never invent a price; if the quote is stale (> 15 s for stocks in session, > 5 s
  for crypto) a market order waits or is rejected with `stale_quote`.
- **Market buy** fills at `ask`, sell at `bid`. If only `last` is known, use
  `last * (1 ± half_spread)` with a default half-spread of 2 bps (stocks/ETFs),
  5 bps (crypto), and the real option bid/ask when available.
- Slippage: add `k * sqrt(qty / avg_volume_per_min)` bps (cap 50 bps) to make large
  orders realistic.
- **Limit**: buy fills when `ask <= limit`, at `min(limit, ask)`. Sell when `bid >= limit`.
- **Stop**: triggers when `last` crosses stop, then behaves as market. **Stop-limit**
  becomes a limit. **Trailing stop** tracks the high-water mark (sells) / low (buys).
- IOC/FOK evaluated once at acceptance. DAY orders expire at 16:00 America/New_York.
- Fees: $0 commission stocks/ETFs; options $0.65/contract; crypto 0.5% spread markup.
  Keep fees in a config dict so they are easy to show in docs.

## Market hours
- US equities/ETFs/options: 09:30-16:00 ET, Mon-Fri, NYSE holidays closed. Optional
  extended hours 04:00-09:30 and 16:00-20:00 for stocks/ETFs with limit orders only.
  Use `zoneinfo` and a holiday list; do not hardcode UTC offsets.
- Crypto: 24/7.
- Orders placed while closed are `accepted` and queued until open (like real brokers).

## Cash, reservations, buying power
- `users.account_type` is `cash` or `margin`. Cash accounts: `buying_power = settled
  cash - reserved`. Margin accounts: see the margin section below.
- On accept of a buy: reserve `qty * price_bound * 1.01 + fees` (price_bound = limit,
  or ask for market). Release the remainder on fill/cancel. On margin accounts the
  reservation is against buying power (requirement), not cash.
- Plain `sell` requires owned qty in the **same bucket**; selling more than owned
  is rejected (it is not an implicit short). Shorts use explicit `sell_short`.
- Options levels: 1 covered calls / cash-secured puts, 2 + long calls/puts,
  3 + spreads (multi-leg), 4 + naked short options (margin only).
  Cash-secured puts reserve `strike * 100 * contracts`.

## Margin (Reg T style, `app/trading/margin.py`)
- Requirements are a **pure function** `requirements(positions, quotes, account)` that
  the order checks and the risk monitor both call. Never duplicate the formulas.
- Long stock/ETF: initial 50%, maintenance 25% (house 30-50% for volatile names via
  config). Long options: 100%, not marginable. Crypto: 100%, cash only.
- Short stock: initial 150% (100% proceeds + 50%), maintenance 30% of market
  value, minimum $5.00/share (or $2.50/share if price < $5). Whole shares only.
- Defined-risk spreads: requirement = max loss. Naked short option:
  `max(20% * S - OTM_amount + premium, 10% * strike + premium) * 100 * contracts`
  (puts: 10% of strike).
- `equity = cash + long_mv - short_mv + option_mv`; `margin_debit = max(0, -cash)`;
  `excess_liquidity = equity - maintenance_req`. Stock buying power overnight =
  `2 * excess (initial basis)`; pattern day traders (equity >= $25k) get 4x intraday.
- Margin interest accrues daily on the debit (tiered APR from config), posted
  monthly as `margin_interest` ledger entries.
- Calls: Fed call (trade breached initial) due T+4; maintenance call
  (equity < maintenance) due T+2; house liquidation when equity < 0.9 *
  maintenance or a call passes its due date. Liquidations are orders with
  `source="liquidation"`, largest requirement first, until compliant.
- PDT: count opening+closing same-day round trips over 5 business days; under $25k
  block the 4th.

## Short selling (`app/trading/borrow.py`)
- `/locate` checks the easy-to-borrow list (large caps) or the hard-to-borrow list
  (config, with borrow APR and available shares). No locate = reject.
- Short proceeds go to `short_proceeds_cents` (not withdrawable). Borrow fee accrues
  daily for HTB names (`borrow_fee` entries). Shorts held over an ex-dividend date
  owe the dividend (`dividend_owed`).
- Position qty is negative; `buy_to_cover` reduces it. P&L for shorts:
  `(avg - fill) * qty_covered`.

## Multi-leg options
- One parent order with `legs[]` (`occ`, `side`, `ratio`) and `strategy_group_id`.
  Net-limit fills when the combined leg mids (minus one tick per leg) reach the limit;
  all legs fill atomically or none do.
- Positions keep `strategy_group_id` so the margin engine applies max-loss and the UI
  groups them. Assignment of one leg breaks the group; recompute requirements.
- Every cash change is one `ledger_entries` insert plus one conditional update of
  `users.{cash_cents, reserved_cents, wallet_balance}` inside a
  `client.start_session()` transaction. Atlas supports transactions; local
  standalone mongod does not, so the dev setup must use a replica set, or the code
  must use the conditional-update + compensating-entry pattern.

## Positions and P&L
- Average-cost method. Buy: `avg = (q*avg + fq*fp) / (q+fq)`. Sell: realized
  `+= (fp - avg) * fq * multiplier - fees`.
- Multiplier: 1 for stocks/ETFs/crypto, 100 for options.
- Unrealized = `(mark - avg) * qty * multiplier`. Mark = mid of bid/ask, else last.
- Day P&L uses the previous close (`prev_close` from the quote).

## Options
- OCC symbol: `AAPL  261218C00200000` (root padded to 6, YYMMDD, C/P, strike*1000
  padded to 8). Store and display the friendly form `AAPL Dec 18 '26 $200 Call`.
- Expiry processing job at 16:15 ET on expiration day: ITM by >= $0.01 long options
  auto-exercise into shares (physical delivery, 100 per contract), OTM expire
  worthless, ITM short options are assigned. If the account cannot support the
  resulting shares, the risk monitor issues a call / liquidates next session.
- Greeks: Black-Scholes with the chain's implied vol, r = current 3-month T-bill
  (config constant is fine), q = 0.

## Copy trading in the same engine
- Following a trader creates a `copy_links` doc and moves `allocation_cents` from
  the user's free cash into the copy bucket with a `copy_allocate` ledger entry.
- Expert traders are modelled as **system accounts** whose orders are generated by
  `trade_scheduler.py` (rewritten to place real orders against live prices instead
  of fake history).
- When a trader order fills, `copy_engine` creates child orders for every active
  link: `follower_qty = trader_qty * (link.allocation / trader_equity)`, rounded to
  lot size (fractional allowed for stocks/crypto, whole contracts for options;
  skip if it rounds to 0). Child orders use `source="copy"`, `parent_order_id`,
  and land in bucket `copy:<link_id>`.
- Stopping a copy closes bucket positions at market and returns cash with
  `copy_release`. Pausing stops new mirrors but keeps positions.
- The unified portfolio = sum of all buckets; the UI can filter by bucket.

## Idempotency and concurrency
- Clients send `client_order_id` (UUID). Duplicate -> return the existing order.
- The matching loop must process one order at a time per user (use a per-user
  `asyncio.Lock` or a `processing_until` lease field) so reservations cannot race.
- Never trust prices, fees, or quantities from the client except the order request.

## Phase 6 additions (engine performance, integrity, reset)
- The engine keeps `Engine.docs` (last state of each open order) and pre-screens every quote with
  the pure `matching.evaluate`; only candidates go to `orders.process` (authoritative, under the
  lock), one `to_thread` batch per symbol. Any new code path that changes an open order in place
  (prices, trail state, qty) must go through `orders.process`/`_publish_order` or call
  `engine.watch()` so the cache is refreshed; `refresh_index()` (every 30 s) is the backstop.
- `app/trading/integrity.py`: `reservation_audit(user)` must stay true. If you add a new kind of
  cash hold, add it to the audit (and to `reset.py`).
- `app/trading/reset.py`: admin reset closes trading state without trading and posts one
  `adjustment` (meta.reset) so cash == net funding (`FUNDING_TYPES`). New position-like
  collections must be closed there too.
- Ledger API rows include `bucket` (fills record `meta.bucket`) and `internal` (copy proceeds).
- Load test: `scripts/load_test_engine.py` (target: eval-only tick p95 < 50 ms).

## Phase 7 additions
- Tax lots: `app/trading/taxlots.py` (`replay`, `compute_disposals`, `open_lots`, `report`, `to_csv`).
  Any new fill kind must keep the fill shape (`is_buy`, `qty`, `gross`, `fee`, `ts`, `bucket`).
- Alerts: `app/trading/alerts.py`; `orders.apply_fill` calls `alerts.on_fill` (must stay idempotent).
  The engine indexes active price alerts by symbol (`Engine.alerts`) and streams their symbols.
- Recurring: `app/trading/recurring.py`; runs from the engine sweep; order source `recurring`.
- Statements/confirmations: `app/trading/statements.py` (reportlab).

## Testing checklist
Unit tests for: avg-cost math, realized P&L, reservation release, each order type
trigger, DAY expiry, holiday closure, OCC parse/format, Black-Scholes against known
values, proportional copy sizing and rounding, ledger balance == sum of entries.
