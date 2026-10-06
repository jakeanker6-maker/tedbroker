# Remove Plan Filter Chips Design

**Date**: 2026-10-06  
**Status**: Approved for Implementation

---

## 1. Overview

Remove the filter chip bars ("All | Hot | Recommended | New | Popular | Featured | Trending") from all 4 plan tabs (General, ETF, DeFi, Options) in the user dashboard. Keep the tag badges displayed on individual plan cards, which already work correctly via the `renderTagBadges()` function and `TAG_CONFIG` with inline SVGs.

---

## 2. Current State

- **Filter chips**: Present in dashboard.html at 4 locations (lines ~5249, ~5312, ~5375, ~5438)
- **Tag badges**: Already implemented in dashboard.js via `TAG_CONFIG` (lines 7-44) and `renderTagBadges()` function (lines 51-64)
- **Filter logic**: `initPlanFilters()` and `filterPlanGrid()` in dashboard.js (lines 6864-6906)
- **Plan cards**: All 4 types (General, ETF, DeFi, Options) already set `data-tags` attribute and render badges via `${renderTagBadges(plan)}`

---

## 3. Changes Required

### 3.1 dashboard.html - Remove Filter Chip Bars

Remove the following 4 filter chip containers:

1. **General Plans** (line ~5249-5257): `<div class="plan-filter-chips" data-plan-type="general">`
2. **ETF Plans** (line ~5312-5320): `<div class="plan-filter-chips" data-plan-type="etf">`
3. **DeFi Plans** (line ~5375-5383): `<div class="plan-filter-chips" data-plan-type="defi">`
4. **Options Plans** (line ~5438-5446): `<div class="plan-filter-chips" data-plan-type="options">`

Each contains 7 filter chips: All, Hot, Recommended, New, Popular, Featured, Trending.

### 3.2 dashboard.js - Remove Filter Initialization

Remove or comment out:
- `initPlanFilters()` function (lines 6864-6887)
- `filterPlanGrid()` function (lines 6894-6906)
- Call to `initPlanFilters()` in DOMContentLoaded (line 6858)

### 3.3 Verify Tag Badges

Confirm all 4 plan card creation functions render tags:
- `createPlanCard()` (line 2139): `${renderTagBadges(plan)}`
- `createETFPlanCard()` (line 2432): Note - ETF plans currently DON'T render tags in card HTML
- `createDeFiPlanCard()` (line 2768): `${renderTagBadges(plan)}`
- `createOptionsPlanCard()` (line 3106): `${renderTagBadges(plan)}`

**Fix needed**: Add tag badge rendering to ETF plan cards.

---

## 4. Icon Pack

Keep current inline SVGs in `TAG_CONFIG` (dashboard.js lines 7-44). They use `currentColor` for proper theme inheritance and require no external dependencies.

---

## 5. Implementation Order

1. Remove filter chip HTML from dashboard.html (4 locations)
2. Add tag badge rendering to ETF plan cards
3. Remove filter JS code from dashboard.js
4. Test in browser

---

## 6. Testing

- Verify no filter chip bars appear on any plan tab
- Verify tag badges appear on all plan cards that have tags
- Verify badges show correct icon, color, and tooltip
- Test light/dark mode
- Test with plans having 0, 1, and multiple tags