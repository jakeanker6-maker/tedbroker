# Login Flow Security & Production Readiness Fixes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all critical security vulnerabilities, broken functionality, and production-readiness issues in the user login/auth flow.

**Architecture:** Address issues in priority order: (1) critical security fixes in backend+frontend, (2) broken CDN/script loading, (3) production hardening. Each task is self-contained and testable.

**Tech Stack:** Python/FastAPI (backend), HTML/JavaScript (frontend), MongoDB, JWT tokens

---

## File Structure

| File | Responsibility |
|------|----------------|
| `app/routes/auth.py` | Backend auth endpoints — fix 2FA code leakage, add token blacklist |
| `public/copytradingbroker.io/login.html` | Login page — fix CDN URLs, remove duplicate scripts |
| `public/copytradingbroker.io/register.html` | Register page — fix CDN URLs, remove duplicate scripts |
| `public/copytradingbroker.io/verify-2fa.html` | 2FA verification — fix token handling, remove code display |
| `public/copytradingbroker.io/forgot-password.html` | Forgot password — fix token storage |
| `public/copytradingbroker.io/reset-password.html` | Reset password — fix token storage |
| `public/copytradingbroker.io/assets/js/auth.js` | Auth utility — add CSRF handling, improve error handling |
| `public/copytradingbroker.io/assets/js/login-handler.js` | Login form — fix race condition, add validation |
| `public/copytradingbroker.io/assets/js/register-handler.js` | Register form — fix OAuth redirect |
| `main.py` | App entry — add security headers middleware |

---

## Task 1: Remove 2FA Code Leakage from API Responses

**Files:**
- Modify: `app/routes/auth.py:136-155` (register endpoint)
- Modify: `app/routes/auth.py:307-324` (login endpoint)

The backend returns `response["code"] = code` when email fails. This is a critical security vulnerability — the 2FA code must never leave the server.

- [ ] **Step 1: Fix register endpoint to never return 2FA code**

In `app/routes/auth.py`, find the register endpoint response block (lines 146-155). Replace:

```python
    response = {
        "message": message,
        "requires_2fa": True,
        "email": user_dict["email"],
        "user_id": str(user_dict["_id"]),
        "email_sent": email_sent
    }
    if not email_sent:
        response["code"] = code
    return response
```

With:

```python
    return {
        "message": message,
        "requires_2fa": True,
        "email": user_dict["email"],
        "user_id": str(user_dict["_id"]),
        "email_sent": email_sent
    }
```

- [ ] **Step 2: Fix login endpoint to never return 2FA code**

In `app/routes/auth.py`, find the login endpoint response block (lines 316-325). Replace:

```python
    response = {
        "message": message,
        "requires_2fa": True,
        "email": user["email"],
        "security_alert": suspicious_activity.get("is_suspicious", False),
        "email_sent": email_sent
    }
    if not email_sent:
        response["code"] = code
    return response
```

With:

```python
    return {
        "message": message,
        "requires_2fa": True,
        "email": user["email"],
        "security_alert": suspicious_activity.get("is_suspicious", False),
        "email_sent": email_sent
    }
```

- [ ] **Step 3: Commit**

```bash
git add app/routes/auth.py
git commit -m "security: remove 2FA code from API responses to prevent leakage"
```

---

## Task 2: Remove 2FA Code Display from Frontend

**Files:**
- Modify: `public/copytradingbroker.io/assets/js/login-handler.js:106-109`
- Modify: `public/copytradingbroker.io/assets/js/register-handler.js:134-137`
- Modify: `public/copytradingbroker.io/verify-2fa.html:206-213`

The frontend stores and displays the 2FA code as a "fallback" when email fails. This must be removed.

- [ ] **Step 1: Remove code storage from login-handler.js**

In `public/copytradingbroker.io/assets/js/login-handler.js`, find lines 106-109:

```javascript
                // Store code for fallback display if email failed
                if (result.data.email_sent === false && result.data.code) {
                    localStorage.setItem('pending_verification_code', result.data.code);
                }
```

Delete these 3 lines entirely.

- [ ] **Step 2: Remove code storage from register-handler.js**

In `public/copytradingbroker.io/assets/js/register-handler.js`, find lines 134-137:

```javascript
                // Store code for fallback display if email failed
                if (result.data.email_sent === false && result.data.code) {
                    localStorage.setItem('pending_verification_code', result.data.code);
                }
```

