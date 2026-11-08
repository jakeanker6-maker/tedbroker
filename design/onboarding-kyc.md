# Onboarding and KYC wizard: redesign spec

Status: proposed, design only. Scope: `public/copytradingbroker.io/onboarding.html`, its styles, and the
markup and small JS changes it needs. Source of truth for tokens: `design/DESIGN.md` and
`assets/css/tokens.css`. No HTML, CSS or JS has been edited.

---

## 1. Brief

**Goal.** Replace the legacy Bootstrap wizard with the Market Pulse auth shell used by `login.html` and
`register.html`. The user finishes four steps: personal info, address, identity verification (KYC), and
an investment profile. Then the account goes to review.

**User.** A new account holder on a phone or a laptop. Many are beginners. Some have never uploaded an ID
online, and some use a screen reader or keyboard only. Some use German, Russian or Arabic labels, so the
layout must hold longer strings.

**Constraints (hard).**
- Keep every id, name, form id, field id and data attribute that `assets/js/onboarding.js` uses. The list is
  in section 9. Changes are proposed only where the JS already needs to change.
- Four steps with the same fields and order:
  1. Personal info: `first_name`, `last_name`, `gender`
  2. Address: `street`, `city`, `state`, `zip_code`, `country`
  3. Identity verification: `document_number`, `document_photo` (preview and "Change photo")
  4. Investment profile: three single-question views, `risk_tolerance`, `annual_income`, `employment_status`.
     Back and Next on each view, Submit on view 3 only.
- No cards, no badges, no pills, no chips, no emoji. Structure comes from hairlines, numbered rows,
  the step rail and whitespace. Icons are inline SVG at 1.5px stroke.
- Light and dark themes both work. WCAG 2.2 AA. Targets are at least 44px. A visible 2px focus ring.
  `prefers-reduced-motion` is respected. The layout is RTL-safe through logical properties.
- Honest copy only. No "school project" or "simulated" wording on this page (AGENTS.md). No fake urgency,
  stats or testimonials. "Skip for now" stays, explained as optional.
- The completion moment stays, restyled as the single elevated surface (a dialog). Its copy is unchanged.

**Assumptions (explicit).**
- A1. `TED_AUTH.isAuthenticated()`, the `/api/onboarding/*` endpoints and their response shapes stay as they are.
- A2. Each of steps 1–3 saves to the API when the user continues. The questionnaire is submitted once,
  at the end of view 3. The copy must not promise anything else.
- A3. `/dashboard` may bounce incomplete accounts back to `/onboarding`. This is not verified (see section 12).
- A4. Approval is an admin action. The copy says "under review" and "typically less than 24 hours" only
  because that is existing copy the client supplied.
- A5. No Stitch screens are produced. The auth shell already is the Market Pulse system, and the
  deliverable is a spec, not a new mockup.

---

## 2. Direction

**Adjectives:** calm, exact, guided, sober, honest.

**References (inside this codebase, not external trends):**
- `register.html`: the three-step rail inside the ink panel (`.auth-steps`). The onboarding rail continues it,
  so the user sees the same language from sign-up through verification.
- `login.html`: split shell, `.field` pattern, `.btn--lg` action, `.overline` head.
- `welcome.html`: numbered rows and hairline rhythm for the status moment.

**Layout decision: split shell (ink left, paper right), same as login and register.**
- Reason 1: continuity. Register's rail and onboarding's rail are the same component. The user does not
  feel a switch from "the new product" to "the old wizard".
- Reason 2: the rail sits where the eye starts, and the form stays in a single reading column. A
  centered single-column wizard with a rail above it (the old layout) pushes the form down and hides
  progress on mobile.
- Reason 3: the ink panel has room for the live-state readout (the rail states) without a card.
- Alternative rejected: a full-width horizontal stepper on top of a centered form. It is simpler, but it
  would need a second progress component on mobile, and it reads as the legacy wizard.

**Breadth.** Form column is `auth__panel auth__panel--wide` (40rem max). Shell columns are
`--auth-cols: 40fr 60fr`, as register uses.

---

## 3. Wireframes

Shorthand: `[ ]` button, `____` field line, `( )` radio, `(•)` selected radio, `▌` 2px accent edge,
`●` 6px dot, `○` upcoming dot, `─` hairline.

### 3.1 Desktop, ≥ 1200px (step 1)

```
 INK PANEL (40fr)                           PAPER PANEL (60fr)
 TED Brokers                 EN v           Need help?  Help centre ->

 ACCOUNT SETUP                              STEP 1 OF 4
 Four short steps to finish                 Personal information
 your account.                              Use the name on your ID document.
                                            Fields marked * are required.

 01 ● Personal info     ● CURRENT           FIRST NAME *          LAST NAME *
    Name and gender                         ____________________  ____________________
 02 ○ Address
    Residential address                     GENDER *
 03 ○ ID verification                       Select gender                         v
    Document number and photo               ____________________________________
 04 ○ Investment profile
    Three questions about you               Skipping is optional for now. You will
                                            need these details before your account
 Each step is saved when you                can be approved.
 continue. Your investment profile          ────────────────────────────────────────
 is sent once, at the end.                  [<- Skip for now]            [Next ->]
```

Step 2, Address: the same shell. The rail marks step 1 complete (`● COMPLETE`, teal) and step 2 current.
The form has `street` on a full row, `city` | `state`, `zip_code` | `country`. The actions are `[<- Back]` and `[Next ->]`.

### 3.2 Desktop, ≥ 1200px (step 3, ID verification, with preview)

```
 STEP 3 OF 4
 Identity verification
 Upload a clear photo of a valid ID document.

 ID DOCUMENT NUMBER *
 ____________________________________________
 Use the number printed on the document you upload below.

 ID DOCUMENT PHOTO *
 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
 ┊  [upload icon]  Click to upload or drag and drop
 ┊                 PNG or JPG, up to 5 MB
 ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈

 (after upload, the dropzone is replaced by the preview:)
 ┌────────────────────────────┐
 │        [ID photo]          │   hairline 1px frame, radius 6px, max 14rem tall
 └────────────────────────────┘
 ✓ Photo added.                              [Change photo]

 NOTE  Note: Please ensure your document photo is clear and all information is readable.
 ────────────────────────────────────────────────────────────────
 [<- Back]                                 [Save and continue ->]
```

### 3.3 Desktop, ≥ 1200px (step 4, questionnaire, view 1 of 3)

```
 STEP 4 OF 4
 Investment profile
 Help us understand your investment preferences.
 Answer three questions. Your answers are submitted together at the end.

 QUESTION 1 OF 3                                 ▬▬▬  ───  ───
 What is your investment risk tolerance?          (segments: done=teal, current=red, upcoming=muted)
 Select the level of risk you are comfortable with.
 ──────────────────────────────────────────────────────────────
 ▌(•) Very Low                                                     <- selected: 2px red edge, filled radio
 ──────────────────────────────────────────────────────────────
   ( ) Low
 ──────────────────────────────────────────────────────────────
   ( ) Moderate
 ──────────────────────────────────────────────────────────────
   ( ) High
 ──────────────────────────────────────────────────────────────
   ( ) Very High
 ──────────────────────────────────────────────────────────────
 [<- Back]                                             [Next ->]
```

