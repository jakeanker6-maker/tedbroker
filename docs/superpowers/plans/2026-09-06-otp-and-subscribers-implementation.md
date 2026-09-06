# OTP Resend Fix & Subscribers Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix OTP resend code button error and add subscribers field to investment plan creation form in admin dashboard.

**Architecture:** Modify backend auth routes to expose email delivery status and codes on failure; add `current_subscribers` field to plan schema and admin UI.

**Tech Stack:** Python FastAPI, MongoDB, Vanilla JavaScript, HTML/CSS

---

## File Structure

| File | Purpose |
|------|---------|
| `app/routes/auth.py` | Auth endpoints (register, login, resend-2fa) |
| `app/routes/admin.py` | Admin endpoints (create_plan, update_plan) + CreatePlan schema |
| `public/copytradingbroker.io/verify-2fa.html` | 2FA verification page frontend |
| `public/copytradingbroker.io/admin-dashboard.html` | Admin dashboard HTML (modals) |
| `public/copytradingbroker.io/assets/js/admin-dashboard.js` | Admin dashboard JavaScript |

---

## Task 1: Update Backend Auth Routes for Email Fallback

**Files:**
- Modify: `app/routes/auth.py`

- [ ] **Step 1: Update `register` endpoint response to include email status**

In `app/routes/auth.py`, find the `register` endpoint (line 69). Replace the return statement at lines 141-146:

```python
# Current code (lines 141-146):
    return {
        "message": "Registration successful. Please verify your email with the code sent to you.",
        "requires_2fa": True,
        "email": user_dict["email"],
        "user_id": str(user_dict["_id"])
    }
```

Replace with:

```python
    response = {
        "message": "Registration successful. Please verify your email with the code sent to you.",
        "requires_2fa": True,
        "email": user_dict["email"],
        "user_id": str(user_dict["_id"]),
        "email_sent": email_sent
    }
    if not email_sent:
        response["code"] = code
    return response
```

- [ ] **Step 2: Update `login` endpoint response to include email status**

In `app/routes/auth.py`, find the `login` endpoint's 2FA return statement (lines 302-307). Replace:

```python
# Current code (lines 302-307):
    return {
        "message": "Verification code sent to your email",
        "requires_2fa": True,
        "email": user["email"],
        "security_alert": suspicious_activity.get("is_suspicious", False)
    }
```

Replace with:

```python
    response = {
        "message": "Verification code sent to your email",
        "requires_2fa": True,
        "email": user["email"],
        "security_alert": suspicious_activity.get("is_suspicious", False),
        "email_sent": email_sent
    }
    if not email_sent:
        response["code"] = code
    return response
```

- [ ] **Step 3: Update `resend-2fa` endpoint response to include email status**

In `app/routes/auth.py`, find the `resend_2fa` endpoint (line 594). Replace the return statement at lines 632-634:

```python
# Current code (lines 632-634):
    return {
        "message": "New verification code sent to your email"
    }
```

Replace with:

```python
    response = {
        "message": "New verification code sent to your email",
        "email_sent": email_sent
    }
    if not email_sent:
        response["code"] = code
    return response
```

- [ ] **Step 4: Verify changes don't break existing functionality**

Run the server and test:
```bash
cd /home/taliban/websites/tedbroker.com
python main.py
```

Test endpoints manually or check that the server starts without errors.

- [ ] **Step 5: Commit**

```bash
git add app/routes/auth.py
git commit -m "fix(auth): expose email delivery status and code fallback in auth responses"
```

---

## Task 2: Update Frontend Verify 2FA Page for Code Fallback

**Files:**
- Modify: `public/copytradingbroker.io/verify-2fa.html`

- [ ] **Step 1: Update form submission handler to show code on email failure**

In `public/copytradingbroker.io/verify-2fa.html`, find the form submission handler (line 236). After line 259 where `data` is parsed, add code to display fallback code:

Current code around line 259-263:
```javascript
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.detail || 'Verification failed');
                }
```

Replace with:
```javascript
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.detail || 'Verification failed');
                }

                // If email failed, show the code as fallback
                if (data.email_sent === false && data.code) {
                    TED_AUTH.showFormMessage('verify-message',
                        `Email delivery failed. Your verification code is: ${data.code}`,
                        'info');
                }
```

