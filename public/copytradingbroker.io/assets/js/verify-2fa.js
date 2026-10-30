// @ts-check
/**
 * Email OTP verification after login/registration.
 * Backend: POST /api/auth/verify-2fa {email, code} -> {access_token}
 *          POST /api/auth/resend-2fa {email}
 * The code is emailed on login (/api/auth/login sets requires_2fa). We do not
 * request a new code on page load; the user can resend after a cooldown.
 */
const RESEND_COOLDOWN = 30;
const API = '/api';

const form = /** @type {HTMLFormElement|null} */ (document.getElementById('verify-2fa-form'));
const inputs = /** @type {HTMLInputElement[]} */ ([...document.querySelectorAll('.otp__input')]);
const errorEl = /** @type {HTMLElement|null} */ (document.getElementById('verify-error'));
const statusEl = /** @type {HTMLElement|null} */ (document.getElementById('verify-status'));
const submitBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('verify-submit'));
const resendBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('resend-code'));
const cooldownEl = resendBtn?.querySelector('[data-cooldown]') || null;
const emailEl = document.getElementById('verify-email');

const email = new URLSearchParams(location.search).get('email') || '';
if (emailEl && email) emailEl.textContent = email;

/** @param {string} msg */
function showError(msg) {
  if (!errorEl) return;
  errorEl.textContent = msg;
  errorEl.hidden = false;
  inputs.forEach((i) => i.classList.add('is-error'));
}
function clearError() {
  if (errorEl) { errorEl.textContent = ''; errorEl.hidden = true; }
  inputs.forEach((i) => i.classList.remove('is-error'));
}
/** @param {string} msg */
function announce(msg) { if (statusEl) statusEl.textContent = msg; }

const code = () => inputs.map((i) => i.value).join('');

/** @param {number} i @param {string} v */
function fill(i, v) { inputs[i].value = v; }

inputs.forEach((input, idx) => {
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '');
    if (digits.length > 1) { // paste of several digits into one box
      [...digits.slice(0, 6)].forEach((d, k) => fill(idx + k < 6 ? idx + k : 5, d));
      inputs[Math.min(idx + digits.length, 5)].focus();
    } else {
      input.value = digits;
      if (digits && idx < 5) inputs[idx + 1].focus();
    }
    clearError();
    if (code().length === 6 && !inputs.some((i) => !i.value)) form?.requestSubmit();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !input.value && idx > 0) { inputs[idx - 1].focus(); inputs[idx - 1].value = ''; e.preventDefault(); }
    if (e.key === 'ArrowLeft' && idx > 0) { e.preventDefault(); inputs[idx - 1].focus(); }
    if (e.key === 'ArrowRight' && idx < 5) { e.preventDefault(); inputs[idx + 1].focus(); }
  });
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const digits = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    [...digits].forEach((d, k) => fill(k, d));
    inputs[Math.min(digits.length, 5)].focus();
    if (digits.length === 6) form?.requestSubmit();
  });
});

/** Start the resend cooldown timer. */
function startCooldown() {
  if (!resendBtn) return;
  let left = RESEND_COOLDOWN;
  resendBtn.disabled = true;
  const tick = () => {
    if (cooldownEl) cooldownEl.textContent = `(${left}s)`;
    if (left <= 0) {
      resendBtn.disabled = false;
      if (cooldownEl) cooldownEl.textContent = '';
      return;
    }
    left -= 1;
    setTimeout(tick, 1000);
  };
  tick();
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  if (!email) { showError('Missing email. Please sign in again.'); return; }
  if (code().length !== 6) { showError('Enter all 6 digits of the code.'); inputs.find((i) => !i.value)?.focus(); return; }
  if (submitBtn) { submitBtn.disabled = true; submitBtn.setAttribute('aria-busy', 'true'); }
  try {
    const res = await fetch(`${API}/auth/verify-2fa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: code() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = typeof data.detail === 'string' ? data.detail : 'That code did not work. Try again.';
      showError(detail);
      announce(detail);
      inputs.forEach((i) => { i.value = ''; });
      inputs[0].focus();
      return;
    }
    if (data.access_token && window.TED_AUTH) {
      window.TED_AUTH.saveToken(data.access_token);
      await window.TED_AUTH.fetchCurrentUser();
    }
    // A referral code entered at sign-up is applied once, now that the account is signed in.
    // One attempt only: an invalid or already-used code is dropped rather than retried.
    const pendingReferral = localStorage.getItem('ted:pending_referral');
    if (pendingReferral && data.access_token) {
      localStorage.removeItem('ted:pending_referral');
      try {
        await fetch(`${API}/referrals/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.access_token}` },
          body: JSON.stringify({ referral_code: pendingReferral }),
        });
      } catch {
        // The referral is optional; sign-in should still complete.
      }
    }
    location.href = '/app/';
  } catch {
    showError('Network error. Check your connection and try again.');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.removeAttribute('aria-busy'); }
  }
});

resendBtn?.addEventListener('click', async () => {
  if (!email || !resendBtn) return;
  resendBtn.disabled = true;
  try {
    const res = await fetch(`${API}/auth/resend-2fa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showError(typeof data.detail === 'string' ? data.detail : 'Could not resend the code. Try again shortly.');
      resendBtn.disabled = false;
      return;
    }
    announce(data.message || 'A new code was sent.');
    inputs.forEach((i) => { i.value = ''; });
    inputs[0].focus();
    startCooldown();
  } catch {
    showError('Network error. Try again.');
    resendBtn.disabled = false;
  }
});

if (!email) showError('Missing email. Please sign in again.');
startCooldown();
inputs[0]?.focus();
