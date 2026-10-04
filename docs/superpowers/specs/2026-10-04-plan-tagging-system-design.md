# Plan Tagging System Design

**Date**: 2026-10-04  
**Status**: Approved for Implementation

---

## 1. Overview

Add a flexible tagging system to all 4 plan types (General, ETF, DeFi, Options) allowing admins to mark plans with tags like "Hot", "Recommended", "New", "Popular", "Featured", "Trending". Tags display as colored badge chips on plan cards with hover tooltips, and users can filter plans by tags on the dashboard.

---

## 2. Data Model

### 2.1 Schema Changes (`app/schemas.py`)

Add to **all 4 plan schemas** (`InvestmentPlan`, `ETFPlan`, `DeFiPlan`, `OptionsPlan`):

```python
# In each schema class
tags: List[str] = Field(default_factory=list)
```

**Predefined tag constants** (in schemas.py or constants module):
```python
PLAN_TAGS = {
    "hot": "Hot",
    "recommended": "Recommended", 
    "new": "New",
    "popular": "Popular",
    "featured": "Featured",
    "trending": "Trending"
}
```

### 2.2 Database

- MongoDB is schemaless — no migration required
- New `tags` field auto-created on first write
- Existing plans default to empty array `[]`

---

## 3. Admin Dashboard

### 3.1 UI Changes (`public/copytradingbroker.io/admin-dashboard.html`)

In **each plan type modal** (create/edit):
- Add multi-select dropdown labeled "Tags"
- Options: Hot, Recommended, New, Popular, Featured, Trending
- Selected tags render as removable chips inside dropdown
- Uses existing modal structure, no new modals needed

### 3.2 JavaScript (`assets/js/admin-dashboard.js`)

- Extend form data collection to include `tags: string[]`
- Populate multi-select on edit with existing plan tags
- Validate: tags must be from predefined list (server also validates)

### 3.3 API (`app/routes/admin.py`)

- `POST /api/admin/plans` — accept `tags` in request body
- `PUT /api/admin/plans/{id}` — accept `tags` in request body  
- Same for ETF, DeFi, Options equivalents
- Return `tags` in response objects

---

## 4. Frontend Dashboard

### 4.1 Plan Card Badges (`dashboard.html` + `dashboard.js`)

**Badge rendering** in card header (top-right of each plan card):

```javascript
const TAG_CONFIG = {
  hot: { icon: FIRE_SVG, label: "Hot", color: "bg-gradient-to-r from-red-500 to-orange-500", tooltip: "Best deal on the platform in a while — limited time only" },
  recommended: { icon: STAR_SVG, label: "Recommended", color: "bg-gradient-to-r from-blue-500 to-green-500", tooltip: "Platform's top pick — best option for you" },
  new: { icon: SPARKLES_SVG, label: "New", color: "bg-gradient-to-r from-purple-500 to-pink-500", tooltip: "Recently added to the platform" },
  popular: { icon: CHART_UP_SVG, label: "Popular", color: "bg-gradient-to-r from-orange-500 to-amber-500", tooltip: "Most chosen by other investors" },
  featured: { icon: DIAMOND_SVG, label: "Featured", color: "bg-gradient-to-r from-yellow-500 to-amber-500", tooltip: "Highlighted by the platform" },
  trending: { icon: TRENDING_UP_SVG, label: "Trending", color: "bg-gradient-to-r from-cyan-500 to-blue-500", tooltip: "Gaining popularity rapidly" }
};
```

- Render as inline-flex badge chips with icon + text
- Hover shows tooltip (native `title` or custom tooltip component)
- Multiple tags wrap horizontally

### 4.2 Filter Chips (`dashboard.html` + `dashboard.js`)

Above each plan grid (4 grids = 4 filter bars):
- Horizontal scrollable chip group: `All | Hot | Recommended | New | Popular | Featured | Trending`
- `All` selected by default
- Click chip → filter cards client-side by tag presence
- Active chip: `bg-primary-600 text-white`; Inactive: `bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300`
- URL sync optional (future): `?tag=hot`

### 4.3 Plan Detail Modal

- Also display tags as badges in modal header
- Consistent with card badges

---

## 5. API Routes (Frontend)

### 5.1 Existing Routes (no breaking changes)

- `GET /api/plans` — returns `tags` array in each plan
- `GET /api/etf-plans` — same
- `GET /api/defi-plans` — same  
- `GET /api/options-plans` — same
- `GET /api/plans/{id}` — same

### 5.2 Optional Future Enhancement

Add query parameter for server-side filtering:
```
GET /api/plans?tags=hot,recommended
```
- Returns only plans matching ANY of the provided tags
- Not required for MVP (client-side filtering sufficient)

---

## 6. Icons (Inline SVG)

All SVGs embedded directly in JS — no external dependencies, no font loading.

| Tag | Icon Source | Style |
|-----|-------------|-------|
| Hot | Heroicons `fire` / Tabler `fire` | Filled flame |
| Recommended | Font Awesome `star` (solid) | Filled 5-point star |
| New | Heroicons `sparkles` | 3 sparkles |
| Popular | Heroicons `chart-bar` / Tabler `chart-line` | Bar chart up |
| Featured | Heroicons `star` outline variant | Diamond/gem shape |
| Trending | Heroicons `chart-bar` up / Tabler `trending-up` | Line trending up |

All SVGs: 16x16 or 20x20, `currentColor` for inherit text color.

---

## 7. Accessibility

- Badges: `role="img" aria-label="Hot — Best deal on the platform in a while — limited time only"`
- Filter chips: `<button role="tab" aria-selected="true/false" aria-controls="plan-grid">`
- Color contrast: WCAG AA on light/dark mode (test gradients)
- Focus visible on filter chips
- Tooltip accessible via `title` attribute + custom tooltip for longer text

---

## 8. Testing

### 8.1 Unit Tests
- Schema validation: `tags` accepts valid tags, rejects invalid
- Admin API: create/edit with tags persists correctly
- Frontend API: responses include `tags`

### 8.2 Integration Tests
- Admin creates plan with tags → appears on dashboard with badges
- Filter chips show/hide correct plans
- Hover tooltips display correct text

### 8.3 Visual Regression
- Screenshot plan cards with 0, 1, multiple tags
- Screenshot filter bar states
- Test light/dark mode

---

## 9. Rollout Plan

1. **Backend**: Add `tags` field to 4 schemas + admin routes
2. **Admin UI**: Multi-select in 4 plan modals
3. **Frontend**: Badge rendering + filter chips on dashboard
4. **Icons**: Inline SVGs in dashboard.js
5. **Test**: Unit + integration + visual
6. **Deploy**: Behind feature flag or direct (low risk)

---

## 10. Future Extensions (Out of Scope)

- Server-side tag filtering (`?tags=`)
- Tag analytics (which tags drive most conversions)
- User-facing tag preferences
- Automated tagging (ML-based "Trending" detection)
- Tag expiration dates (auto-remove "Hot" after N days)

---

## 11. Approval

- [x] Data model approach (flexible tags array)
- [x] Visual design (colored badge chips + filter chips)
- [x] Admin input (multi-select dropdown)
- [x] Tooltip text confirmed
- [x] Frontend filtering (client-side filter chips)

**Ready for implementation plan.**