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

## 2026-11-08 · Onboarding and KYC wizard redesign
- **Split shell, same as login and register.** The ink panel carries the four-step rail and the live state; the paper panel holds one step at a time. The rail is the same component register already uses, so sign-up and verification feel like one flow. The old centered wizard with a top stepper is dropped.
- **Rail states are text plus a 6px dot, never badges.** Current shows `● CURRENT`, complete shows `● COMPLETE`. On mobile the rail becomes four hairline segments, and the "Step N of 4" line carries the name.
- **Questionnaire is hairline rows with a native-behaving radio, not bordered cards.** Question position is visible text plus segments. The completion moment becomes the one elevated `.dialog`, with the copy kept and "Verification submitted" in sentence case.
- **Accessibility fixes beyond the redesign.** Field underlines move to `--onb-line` (the old border failed 3:1). The dark primary button text is ink-900 (white on red-400 is 3.31:1). The file input is focusable. Errors go inline next to the field. Step changes move focus to the new h1.
- **Honest copy.** "Save and continue" replaces "Submit" on the KYC step, which saves and moves on. "Skip for now" is kept and explained. The Swal popups are replaced by inline errors and a native dialog, which needs the JS changes listed in `design/onboarding-kyc.md` section 9.
- **Open risks before build:** verify that `/dashboard` does not bounce incomplete accounts (otherwise "Skip for now" is a dead end), and remove the Swal dependency from `TED_AUTH` messages on this page.
- **Implemented (2026-11-08):**
  - "Skip for now" is removed. `/dashboard` sends an unapproved account to `/welcome`, and `/welcome` sends it back to `/onboarding`, so the link was a dead end. Step 1 has only Next.
  - The completion title is "Verification submitted" (sentence case, no "!"). The other completion copy is unchanged.
  - The chat widget is dropped from this page, to match login and register.
  - SweetAlert2 is pinned to 11.26.25 with SRI, because `auth.js` still uses it for session-expired notices.
  - The file input accepts PNG and JPEG only, which matches the copy.
  - Review fixes applied: the dropzone focus ring, placeholder contrast, the focus move to the form alert on server errors, and the stale FileReader abort.
  - Known gaps, not fixed here: the auth token is in localStorage (shared `auth.js`), `loadExistingData` can overwrite typed values, the Sora 600 and forced-colors rail polish, and screen-reader announcements have not been tested with a real reader.