View 2 (annual income) and view 3 (employment status) use the same layout. View 3's primary button reads
`Submit for review ->`. The error line, shown after a Next with no selection, sits under the last row:
`! Please select an option to continue.` (icon plus text, loss color).

### 3.4 Mobile, 375px (step 2, Address)

```
 +--------------------------------------+   INK BAR (auto height)
 | TED Brokers                    EN v  |
 |                                      |
 | [====][====][____][____]             |   rail: 4 hairline segments
 +--------------------------------------+   done=teal, current=red, upcoming=muted
 | STEP 2 OF 4                          |   PAPER (form)
 | Address                              |
 | Enter your current residential       |
 | address. Fields marked * are         |
 | required.                            |
 |                                      |
 | STREET ADDRESS *                     |
 | ____________________________________ |
 | CITY *                               |
 | ____________________________________ |
 | STATE OR PROVINCE *                  |
 | ____________________________________ |
 | ZIP OR POSTAL CODE *                 |
 | ____________________________________ |
 | COUNTRY *                            |
 | ____________________________________ |
 |                                      |
 +--------------------------------------+ <- sticky action row (hairline top)
 | [<- Back]   [ Next ->               ]|   Back ~7rem, primary flex 1
 +--------------------------------------+
```

Under 40rem the `auth-grid` collapses to one column, so every field is full width. The field labels stay
above the fields, so nothing is placed side by side on a phone.

### 3.5 Mobile, 375px (step 4, questionnaire, view 2 of 3)

```
 STEP 4 OF 4
 Investment profile                     (h1 visible on each step)
 Help us understand your investment preferences.

 QUESTION 2 OF 3          [done][current][upcoming]
 What is your annual income?
 Select the range that best describes your annual earnings.
 ----------------------------------------------------
   ( ) Less than $10,000
 ----------------------------------------------------
 ▌(•) $10,000 - $50,000
 ----------------------------------------------------
   ( ) $50,000 - $100,000
 ----------------------------------------------------
   ( ) $100,000 - $1,000,000
 ----------------------------------------------------
   ( ) More than $1,000,000
 ----------------------------------------------------
 +----------------------------------------------------+
 | [<- Back]              [ Next ->                 ] |  sticky
 +----------------------------------------------------+
```

### 3.6 Completion dialog (desktop and mobile)

```
 ┌──────────────────────────────────────────────────┐   .dialog, radius 16px, ink-tinted shadow
 │ Verification submitted                           │
 │                                                  │
 │ Thank you for completing your investment         │
 │ profile!                                         │
 │                                                  │
 │ Your information is currently under review by    │
 │ our team.                                        │
 │ ────────────────────────────────────────────────  │
 │ (clock) Approval typically takes less than 24 hours│
 │ ────────────────────────────────────────────────  │
 │ You will receive a notification once your account│
 │ has been approved and you can start trading.     │
 │                                                  │
 │ ────────────────────────────────────────────────  │
 │                                 [Continue ->]    │  full width on mobile
 └──────────────────────────────────────────────────┘
```

No close (X) button and no Escape to dismiss, because the old flow prevented both. `Continue` is the only
exit. This is the same behavior as today, shown plainly.

---

## 4. Step rail

The rail is an `ol.auth-steps.onb-rail` in the ink panel, with `aria-label="Onboarding steps"`. It has four
`li.auth-steps__item.wizard-step[data-step]` items in order. The JS toggles classes `active` and `completed`
and sets `aria-current="step"` on the current item. That contract is kept.

**Anatomy per item (desktop, ≥ 60rem):**
- numeral `01`–`04` (`.auth-steps__num`, `--text-small`, JetBrains Mono 500)
- a 6px filled dot as the state marker, drawn by `::before` (no ring, no background, no box-shadow)
- title (`.auth-steps__title`, Sora 600, 1.125rem)
- inline state text, after the title, only for current and complete (`.onb-step__state`, which is a `.tag`)
- one-line description (`.auth-steps__text`, `--text-small`, muted)
- a 1px vertical connector between dots (`--color-border`)

**States.**

| State | Numeral | Dot | Title | Inline state text | Hook |
|---|---|---|---|---|---|
| Upcoming | `--color-text-muted` | `--color-text-muted` | muted, 500 | none | no class |
| Current | `--color-accent-text` | `--color-accent` | `--color-text`, 600 | `● CURRENT`, `tag--accent` | `aria-current="step"` |
| Complete | `--color-text` | `--color-signal` | `--color-text`, 500 | `● COMPLETE`, `tag--gain` | `.completed` |

- The "CURRENT" text is shown for sighted users. Screen readers get `aria-current`.
- The "COMPLETE" text is generated with `::after { content: "Complete" }` on `.completed .onb-step__state`.
  Most screen readers read generated content. The state is never conveyed by color alone (dot plus word).
- Forced colors: the dot uses `background: currentColor` through `forced-colors`, so it stays visible.

**Mobile (< 60rem).** The rail becomes a 4-column grid of 2px hairline segments. Each segment is the item's
`::before`, full width, in its state color (current red, complete teal, upcoming muted). Numerals,
titles, descriptions and state text are visually hidden with `.sr-only` on mobile. The step name is in
the form's progress line ("Step 2 of 4") and in the h1, so no information is lost.

**Connector on mobile:** `::after` is hidden. Gap between segments is `--space-2`.

**Not interactive.** Items are not links or buttons. Clicking to go back is out of scope (open question O3).

**Overflow.** Titles wrap to two lines in the rail (`overflow-wrap: anywhere`). Long German titles such as
"Identitätsprüfung" or "Persönliche Daten" are safe at 60rem because the rail column is 40% of the viewport.

---

## 5. Component specs

All values use existing tokens. Where a value is not a token, it is written as a `calc`/`color-mix` of tokens.

### 5.1 Shell

- `main.auth#main` (existing `.auth` grid), `style="--auth-cols: 40fr 60fr"`.
- Left: `section.auth__visual.surface-ink` with `aria-label="Account setup progress"`.
  Contains `.mesh`, `canvas.dotfield` (decorative, `aria-hidden`), `.auth-visual__top`
  (wordmark, `.site-lang`), `.onb-visual__body` (overline, headline, rail), `.auth-visual__foot`.
- Right: `section.auth__form.surface-paper.onb-form` with `aria-label="Complete your profile"`. The step h1 changes per step, so the section is named by a fixed label, not by the h1.
- The ink panel keeps `.surface-ink` in both themes (it is a brand panel).
- Visual body is not hidden on mobile. Only `.auth-visual__foot` and the headline are hidden under 60rem.
  Use the new class `.onb-visual__body` so `auth.css`'s mobile rule (which targets `.auth-visual__body`)
  does not hide the rail.