Delete these 3 lines entirely.

- [ ] **Step 3: Remove code display from verify-2fa.html**

In `public/copytradingbroker.io/verify-2fa.html`, find lines 206-213:

```javascript
        // Check for stored fallback code from registration/login
        const storedCode = localStorage.getItem('pending_verification_code');
        if (storedCode) {
            localStorage.removeItem('pending_verification_code');
            TED_AUTH.showFormMessage('verify-message',
                `Email delivery failed. Your verification code is: ${storedCode}`,
                'info');
        }
```

Delete this block entirely.

- [ ] **Step 4: Update fallback message in login-handler.js**

In `public/copytradingbroker.io/assets/js/login-handler.js`, find the email_sent check around line 111. Change the message from mentioning "code below" to a generic message. Find:

```javascript
                if (result.data.email_sent === false && result.data.code) {
                    localStorage.setItem('pending_verification_code', result.data.code);
                }
                // Redirect to 2FA verification page
                TED_AUTH.showFormMessage('login-message', 'Verification code sent! Redirecting...', 'info');
```

Replace with:

```javascript
                // Redirect to 2FA verification page
                if (result.data.email_sent === false) {
                    TED_AUTH.showFormMessage('login-message', 'Email delivery failed. Please contact support if you do not receive the code.', 'info');
                } else {
                    TED_AUTH.showFormMessage('login-message', 'Verification code sent! Redirecting...', 'info');
                }
```

- [ ] **Step 5: Commit**

```bash
git add public/copytradingbroker.io/assets/js/login-handler.js public/copytradingbroker.io/assets/js/register-handler.js public/copytradingbroker.io/verify-2fa.html
git commit -m "security: remove 2FA code storage and display from frontend"
```

---

## Task 3: Fix OAuth Token URL Leakage

**Files:**
- Modify: `app/routes/auth.py` (Google OAuth redirect)
- Modify: `public/copytradingbroker.io/assets/js/login-handler.js:12-59`
- Modify: `public/copytradingbroker.io/assets/js/register-handler.js:12-38`

The OAuth flow passes the access token via URL query parameter `?token=...`. This leaks into browser history, server logs, and referrer headers.

- [ ] **Step 1: Find the Google OAuth callback endpoint**

In `app/routes/auth.py`, search for the Google OAuth callback that redirects with `?token=`. Look for `google_login` or OAuth callback handler:

```bash
grep -n "token.*query\|redirect.*token\|?token=" app/routes/auth.py
```

- [ ] **Step 2: Change OAuth redirect to use fragment instead of query**

The OAuth callback should redirect to `/login#token=...` (fragment) instead of `/login?token=...` (query). Fragments are never sent to the server in requests.

Find the redirect URL construction in the OAuth callback and change `?token=` to `#token=`.

- [ ] **Step 3: Update login-handler.js to read from fragment**

In `public/copytradingbroker.io/assets/js/login-handler.js`, replace the `handleOAuthRedirect` function:

```javascript
async function handleOAuthRedirect() {
    // Check hash fragment first (OAuth redirect), then query params (legacy)
    let token = null;
    let error = null;

    const hash = window.location.hash;
    if (hash && hash.includes('token=')) {
        const hashParams = new URLSearchParams(hash.substring(1));
        token = hashParams.get('token');
    } else {
        const urlParams = new URLSearchParams(window.location.search);
        token = urlParams.get('token');
        error = urlParams.get('error');
    }

    if (error) {
        if (error === 'oauth_failed') {
            TED_AUTH.showFormMessage('login-message', 'Google sign-in failed. Please try again.', 'error');
        }
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (token) {
        TED_AUTH.saveToken(token);
        await TED_AUTH.fetchCurrentUser();
        window.history.replaceState({}, document.title, window.location.pathname);

        try {
            const onboardingResponse = await TED_AUTH.apiCall('/api/onboarding/status');
            const onboardingData = await onboardingResponse.json();

            if (onboardingData.is_onboarding_complete) {
                TED_AUTH.showFormMessage('login-message', 'Login successful! Redirecting to dashboard...', 'success');
                setTimeout(() => { window.location.href = '/dashboard'; }, 1000);
            } else {
                TED_AUTH.showFormMessage('login-message', 'Login successful! Please complete your profile...', 'success');
                setTimeout(() => { window.location.href = '/onboarding'; }, 1000);
            }
        } catch (error) {
            console.error('Error checking onboarding status:', error);
            TED_AUTH.showFormMessage('login-message', 'Login successful! Redirecting...', 'success');
            setTimeout(() => { window.location.href = '/dashboard'; }, 1000);
        }
    }
}
```