- [ ] **Step 2: Update resend code handler to show code on email failure**

In `public/copytradingbroker.io/verify-2fa.html`, find the resend code handler (line 306). Update the success handling:

Current code around line 318-331:
```javascript
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.detail || 'Failed to resend code');
                }

                // Reset timer
                timeLeft = 600;
                document.getElementById('verification-code').disabled = false;
                document.getElementById('verification-code').value = '';
                document.getElementById('verification-code').focus();
                updateTimer();

                TED_AUTH.showFormMessage('verify-message', 'New verification code sent to your email', 'success');
```

Replace with:
```javascript
                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.detail || 'Failed to resend code');
                }

                // Reset timer
                timeLeft = 600;
                document.getElementById('verification-code').disabled = false;
                document.getElementById('verification-code').value = '';
                document.getElementById('verification-code').focus();
                updateTimer();

                if (data.email_sent === false && data.code) {
                    TED_AUTH.showFormMessage('verify-message',
                        `Email delivery failed. Your verification code is: ${data.code}`,
                        'info');
                } else {
                    TED_AUTH.showFormMessage('verify-message', 'New verification code sent to your email', 'success');
                }
```

- [ ] **Step 3: Commit**

```bash
git add public/copytradingbroker.io/verify-2fa.html
git commit -m "fix(frontend): display verification code fallback when email delivery fails"
```

---

## Task 3: Add Subscribers Field to Backend Schema and Endpoints

**Files:**
- Modify: `app/routes/admin.py` (schema + 2 endpoints)

- [ ] **Step 1: Update CreatePlan schema to include current_subscribers**

In `app/routes/admin.py`, find the `CreatePlan` class (line 55). Add the new field:

Current code (lines 55-62):
```python
class CreatePlan(BaseModel):
    """Schema for creating an investment plan"""
    name: str = Field(..., min_length=1, max_length=100, description="Plan name")
    description: str = Field(..., description="Plan description")
    minimum_investment: float = Field(..., gt=0, description="Minimum investment amount")
    expected_return_percent: float = Field(..., description="Expected return percentage")
    holding_period_months: int = Field(..., gt=0, description="Holding period in months")
    is_active: bool = Field(default=True, description="Whether the plan is active")
```

Replace with:
```python
class CreatePlan(BaseModel):
    """Schema for creating an investment plan"""
    name: str = Field(..., min_length=1, max_length=100, description="Plan name")
    description: str = Field(..., description="Plan description")
    minimum_investment: float = Field(..., gt=0, description="Minimum investment amount")
    expected_return_percent: float = Field(..., description="Expected return percentage")
    holding_period_months: int = Field(..., gt=0, description="Holding period in months")
    current_subscribers: int = Field(default=0, ge=0, description="Number of current subscribers")
    is_active: bool = Field(default=True, description="Whether the plan is active")
```

- [ ] **Step 2: Update create_plan endpoint to use schema value**

In `app/routes/admin.py`, find the `create_plan` endpoint (line 1152). Update line 1176:

Current code:
```python
        "current_subscribers": 0,
```

Replace with:
```python
        "current_subscribers": plan_data.current_subscribers,
```

- [ ] **Step 3: Update update_plan endpoint to include current_subscribers**

In `app/routes/admin.py`, find the `update_plan` endpoint (line 1200). Add `current_subscribers` to the update_dict:

Current code (lines 1233-1241):
```python
    # Update plan document
    update_dict = {
        "name": plan_data.name,
        "description": plan_data.description,
        "minimum_investment": plan_data.minimum_investment,
        "expected_return_percent": plan_data.expected_return_percent,
        "holding_period_months": plan_data.holding_period_months,
        "is_active": plan_data.is_active,
        "updated_at": datetime.utcnow()
    }
```