### 5.2 Progress line and step title

- `p.overline#progress-indicator` (in the panel head, above the h1). Text: `Step <span id="current-step">1</span> of 4`.
  It gets `aria-live="polite"`. Visible on all steps.
- h1 per step, inside each `.step-content`: `h1.onb-title[tabindex="-1"]`. Size uses `.auth__panel h1`
  (2.25–3rem), and `text-wrap: balance`. Each step has its own h1, so the JS does not need to change
  the title text. The focus target on step change is the active step's h1 (see section 9).
- Intro paragraph: `p.lead`-style body, `--color-text-muted`, max 60ch.

### 5.3 Field (text input, select)

Reuse `.field`, `.field__label`, `.field__control`, `.field__input`, `.field__select`, `.field__help`,
`.field__error` (login pattern). Inside `.auth-form`, the label is not uppercase (existing override).

- Label: DM Sans 500, `--text-small`. Required marker: `<span aria-hidden="true">*</span>` after the text.
- Control: underline style, as login. **Override the underline color** to `var(--onb-line)`
  (= `--color-text-muted`). The existing `--color-border-strong` underline is 1.53:1 on paper, which
  fails 3:1 for the input boundary (WCAG 1.4.11). Dark `--color-border-strong` (ink-500) is 2.05:1, also a fail.
- Input min-height 2.9rem (`.field__input` existing) and the `.field__control` padding gives a 48px hit area.
  The `.field__control` is at least 3rem tall.
- Helper text (`.field__help`) is linked with `aria-describedby`. Errors use `.field__error` with
  `aria-describedby` and `aria-invalid`.

**States:**

| State | Visual |
|---|---|
| Default | underline 1px `--onb-line`, text `--color-text`, placeholder muted at 80% |
| Hover (pointer) | underline `--color-text`, transition 160ms |
| Focus-visible | 2px outline `--color-focus` (navy light, teal dark), 2px offset, radius 6px, on the `.field__control`. Input's own outline stays `none` (it is replaced by the control ring) |
| Active (typing) | same as focus-visible |
| Filled | same as default. No per-field success check (noise) |
| Disabled (during submit) | `opacity: .5`, `cursor: not-allowed`, underline dotted |
| Read-only | not used in this flow |
| Error | underline and `box-shadow: 0 1px 0 0` in `--color-loss`; `.field__error` shown with the circle icon and the message |
| Empty (no value) | placeholder only; required error appears on submit, not on blur |
| Loading | none on fields. Loading belongs to the button (5.11) |

**Autofill.** Browsers can paint a light background on autofilled inputs in dark mode. Add
`.onb-form .field__input:autofill { -webkit-text-fill-color: var(--color-text); transition: background-color 9999s; }`
so the text stays readable. The risk is listed in section 12.

### 5.4 Gender select

- `.field__select` with `appearance: none`. The existing chevron (`.field__control:has(.field__select)::after`) is reused.
- Option list text color: `--ink-900` (existing), so it reads in dark mode.
- Placeholder option: `value=""`, text "Select gender", `disabled hidden`? **Not hidden.** Keep it selectable
  so a user can see the field is unset. Mark `disabled` only after the first selection is impossible (not needed).
- Options text and values unchanged: `Male` / `Female` / `Others`.

### 5.5 Field groups

- `.auth-grid` (2 columns ≥ 40rem, 1 column below). Gap `--space-5 --space-6`.
- Step 1: `first_name` | `last_name` on one row; `gender` on the next row, full width (`.auth-grid__full`).
- Step 2: `street` full; `city` | `state`; `zip_code` | `country`.
- Step 3: `document_number` full; `document_photo` full.
- Stacking order and tab order match the visual order.

### 5.6 Radio option row (questionnaire)

Not a card. The row is a full-width label with hairlines, and the indicator is a radio drawn with CSS.

- Container `.questionnaire-options`: no gap, no border. Each `label.questionnaire-option` has:
  - `min-block-size: 3.5rem` (56px, well over 44px)
  - `padding-inline: var(--space-3)` at the start and `var(--space-2)` at the end
  - `border-block-end: 1px solid var(--color-border)`; the first row also has `border-block-start`
  - `gap: var(--space-4)`
- Indicator: `input[type=radio]` with `appearance: none`, 1.25rem (20px) circle, `border: 1.5px solid var(--onb-line)`.
  Checked: `background: var(--color-accent)` and `box-shadow: inset 0 0 0 4px var(--color-surface)` (a red
  dot with a surface ring). The indicator is never color-only, because the checked state also gets the edge bar and the 600 weight.
- Selected row: 2px accent edge on the inline-start side (`::before`, full row height, `--color-accent`),
  label weight 600.
- Hover: row background `--onb-row-hover`. Only when `(hover: hover)`.
- Focus-visible: 2px outline on the radio itself (`--color-focus`, 3px offset). Keyboard focus is visible without a row ring.
- Active (pressed): no extra effect beyond the checked state.
- Disabled (during submit): row `opacity: .5`, `cursor: not-allowed`.
- Text: label text in `span`, 1rem, 500. Long answers wrap; the indicator aligns to the first line (`align-items: flex-start` with the indicator at `margin-block-start: .2em`) when the text is more than one line.
- Forced colors: `input[type=radio] { appearance: auto }` restores the native radio.
- RTL: the edge bar uses `inset-inline-start`; `gap` is logical.

### 5.7 Question position indicator

- `p#questionnaire-position` (existing) is made visible: overline style, text `Question N of 3`. It replaces the visually hidden line.
- Segments: `.questionnaire-dots` (`aria-hidden`) holds three `span.questionnaire-dot` elements. Each is
  a 2px high by 2rem wide bar. Classes: `.is-active` (accent), `.is-done` (signal), default `--color-border-strong`.
  The segments are decorative. The text says the position.

### 5.8 ID document dropzone

Replaces `.file-upload-wrapper` / `.file-upload-label`. The `label` keeps `id="file-upload-label"` and `for="document_photo"`.

- The file input is visually hidden with `.sr-only`. **It must be focusable** (the old `left:-9999px` made it unreachable by keyboard).
  The focus ring is shown on the dropzone: `.onb-dropzone:has(#document_photo:focus-visible)`.
- Structure (ruled area, not a box with a fill):
  - `min-block-size: 9rem`, padding `--space-5`
  - `border: 1px dashed var(--onb-line)`, `border-radius: var(--radius-md)`, no background fill
  - content row: upload icon (24px, 1.5px stroke, `--color-text-muted`), then text block at the inline start
  - line 1: "**Click to upload** or drag and drop" (`--color-text`, 600 for the first phrase)
  - line 2: "PNG or JPG, up to 5 MB" (`--text-xs`, `--color-text-muted`)

