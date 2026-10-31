# Design decisions

## 2026-10-27: "Market Pulse" direction
- **No cards and no badges (client requirement).** Structure comes from full-bleed bands, hairline rules, ledger rows, numbered rows and oversized numerals. Tags become inline caps text with a dot (`● RECOMMENDED`).
- **Brand-derived palette.**
  - TED red is the single action colour.
  - Ink navy (from "Brokers") is the canvas.
  - Teal is the signal colour for live and positive data, and draws on the logo's dotted "o".
  - Amber marks pending states.
- **Type.** Sora for display (vibrant, geometric, fintech), DM Sans for UI, JetBrains Mono for all numbers.
  - Bricolage Grotesque was the first choice, but the Stitch API rejects it.
  - It can still be swapped in during implementation if preferred.
- **Motion carries the "interactive visuals".**
  - count-up numerals
  - charts that draw themselves in
  - a drifting dot-matrix/particle field
  - a scrolling ticker
  - expanding ledger rows
  - animated donut rings
  - inline sliders and simulators
- **Dashboard IA.**
  - A left rail replaces the overcrowded horizontal menu, which fixes long German/Russian labels and RTL.
  - TED AI moves from a permanent left panel to a top-bar slide-over.
  - The right Help panel moves into the rail footer.
- **Mobile dashboard** uses a 5-tab bottom bar (Home, Wallet, Traders, Plans, More) plus a floating TED AI button.

## 2026-10-29 · Trading Hub layout decisions
- **Three columns only from 100rem (1600px).** At 1440px a 16rem watchlist rail left the chart
  and options chain only ~36rem wide, so the chain dropped to Delta/Bid/Ask. Below 100rem the
  watchlist and account panel move under the workspace instead.
- **Mobile ticket is inline, not a bottom-sheet dialog.** The ticket is a long form (actions,
  quantity, type, prices, TIF, estimate). As an inline section it keeps native scrolling, autofill
  and browser zoom behaviour, and the sticky Buy / Sell bar jumps to it. A modal sheet over a
  live-updating chain added focus-trap complexity for no gain in task speed.
- **Compact options chain via container queries:** Vol/OI hides below 52rem of table width,
  IV below 36rem; the Calls/Puts group headers recompute their colspan.
- **Mobile tab bar: "Trade" replaces "Plans"** (Home, Wallet, Traders, Trade, More). Trading is
  the primary task; plans stay one tap away in the rail behind "More".
