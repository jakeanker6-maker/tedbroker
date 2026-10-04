# Plan Tagging System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add flexible tagging system (Hot, Recommended, New, Popular, Featured, Trending) to all 4 plan types with admin UI, colored badge chips on plan cards, hover tooltips, and client-side filter chips.

**Architecture:** Add `tags: List[str]` field to 4 Pydantic schemas. Extend admin modals with multi-select dropdown. Render badges + filter chips in dashboard.js using inline SVGs. All changes backward-compatible.

**Tech Stack:** FastAPI, Pydantic, MongoDB (schemaless), Vanilla JS (ES6), Tailwind CSS, inline SVG icons.

---

## File Structure Map

```
app/
├── schemas.py                      # Add tags field to 4 plan schemas + TAG_CONFIG
├── routes/
│   ├── admin.py                    # Accept/return tags in CRUD endpoints
│   ├── plans.py                    # Return tags in GET responses
│   ├── etf_plans.py                # Return tags in GET responses
│   ├── defi_plans.py               # Return tags in GET responses
│   └── options_plans.py            # Return tags in GET responses

public/copytradingbroker.io/
├── admin-dashboard.html            # Add multi-select dropdown to 4 modals
├── dashboard.html                  # Add filter chip containers above 4 plan grids

assets/js/
├── admin-dashboard.js              # Handle tags in form data, populate on edit
├── dashboard.js                    # Render badges, filter chips, tooltips, TAG_CONFIG + SVGs
```

---

## Task Breakdown

### Task 1: Backend - Add tags field to schemas

**Files:**
- Modify: `app/schemas.py`

- [ ] **Step 1: Write failing test for schema validation**

```python
# tests/unit/test_schemas.py
def test_investment_plan_accepts_tags():
    from app.schemas import InvestmentPlan
    plan = InvestmentPlan(name="Test", description="Desc", minimum_investment=100, 
                          holding_period_months=6, expected_return_percent=10.0, tags=["hot", "recommended"])
    assert plan.tags == ["hot", "recommended"]

def test_investment_plan_defaults_empty_tags():
    from app.schemas import InvestmentPlan
    plan = InvestmentPlan(name="Test", description="Desc", minimum_investment=100,
                          holding_period_months=6, expected_return_percent=10.0)
    assert plan.tags == []

def test_investment_plan_rejects_invalid_tag():
    from app.schemas import InvestmentPlan
    import pytest
    with pytest.raises(ValueError):
        InvestmentPlan(name="Test", description="Desc", minimum_investment=100,
                       holding_period_months=6, expected_return_percent=10.0, tags=["invalid_tag"])
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/unit/test_schemas.py::test_investment_plan_accepts_tags -v
# Expected: FAIL - tags field doesn't exist
```

- [ ] **Step 3: Add tags field + validator to all 4 schemas**

```python
# In app/schemas.py - add to each schema class (InvestmentPlan, ETFPlan, DeFiPlan, OptionsPlan)
from typing import List
from pydantic import Field, field_validator

VALID_TAGS = {"hot", "recommended", "new", "popular", "featured", "trending"}

tags: List[str] = Field(default_factory=list)

@field_validator("tags", mode="before")
@classmethod
def validate_tags(cls, v):
    if v is None:
        return []
    if not isinstance(v, list):
        raise ValueError("tags must be a list")
    for tag in v:
        if tag not in VALID_TAGS:
            raise ValueError(f"Invalid tag: {tag}. Valid tags: {VALID_TAGS}")
    return v
```