**States:**

| State | Visual |
|---|---|
| Default (empty) | dashed hairline `--onb-line`, text as above |
| Hover | border `--color-text-muted` → `--color-text`, 160ms (pointer only) |
| Focus-visible | 2px `--color-focus` outline, 3px offset, on the dropzone |
| Active (press) | none extra |
| Drag-over | border solid `--color-accent`, background `--onb-drag-tint`. Toggled with class `is-dragover` (JS change, section 9) |
| Disabled (during submit) | `opacity: .5`, `pointer-events: none` |
| Loading (reading the file) | line 1 becomes "Reading photo..." and `aria-busy="true"`. FileReader is usually instant, so this is brief |
| Error | border dashed `--color-loss`; error text below with icon: see copy deck (E-P1 to E-P3) |
| Success | the dropzone is replaced by the preview (5.9) |
| Empty | same as default. The message explains what to upload |
| Overflow | none. Long file names are not shown |

### 5.9 Photo preview

Shown when a file is read. Replaces the dropzone (existing `display` toggle).

- `#file-preview` contains `img#preview-image` (`alt="Preview of your ID document"`),
  `inline-size: 100%`, `max-block-size: 14rem`, `object-fit: contain`, 1px `--color-border` frame, radius `--radius-sm`,
  background `--color-surface`.
- Caption row under the image, `display: flex; justify-content: space-between`:
  - left: "Photo added." with a check icon in `--color-gain` (text stays `--color-text-muted`)
  - right: `button#change-photo.text-btn` with text "Change photo". `min-block-size: 2.75rem` (44px). It resets the input and shows the dropzone again.
- States:
  - Loaded: the image and caption above.
  - Changing: the dropzone returns with focus on the file input (JS change).
  - Image failed to load: the frame shows the message E-P4 in place of the image; "Change photo" stays.

### 5.10 Note / alert (KYC note)

Static row, not a box. Replaces `.alert.alert-info`.

- `div.onb-note`: `display: grid; grid-template-columns: auto 1fr; gap: var(--space-3)`.
  Top and bottom hairlines `--color-border`. Icon: info (1.5px, `--color-link`). Text: `--text-small`, `--color-text`.
- "Note:" is `<strong>`. Copy unchanged.
- No background, no radius, no left bar.

### 5.11 Action row

- `div.onb-actions`: `display: flex; justify-content: space-between; align-items: center; gap: var(--space-3)`.
  Hairline top (`--color-border`), padding-block-start `--space-5`, margin-block-start `--space-6`.
  Logical properties mean the layout mirrors in RTL.
- Left: secondary. Back, or "Skip for now" on step 1. Class `.btn.btn--outline.btn--lg`. "Skip for now" is an
  anchor (`href="/dashboard"`), not an inline `onclick`. Back buttons stay `button` with ids.
- Right: primary. Class `.btn.btn--lg`, with the arrow icon (`.btn__arrow`, flips in RTL through existing CSS).
- Height 3.5rem (56px). Labels are `white-space: normal` under 60rem so long German and Russian labels wrap inside the button.

**Button states (primary):**

| State | Visual |
|---|---|
| Default | `--color-accent` background, `--color-on-accent` text |
| Hover (pointer) | `--color-accent-hover`, red glow (existing `.btn:hover`), arrow nudges 3px |
| Focus-visible | 2px `--color-focus` outline, 2px offset (existing base rule) |
| Active | `translateY(1px)` (existing) |
| Disabled | `opacity .5`, `cursor: not-allowed`. Used on Back during submit |
| Loading | `aria-busy="true"` and the existing spinner (`.btn[aria-busy="true"]::after`). Disabled while busy. The label stays |
| Success | no button state. The next step renders |
| Error | none on the button. The error sits in the alert line (5.12) |

**Secondary:** same states with `btn--outline`: hover adds `--color-text` border; disabled and loading as primary.

**Sticky on mobile (< 60rem):**
- `position: sticky; inset-block-end: 0;` with `background: var(--color-bg)`, hairline top, padding-block
  `--space-3` plus `env(safe-area-inset-bottom)`.
- The form gets `padding-block-end` equal to the bar height plus `--space-4` so the last field is never hidden.
- Focused fields get `scroll-margin-block-end: 7rem` so the browser never scrolls them under the bar.
- Primary button width: `flex: 1 1 auto`. Back: `flex: 0 0 auto`, `min-inline-size: 7rem`.
- At 320px the content width is about 272px. Two buttons still fit. Long labels wrap to two lines inside a 56px button (padding-block `--space-3`).

### 5.12 Form-level alert (server and validation summary)

- `p.field__error.onb-alert[role="alert"][hidden]`, placed directly above the action row in each form.
- Shows the icon and the message text. Used for API errors (`data.detail`) and for "Please fill in all required fields" if it is kept.
- Message stays until the next submit. The user's input is kept.
- Field-level errors (5.3) are the primary channel. This line is only for errors not tied to one field.

### 5.13 Questionnaire option errors

- `p.questionnaire-error#q-error-N[role="alert"][hidden]` (existing). Shown under the last row of the view,
  with the circle icon and text E-Q1 (section 10). Color `--color-loss`, 600 weight.

### 5.14 Completion dialog

Uses the existing `.dialog` (16px radius, `--shadow-float`, ink-tinted, the one elevated surface).

- `dialog#onb-complete.dialog[aria-labelledby="onb-complete-title"]`. Opened with `showModal()`.
- Head: `.dialog__head` with `h2.dialog__title#onb-complete-title[tabindex="-1"]` "Verification submitted".
  No close button.
- Body (`.dialog__body`, `display: grid`, gap `--space-4`):
  1. `p` in `--text-h3` 700: "Thank you for completing your investment profile!"
  2. `p`: "Your information is currently under review by our team."
  3. `.onb-pending`: a ruled row, hairline top and bottom, clock icon (`--color-pending`), text in `--color-text`
     600: "Approval typically takes less than 24 hours". No amber box, no left bar, no background.
  4. `p.muted`: "You will receive a notification once your account has been approved and you can start trading."
- Foot: `.dialog__foot`. One button, `button.btn.btn--lg#onb-complete-continue` "Continue" with the arrow.
  Full width under 40rem (`.btn--block`), right-aligned above that.
- Escape and backdrop clicks are prevented (`cancel` event `preventDefault`, no `closedby` light dismiss). This is the existing behavior.
- Focus: opens with focus on the Continue button. The heading is announced first because it is the dialog's name.
- Motion: the existing `.dialog` opening transition (280ms). Reduced motion: none.
- Backdrop: `.dialog::backdrop` existing (ink at 70%, blur 3px).

### 5.15 Toast (success and general errors)