Replace with:
```python
    # Update plan document
    update_dict = {
        "name": plan_data.name,
        "description": plan_data.description,
        "minimum_investment": plan_data.minimum_investment,
        "expected_return_percent": plan_data.expected_return_percent,
        "holding_period_months": plan_data.holding_period_months,
        "current_subscribers": plan_data.current_subscribers,
        "is_active": plan_data.is_active,
        "updated_at": datetime.utcnow()
    }
```

- [ ] **Step 4: Verify server starts without errors**

```bash
cd /home/taliban/websites/tedbroker.com
python main.py
```

- [ ] **Step 5: Commit**

```bash
git add app/routes/admin.py
git commit -m "feat(admin): add current_subscribers field to plan schema and endpoints"
```

---

## Task 4: Add Subscribers Field to Admin Dashboard HTML

**Files:**
- Modify: `public/copytradingbroker.io/admin-dashboard.html`

- [ ] **Step 1: Add subscribers field to "Add Plan" modal**

In `public/copytradingbroker.io/admin-dashboard.html`, find the "Add Plan" modal (line 745). Add a new form group after the "Holding Period" field (after line 773):

Current code (lines 770-780):
```html
                <div class="form-group">
                    <label for="plan-period">Holding Period (Months) *</label>
                    <input type="number" id="plan-period" required min="1" step="1" placeholder="12">
                </div>

                <div class="form-group">
                    <label style="display: flex; align-items: center; cursor: pointer;">
                        <input type="checkbox" id="plan-active" checked style="width: auto; margin-right: 10px;">
                        <span>Active (visible to users)</span>
                    </label>
                </div>
```

Replace with:
```html
                <div class="form-group">
                    <label for="plan-period">Holding Period (Months) *</label>
                    <input type="number" id="plan-period" required min="1" step="1" placeholder="12">
                </div>

                <div class="form-group">
                    <label for="plan-subscribers">Current Subscribers</label>
                    <input type="number" id="plan-subscribers" min="0" value="0" placeholder="0">
                    <small style="color: #8b93a7; font-size: 13px; display: block; margin-top: 5px;">
                        Number of users currently subscribed to this plan
                    </small>
                </div>

                <div class="form-group">
                    <label style="display: flex; align-items: center; cursor: pointer;">
                        <input type="checkbox" id="plan-active" checked style="width: auto; margin-right: 10px;">
                        <span>Active (visible to users)</span>
                    </label>
                </div>
```

- [ ] **Step 2: Add subscribers field to "Edit Plan" modal**

In `public/copytradingbroker.io/admin-dashboard.html`, find the "Edit Plan" modal (line 794). Add the same field after the "Holding Period" field (after line 824):

Current code (lines 821-832):
```html
                <div class="form-group">
                    <label for="edit-plan-period">Holding Period (Months) *</label>
                    <input type="number" id="edit-plan-period" required min="1" step="1" placeholder="12">
                </div>

                <div class="form-group">
                    <label style="display: flex; align-items: center; cursor: pointer;">
                        <input type="checkbox" id="edit-plan-active" checked style="width: auto; margin-right: 10px;">
                        <span>Active (visible to users)</span>
                    </label>
                </div>
```

Replace with:
```html
                <div class="form-group">
                    <label for="edit-plan-period">Holding Period (Months) *</label>
                    <input type="number" id="edit-plan-period" required min="1" step="1" placeholder="12">
                </div>

                <div class="form-group">
                    <label for="edit-plan-subscribers">Current Subscribers</label>
                    <input type="number" id="edit-plan-subscribers" min="0" value="0" placeholder="0">
                    <small style="color: #8b93a7; font-size: 13px; display: block; margin-top: 5px;">
                        Number of users currently subscribed to this plan
                    </small>
                </div>

                <div class="form-group">
                    <label style="display: flex; align-items: center; cursor: pointer;">
                        <input type="checkbox" id="edit-plan-active" checked style="width: auto; margin-right: 10px;">
                        <span>Active (visible to users)</span>
                    </label>
                </div>
```

- [ ] **Step 3: Commit**

```bash
git add public/copytradingbroker.io/admin-dashboard.html
git commit -m "feat(admin-ui): add subscribers input field to plan create/edit modals"
```

---

## Task 5: Update Admin Dashboard JavaScript for Subscribers Field

