---
name: trading-hub-ui
description: UX and implementation patterns for the TED Brokers Trading Hub dashboard pages (trade.html, unified portfolio, options chain, orders, watchlists) built to feel like E*TRADE / Robinhood / thinkorswim - quote header, live chart, order ticket with preview and confirm, positions and orders blotters, options chain grid, watchlists, symbol search, live SSE price updates and flashing ticks. Use when building or reviewing any Trading Hub front-end in public/copytradingbroker.io/app/ or assets/js/live/trade*.js / assets/js/components/.
---

# Trading Hub UI

Load `tedbroker-codebase`, `vanilla-html`, `vanilla-css`, `vanilla-js` and `ui-design`
first. Follow `design/DESIGN.md` tokens; no frameworks, no Tailwind.

## Pages
| Page | Purpose |
|---|---|
| `app/trade.html` | The Trading Hub: symbol search, quote header, chart, order ticket, depth-style bid/ask, positions/orders/activity tabs, watchlist rail |
| `app/trade.html?symbol=AAPL&tab=options` | Options chain view for the underlying |
| `app/portfolio.html` (rework) | Unified portfolio: equity curve, allocation by asset class and by source (Self-directed vs each copied trader), holdings table with bucket filter |
| `app/orders.html` (optional) | Full order history with filters and CSV export |
| `app/index.html` | Home gets real totals from `/api/trading/portfolio/summary` |

Add "Trade" to the sidebar rail and mobile tabbar on **every** page in `app/`.

## Layout (desktop >= 1200px)
```
| watchlist rail | quote header (symbol, last, change, bid x ask, session badge)  | order ticket |
|                | chart (candles, ranges 1D 5D 1M 3M 1Y 5Y, line/candle toggle)  | (sticky)     |
|                | tabs: Positions | Open orders | History | Options chain | News   |              |
```
Tablet: ticket becomes a bottom sheet `<dialog>`. Mobile: single column, sticky
"Buy" / "Sell" bar opening the ticket dialog.

## Order ticket (the most important component)
- Fields: Action (Buy/Sell; Buy to open/Sell to close etc. for options), Quantity
  with "Shares / Dollars" toggle for fractional stocks and crypto, Order type
  (Market, Limit, Stop, Stop limit, Trailing stop), prices shown only when relevant,
  Time in force (Day, GTC, IOC, FOK), Extended hours checkbox (limit only).
- Live estimate: est. cost/proceeds, est. fee, buying power after, position after.
- **Preview step** -> summary in a confirmation `<dialog>` -> Place order. Matches
  how pro platforms prevent fat-finger trades. Generate `client_order_id`
  (`crypto.randomUUID()`) when the ticket opens; reuse it on retry.
- Validation messages inline (`aria-describedby`), e.g. insufficient buying power,
  market closed (order will queue), qty not whole contracts.
- After placing: toast with status, order appears in Open orders instantly, updates
  live from the account SSE stream.

## Live data in the browser
- One `EventSource` per page to `/api/stream/prices?symbols=...&st=...`; update the
  subscription by reconnecting with the new symbol set (debounced 300 ms).
- One `EventSource` to `/api/stream/account` for orders, fills, cash, positions.
- Tick flash: add `.tick--up` / `.tick--down` for 600 ms; respect
  `prefers-reduced-motion` (no flash, colour only).
- Batch DOM writes with `requestAnimationFrame`; never rebuild whole tables per tick,
  update cells by `data-symbol` key.
- Show a connection status dot (Live / Reconnecting / Delayed) in the quote header.
- Prices: tabular numerals (`font-variant-numeric: tabular-nums`), JetBrains Mono for
  numbers, gain/loss colours from tokens plus a +/- sign (never colour alone).

## Charts
- Vendor TradingView **Lightweight Charts** (Apache-2.0) under
  `public/unpkg.com/lightweight-charts@<ver>/` and wrap it in
  `assets/js/components/price-chart.js`. Last candle updates from the SSE stream.
- Portfolio equity curve uses the same component in area mode.

## Options chain
- Expiry selector (chips), strikes down the middle, calls left / puts right, columns:
  Bid, Ask, Last, Change, Volume, OI, IV, Delta. Shade ITM rows. Center on ATM and
  allow "strikes shown: 10/20/All".
- Clicking bid/ask pre-fills the ticket with Sell/Buy to open and a limit price at
  that side.
- Show "Delayed" badge when chain data is delayed.

## Margin, shorting, strategies, baskets
- Account panel: account type badge (Cash / Margin), buying power split (Stock,
  Options, Crypto), margin used, excess liquidity, day trades left (PDT). Values
  come from `GET /api/trading/account` and update from the account stream.
- Ticket actions include Sell short / Buy to cover on margin accounts; show the
  locate badge (`ETB` or `HTB 12.5% APR`) and the margin impact line in preview.
- Margin call banner (`role="alert"`, once per page load) on every dashboard page
  with amount due and deadline; links to the account panel.