- Existing `.toast-region` and `.toast`. Success uses `role="status"`, error uses `role="alert"`.
- Copy for success is the existing JS string. Example: "Personal information saved!"
- The toast replaces the Swal popup that `TED_AUTH.showSuccess` / `showError` open today. See section 9.

### 5.16 Loading overlay

- No full-page overlay. The old `TED_AUTH.showLoading` (a modal) is replaced by the button loading state (5.11).
  Reason: a modal over the form adds focus-trap work and blocks reading of the current copy.

---

## 6. Token mapping

### 6.1 Reuse (no change)

| Need | Existing |
|---|---|
| Shell | `.auth`, `.auth__visual`, `.auth__form`, `.auth__top`, `.auth__panel`, `.auth__panel--wide`, `.auth__foot` (public.css) |
| Surfaces | `.surface-ink`, `.surface-paper` (tokens.css) |
| Brand and visual | `.wordmark`, `.site-lang`, `.mesh`, `canvas.dotfield`, `.live-dot` |
| Head | `.auth-head`, `.overline`, `.overline--signal`, `.auth-headline`, `.auth-subline` |
| Rail | `.auth-steps`, `.auth-steps__item`, `.auth-steps__num`, `.auth-steps__title`, `.auth-steps__text` (auth.css), `.tag`, `.tag--gain`, `.tag--accent`, `.tag--pending` (components.css) |
| Fields | `.auth-form`, `.auth-grid`, `.auth-grid__full`, `.field`, `.field__label`, `.field__control`, `.field__input`, `.field__select`, `.field__help`, `.field__error`, `.sr-only`, `.muted` |
| Buttons | `.btn`, `.btn--lg`, `.btn--outline`, `.btn--block`, `.btn__arrow`, `.text-btn` |
| Dialog and toast | `.dialog`, `.dialog__head`, `.dialog__title`, `.dialog__body`, `.dialog__foot`, `.toast-region`, `.toast` |
| Motion | `rise` keyframe, `--duration-base`, `--ease-out`, `--ease-in` |
| Radius, space, text | `--radius-sm`, `--radius-md`, `--radius-lg`, `--space-*`, `--text-*`, `--font-*` |

### 6.2 New classes (page-scoped, in `@layer pages`, file `assets/css/pages/onboarding.css`)

| Class | Purpose |
|---|---|
| `.onb-form` | scope for dark token overrides and form layout |
| `.onb-visual__body` | ink panel body that stays visible on mobile (rail lives here) |
| `.onb-rail` | modifiers on `.auth-steps`: dot states, mobile segments |
| `.onb-step__state` | the inline `● CURRENT` / `● COMPLETE` tag inside the title |
| `.onb-title` | step h1 spacing (uses `.auth__panel h1` size) |
| `.onb-actions` | action row, sticky under 60rem |
| `.onb-note` | KYC note row |
| `.onb-dropzone` | ruled dashed area for the photo |
| `.onb-preview` | preview frame and caption row |
| `.onb-alert` | form-level error line (adds spacing only; uses `.field__error`) |
| `.onb-pending` | ruled row for "Approval typically takes..." in the dialog |
| `.onb-complete` | dialog body text hierarchy |

Keep the existing `questionnaire-*` class names. Only restyle them. Do not rename them.

### 6.3 New page tokens (minimal, three, declared on `.onb-form` in `pages/onboarding.css`)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--onb-line` | `var(--color-text-muted)` (#55657A, 5.95:1 on white) | `var(--color-text-muted)` (#9AA9BD, 7.6:1 on ink-900) | field underlines, radio ring, dropzone dash. Non-text boundary, 3:1+ |
| `--onb-row-hover` | `color-mix(in oklch, var(--color-text) 4%, transparent)` | same | option row hover tint |
| `--onb-drag-tint` | `color-mix(in oklch, var(--color-accent) 6%, transparent)` | same | dropzone drag-over fill |

### 6.4 Dark mode override set (`.onb-form` only)

The auth shell is light-only today: `:root` and `.surface-paper` are paper, and dark tokens exist only
under `.surface-ink`. So a `data-theme="dark"` page does not darken the form panel. The onboarding page
fixes this locally, without changing the shared tokens:

```css
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .onb-form { /* set below */ } }
:root[data-theme="dark"] .onb-form { /* set below */ }
.onb-form (dark) {
  --color-bg: var(--ink-900);          /* #0A1626 */
  --color-surface: var(--ink-800);     /* #11223A */
  --color-surface-2: var(--ink-850);
  --color-text: #EEF2F7;
  --color-text-muted: var(--slate-400);/* #9AA9BD, 7.6:1 */
  --color-border: var(--ink-600);      /* #22344D, hairline, decorative */
  --color-border-strong: var(--ink-500);
  --color-accent: var(--red-400);      /* #FF4A52, DESIGN dark accent */
  --color-accent-hover: color-mix(in oklch, var(--red-400), white 12%);
  --color-accent-text: var(--red-400); /* 5.5:1 on ink-900 */
  --color-on-accent: var(--ink-900);   /* NOT white: white on #FF4A52 is 3.31:1 */
  --color-focus: var(--teal-300);      /* 11.6:1 */
  --color-link: var(--navy-300);
  --color-signal: var(--teal-300);
  --color-gain: var(--teal-300);
  --color-loss: var(--loss-400);       /* 6.6:1 */
  --color-pending: var(--amber-400);   /* 9.9:1 */
  color-scheme: dark;
}
```

**Why `--color-on-accent` is overridden.** The shared `.surface-ink` sets white text on the red button. White on
#FF4A52 is 3.31:1, which fails AA for 15px semibold text. Ink-900 on #FF4A52 is 5.50:1. The same problem exists
on the dashboard and should be fixed globally (open question O5).

**Light mode** uses the default `.surface-paper` tokens. Light values checked: ink-900 on paper-50 17.1:1;
muted 5.6:1; white on red-500 4.58:1 (button, passes but barely); red-600 text 5.55:1; teal-700 signal 4.59:1;
amber-700 pending 5.11:1; loss-600 5.29:1; navy focus 8.33:1.

### 6.5 Contrast summary (checked pairs)

| Pair | Ratio | Result |
|---|---|---|
| Body text, light | 17.1:1 | pass |
| Muted text, light (paper-600 on paper-50) | 5.6:1 | pass |
| Field underline, light (paper-300, old) | 1.53:1 | fail, replaced by `--onb-line` (5.95:1) |
| Primary button text, light (white on red-500) | 4.58:1 | pass |
| Primary button text, dark (white on red-400) | 3.31:1 | fail, use ink-900 (5.50:1) |
| Primary button text, dark (ink-900 on red-400) | 5.50:1 | pass |
| Body text, dark | 16.2:1 | pass |
| Muted text, dark | 7.6:1 | pass |
| Field underline, dark (ink-500, old) | 2.05:1 | fail, replaced by `--onb-line` (7.6:1) |
| Focus ring, dark (teal-300) | 11.6:1 | pass |
| Error text, dark (loss-400) | 6.6:1 | pass |
| Hairlines (decorative) | 1.2–1.5:1 | allowed: not required to carry meaning |

