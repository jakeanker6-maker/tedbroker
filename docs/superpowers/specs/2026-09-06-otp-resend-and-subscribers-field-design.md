# Design Spec: OTP Resend Code Fix & Investment Plan Subscribers Field

**Date:** 2026-09-06
**Status:** Approved
**Issues Addressed:**
1. Resend code button shows error; OTP not sent on registration/login
2. Investment plan profiles missing "number of subscribers" field in admin dashboard

---

## Issue 1: OTP Resend Code Fix

### Problem
- Postmark email service is failing (payment method needs update)
- Resend code button shows error message
- Users have no way to know the email failed or see their verification code
- Backend silently logs codes to console when email fails

### Root Cause
- `email_service.send_2fa_code()` returns `False` on failure
- `auth.py` endpoints continue execution but don't expose the code to users
- Resend endpoint always returns success message regardless of email status

### Solution: Graceful Degradation with Code Display

#### Backend Changes

**File: `app/routes/auth.py`**

1. **`register` endpoint (line 69-146):**
   - Add `email_sent` boolean to response
   - When `email_sent` is `False`, include `code` in response for fallback display

2. **`login` endpoint (line 149-307):**
   - Same changes for 2FA flow when `two_fa_enabled` is True

3. **`resend-2fa` endpoint (line 594-634):**
   - Return `email_sent` status in response
   - When `email_sent` is `False`, include `code` in response

#### Frontend Changes

**File: `public/copytradingbroker.io/verify-2fa.html`**

1. **Update resend code handler (line 306-336):**
   - Check `email_sent` in response
   - If `email_sent: false`, show code with message: "Email delivery failed. Your verification code is: XXXXXX"
   - If `email_sent: true`, show normal success message

2. **Update form submission handler (line 236-303):**
   - Store code from response if provided
   - Show code if initial email delivery failed

### Files to Modify
- `app/routes/auth.py` (3 endpoints)
- `public/copytradingbroker.io/verify-2fa.html` (frontend handlers)

---

## Issue 2: Investment Plan Subscribers Field

### Problem
- `CreatePlan` schema doesn't include `current_subscribers` field
- `create_plan` endpoint hardcodes `current_subscribers: 0`
- Admin dashboard form has no subscribers input field
- `update_plan` endpoint doesn't update subscribers count

### Solution: Admin-Editable Field

#### Backend Changes

**File: `app/routes/admin.py`**

1. **Update `CreatePlan` schema (line 55-62):**
   ```python
   class CreatePlan(BaseModel):
       name: str = Field(..., min_length=1, max_length=100)
       description: str = Field(...)
       minimum_investment: float = Field(..., gt=0)
       expected_return_percent: float = Field(...)
       holding_period_months: int = Field(..., gt=0)
       current_subscribers: int = Field(default=0, ge=0)  # NEW
       is_active: bool = Field(default=True)
   ```

2. **Update `create_plan` endpoint (line 1152-1196):**
   - Line 1176: Change `"current_subscribers": 0` to `"current_subscribers": plan_data.current_subscribers`

3. **Update `update_plan` endpoint (line 1200-1259):**
   - Add `current_subscribers` to `update_dict` (line 1233-1241)

#### Frontend Changes

**File: `public/copytradingbroker.io/admin-dashboard.html`**

1. **Add subscribers field to "Add Plan" modal (line 745-792):**
   ```html
   <div class="form-group">
       <label for="plan-subscribers">Current Subscribers</label>
       <input type="number" id="plan-subscribers" min="0" value="0" placeholder="0">
   </div>
   ```

2. **Add subscribers field to "Edit Plan" modal (line 794-843):**
   - Same field with id `edit-plan-subscribers`

**File: `public/copytradingbroker.io/assets/js/admin-dashboard.js`**

3. **Update `submitNewPlan` function (line 1082-1111):**
   - Add `current_subscribers: parseInt(document.getElementById('plan-subscribers').value)` to `planData`

4. **Update `submitEditedPlan` function (line 1150-1181):**
   - Add `current_subscribers: parseInt(document.getElementById('edit-plan-subscribers').value)` to `planData`

5. **Update `showEditPlanModal` function (line 1114-1138):**
   - Add: `document.getElementById('edit-plan-subscribers').value = plan.current_subscribers || 0;`

### Files to Modify
- `app/routes/admin.py` (schema + 2 endpoints)
- `public/copytradingbroker.io/admin-dashboard.html` (2 modals)
- `public/copytradingbroker.io/assets/js/admin-dashboard.js` (3 functions)

---

## Testing Considerations

1. **OTP Fix Testing:**
   - Test registration flow with email service disabled
   - Test login flow with 2FA enabled
   - Test resend code button displays code when email fails
   - Verify normal flow still works when email service is available

2. **Subscribers Field Testing:**
   - Create new plan with custom subscriber count
   - Edit existing plan to update subscriber count
   - Verify subscriber count displays correctly in plans list
   - Verify count persists after page refresh

---

## Risk Assessment

- **Low Risk:** Both changes are additive and don't modify existing behavior
- **Backward Compatible:** Existing plans with `current_subscribers: 0` will continue to work
- **No Database Migration:** Schema changes use defaults, existing documents unaffected