- Strategy builder: template picker, legs table bound to chain strikes, net
  debit/credit, payoff chart with breakevens, max profit/loss, requirement.
- Baskets tab: template gallery cards, basket detail (target vs actual donut,
  drift %, Rebalance button), custom builder with weights that must total 100%.

## Funding UI
- Funding uses the existing wallet deposit/withdraw UI (`app/wallet.html`,
  `assets/js/live/wallet.js`); do not rebuild it. The Trading Hub "Deposit" button
  links to `wallet.html#deposit`. Show buying power / withdrawable from
  `/api/wallet/balance` and update on the account stream's `balance` event.

## As built (Phase 3) - read before changing the Trading Hub
- Modules: `assets/js/live/trade.js` (controller) + `assets/js/trade/{dom,stream,chart,ticket,
  blotter,watchlist,chain,baskets}.js`. Build DOM with `dom.h()`; never `innerHTML`.
- **Never return 401/403 for business rules**: `api.js` clears the session and redirects to login
  on those. Use 400/409 with `{detail: {code, message}}`; `ticket.js` maps `code` to a field.
- Every async load that can be superseded (symbol switch, candles, chain, search, preview) uses
  a sequence token and drops stale responses. Keep that pattern.
- Live refreshes must not destroy what the user is interacting with: the ticket radios update in
  place, the open-orders table defers re-render while an inline edit is open, focus is restored.
- `.field__error` only shows inside a `.field` with an `aria-invalid` input; form-level errors
  need an explicit `:not([hidden]) { display: flex }` rule.
- Do not name a module variable `history` (shadows `window.history`), and do not use
  `data-count` (main.js count-up animation hijacks it).
- SSE custom events must not be named `error` (reserved by EventSource): use `stream_error`.
- Shortcuts need a modifier key (Alt+B/S/F) for WCAG 2.1.4.
- Layout: 3 columns only from 100rem; chain columns collapse via container queries on
  `.ledger-wrap`; workspace children need `min-inline-size: 0`.

## As built (Phase 5) - portfolio, copy traders, home, wallet
- Page scripts reuse `trade/dom.js` (`h`, formatters), `trade/chart.js` and `trade/stream.js`
  (`accountStream`). Refresh = debounced + sequence token; the first failed load shows an
  explicit error row/state, never the HTML placeholder numbers.
- Copy controls (`live/copy-traders.js`): guard every mutation with an in-flight flag and disable
  the panel's controls; validate amounts inline (`aria-invalid` + `[data-error-msg]`); restore
  focus after a re-render (toggle button, or the amount field once a copy is gone).
- Ledger rows in the UI: hide `order_hold/order_release/withdrawal_hold/withdrawal_release` and
  entries with `internal: true`; for `copy_*` entries with `amount` 0 show `-reserved_change`;
  an entry whose `bucket` starts with `copy:` is a copied trade.
- Categorical chart colours: `--chart-cat-1..6` (theme-aware, >= 3:1 on light backgrounds).

## Phase 6 UI notes
- Quote header: `[data-q="feed"]` "Delayed" tag, shown only while the instrument trades
  (crypto, or equity session open/pre/post) and `quote.feed === 'delayed'`.
- Admin Trading Hub tab: `assets/js/admin-trading.js` (classic script, `createElement` only),
  hooked onto the legacy globals `viewUser` / `switchUserTab`; reset confirmed by typing the email.

## Phase 7 UI notes
- New pages: `app/documents.html` (`live/documents.js`), `app/screener.html` (`live/screener.js`); both in
  `APP_PAGES` (main.py) and in every page's rail. Protected files download via `api.download(path, name)`.
- Trading Hub tabs Company / Alerts / Recurring: `trade/company.js` (`load(symbol)`, `reset()`),
  `trade/alerts.js` and `trade/recurring.js` (`load()`, `symbolChanged()`), wired in `live/trade.js`
  on `tabs:change` (skipped in demo mode) and on symbol change; SSE `alert` -> toast.
- Inputs/selects must sit inside `.field__control` (the underline lives there).
- Busy submit buttons use `aria-disabled` (not `disabled`) so focus is not lost; after create/delete
  focus the list heading (`tabindex=-1`). External links: `safeUrl()` + `rel="noopener noreferrer"`.

## Accessibility
- Tables use `<table>` with `scope`, sortable headers are buttons with `aria-sort`.
- Live price regions are **not** `aria-live` (too chatty); order status toasts are
  `role="status"`.
- Ticket is a real `<form>`; Buy/Sell is a radio group styled as a segmented control.
- Keyboard: `/` focuses symbol search, `B` / `S` open ticket (only when focus is not
  in an input), `Esc` closes dialogs.

## Footer
Every user dashboard page (including the Trading Hub) includes the school-project notice in `app__foot`, and no other page does:
"This platform is a student school project with simulated markets and simulated
funds. It is not a real broker. Do not deposit real money on this platform."