---

## 7. Copy deck

Final text. Sentence case. US spelling. Existing strings are kept where they carry meaning. Changes are
listed in the "Was" column. Strings marked **JS** are JS-owned: they stay as the code has them, unless
noted in section 9.

### 7.1 Document and shell

| Key | Copy | Was |
|---|---|---|
| Title | Complete your profile — TED Brokers | Complete Your Profile \| TED Brokers |
| Meta description | Complete your TED Brokers account: personal details, address, identity verification and investment profile. | Account Onboarding |
| Skip link | Skip to form | (none) |
| Top-right link | Need help? Help centre → (link to `help.html`) | (none) |
| Panel aria-label (section) | Account setup progress | (none) |
| Form section aria-label | Complete your profile | (none) |
| Overline (ink) | Account setup | (none) |
| Headline (ink) | Four short steps to finish your account. | (none) |
| Ink foot | Each step is saved when you continue. Your investment profile is sent once, at the end. | (none) |

### 7.2 Rail

| Item | Title | Description | State text |
|---|---|---|---|
| 01 | Personal info | Name and gender | CURRENT / COMPLETE |
| 02 | Address | Residential address | |
| 03 | ID verification | Document number and photo | |
| 04 | Investment profile | Three questions about you | |

Was: "Personal Info", "Address", "ID Verification", "Investment Profile". Sentence case only.

### 7.3 Step 1: Personal information

- Progress: `Step 1 of 4`
- h1: Personal information (was "Personal Information")
- Intro: Use the name on your ID document. Fields marked * are required.
- Labels: First name * · Last name * · Gender *
- Gender placeholder: Select gender (was "Select Gender")
- Options: Male · Female · Others (values unchanged)
- Helper (above actions): Skipping is optional for now. You will need these details before your account can be approved.
- Actions: Skip for now (link) · Next →
- Errors:
  - E-1a: Enter your first name.
  - E-1b: Enter your last name.
  - E-1c: Select your gender.
- Success toast (JS): Personal information saved!
- Loading (JS): Saving personal information...

### 7.4 Step 2: Address

- Progress: Step 2 of 4
- h1: Address
- Intro: Enter your current residential address. Fields marked * are required.
- Labels: Street address * · City * · State or province * · ZIP or postal code * · Country *
  (was "State/Province", "ZIP/Postal Code")
- Errors:
  - E-2a: Enter your street address.
  - E-2b: Enter your city.
  - E-2c: Enter your state or province.
  - E-2d: Enter your ZIP or postal code.
  - E-2e: Enter your country.
- Actions: ← Back · Next →
- Success toast (JS): Address information saved!
- Loading (JS): Saving address information...

### 7.5 Step 3: Identity verification

- Progress: Step 3 of 4
- h1: Identity verification
- Intro: Upload a clear photo of a valid ID document.
- Label: ID document number *
- Placeholder (existing): Enter your passport, driver's license, or national ID number
- Helper: Use the number printed on the document you upload below.
- Error: E-3a: Enter your document number.
- Label: ID document photo *
- Dropzone line 1: **Click to upload** or drag and drop (was "Click to upload")
- Dropzone line 2: PNG or JPG, up to 5 MB (was "PNG, JPG (MAX. 5MB)")
- Dropzone reading: Reading photo...
- File errors (inline under the dropzone; replace the old toasts):
  - E-P1: Choose an image file, such as PNG or JPG. (was "Please select an image file")
  - E-P2: The file must be smaller than 5 MB. (was "File size must be less than 5MB")
  - E-P3: Upload a photo of your ID document. (was "Please upload a photo of your ID document")
  - E-P4: This photo could not be shown. Choose another file.
- Preview alt: Preview of your ID document
- Caption: Photo added.
- Button: Change photo
- Note: **Note:** Please ensure your document photo is clear and all information is readable. (unchanged)
- Actions: ← Back · Save and continue → (was "Submit": the step saves and moves on, it does not submit)
- Loading (JS): Submitting verification documents...

### 7.6 Step 4: Investment profile

- Progress: Step 4 of 4
- h1: Investment profile
- Intro: Help us understand your investment preferences. Answer three questions. Your answers are submitted together at the end.
- Position overline: Question 1 of 3 (also 2 of 3, 3 of 3)

**View 1: risk tolerance**
- h2: What is your investment risk tolerance?
- Description: Select the level of risk you are comfortable with.
- Options: Very Low · Low · Moderate · High · Very High
- Error: E-Q1: Please select an option to continue.
- Actions: ← Back (returns to step 3) · Next →

**View 2: annual income**
- h2: What is your annual income?
- Description: Select the range that best describes your annual earnings.
- Options (text unchanged): Less than $10,000 · $10,000 - $50,000 · $50,000 - $100,000 · $100,000 - $1,000,000 · More than $1,000,000
- Error: E-Q1 (same)
- Actions: ← Back · Next →

**View 3: employment status**
- h2: What is your employment status?
- Description: Select the option that best describes your current status.
- Options: Unemployed · Self-Employed · Part Time · Full Time · Retired
- Error: E-Q1 (same)
- Actions: ← Back · Submit for review → (was "Submit")
- Loading (JS): Saving your investment profile...

### 7.7 Completion dialog

- Title: Verification submitted (was "Verification Submitted!")
- Line 1: Thank you for completing your investment profile!
- Line 2: Your information is currently under review by our team.
- Pending row: Approval typically takes less than 24 hours
- Line 3: You will receive a notification once your account has been approved and you can start trading.
- Button: Continue

### 7.8 Global errors

- E-G1: Something went wrong. Your answers are still here. Try again. (fallback when the server gives no message)
- Server messages: pass through `data.detail` when it is a string (existing behavior).

### 7.9 Copy rules applied

- No "school project", "simulated", "demo" or "sample" wording.
- No urgency words ("hurry", "limited", "only").
- No promises about approval time beyond the existing "typically less than 24 hours".
- "Skip for now" is explained as optional. The helper says what is still needed.
- Buttons name the action: "Next", "Save and continue", "Submit for review", "Continue".

---

## 8. Motion spec

