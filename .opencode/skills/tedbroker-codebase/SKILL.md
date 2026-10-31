---
name: tedbroker-codebase
description: Conventions and map of the TED Brokers codebase (FastAPI + pymongo backend in app/, framework-free dashboard in public/copytradingbroker.io/app/). Use when adding or changing any backend route, Mongo collection, dashboard page, sidebar/nav entry, page script under assets/js/live/, or CSS in assets/css/ in this repo, including the Trading Hub and copy-trading work.
---

# TED Brokers codebase conventions

This is a **school project**. Markets and funds are simulated. Never add flows that
move real money. The "School project notice" (class `.school-notice`) belongs only in the
`app__foot` of user dashboard pages (`public/copytradingbroker.io/app/*.html`). Do not add it
to public pages, documents, emails, or the admin UI, and do not add other "school project"
or "simulated" wording about TED Brokers in user-facing text.

## Stack
- Python 3, FastAPI 0.115, Uvicorn, **synchronous pymongo** (no ORM), Pydantic v2 for
  request/response validation only. Entry point `main.py`.
- Frontend: plain HTML + layered CSS + ES modules. No build step, no npm, no framework.
  Third-party front-end libs are vendored locally (see `public/unpkg.com/`,
  `public/cdn.jsdelivr.net/`); do not load from public CDNs at runtime.
- Run: `./run.sh` or `uvicorn main:app --reload --port 8000`.

## Backend layout
- `app/database.py` - Mongo client and the collection-name registry (lines ~55-73).
  Register every new collection there and add indexes in a startup helper.
- `app/schemas.py` - all Pydantic models. New domains may get their own module
  (e.g. `app/trading/schemas.py`) to keep this file from growing further.
- `app/routes/<domain>.py` - one `APIRouter` per domain, mounted in `main.py` under
  `/api/<domain>`.
- Auth dependency: `get_current_user` / `get_current_user_token` in `app/auth.py`
  (JWT Bearer, token blacklist). Admin routes use `get_current_admin` in
  `app/routes/admin.py`.
- Background loops are started in `main.py` startup with `asyncio.create_task`
  (see `app/trade_scheduler.py`). Long-running work must not block the event loop:
  wrap pymongo calls in `await asyncio.to_thread(...)` inside async loops.
- Rate limiting via slowapi (`app/rate_limiter.py`).
- External keys live in `.env`: `FINNHUB_API_KEY`, `NEWSAPI_KEY`, `OPENROUTER_API_KEY`.
  Note `app/database.py` reads `DATABASE_NAME`, not `MONGODB_DB`.

## No static data on dashboard pages
- Markup in `app/*.html` holds structure only: no names, balances, counts, prices, dates, sample
  rows or chart series. Use "—" or a loading line; the page script fills it from the API.
- A failed request shows an explicit error (`role="alert"` or an empty state), never `0` or
  `$0.00`, and never a sample row.
- Figures that have not been measured are `null` in the API and "—" in the UI (for example
  trader returns without a live track record, a day P&L without a previous close, or an
  unpriced position's market value).
- Free cash = cash minus holds (`withdrawable`). Use it for "available" on every page; cash
  balance = total cash.
- `/assets/*` is served with `Cache-Control: no-cache` (main.py `RevalidatingStaticFiles`).

## Money rules (apply everywhere)
- The user's cash is `users.wallet_balance`. Any code that changes it must go through
  the ledger service (`app/trading/ledger.py`, once it exists), never a bare `$inc`
  from a route.
- Store money as integer **cents** (or `Decimal128`) in new collections; convert at
  the API edge. Never compare floats for equality.
- Balance changes must be atomic: use a conditional `find_one_and_update` with a
  guard such as `{"wallet_balance": {"$gte": amount}}`, or a transaction.

## Frontend layout
- Pages: `public/copytradingbroker.io/app/*.html`, served by the allow-list in
  `main.py` (~line 220). Add new page slugs to that list.
- **There is no shared layout.** Each page duplicates the sidebar `<aside class="rail">`,
  `<header class="topbar">`, mobile `<nav class="tabbar">`, and `<dialog id="ted-ai">`.
  When adding a nav item, update it in **every** page in `app/`.
- Page script per page in `assets/js/live/<page>.js`, plus shared `base.js`, `api.js`
  (fetch with Bearer token from localStorage `ted_access_token`, money formatters,
  `?demo` mode), `shell.js` (skeletons/empty states), `header.js`, `ticker.js`,
  `ai-panel.js`.
- Components: `data-component="name"` attributes are auto-loaded by
  `assets/js/main.js` from `assets/js/components/<name>.js`.
- CSS: `assets/css/main.css` imports layers `reset, tokens, base, layout, components,
  public, app, utilities`. Use tokens from `tokens.css` (`--color-*`, `--space-*`,
  `--text-*`, `--radius-*`); dashboard default theme is `.surface-ink` (dark).
  Page-specific CSS goes in `assets/css/pages/<page>.css`.
- Design source of truth: `design/DESIGN.md` ("Market Pulse").
- Render untrusted data with `textContent` / DOM APIs, never `innerHTML` with
  interpolated server data.

## Tests
- `tests/` uses pytest. `tests/conftest.py` hardcodes a foreign `sys.path`; fix it to
  be relative before relying on it. Prefer a separate test database
  (`DATABASE_NAME=tedbroker_test`) and `mongomock` or a local mongod for unit tests.

## Operations (Phase 6)
- Tests: `venv/bin/python -m pytest -q` (mongomock via `tests/conftest.py`, never touches `.env`).
- `CORS_ORIGINS` (comma-separated, never `*`); run Uvicorn with one worker (in-process PriceBus).
- Admin Trading Hub API: `app/routes/admin_trading.py` (`/api/admin/trading/...`): per-user
  ledger/orders/positions, integrity checks, engine/feed status, reset simulated account.
- Scripts: `scripts/seed_demo.py` (demo account; dry run by default), `scripts/load_test_engine.py`,
  `scripts/migrate_cash_to_ledger.py`. Simulation write-up: `docs/TRADING_HUB.md`.