**Files:**
- Modify: `public/copytradingbroker.io/assets/js/admin-dashboard.js`

- [ ] **Step 1: Update submitNewPlan to include subscribers**

In `public/copytradingbroker.io/assets/js/admin-dashboard.js`, find the `submitNewPlan` function (line 1082). Update the planData object:

Current code (lines 1085-1092):
```javascript
    const planData = {
        name: document.getElementById('plan-name').value,
        description: document.getElementById('plan-description').value,
        minimum_investment: parseFloat(document.getElementById('plan-min-investment').value),
        expected_return_percent: parseFloat(document.getElementById('plan-return').value),
        holding_period_months: parseInt(document.getElementById('plan-period').value),
        is_active: document.getElementById('plan-active').checked
    };
```

Replace with:
```javascript
    const planData = {
        name: document.getElementById('plan-name').value,
        description: document.getElementById('plan-description').value,
        minimum_investment: parseFloat(document.getElementById('plan-min-investment').value),
        expected_return_percent: parseFloat(document.getElementById('plan-return').value),
        holding_period_months: parseInt(document.getElementById('plan-period').value),
        current_subscribers: parseInt(document.getElementById('plan-subscribers').value) || 0,
        is_active: document.getElementById('plan-active').checked
    };
```

- [ ] **Step 2: Update submitEditedPlan to include subscribers**

In `public/copytradingbroker.io/assets/js/admin-dashboard.js`, find the `submitEditedPlan` function (line 1150). Update the planData object:

Current code (lines 1154-1161):
```javascript
    const planData = {
        name: document.getElementById('edit-plan-name').value,
        description: document.getElementById('edit-plan-description').value,
        minimum_investment: parseFloat(document.getElementById('edit-plan-min-investment').value),
        expected_return_percent: parseFloat(document.getElementById('edit-plan-return').value),
        holding_period_months: parseInt(document.getElementById('edit-plan-period').value),
        is_active: document.getElementById('edit-plan-active').checked
    };
```

Replace with:
```javascript
    const planData = {
        name: document.getElementById('edit-plan-name').value,
        description: document.getElementById('edit-plan-description').value,
        minimum_investment: parseFloat(document.getElementById('edit-plan-min-investment').value),
        expected_return_percent: parseFloat(document.getElementById('edit-plan-return').value),
        holding_period_months: parseInt(document.getElementById('edit-plan-period').value),
        current_subscribers: parseInt(document.getElementById('edit-plan-subscribers').value) || 0,
        is_active: document.getElementById('edit-plan-active').checked
    };
```

- [ ] **Step 3: Update showEditPlanModal to populate subscribers field**

In `public/copytradingbroker.io/assets/js/admin-dashboard.js`, find the `showEditPlanModal` function (line 1114). Add the subscribers field population:

Current code (line 1127):
```javascript
        document.getElementById('edit-plan-active').checked = plan.is_active;
```

Replace with:
```javascript
        document.getElementById('edit-plan-active').checked = plan.is_active;
        document.getElementById('edit-plan-subscribers').value = plan.current_subscribers || 0;
```

- [ ] **Step 4: Verify no JavaScript errors**

Open browser developer console and check for syntax errors.

- [ ] **Step 5: Commit**

```bash
git add public/copytradingbroker.io/assets/js/admin-dashboard.js
git commit -m "feat(admin-js): handle subscribers field in plan create/edit operations"
```

---

## Task 6: Final Verification

- [ ] **Step 1: Start the server and test all changes**

```bash
cd /home/taliban/websites/tedbroker.com
python main.py
```

- [ ] **Step 2: Test OTP flow**

1. Navigate to `/register` and create a new account
2. Verify the verify-2fa page shows the code if email fails
3. Test the resend code button shows the code fallback

- [ ] **Step 3: Test subscribers field**

1. Login to admin dashboard at `/admin/login`
2. Navigate to Investment Plans tab
3. Click "Add Plan" and verify subscribers field appears
4. Create a plan with a custom subscriber count
5. Edit the plan and verify the subscriber count is populated
6. Update the subscriber count and verify it persists

- [ ] **Step 4: Run final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: final verification and minor adjustments"
```
