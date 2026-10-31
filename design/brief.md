# TED Brokers — UI redesign brief (frontend only)

## Scope
- **In:** public marketing pages, auth pages, and the user dashboard (`copytradingbroker.io/dashboard.html` SPA tabs).
- **Out:** the admin dashboard (`admin-*.html`) and all backend/API changes. The redesign keeps every
  existing JS hook (`data-tab`, `data-i18n`, modal ids, form ids) so `dashboard.js`, `auth.js` and
  `language.js` keep working.

## Product
TED Brokers ("Copy & Win") is a copy-trading broker. Users fund a wallet (bank, crypto, PayPal),
copy verified traders across FX, stocks, crypto, commodities, indices and options, or subscribe to
automated plans (Robo Advisor, ETF, DeFi, Options; Staking is coming soon). It also has referrals and
an AI assistant called "TED AI". The site ships in 10 languages, including Arabic (RTL).

## Audience
- **Retail investors** (beginners to intermediate, mostly on mobile) who want passive exposure to markets.
- **Experienced traders** who want followers and commission income.

## Primary goals
- **Public site:** understand how copy trading works, trust the platform, start sign-up.
- **Dashboard:** see portfolio health at a glance, fund the wallet, find and copy a trader, manage
  plans, invite friends, and secure the account.

## What the user asked for
- More professional, with more animation and interactive visuals.
- **No cards and no badges.**
- Professional yet vibrant fonts and visuals.

## Problems with the current UI
- **Two theme stacks** (Bootstrap 5.3 and 5.1), plus about 4.7k lines of inline dashboard CSS and heavy `!important` overrides.
- **Card soup everywhere:** stat boxes, plan cards, testimonials and news cards. Plan tags are rendered as gradient badges.
- **Off-brand colors:** red is used for both "success" and "primary", there is a stray purple gradient, and the font stack is inconsistent.
- **Weak data storytelling:** charts are almost entirely third-party TradingView embeds, and the dashboard has no visuals of the user's own data.
- **No RTL-aware custom CSS.**

## Direction: "Market Pulse"
- **Feel:** precise, confident, kinetic, trustworthy, vibrant.
- **References:**
  - **Stripe:** gradient-mesh energy and editorial rhythm.
  - **Linear:** restraint, hairlines, crisp motion.
  - **Robinhood / Revolut:** big-number data storytelling and bold type.
- **The brand's own assets drive the system:**
  - **TED red** for action.
  - **Brokers navy** for ink and authority.
  - **The logo's dot-cluster "o"**, which becomes a living particle/dot-matrix motif behind heroes and charts.

## Constraints and assumptions
- **Tech:** vanilla HTML/CSS/JS, with no framework required. TradingView widgets may stay where they add value, restyled to fit.
- **Layout:** RTL must mirror correctly, so use logical properties throughout. Long German and Russian labels need room.
- **Fonts:** need non-Latin fallbacks (Noto Sans Arabic/SC/Devanagari/Bengali).
- **Motion:** respect `prefers-reduced-motion`.
- **Honesty flag:** the existing marketing numbers conflict with each other (10,000+ copiers vs 100K+
  users; "5–10% monthly" earnings tables). The mockups use them only as placeholders. Before
  launch they must be verified, and return figures must be shown as historical, never guaranteed,
  with risk disclosure kept visible.