| Motion | Spec | Reduced motion |
|---|---|---|
| Step entrance (`.step-content.active`) | `rise` keyframe: opacity 0 → 1, translate 12px → 0; 280ms `--ease-out`. No exit animation (the old step is hidden at once) | No animation. Final state immediately |
| Question entrance (`.questionnaire-view` when `hidden` is removed) | same as step entrance | No animation |
| Focus move on step change | none (the heading is focused with `preventScroll`) | same |
| Scroll to top on step change | existing `scrollTo` smooth (already reduced-motion aware) | `auto` |
| Rail dot color | 280ms `--duration-base`, color only | none |
| Rail segment color (mobile) | 280ms, color only | none |
| Question segment (`.questionnaire-dot`) | 160ms background | none |
| Field underline on hover/focus | 160ms border-color | none |
| Radio check | 160ms background | none |
| Dropzone border and fill (hover, drag-over) | 160ms | none |
| Primary button hover (glow, arrow 3px) | existing 160ms transform/box-shadow | existing `base.css` rule sets durations to 0.01ms |
| Dialog open | existing `.dialog` 280ms opacity and translate, `@starting-style` | none (existing global rule) |
| Mesh and dotfield in the ink panel | existing decorative motion | must render static under reduced motion. Verify `main.js` honors it (open question O6) |

**Rules.** Animate only opacity and transform. Use `--ease-out` for entering. No animation runs on
input (typing). No animation delays a button press. The base `prefers-reduced-motion` rule already
collapses durations, but the page CSS also sets `animation: none` on `.step-content` and
`.questionnaire-view` to be explicit.

---

## 9. Behavior contract (ids, names, data attributes)

### 9.1 Keep unchanged (do not rename)

- Forms: `#personal-info-form`, `#address-form`, `#kyc-form`, `#questionnaire-form`
- Fields: `#first_name`, `#last_name`, `#gender`, `#street`, `#city`, `#state`, `#zip_code`, `#country`,
  `#document_number`, `#document_photo` (`name` attributes too)
- Radio groups: `name="risk_tolerance"`, `name="annual_income"`, `name="employment_status"` with the existing `value` attributes
- Steps: `.wizard-step[data-step="1..4"]` (exactly four, in order), `.step-content[data-step="1..4"]`
- Buttons: `#btn-back-address`, `#btn-back-kyc`, `#questionnaire-submit`, `#change-photo`, `button[data-q-action="back|next"]`
- Dropzone and preview: `#file-upload-label`, `#file-preview`, `#preview-image`
- Questionnaire: `.questionnaire-view[data-view="1..3"]`, `#q-heading-N`, `#q-error-N`, `#q-desc-N`,
  `.questionnaire-dot[data-dot="1..3"]`, `#questionnaire-position`
- Progress: `#progress-indicator`, `#current-step`
- Classes the JS toggles: `active`, `completed` (on `.wizard-step`), `is-active`, `is-done` (on dots), `hidden` (on views)

### 9.2 Proposed JS changes (small; the builder makes them, the design only specifies them)

1. **Step focus.** In `goToStep(step)`, after showing the step, focus `.step-content[data-step="N"] h1` with
   `{ preventScroll: true }`. Makes step changes announced to screen readers.
2. **Progress live region.** `#progress-indicator` gets `aria-live="polite"` in markup (no JS change).
3. **Drag state.** Replace `fileLabel.style.background` in dragover/dragleave/drop with `classList.toggle('is-dragover', ...)`.
   Remove the hard-coded hex values.
4. **Inline validation.** Add `novalidate` to the four forms. Validate in JS. On failure, set `data-invalid="true"`
   on the `.field`, set `aria-invalid="true"` on the input, and show the `.field__error` message text.
   Add `aria-describedby` linking input → help and error. Replace the `TED_AUTH.showError(...)` validation
   toasts with these inline errors. Keep the submit flow unchanged.
5. **Form-level errors.** Server errors go to `.onb-alert[role="alert"]` above the actions, not to a Swal modal.
6. **Loading.** Replace `TED_AUTH.showLoading` / `closeLoading` with `aria-busy="true"` on the submitting button and
   `disabled` on the form's buttons. This also removes the Swal dependency for loading.
7. **Dialog.** Replace `Swal.fire(...)` with the native `#onb-complete` dialog. Prevent `cancel`. Open with
   `showModal()`. The Continue button calls `goToNextStep()`. Remove the sweetalert2 `<script>` tag only if no
   other code on this page uses it (`TED_AUTH.showSuccess` and `showError` in `auth.js` also use Swal; if the
   page keeps those for API toasts, keep the script or move to `.toast`).
8. **Dropzone focus.** Make the file input focusable (`.sr-only`), not off-screen.
9. **Dropzone and file errors.** Show E-P1 to E-P3 inline under the dropzone (new element `#document_photo-error`,
   `.field__error`, `role="alert"`) instead of toasts.
10. **Image error.** Set `previewImage.onerror` to show E-P4 and keep "Change photo".
11. **Skip link.** The "Skip for now" anchor replaces `onclick="window.location.href='/dashboard'"`.
12. **Scripts and head.** Remove Bootstrap, jQuery, Font Awesome, `custom-theme.css`, `style.css`, `plugins.css`,
    and the Bootstrap `<style>` block. Load the same stack as `login.html`: `main.css`, `pages/auth.css`,
    `pages/onboarding.css` (new), the Market Pulse font link, the theme init script, and `main.js` (module).

### 9.3 New ids (proposed, minimal)

- `#document_photo-error` (E-P1 to E-P3)
- `#onb-complete` and `#onb-complete-title`, `#onb-complete-continue` (replace Swal)

---

## 10. Icons

Lucide-style, 1.5px stroke, 24 viewBox, `fill="none"`, `stroke="currentColor"`, `aria-hidden="true"`,
`focusable="false"`. Sizes: 16px (inline with text), 20px (rail or row), 24px (dropzone).

| Icon | Use | Paths (24 viewBox) |
|---|---|---|
| arrow-right | Next, Save and continue, Continue, Submit for review | `M5 12h14` `M12 5l7 7-7 7` |
| arrow-left | Back | `M19 12H5` `M12 19l-7-7 7-7` |
| check | Photo added, complete | `M20 6 9 17l-5-5` |
| info | KYC note | circle `cx12 cy12 r10`; `M12 16v-4`; `M12 8h.01` |
| circle-alert | Field and group errors | circle `cx12 cy12 r10`; `M12 8v4`; `M12 16h.01` |
| upload | Dropzone | `M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4` `M17 8l-5-5-5 5` `M12 3v12` |
| clock | Approval row in dialog | circle `cx12 cy12 r10`; `M12 6v6l4 2` |
| help-circle | none in this page | (not used) |

Remove every Font Awesome icon (`fa-cloud-upload`, `fas fa-clock`, `fa-info-circle`). No emoji anywhere.

Icons never carry meaning alone. Each has text beside it.

---

## 11. Accessibility notes

### 11.1 Heading structure

- One h1 per step, inside each `.step-content`. Only the visible step's h1 is in the accessibility tree.
- Questionnaire question headings are h2, inside `legend` (valid in HTML).
- The ink headline is a `p`, not a heading. It is marketing context, and the page's real title is the step h1.
- Document title updates per step is **not** required (one document title is fine for the wizard).
  Optional enhancement: `document.title = "Step N of 4: <title> — TED Brokers"`. Not required.

### 11.2 Step announcement