- [ ] **Step 4: Update register-handler.js similarly**

Apply the same fragment-based token reading to `public/copytradingbroker.io/assets/js/register-handler.js`.

- [ ] **Step 5: Commit**

```bash
git add app/routes/auth.py public/copytradingbroker.io/assets/js/login-handler.js public/copytradingbroker.io/assets/js/register-handler.js
git commit -m "security: use URL fragment for OAuth token to prevent server log leakage"
```

---

## Task 4: Fix Broken CDN URLs and Remove Duplicate Scripts

**Files:**
- Modify: `public/copytradingbroker.io/login.html`
- Modify: `public/copytradingbroker.io/register.html`
- Modify: `public/copytradingbroker.io/verify-2fa.html`
- Modify: `public/copytradingbroker.io/forgot-password.html`
- Modify: `public/copytradingbroker.io/reset-password.html`

Multiple CDN URLs are broken (relative paths instead of absolute) and jQuery/Bootstrap are loaded 3+ times.

- [ ] **Step 1: Fix SweetAlert2 CDN URL in login.html**

In `public/copytradingbroker.io/login.html`, line 38, change:

```html
<script src="../unpkg.com/sweetalert2%407.8.2/dist/sweetalert2.all.js"></script>
```

To:

```html
<script src="https://unpkg.com/sweetalert2@7.8.2/dist/sweetalert2.all.js"></script>
```

- [ ] **Step 2: Fix Google Translate URL in login.html**

In `public/copytradingbroker.io/login.html`, line 157-158, change:

```html
<script type="text/javascript"
    src="translate.google.com/translate_a/elementa0d8a0d8a0d8.html?cb=googleTranslateElementInit"></script>
```

To:

```html
<script type="text/javascript"
    src="https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"></script>
```

- [ ] **Step 3: Remove duplicate jQuery and Bootstrap from login.html**

In `public/copytradingbroker.io/login.html`, remove lines 314-318 (the duplicate jQuery, FontAwesome, and Bootstrap CDN loads):

```html
<script src="../code.jquery.com/jquery-3.6.0.min.js"></script>
<script src="../use.fontawesome.com/b69656bbf6.js"></script>
<script src="../code.jquery.com/jquery-3.5.1.js"></script>
<script src="../cdn.jsdelivr.net/npm/bootstrap%405.0.0-beta1/dist/js/bootstrap.bundle.min.js"></script>
<script src="../cdnjs.cloudflare.com/ajax/libs/jquery-validate/1.19.2/jquery.validate.min.js"></script>
```

- [ ] **Step 4: Apply same fixes to register.html**

Repeat steps 1-3 for `public/copytradingbroker.io/register.html` (same line numbers).

- [ ] **Step 5: Apply same fixes to verify-2fa.html, forgot-password.html, reset-password.html**

Fix the SweetAlert2 CDN URL in all three files. Remove duplicate jQuery loads where present.

- [ ] **Step 6: Remove GTranslate duplicate from login.html and register.html**

Both Google Translate widget AND GTranslate widget are loaded. Remove the GTranslate wrapper and script since Google Translate is already loaded:

Delete from login.html (lines 271-280):
```html
<div class="gtranslate_wrapper"></div>
<script>
    window.gtranslateSettings = {
        default_language: "en",
        alt_flags:{"en":"usa"},
        wrapper_selector: ".gtranslate_wrapper",
        flag_style: "3d",
    };
</script>
<script src="../cdn.gtranslate.net/widgets/latest/float.js" defer></script>
```

Do the same for register.html.

- [ ] **Step 7: Remove HTTrack artifacts from login.html and register.html**

Delete the HTTrack comments at the top of login.html (lines 5-6):
```html
<!-- Mirrored from copytradingbroker.io/login by HTTrack Website Copier/3.x [XR&CO'2014], Mon, 13 Oct 2025 14:42:55 GMT -->
<!-- Added by HTTrack --><meta http-equiv="content-type" content="text/html;charset=UTF-8" /><!-- /Added by HTTrack -->
```

