# TED Brokers — "Market Pulse" prototype (vanilla HTML/CSS/JS)

Working prototypes of the redesigned public pages and user dashboard. There is no build step and no
framework. These pages are front-end only: data is mocked and forms run in demo mode. They are not
wired to the FastAPI backend yet.

## Run
```sh
cd design/prototype && python3 serve.py        # no-cache dev server on :8765
# then open http://localhost:8765/  (ES modules need http://, not file://)
```

### Page-specific components (added by page)
| Page | Components |
|---|---|
| How it works | `hiw-sim` (capital simulator) |
| For traders | `traders-calc` (earnings calculator) |
| About | `about-map` (dot world map), `about-clock` |
| Help | `help-search` (live filter; emits `help:filtered`), `help-toc` |
| Sign in / up | `auth-form` (validation + redirect), `auth-feed`, `ref-prefill` |
| Wallet | `wallet-deposit` (3-step; opens on `#deposit`), `wallet-withdraw`, `wallet-history` |
| Copy traders | `traders-filter`, `traders-copy`, `amount-field` |
| Plans | `plans-map` (risk/return scatter), `plans-invest`, `plans-hash` |
| Portfolio | `pf-range`, `pf-gauge`, `pf-actions` |
| Referrals | `ref-filter`, `ref-share` |
| Settings | `set-security` (2FA, sessions), `set-prefs` (theme), `set-kyc` |

## Pages
| Public | Dashboard (`app/`) |
|---|---|
| `index.html` Home | `app/index.html` Overview (**shell reference**) |
| `how-it-works.html` | `app/copy-traders.html` |
| `traders.html` For traders | `app/wallet.html` (+ deposit/withdraw dialogs) |
| `about.html` | `app/plans.html` Investment plans |
| `help.html` FAQ + contact | `app/portfolio.html` |
| `login.html`, `register.html` | `app/referrals.html`, `app/settings.html` |

## Architecture

### CSS
`assets/css/main.css` is the only linked stylesheet. It sets up cascade layers in this order:
reset → tokens → base → layout → components → shell → pages → utilities.

- **`tokens.css`:** primitives plus semantic roles.
  - Section theming uses `.surface-ink` (dark) or `.surface-paper` (light).
  - The dashboard theme toggle sets `html[data-theme="light"]`.
- **`components.css`:** wordmark, overline, buttons, links, inline tags, delta (▲/▼), stat strip, numbered rows, ledger tables (with expandable rows), avatar, risk bar, tabs, segmented range, underline form fields, switch, meter, accordion, dialog, toast, ticker, chart, spark, bars, donut, dotfield, quote.
- **`public.css`:** site header and mobile nav, hero, gradient mesh, CTA band, footer, auth split layout.
- **`app.css`:** rail, top bar, content, columns, quick actions, mobile tab bar, TED AI drawer.
- **`pages/<page>.css`:** optional page-only rules, which **must** be wrapped in `@layer pages { … }`.

### JS
`assets/js/main.js` is an ES module.

**Global behaviours:**
- reveal on scroll (`data-reveal`, staggered with `style="--i:n"`)
- count-up numbers (`data-count`, plus `data-format="currency|number"`, `data-decimals`, `data-prefix`, `data-suffix`)
- header scroll state and mobile nav
- rail toggle (`data-rail-toggle`)
- dialogs: `data-dialog-open="id"` to open, `data-dialog-close` to close
- theme toggle (`data-theme-toggle`)
- copy to clipboard (`data-copy="text"`)
- expandable rows: `data-expand="group"` plus `aria-controls`, `aria-expanded`, `data-label-open`, `data-label-closed`
- demo forms (`data-demo-form="Toast message"`)
- `toast()` in `lib/util.js`

**Components** load automatically from `data-component="name"`, which imports `assets/js/components/name.js` and calls `init(el)`. To add one, just create the file.

| Component | What it does |
|---|---|
| `chart` | Area/line chart with glow, draw-in, crosshair tooltip and arrow-key scrubbing. Configured with `data-series`, `data-compare`, `data-band-low` / `data-band-high`, `data-format`, `data-start`, `data-step`, `data-labels`, `data-yaxis`, `data-xaxis`, `data-dots`. Series are either `"1,2,3"` or `"walk:N,seed=S,drift=D,vol=V,start=A,end=B"`. Update it from code with `import { update } from './chart.js'; update(el, {series:[…]})` or by dispatching `chart:update`. |
| `spark` | Sparkline (`data-series`). Colour follows the trend. |
| `donut` | Ring built from its `.legend li[data-value]` with `style="--c: …"`. |
| `bars` | Bar chart (`data-values`, `data-labels`, `data-format="percent|currency"`, `data-show-values`). Negative values draw downwards. |
| `dotfield` | Canvas background, `data-mode="globe|field|network"`. |
| `ticker` | Seamless loop with live price nudges. |
| `tabs` | WAI-ARIA tabs (`role=tablist`/`tab`/`tabpanel`). |
| `seg` | `aria-pressed` group. Drives a chart via `data-target` plus per-button `data-series`. |
| `password` | Show/hide toggle plus strength meter. |
| `quotes` | Testimonial carousel. |

## Design rules (from `design/DESIGN.md`)
- **No cards, no boxed panels, no badges/pills/chips.** Structure comes from hairlines, full-bleed bands, ledger rows, numbered rows and big numerals. Tags are `.tag` (dot plus caps text).
- **Colour roles:**
  - TED red is the only action colour.
  - Teal means gain/live.
  - Amber means pending.
  - Loss always comes with ▼.
- **Fonts:** Sora for display, DM Sans for UI, JetBrains Mono for all numbers.
- **Honesty:** no invented licences, regulators, custody claims or guarantees. Returns are labelled as past or illustrative performance.
- **Logical properties** only, so the layout works in RTL.
