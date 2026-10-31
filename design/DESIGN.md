# DESIGN.md: TED Brokers ("Market Pulse")

> This is the single source of truth for the redesign. It covers the public site and the user
> dashboard; the admin dashboard is out of scope. Log changes in `design/decisions.md`.

## 1. Product & audience
- **Product:** a copy-trading broker. Users follow verified traders or automated plans across FX,
  stocks, crypto, commodities, indices and options.
- **Audience:** retail investors (mostly on mobile, beginner to intermediate) and experienced
  traders looking for followers. The site ships in 10 languages, including Arabic RTL.
- **Primary goals:**
  1. Trust the platform and sign up.
  2. Fund the account and copy a trader or a plan.
  3. Monitor performance at a glance.
- **Tone:** precise, confident, kinetic, trustworthy, vibrant.
- **References:**
  - **Stripe:** animated gradient-mesh energy and editorial rhythm.
  - **Linear:** hairline structure and crisp, restrained motion.
  - **Robinhood / Revolut:** oversized numerals and data storytelling.

## 2. Visual direction
**"Market Pulse."**
- **Base:** a deep navy ink canvas (dark hero bands, dashboard shell) alternates with bright
  off-white editorial sections.
- **TED red** is the single action color.
- **Vibrancy comes from:** an electric teal "signal" color, used for live data, positive moves and
  the dot-matrix motif taken from the logo's dotted "o"; a warm-red to amber glow inside hero
  gradients; and oversized display type.
- **Structure without containers:** content is organized by **full-bleed bands, hairline rules,
  generous whitespace, split layouts, numbered rows, ruled tables and big numerals**, never by
  boxes.

**Do:**
- Separate content with 1px hairline dividers, alternating section backgrounds, vertical rhythm and
  numbered indexes (01 / 02 / 03).
- Present stats as huge numerals with small caps labels underneath, in open columns separated by
  vertical hairlines.
- Show lists such as traders, plans and transactions as **rows** in ruled tables or ledger lists,
  with an expanding row for detail.
- Show status as **inline colored text with a 6px dot or an arrow**, e.g. `● Active`,
  `▲ 12.4%`, `Pending ·`.
- Use live, animated visuals:
  - a particle/dot-matrix field drifting behind heroes
  - animated line and area sparklines that draw on scroll
  - count-up numbers
  - a scrolling ticker band
  - an allocation donut
  - glowing chart cursors
- Use asymmetric layouts, with big type on one side and an interactive visual on the other.

**Don't:**
- **No cards.** No rounded boxes with a shadow or border that hold content, no grids of tiles, no
  "glass" panels.
- **No badges, pills, chips or tag capsules.** Plan tags such as "Hot" or "Recommended" become an
  inline red/teal overline word, e.g. `RECOMMENDED —`.
- No stock-illustration people, no emoji icons, and no purple/indigo gradients.
- No drop shadows on layout regions. Elevation is used only for dialogs, menus and toasts.

## 3. Color (light / dark)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-ink` | `#0A1626` | — | dark bands, dashboard shell background |
| `--color-ink-2` | `#11223A` | — | raised regions on ink (sidebars, menus) |
| `--color-bg` | `#F7F8FA` | `#0A1626` | page background |
| `--color-surface` | `#FFFFFF` | `#11223A` | dialogs, inputs |
| `--color-text` | `#0A1626` | `#EEF2F7` | body text |
| `--color-text-muted` | `#55657A` | `#9AA9BD` | secondary text |
| `--color-border` | `#DCE2EA` | `#22344D` | hairline dividers |
| `--color-accent` (TED red) | `#E3262F` | `#FF4A52` | primary actions, current nav, key highlights |
| `--color-accent-contrast` | `#FFFFFF` | `#FFFFFF` | text on red |
| `--color-brand-navy` | `#1D4E6F` | `#5C9CC7` | logo "Brokers", secondary links, chart base lines |
| `--color-signal` (teal) | `#0FB5A6` | `#2EE6D3` | live data, positive moves, dot motif, focus ring on dark |
| `--color-glow` (amber) | `#FFB020` | `#FFC24D` | gradient glow highlights, warnings |
| `--color-loss` | `#E5484D` | `#FF6B70` | negative values, always with ▼ |
| `--color-focus` | `#1D4E6F` | `#2EE6D3` | 2px focus ring with a 2px offset |

**Hero gradient mesh** (on ink): radial red `#E3262F` at 35% opacity bottom-left, amber `#FFB020`
at 20% opacity top-right, teal `#0FB5A6` at 25% opacity center-right. It drifts slowly on a
20s loop.