And the closing comment (line 332):
```html
<!-- Mirrored from copytradingbroker.io/login by HTTrack Website Copier/3.x ... -->
```

Do the same for register.html.

- [ ] **Step 8: Commit**

```bash
git add public/copytradingbroker.io/login.html public/copytradingbroker.io/register.html public/copytradingbroker.io/verify-2fa.html public/copytradingbroker.io/forgot-password.html public/copytradingbroker.io/reset-password.html
git commit -m "fix: correct broken CDN URLs, remove duplicate scripts and HTTrack artifacts"
```

---

## Task 5: Fix OAuth Redirect Race Condition

**Files:**
- Modify: `public/copytradingbroker.io/assets/js/login-handler.js:62-66`
- Modify: `public/copytradingbroker.io/assets/js/register-handler.js:41-45`

`handleOAuthRedirect()` is async but `redirectIfAuthenticated()` is called synchronously right after. If the page loads with a token in the URL, both fire — the second may redirect before the first finishes.

- [ ] **Step 1: Fix login-handler.js DOMContentLoaded**

In `public/copytradingbroker.io/assets/js/login-handler.js`, replace lines 62-66:

```javascript
document.addEventListener('DOMContentLoaded', function() {
    // Check for OAuth redirect
    handleOAuthRedirect();
    // Redirect if already logged in
    TED_AUTH.redirectIfAuthenticated();
```

With:

```javascript
document.addEventListener('DOMContentLoaded', async function() {
    // Check for OAuth redirect first (await to prevent race condition)
    await handleOAuthRedirect();

    // Only redirect if already logged in AND no token was just processed
    const hash = window.location.hash;
    const urlParams = new URLSearchParams(window.location.search);
    const hasToken = (hash && hash.includes('token=')) || urlParams.get('token');

    if (!hasToken) {
        TED_AUTH.redirectIfAuthenticated();
    }
```

- [ ] **Step 2: Apply same fix to register-handler.js**

Apply the same pattern to `public/copytradingbroker.io/assets/js/register-handler.js:41-45`.

- [ ] **Step 3: Commit**

```bash
git add public/copytradingbroker.io/assets/js/login-handler.js public/copytradingbroker.io/assets/js/register-handler.js
git commit -m "fix: resolve race condition between OAuth redirect and auth check"
```

---

## Task 6: Add Security Headers Middleware

**Files:**
- Modify: `main.py` (add security headers middleware)

No security headers are set. Add CSP, X-Frame-Options, X-Content-Type-Options, and HSTS.

- [ ] **Step 1: Add security headers middleware to main.py**

In `main.py`, after the CORS middleware block (line 32), add:

```python
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        # Only add HSTS in production
        if not os.getenv("DEBUG", "false").lower() == "true":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

app.add_middleware(SecurityHeadersMiddleware)
```

Add `import os` at the top if not already present.

- [ ] **Step 2: Commit**

```bash
git add main.py
git commit -m "security: add security headers middleware (CSP, X-Frame-Options, HSTS)"
```

---

## Task 7: Add Frontend Input Validation

**Files:**
- Modify: `public/copytradingbroker.io/assets/js/login-handler.js:82-90`

Login form only checks `!email || !password`. No email format validation.

- [ ] **Step 1: Add email format validation to login-handler.js**

In `public/copytradingbroker.io/assets/js/login-handler.js`, find the validation block (lines 87-90):

```javascript
        // Validate inputs
        if (!email || !password) {
            TED_AUTH.showFormMessage('login-message', 'Please enter both email and password', 'error');
            return;
        }
```

Replace with:

```javascript
        // Validate inputs
        if (!email || !password) {
            TED_AUTH.showFormMessage('login-message', 'Please enter both email and password', 'error');
            return;
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            TED_AUTH.showFormMessage('login-message', 'Please enter a valid email address', 'error');
            return;
        }
```

- [ ] **Step 2: Add caps lock warning to password field**

In `public/copytradingbroker.io/login.html`, before the closing `</form>` tag, add a caps lock warning div. Find the password input (line 213-216) and add after it:

```html
<div id="caps-lock-warning" style="color: #ff9800; font-size: 12px; display: none; margin-top: 4px;">
    <i class="fas fa-exclamation-triangle"></i> Caps Lock is on
</div>
```

