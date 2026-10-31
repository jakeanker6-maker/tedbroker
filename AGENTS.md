# TED Brokers - agent instructions

This is a **school project**: a simulated trading and copy-trading platform using real
market prices with simulated execution and simulated funds. It is not a real broker.

- Never add flows that collect or move real money. The "School project notice"
  (`.school-notice`) appears only in the footer of the user dashboard pages (`app/*.html`).
  Do not add it, or any other "school project" / "simulated" wording about TED Brokers, to
  public pages, PDFs, CSVs, emails, notifications, or the admin UI.
- No sample data on user dashboard pages (`public/copytradingbroker.io/app/*.html` and
  `assets/js/live/*.js`). Every figure, name, row, chart series or count must come from the API.
  Placeholders in markup are "—" or a loading line. A failed request shows an explicit error
  state, never zeros or sample values. Seed or demo values are never shown as a track record.
- Funding: integrate the **existing** deposit/withdrawal mechanism (deposit request ->
  admin approval -> wallet credit; withdrawals with code + admin approval) with the
  ledger. Keep its endpoints and UI contracts; do not add new payment processors.
- Project skills: `tedbroker-codebase`, `sim-trading-engine`, `market-data`,
  `trading-hub-ui` (in `.opencode/skills/`). Load the relevant ones before working.
- Project subagents: `trading-backend`, `market-data`, `trading-ui`, `trading-qa`
  (in `.opencode/agents/`), plus the global `ui-designer` / `ui-reviewer`.
- The Trading Hub implementation plan is
  `docs/superpowers/plans/2026-10-29-trading-hub.md`. Work task by task.
- MCPs: `mongodb` (read-only; needs `TEDBROKER_MONGODB_URL` exported in the shell
  that launches opencode), `context7` (library docs), plus global `playwright`,
  `chrome-devtools`, `stitch`.