## 4. Typography
- **Display:** Sora, 600/800. It is geometric, energetic and fintech-crisp, yet still professional.
  Bricolage Grotesque was the first choice but isn't supported by Stitch.
- **Text and UI:** DM Sans, 400/500/700.
- **Numbers and data:** JetBrains Mono, 500, with tabular numerals for prices, balances and tickers.
- **Non-Latin fallbacks:** Noto Sans Arabic, Noto Sans SC, Noto Sans Devanagari, Noto Sans Bengali.

| Token | Size | LH | Weight | Tracking | Use |
|---|---|---|---|---|---|
| `--text-display` | `clamp(3rem, 1.8rem + 5vw, 6rem)` | 1.0 | 800 | -0.035em | hero headline |
| `--text-numeral` | `clamp(2.5rem, 1.5rem + 3vw, 4.5rem)` | 1.0 | 600 | -0.02em | big stats, balance |
| `--text-h1` | `clamp(2.25rem, 1.6rem + 2.4vw, 3.5rem)` | 1.05 | 800 | -0.03em | page titles |
| `--text-h2` | `clamp(1.75rem, 1.4rem + 1.4vw, 2.5rem)` | 1.1 | 700 | -0.02em | section titles |
| `--text-h3` | `1.25rem` | 1.25 | 700 | -0.01em | row titles |
| `--text-body` | `1.0625rem` | 1.55 | 400 | 0 | paragraphs |
| `--text-small` | `0.875rem` | 1.45 | 400 | 0 | meta |
| `--text-label` | `0.75rem` | 1.2 | 700 | +0.12em, uppercase | overlines, stat labels, inline tags |

## 5. Spacing, layout, shape, elevation, motion
- **Spacing scale:** 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 · 128. Section padding is
  `clamp(4rem, 2rem + 6vw, 9rem)`.
- **Grid and widths:** 12-column grid, max width 1280px, 24px gutters. The dashboard content area
  is fluid.
- **Radius:** buttons and inputs 10px, dialogs 16px. Layout regions are square (no radius).
- **Elevation:** only dialogs, menus and toasts get a soft shadow tinted with the ink color.
- **Motion:**
  - **Entrances:** 600ms reveal with `cubic-bezier(.2,.8,.2,1)`, using a 24px rise and fade, with
    staggered lines of text.
  - **Count-up numbers:** 1.2s.
  - **Charts:** sparkline paths draw in over 900ms.
  - **Continuous:** the ticker band scrolls on a 40s linear loop. The dot field responds to the
    cursor with a parallax of up to 12px.
  - **Hover:** row hover gets a 2px red bar on the inline-start edge and a background tint.
  - **Reduced motion:** every animation is disabled under `prefers-reduced-motion`, and values
    render in their final state.

## 6. Components
- **Buttons:**
  - **Primary:** solid TED red with white text, 48px tall. On hover it gets an arrow nudge and a
    red glow.
  - **Secondary:** 1px outline on ink or white.
  - **Ghost:** text link with an animated underline.
- **Stat strip:** open columns separated by vertical hairlines; label in caps, numeral in
  JetBrains Mono, delta as an arrow plus colored text. No container.
- **Ledger / table rows:** full-width rows with hairline separators and right-aligned numbers.
  The row expands inline to show detail: chart, stats and the copy action.
- **Numbered feature rows:** a large "01" index in muted outline type, then title and copy, divided
  by hairlines.
- **Inline tag:** caps label in accent or signal color preceded by a dot, e.g. `● RECOMMENDED`.
  No background, no border.
- **Tabs / segmented control:** text tabs with an animated underline indicator.
- **Inputs:** underline style or 1px border at 10px radius, with a floating label. The error
  message sits below the field in loss color with an icon.
- **Navigation:**
  - **Public:** a transparent header over the ink hero that turns solid ink when scrolled.
  - **Dashboard:** a slim left rail on ink (icons plus labels) with a top bar holding search,
    language, theme and avatar. TED AI opens as a slide-over drawer.
- **Dialogs:** deposit, withdraw and 2FA use a centered surface with a 16px radius. This is the one
  allowed elevated surface.

## 7. Iconography & imagery
- **Icons:** Phosphor or Lucide line icons at 1.5px stroke, 20/24px.
- **Imagery:**
  - generative visuals (dot-matrix globe, particle fields, gradient mesh, animated charts)
  - real trader portraits in circular 40px avatars
  - no stock people in heroes

## 8. Content & voice
- **Voice:** sentence case, specific, calm and confident.
- **Buttons:** verbs, e.g. "Start copying", "Deposit funds", "Copy trader".
- **Numbers:** currency is shown as `$12,480.32`, percentages with a sign (`+4.2%`), dates as
  `27 Oct 2026`.