Then add this script before `</body>` in login.html:

```javascript
<script>
document.addEventListener('DOMContentLoaded', function() {
    const passwordInput = document.querySelector('input[name="password"]');
    const capsWarning = document.getElementById('caps-lock-warning');
    if (passwordInput && capsWarning) {
        passwordInput.addEventListener('keyup', function(e) {
            capsWarning.style.display = (e.getModifierState && e.getModifierState('CapsLock')) ? 'block' : 'none';
        });
    }
});
</script>
```

- [ ] **Step 3: Commit**

```bash
git add public/copytradingbroker.io/assets/js/login-handler.js public/copytradingbroker.io/login.html
git commit -m "feat: add email format validation and caps lock warning to login"
```

---

## Task 8: Fix Silent Error Swallowing

**Files:**
- Modify: `public/copytradingbroker.io/assets/js/login-handler.js:134-141`
- Modify: `public/copytradingbroker.io/assets/js/login-handler.js:51-57`

When onboarding status check fails, user is silently redirected to dashboard with no error indication.

- [ ] **Step 1: Add error logging and user feedback in login-handler.js**

In `public/copytradingbroker.io/assets/js/login-handler.js`, find the catch block (lines 134-141):

```javascript
                } catch (error) {
                    // If there's an error checking onboarding status, default to dashboard
                    console.error('Error checking onboarding status:', error);
                    TED_AUTH.showFormMessage('login-message', 'Login successful! Redirecting...', 'success');
                    setTimeout(() => {
                        window.location.href = '/dashboard';
                    }, 1000);
                }
```

Replace with:

```javascript
                } catch (error) {
                    console.error('Error checking onboarding status:', error);
                    // Still redirect but inform user something went wrong
                    TED_AUTH.showFormMessage('login-message', 'Login successful! Some features may be temporarily unavailable.', 'info');
                    setTimeout(() => {
                        window.location.href = '/dashboard';
                    }, 1500);
                }
```

- [ ] **Step 2: Apply same fix to verify-2fa.html**

Find the same catch block in `public/copytradingbroker.io/verify-2fa.html` (around line 299) and apply the same change.

- [ ] **Step 3: Commit**

```bash
git add public/copytradingbroker.io/assets/js/login-handler.js public/copytradingbroker.io/verify-2fa.html
git commit -m "fix: add user feedback when onboarding status check fails"
```

---

## Task 9: Improve Logout with Server-Side Token Invalidation

**Files:**
- Modify: `app/routes/auth.py` (add logout endpoint with token blacklist)
- Modify: `public/copytradingbroker.io/assets/js/auth.js:195-198`

Logout only clears localStorage. The JWT remains valid until expiry.

- [ ] **Step 1: Add token blacklist collection to database.py**

In `app/database.py`, add a constant for the blacklist collection:

```python
TOKEN_BLACKLIST_COLLECTION = "token_blacklist"
```

- [ ] **Step 2: Add logout endpoint to auth.py**

In `app/routes/auth.py`, add a new logout endpoint:

```python
@router.post("/logout")
async def logout(request: Request, token_data: dict = Depends(get_current_user_token)):
    """Logout user by blacklisting their token"""
    from app.database import get_collection, TOKEN_BLACKLIST_COLLECTION

    token = token_data.get("token")
    if token:
        blacklist = get_collection(TOKEN_BLACKLIST_COLLECTION)
        blacklist.insert_one({
            "token": token,
            "blacklisted_at": datetime.utcnow()
        })

    return {"message": "Logged out successfully"}
```

- [ ] **Step 3: Add token blacklist check to token validation**

In `app/auth.py`, find the `get_current_user_token` function and add a blacklist check:

```python
# After decoding the token, check if it's blacklisted
from app.database import get_collection, TOKEN_BLACKLIST_COLLECTION
blacklist = get_collection(TOKEN_BLACKLIST_COLLECTION)
if blacklist.find_one({"token": token}):
    raise HTTPException(status_code=401, detail="Token has been revoked")
```

- [ ] **Step 4: Update frontend logout to call API**

In `public/copytradingbroker.io/assets/js/auth.js`, replace the logout function (lines 195-198):

```javascript
    logout() {
        this.removeToken();
        window.location.href = '/login';
    },
```

With:

```javascript
    async logout() {
        try {
            await this.apiCall('/api/auth/logout', { method: 'POST' });
        } catch (e) {
            // Proceed with local logout even if API call fails
        }
        this.removeToken();
        window.location.href = '/login';
    },
```

- [ ] **Step 5: Commit**

```bash
git add app/routes/auth.py app/auth.py app/database.py public/copytradingbroker.io/assets/js/auth.js
git commit -m "security: add server-side token blacklist for logout"
```

---

## Task 10: Add Client-Side Rate Limiting Feedback

**Files:**
- Modify: `public/copytradingbroker.io/assets/js/login-handler.js`

No visual feedback when rate limited. Users see a generic error.

- [ ] **Step 1: Add rate limit detection to login handler**

In `public/copytradingbroker.io/assets/js/login-handler.js`, find the error handling block (around line 143-145):

```javascript
        } else {
            TED_AUTH.showFormMessage('login-message', result.error, 'error');
        }
```

Replace with:

```javascript
        } else {
            // Check if rate limited
            if (result.error && result.error.includes('rate limit')) {
                TED_AUTH.showFormMessage('login-message', 'Too many login attempts. Please wait a moment and try again.', 'error');
            } else {
                TED_AUTH.showFormMessage('login-message', result.error, 'error');
            }
        }
```

Also, update the `TED_AUTH.login` method in `auth.js` to capture the rate limit header. In `auth.js`, after the `apiCall` in the `login` method, add:

```javascript
            // Check for rate limiting
            const retryAfter = response.headers.get('Retry-After');
            if (retryAfter) {
                return { success: false, error: `rate limit exceeded. Retry after ${retryAfter} seconds` };
            }
```

- [ ] **Step 2: Add countdown timer for rate limited users**

In `login-handler.js`, add a function to show a countdown when rate limited:

```javascript
function showRateLimitCountdown(seconds) {
    const btn = document.getElementById('login-btn');
    if (!btn) return;
    btn.disabled = true;
    let remaining = parseInt(seconds) || 60;
    const originalText = btn.textContent;

    const interval = setInterval(() => {
        btn.textContent = `Wait ${remaining}s`;
        remaining--;
        if (remaining <= 0) {
            clearInterval(interval);
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }, 1000);
}
```

Call this function when rate limit is detected.

- [ ] **Step 3: Commit**

```bash
git add public/copytradingbroker.io/assets/js/login-handler.js public/copytradingbroker.io/assets/js/auth.js
git commit -m "feat: add rate limit feedback with countdown timer to login"
```

---

## Task 11: Add Password Requirements Display to Login

**Files:**
- Modify: `public/copytradingbroker.io/login.html`

Password requirements are only shown on register/reset, not on login. Users don't know why login might fail.

- [ ] **Step 1: Add a subtle password hint below login password field**

In `public/copytradingbroker.io/login.html`, find the password input (around line 213-216) and add after it:

```html
<p style="color: #8b93a7; font-size: 11px; margin-top: 4px;">
    <i class="fas fa-info-circle"></i> Password must be at least 8 characters with uppercase, lowercase, and a number
</p>
```

- [ ] **Step 2: Commit**

```bash
git add public/copytradingbroker.io/login.html
git commit -m "feat: add password requirements hint to login page"
```

---

## Execution Summary

| Task | Priority | Type | Files Changed |
|------|----------|------|---------------|
| 1. Remove 2FA code from API | Critical | Security | auth.py |
| 2. Remove 2FA code from frontend | Critical | Security | login-handler.js, register-handler.js, verify-2fa.html |
| 3. Fix OAuth token URL leakage | Critical | Security | auth.py, login-handler.js, register-handler.js |
| 4. Fix broken CDN/duplicates | High | Broken | login.html, register.html, verify-2fa.html, forgot-password.html, reset-password.html |
| 5. Fix OAuth race condition | High | Bug | login-handler.js, register-handler.js |
| 6. Add security headers | High | Security | main.py |
| 7. Add frontend validation | Medium | UX | login-handler.js, login.html |
| 8. Fix silent error swallowing | Medium | UX | login-handler.js, verify-2fa.html |
| 9. Server-side logout | Medium | Security | auth.py, auth.js, database.py |
| 10. Rate limit feedback | Low | UX | login-handler.js, auth.js |
| 11. Password requirements hint | Low | UX | login.html |