Also add `TAG_CONFIG` dict for frontend (or keep in JS only - see Task 5).

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/unit/test_schemas.py::test_investment_plan_accepts_tags -v
pytest tests/unit/test_schemas.py::test_investment_plan_defaults_empty_tags -v
pytest tests/unit/test_schemas.py::test_investment_plan_rejects_invalid_tag -v
# Expected: All PASS
```

- [ ] **Step 5: Run all schema tests**

```bash
pytest tests/unit/test_schemas.py -v
# Expected: All PASS
```

- [ ] **Step 6: Commit**

```bash
git add app/schemas.py tests/unit/test_schemas.py
git commit -m "feat: add tags field with validation to all plan schemas"
```

---

### Task 2: Backend - Update admin routes to handle tags

**Files:**
- Modify: `app/routes/admin.py`

- [ ] **Step 1: Write failing test for admin create with tags**

```python
# tests/unit/api/test_admin_plans.py
def test_admin_create_plan_with_tags(client, admin_token):
    response = client.post("/api/admin/plans", json={
        "name": "Tagged Plan", "description": "Desc", "minimum_investment": 100,
        "holding_period_months": 6, "expected_return_percent": 10.0,
        "tags": ["hot", "recommended"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert response.status_code == 200
    assert response.json()["tags"] == ["hot", "recommended"]

def test_admin_update_plan_tags(client, admin_token, sample_plan):
    response = client.put(f"/api/admin/plans/{sample_plan.id}", json={
        "tags": ["new", "popular"]
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert response.status_code == 200
    assert response.json()["tags"] == ["new", "popular"]
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/unit/api/test_admin_plans.py::test_admin_create_plan_with_tags -v
# Expected: FAIL - tags not handled
```

- [ ] **Step 3: Update admin route models + endpoints**

In `app/routes/admin.py`:
- Update `PlanCreate`, `PlanUpdate` models to include `tags: List[str] = []`
- Same for ETF, DeFi, Options equivalents
- Ensure `tags` included in response models (already covered by schema)

```python
# In each create/update model
tags: List[str] = Field(default_factory=list)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/unit/api/test_admin_plans.py::test_admin_create_plan_with_tags -v
pytest tests/unit/api/test_admin_plans.py::test_admin_update_plan_tags -v
# Expected: PASS
```

- [ ] **Step 5: Repeat for ETF, DeFi, Options admin routes**

Same pattern for 3 other plan types.

- [ ] **Step 6: Run all admin plan tests**

```bash
pytest tests/unit/api/test_admin_plans.py -v
pytest tests/unit/api/test_admin_etf_plans.py -v
pytest tests/unit/api/test_admin_defi_plans.py -v
pytest tests/unit/api/test_admin_options_plans.py -v
```

- [ ] **Step 7: Commit**

```bash
git add app/routes/admin.py tests/unit/api/test_admin_*.py
git commit -m "feat: admin routes accept and return tags for all plan types"
```

---

### Task 3: Backend - Update frontend plan routes to return tags

**Files:**
- Modify: `app/routes/plans.py`, `app/routes/etf_plans.py`, `app/routes/defi_plans.py`, `app/routes/options_plans.py`

- [ ] **Step 1: Write failing test**

```python
# tests/unit/api/test_plans.py
def test_get_plans_includes_tags(client, user_token, sample_plan_with_tags):
    response = client.get("/api/plans", headers={"Authorization": f"Bearer {user_token}"})
    assert response.status_code == 200
    plans = response.json()
    assert any(p["tags"] == ["hot", "recommended"] for p in plans)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest tests/unit/api/test_plans.py::test_get_plans_includes_tags -v
# Expected: FAIL - tags not in response (but should auto-work since schema has it)
```

- [ ] **Step 3: Verify no code changes needed**

Since schemas already include `tags` and routes return schema objects, this should work automatically. Just verify.

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest tests/unit/api/test_plans.py::test_get_plans_includes_tags -v
# Expected: PASS (if schemas properly configured)
```

- [ ] **Step 5: Repeat for all 4 plan types**

- [ ] **Step 6: Commit**

```bash
git add app/routes/plans.py app/routes/etf_plans.py app/routes/defi_plans.py app/routes/options_plans.py
git commit -m "feat: frontend plan routes return tags field"
```

---

### Task 4: Admin Dashboard - Add multi-select tag dropdown to modals

**Files:**
- Modify: `public/copytradingbroker.io/admin-dashboard.html`
- Modify: `assets/js/admin-dashboard.js`

- [ ] **Step 1: Add multi-select HTML to each modal (4 modals)**

In `admin-dashboard.html`, inside each plan type modal form:
```html
<div class="form-group">
    <label for="planTags">Tags</label>
    <select id="planTags" name="tags" multiple class="form-select tag-multiselect" data-placeholder="Select tags...">
        <option value="hot">🔥 Hot</option>
        <option value="recommended">⭐ Recommended</option>
        <option value="new">✨ New</option>
        <option value="popular">📈 Popular</option>
        <option value="featured">💎 Featured</option>
        <option value="trending">📊 Trending</option>
    </select>
    <small class="form-text">Hold Ctrl/Cmd to select multiple</small>
</div>
```
Add to: General Plans modal, ETF Plans modal, DeFi Plans modal, Options Plans modal.

- [ ] **Step 2: Initialize Choices.js or native multi-select in admin-dashboard.js**

```javascript
// In admin-dashboard.js, after modal opens
function initTagMultiselect(selectId, existingTags = []) {
    const select = document.getElementById(selectId);
    if (select.choices) select.choices.destroy();
    select.choices = new Choices(select, {
        removeItemButton: true,
        placeholder: true,
        placeholderValue: 'Select tags...',
        searchEnabled: false,
        itemSelectText: '',
    });
    // Set existing values
    existingTags.forEach(tag => select.choices.setChoiceByValue(tag));
}
```

Call in each modal's `show` handler.

- [ ] **Step 3: Include tags in form submit data**

In each create/edit handler:
```javascript
const formData = {
    // ... existing fields
    tags: Array.from(document.getElementById('planTags').selectedOptions).map(o => o.value)
};
```

- [ ] **Step 4: Populate tags on edit**

In edit button handler, after fetching plan data:
```javascript
initTagMultiselect('planTags', plan.tags || []);
```

- [ ] **Step 5: Test manually**

Open admin dashboard → click "Add Plan" → verify multi-select works → create plan with tags → verify tags show in list → edit plan → verify tags pre-selected.

- [ ] **Step 6: Commit**

```bash
git add public/copytradingbroker.io/admin-dashboard.html assets/js/admin-dashboard.js
git commit -m "feat: admin dashboard multi-select tag dropdown for all plan types"
```

---

### Task 5: Frontend - TAG_CONFIG + SVG icons in dashboard.js

**Files:**
- Modify: `assets/js/dashboard.js`

- [ ] **Step 1: Add TAG_CONFIG object with SVGs**

```javascript
// At top of dashboard.js
const TAG_CONFIG = {
    hot: {
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 1 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 1 2.5 2.5z"/></svg>`,
        label: "Hot",
        color: "bg-gradient-to-r from-red-500 to-orange-500",
        tooltip: "Best deal on the platform in a while — limited time only"
    },
    recommended: {
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`,
        label: "Recommended",
        color: "bg-gradient-to-r from-blue-500 to-green-500",
        tooltip: "Platform's top pick — best option for you"
    },
    new: {
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
        label: "New",
        color: "bg-gradient-to-r from-purple-500 to-pink-500",
        tooltip: "Recently added to the platform"
    },
    popular: {
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>`,
        label: "Popular",
        color: "bg-gradient-to-r from-orange-500 to-amber-500",
        tooltip: "Most chosen by other investors"
    },
    featured: {
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
        label: "Featured",
        color: "bg-gradient-to-r from-yellow-500 to-amber-500",
        tooltip: "Highlighted by the platform"
    },
    trending: {
        icon: `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
        label: "Trending",
        color: "bg-gradient-to-r from-cyan-500 to-blue-500",
        tooltip: "Gaining popularity rapidly"
    }
};
```

- [ ] **Step 2: Add renderTagBadges(plan) helper function**

```javascript
function renderTagBadges(plan) {
    if (!plan.tags || plan.tags.length === 0) return '';
    return plan.tags.map(tag => {
        const config = TAG_CONFIG[tag];
        if (!config) return '';
        return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white ${config.color}" 
                     title="${config.tooltip}" 
                     role="img" 
                     aria-label="${config.label} — ${config.tooltip}">
                    ${config.icon}
                    ${config.label}
                </span>`;
    }).join(' ');
}
```

- [ ] **Step 3: Commit**

```bash
git add assets/js/dashboard.js
git commit -m "feat: add TAG_CONFIG with inline SVGs and renderTagBadges helper"
```

---

### Task 6: Frontend - Render badges on plan cards

**Files:**
- Modify: `assets/js/dashboard.js`

- [ ] **Step 1: Write failing test (visual - manual)**

Check `createPlanCard()`, `createETFPlanCard()`, `createDeFiPlanCard()`, `createOptionsPlanCard()` functions.

- [ ] **Step 2: Update each create*PlanCard function**

In each function, after plan name/header, add badge container:
```javascript
// Find the card header area (where plan name is)
const badgeHtml = renderTagBadges(plan);
if (badgeHtml) {
    // Insert after plan name or in header
    // Example for general plans:
    card.querySelector('.plan-name').insertAdjacentHTML('afterend', 
        `<div class="plan-tags flex flex-wrap gap-1 mt-1">${badgeHtml}</div>`);
}
```

Do this for all 4 card types.

- [ ] **Step 3: Update plan detail modal**

In `showPlanDetails()` / modal render function:
```javascript
// Add badges to modal header
const badgeHtml = renderTagBadges(plan);
modal.querySelector('.modal-header').insertAdjacentHTML('beforeend',
    `<div class="plan-tags flex flex-wrap gap-1 mt-2">${badgeHtml}</div>`);
```

- [ ] **Step 4: Test manually**

Open dashboard → verify badges appear on cards with tags → hover shows tooltip → modal shows badges.

- [ ] **Step 5: Commit**

```bash
git add assets/js/dashboard.js
git commit -m "feat: render tag badges on all plan cards and detail modals"
```

---

### Task 7: Frontend - Add filter chips above plan grids

**Files:**
- Modify: `public/copytradingbroker.io/dashboard.html`
- Modify: `assets/js/dashboard.js`

- [ ] **Step 1: Add filter chip container HTML in dashboard.html**

Above each of the 4 plan grid containers:
```html
<!-- General Plans Filter -->
<div class="plan-filter-chips flex flex-wrap gap-2 mb-4" data-plan-type="general">
    <button class="filter-chip px-3 py-1 rounded-full text-sm font-medium bg-primary-600 text-white" data-tag="all">All</button>
    <button class="filter-chip px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" data-tag="hot">🔥 Hot</button>
    <button class="filter-chip px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" data-tag="recommended">⭐ Recommended</button>
    <button class="filter-chip px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" data-tag="new">✨ New</button>
    <button class="filter-chip px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" data-tag="popular">📈 Popular</button>
    <button class="filter-chip px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" data-tag="featured">💎 Featured</button>
    <button class="filter-chip px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" data-tag="trending">📊 Trending</button>
</div>
```
Repeat for ETF, DeFi, Options grids with `data-plan-type="etf"`, `"defi"`, `"options"`.

- [ ] **Step 2: Add filter logic in dashboard.js**

```javascript
function initPlanFilters() {
    document.querySelectorAll('.plan-filter-chips').forEach(container => {
        const planType = container.dataset.planType;
        const chips = container.querySelectorAll('.filter-chip');
        const grid = document.getElementById(`${planType}-plans-grid`); // or similar selector
        
        chips.forEach(chip => {
            chip.addEventListener('click', () => {
                // Update active state
                chips.forEach(c => c.classList.toggle('bg-primary-600', false));
                chips.forEach(c => c.classList.toggle('text-white', false));
                chips.forEach(c => c.classList.toggle('bg-gray-100', true));
                chips.forEach(c => c.classList.toggle('dark:bg-gray-800', true));
                chips.forEach(c => c.classList.toggle('dark:text-gray-300', true));
                
                chip.classList.toggle('bg-primary-600', true);
                chip.classList.toggle('text-white', true);
                chip.classList.toggle('bg-gray-100', false);
                chip.classList.toggle('dark:bg-gray-800', false);
                chip.classList.toggle('dark:text-gray-300', false);
                
                // Filter cards
                const tag = chip.dataset.tag;
                filterPlanGrid(grid, tag);
            });
        });
    });
}

function filterPlanGrid(grid, tag) {
    const cards = grid.querySelectorAll('.plan-card');
    cards.forEach(card => {
        if (tag === 'all') {
            card.style.display = '';
        } else {
            const planTags = JSON.parse(card.dataset.tags || '[]');
            card.style.display = planTags.includes(tag) ? '' : 'none';
        }
    });
}
```

- [ ] **Step 3: Add data-tags attribute to plan cards**

In each `create*PlanCard` function:
```javascript
card.dataset.tags = JSON.stringify(plan.tags || []);
```

- [ ] **Step 4: Call initPlanFilters() on dashboard load**

```javascript
document.addEventListener('DOMContentLoaded', () => {
    // ... existing init
    initPlanFilters();
});
```

- [ ] **Step 5: Test manually**

Open dashboard → click filter chips → verify cards show/hide correctly → test all 4 plan types.

- [ ] **Step 6: Commit**

```bash
git add public/copytradingbroker.io/dashboard.html assets/js/dashboard.js
git commit -m "feat: add filter chips for tag-based plan filtering on dashboard"
```

---

### Task 8: Integration Testing & Visual Verification

**Files:**
- Test: Manual + existing test suite

- [ ] **Step 1: Run full backend test suite**

```bash
pytest tests/unit/ -v
pytest tests/integration/ -v
# Expected: All PASS
```

- [ ] **Step 2: Manual E2E test**

1. Login as admin → create General Plan with tags ["hot", "recommended"]
2. Create ETF Plan with ["new"]
3. Create DeFi Plan with ["popular", "featured"]
4. Create Options Plan with ["trending"]
5. Logout, login as regular user → open dashboard
6. Verify all 4 plan types show correct badges
7. Hover badges → verify tooltips
8. Click filter chips → verify filtering works per plan type
9. Click plan card → open modal → verify badges in modal

- [ ] **Step 3: Visual regression (screenshots)**

Capture screenshots of:
- Dashboard with all tags displayed
- Filter chips in active/inactive states
- Plan detail modal with badges
- Admin modal with multi-select
- Light + dark mode

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration test fixes and visual polish"
```

---

### Task 9: Dark Mode Contrast Check

**Files:**
- Modify: `assets/js/dashboard.js` (TAG_CONFIG colors if needed)

- [ ] **Step 1: Verify gradients meet WCAG AA in dark mode**

Check each gradient color combo against dark background (`bg-gray-900`).

- [ ] **Step 2: Adjust colors if needed**

Use Tailwind's `dark:` variants or adjust gradient stops.

- [ ] **Step 3: Commit**

```bash
git add assets/js/dashboard.js
git commit -m "fix: dark mode contrast for tag badges"
```

---

### Task 10: Final Polish & Deploy Prep

- [ ] **Step 1: Run lint/typecheck**

```bash
# If project has lint commands
npm run lint  # or equivalent
python -m mypy app/  # if using mypy
```

- [ ] **Step 2: Run full test suite one more time**

```bash
pytest tests/ -v
```

- [ ] **Step 3: Update any documentation if needed**

Check if `README.md` or API docs need tag field documentation.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete plan tagging system (hot/recommended/new/popular/featured/trending)"
```

---

## Execution Notes

- **Order matters**: Tasks 1-3 (backend) must complete before Tasks 4-7 (frontend) can fully test
- **Parallelizable**: Task 4 (admin HTML) and Task 5 (TAG_CONFIG) can run in parallel after Task 1
- **Rollback**: Each task commits independently — easy to revert single task
- **Feature flag**: Consider wrapping filter chips in `if (ENABLE_TAG_FILTERS)` for quick disable

---

## Dependencies

- **Choices.js** (or similar) for multi-select — check if already in project. If not, add via CDN or npm.
- **Tailwind CSS** — already used, gradients work out of box.
- **No new npm packages** required (inline SVGs).

---

## Estimated Effort

| Task | Est. Time |
|------|-----------|
| 1: Schemas | 30 min |
| 2: Admin routes | 45 min |
| 3: Frontend routes | 15 min |
| 4: Admin UI | 45 min |
| 5: TAG_CONFIG | 20 min |
| 6: Card badges | 30 min |
| 7: Filter chips | 45 min |
| 8: Integration test | 30 min |
| 9: Dark mode | 15 min |
| 10: Polish | 15 min |
| **Total** | **~4.5 hours** |

---

**Plan saved to `docs/superpowers/plans/2026-10-04-plan-tagging-system.md`. Ready for execution.**