- **Disclosures:** risk disclosure is always visible near return figures. Returns are labelled
  "past performance".

## 9. Accessibility commitments
- **Standard:** WCAG 2.2 AA in both themes.
- **Interaction:** 2px focus ring, targets of at least 44px, reduced-motion support and
  forced-colors support.
- **RTL:** fully mirrored using logical properties. Charts are not mirrored.

## 10. Trading Hub (`app/trade.html`)
The Trading Hub keeps the Market Pulse rules: regions are separated by hairlines rather than
boxed, numbers are JetBrains Mono with tabular numerals, and status is shown as inline caps text
with a dot. Density is higher than the rest of the dashboard because it is a working tool.

**Layout (>= 1600px):** three columns, separated by 1px vertical hairlines and no gaps.
- **Watchlist rail:** 16rem.
- **Workspace:** fluid. Contains the quote header, chart, then the tabs.
- **Order ticket:** 22rem, sticky below the top bar, and scrolls inside itself when taller than
  the viewport.
- **768-1599px:** the watchlist and account panel move under the workspace and the ticket stays
  on the right. This leaves the chart and options chain about 850px at 1440px.
- **Mobile (< 768):** a single column in the order quote, chart, tabs, ticket, watchlist. A
  sticky Buy / Sell bar jumps to the inline ticket (see decisions.md 2026-10-29).
- **Shortcuts:** always use a modifier (Alt+B buy, Alt+S sell, Alt+F find symbol), per WCAG 2.1.4.

**Quote header:**
- Symbol in Sora 700, with the name and exchange muted beneath it.
- Last price in `--text-numeral` mono, then the change as an arrow plus colored text (`▲ +2.31
  (+0.68%)`).
- Bid x ask in mono, followed by inline tags for the session (`● OPEN`, `● PRE-MARKET`,
  `● CLOSED`) and the data state (`● LIVE` in signal teal, `● DELAYED` or `● ESTIMATED SPREAD`
  in amber).
- Price ticks flash the last price text color (teal up, loss down) for 600ms. There is no
  background flash, and under reduced motion only the color changes.

**Chart:**
- TradingView Lightweight Charts, vendored under `assets/vendor/`.
- Area series by default, with a candle toggle. Line color is `--chart-line`, grid
  `--chart-grid`, and the background is transparent.
- Range control: the segmented underline control (`1D 5D 1M 3M 6M YTD 1Y 5Y`).
- Line color in light mode is teal-700 (4.6:1); colors re-read on theme change.
- The last bar updates from the price stream.

**Order ticket:**
- **Actions:** a segmented control with Buy / Sell, plus Sell short / Buy to cover on margin
  accounts. Buy is underlined in red and sell is outlined.
- **Fields:** underline-style fields for quantity (with a Shares / Dollars toggle), order type,
  limit/stop/trail price, time in force and an extended-hours switch.
- **Live estimate block:** est. price, est. cost or proceeds, fees and buying power after, each
  label in caps on its own row with a hairline.
- **Confirmation:** "Review order" opens a confirmation dialog (the one elevated surface) with the
  full order summary, warnings and the "Place order" button. A toast confirms placement.
- **Errors:** inline below the relevant field in loss color, using the API `code` to pick the field.

**Blotters:**
- Positions, Open orders, History and Activity are ruled `.ledger` tables with right-aligned
  mono numbers.
- Gains and losses are shown with an arrow and sign. Row hover uses the 2px red edge.
- Open orders have Cancel / Edit text buttons.
- Spread groups render as one parent row with leg rows indented beneath.

**Options chain:**
- Expiries in a horizontally scrolling segmented control (no chips).
- Calls on the left, strike in the middle column, puts on the right.
- In-the-money cells get a 6% tint of the text color.
- Bid and ask cells are buttons that pre-fill the ticket (sell at bid, buy at ask).
- "Strikes: 10 / 20 / All", centered on the ATM strike, with a hairline marking the spot.

**Strategy builder:**
- Template selector, then legs as ledger rows.
- Net debit/credit in a big mono numeral.
- Payoff chart: a line series with a zero line, breakevens marked and shown as inline tags.
- Max profit / max loss / requirement shown as a stat strip.

**Account panel (bottom of the watchlist rail):**
- A stat strip with account type, buying power (stock / options / crypto), margin used, excess
  liquidity and day trades left.
- A margin call shows as a full-width `role="alert"` band in loss color above the workspace (and
  on every dashboard page), with the amount, deadline and a link to Deposit.