- Rail: `ol[aria-label="Onboarding steps"]`, `aria-current="step"` on the current `li` (existing JS).
- Complete state is spoken through the generated "Complete" text (section 4).
- Progress line `#progress-indicator` is `aria-live="polite"`. It announces "Step 2 of 4".
- On step change the new h1 receives focus, so the title is announced. Focus is not moved on the first
  paint of the page; it stays on the skip link or on the document.

### 11.3 Focus moves

| Event | Focus target |
|---|---|
| Step change (Next, Back, resume) | new step's h1 (`tabindex="-1"`) |
| Questionnaire view change | `#q-heading-N` (existing) |
| Validation error on Next (view) | the error `p` is announced via `role="alert"`; focus stays on the Next button |
| Form field error on submit | the first invalid field (focus), error announced by `role="alert"` on the field error |
| Dialog open | Continue button; dialog name = title |
| Dialog closes (Continue) | navigation, no focus restore needed |

### 11.4 Fields and errors

- Every input has a visible `label` element. Placeholder is never the only label.
- Required: `required` attribute plus visible `*`. The `*` is `aria-hidden`, and the form intro says "Fields marked * are required."
- Helper and error: `aria-describedby` lists helper id and error id. The error `p` has `role="alert"` only when shown
  (it is `hidden` otherwise, so the alert fires only when content is injected).
- Radio groups: `fieldset` plus `legend` (the h2). `aria-describedby` points to the description and the error.

### 11.5 Targets and focus

- Touch targets: fields 48px high, primary and secondary buttons 56px, radio rows 56px, "Change photo" 44px, rail items not interactive.
- Focus ring: 2px, offset 2px (3px on radio and dropzone). Never removed without replacement.

### 11.6 Color and forced colors

- Status (current, complete, error, pending) always has a word plus a color.
- `forced-colors`: rail dots use `currentColor` background, radio uses native `appearance: auto`, dropzone border keeps its dash, field underlines keep the border.

### 11.7 RTL

- All spacing and edges use logical properties (`inset-inline-start`, `padding-inline`, `margin-block`).
- The radio edge bar and the rail connector use the logical edges.
- Back and Next arrows flip with the existing `[dir="rtl"] .btn__arrow` rule.
- Numbers (`01`–`04`, `1 of 3`) stay LTR in a mono span with `unicode-bidi: isolate`.

### 11.8 Motion

- Reduced motion: section 8.

### 11.9 Language

- `<html lang="en" dir="ltr">` (set `lang` from the site's language switch if the language script is used).

---

## 12. Risks for the implementer and open questions

**Risks.**
- R1. **"Skip for now" may loop.** It goes to `/dashboard`. `dashboard.js` sends incomplete accounts to
  `/onboarding` (lines ~476 and ~535, not fully verified). If it does, the button is a dead end. The
  helper copy is honest only if the dashboard lets an incomplete account in. Verify before shipping.
- R2. **`TED_AUTH.showError` / `showSuccess` use Swal** (`auth.js`). The validation and API errors in
  `onboarding.js` go through them, so the Swal popup can return even after the restyle. Section 9.2 items 4–6 fix it on this page only.
- R3. **Dark mode for the auth shell is not global.** The form panel is paper-only today. The override in 6.4 is page-scoped. Login and register have the same gap.
- R4. **Field underline contrast.** The new `--onb-line` is darker than login and register. Visual inconsistency across the auth pages is intended, and login and register should move to the same token later.
- R5. **Autofill in dark mode** can paint light backgrounds. The `:autofill` rule in 5.3 mitigates it. Test in Chrome and Safari.
- R6. **`[hidden]` vs `display`.** `.questionnaire-view[hidden]` and `.step-content` are toggled by `hidden` and by `.active`. Do not set `display` on those selectors without `:not([hidden])` or without the class check, or the views stop hiding.
- R7. **`.field__error` is `display:none` by default** and only shows with `data-invalid` or `aria-invalid`. The form-level `.onb-alert` must add `display: flex` when shown, or it will stay hidden.
- R8. **Sticky action row on iOS** needs `env(safe-area-inset-bottom)`. Test on a notched device. Check it does not cover the keyboard-focused field.
- R9. **German, Russian and Arabic labels.** Long button labels wrap (section 5.11). The h1 uses `text-wrap: balance`. The rail titles wrap. Test with 2× zoom and 320px.
- R10. **Dotfield canvas** must stop under reduced motion (O6).
- R11. **Long-press and copy-paste** into the document number field: no special handling needed. The field allows the full string.

**Open questions for the client (not decided here).**
- O1. Keep "Skip for now", or remove it if R1 is confirmed? Current recommendation: keep only if the dashboard lets the account in; otherwise remove it and keep Back.
- O2. Keep the chat support widget on this page? Login and register do not load it. The spec drops it for consistency. Keep if support needs it.
- O3. Should the rail let users go back to a completed step? Not in scope. Would need JS and a warning if the step is changed later.
- O4. "Others" as a gender value. Kept as-is for data compatibility. The label may read better as "Other" (needs backend confirmation).
- O5. The dark-mode primary button text (white on red-400, 3.31:1) fails AA on the dashboard too. Global fix recommended: `--color-on-accent: var(--ink-900)` in `.surface-ink`. Confirm before changing shared tokens.
- O6. Confirm `main.js` stops the dotfield and mesh under `prefers-reduced-motion`.
- O7. Country is free text. A country select would prevent typos, but it changes the data contract. Not changed here.
- O8. Should the completion dialog offer any action other than Continue (for example, "Back to step 4" when an answer is wrong)? Not in the original flow. Not added.

---

## 13. Checklist (DESIGN.md section 9 applied)

- [x] One primary action per view (red button, right). Secondary is outlined, left.
- [x] Hierarchy: overline, h1, intro, fields, actions. Blur test: the h1 and the red button read first.
- [x] Only existing tokens, plus three page tokens (6.3) and the dark override set (6.4).
- [x] Type: Sora for headings, DM Sans for text, JetBrains Mono for numerals and overlines. Two families per element.
- [x] Contrast pairs checked in both themes (6.5). The two fails found are fixed.
- [x] States designed: hover, focus-visible, active, disabled, loading, error, success, empty (sections 5.3–5.14).
- [x] 320px, 375px, 768px, 1280px, 2× zoom covered by the breakpoints (60rem, 40rem).
- [x] Targets ≥ 44px (fields 48px, buttons 56px, radio rows 56px, Change photo 44px).
- [x] Copy is specific. Buttons name the action. No dark patterns, no urgency, no fake stats.
- [x] Icons from one set (Lucide-style, 1.5px). No emoji.
- [x] Motion is purposeful and reduced-motion is handled (section 8).
- [x] No cards, no badges, no pills, no chips. Structure is hairlines, rows, rail and whitespace.
- [x] Completion moment kept as a dialog, copy unchanged except the title sentence case and the dropped "!".
