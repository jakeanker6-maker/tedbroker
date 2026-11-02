// @ts-check
/**
 * Sign-up form. Posts to POST /api/auth/register, then continues to the
 * email code step (/verify-2fa). The backend does not accept a referral code
 * at sign-up, so a valid code is kept in localStorage and submitted to
 * /api/referrals/submit once the new account is verified and signed in.
 */
import { check, clearError, setError } from '../components/auth-form.js';

import { mountCaptcha } from '../lib/captcha.js';

const form = /** @type {HTMLFormElement|null} */ (document.querySelector('form[data-auth="register"]'));
const captchaBox = form instanceof HTMLFormElement ? form.querySelector('[data-captcha]') : null;
const captcha = captchaBox instanceof HTMLElement ? mountCaptcha(captchaBox) : null;
const formError = /** @type {HTMLElement|null} */ (document.getElementById('register-error'));
const PENDING_REFERRAL_KEY = 'ted:pending_referral';

// Server field names -> form control ids
const FIELD_IDS = {
  email: 'email',
  username: 'username',
  password: 'pw',
  full_name: 'fullname',
  phone: 'phone',
  country: 'country',
  gender: 'gender',
};

if (form) {
  const control = (/** @type {string} */ name) =>
    /** @type {HTMLInputElement|HTMLSelectElement|null} */ (form.querySelector(`[name="${name}"]`));

  const showFormError = (/** @type {string} */ msg) => {
    if (!formError) return;
    formError.textContent = msg;
    formError.hidden = !msg;
  };

  /** @param {string} field @param {string} msg */
  const fieldError = (field, msg) => {
    const el = document.getElementById(FIELD_IDS[/** @type {keyof typeof FIELD_IDS} */ (field)] || '');
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
      setError(el, msg);
      el.focus();
      return true;
    }
    return false;
  };

  // Clear messages as the user edits
  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t instanceof HTMLElement && t.getAttribute('aria-invalid') === 'true') clearError(/** @type {any} */ (t));
    showFormError('');
  });
  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t instanceof HTMLElement && t.getAttribute('aria-invalid') === 'true') clearError(/** @type {any} */ (t));
  });

  /** @param {any} detail */
  const messageFromDetail = (detail) => {
    if (typeof detail === 'string') {
      const field = /already registered/i.test(detail) ? 'email'
        : /username already/i.test(detail) ? 'username'
        : null;
      return { text: detail, field };
    }
    if (Array.isArray(detail) && detail[0]) {
      const item = detail[0];
      const field = Array.isArray(item.loc) ? String(item.loc[item.loc.length - 1]) : null;
      const text = String(item.msg || 'Check the highlighted fields.').replace(/^Value error, /, '');
      return { text, field };
    }
    return { text: 'Something went wrong. Please try again.', field: null };
  };

  const submitBtn = /** @type {HTMLButtonElement|null} */ (form.querySelector('[type="submit"]'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitBtn?.getAttribute('aria-busy') === 'true') return;
    showFormError('');

    // 1. Client-side checks, the same rules as the rest of the auth forms
    let first = null;
    for (const c of /** @type {(HTMLInputElement|HTMLSelectElement)[]} */ ([...form.querySelectorAll('input, select')])) {
      if (c instanceof HTMLInputElement && ['hidden', 'submit', 'button'].includes(c.type)) continue;
      const msg = check(c, form);
      if (msg) { setError(c, msg); first ??= c; } else clearError(c);
    }
    if (first) { first.focus(); return; }

    // 2. Build the payload the backend expects
    const phoneNumber = (control('phone')?.value || '').trim();
    const phoneCode = control('phone_code')?.value || '';
    const payload = {
      email: (control('email')?.value || '').trim(),
      username: (control('username')?.value || '').trim(),
      password: control('password')?.value || '',
      full_name: (control('full_name')?.value || '').trim() || null,
      phone: phoneNumber ? `${phoneCode} ${phoneNumber}`.slice(0, 20) : null,
      gender: control('gender')?.value || null,
      country: control('country')?.value || null,
    };
    const referral = (control('referral_code')?.value || '').trim();

    if (control('password')?.value !== control('password_confirm')?.value) {
      setError(/** @type {HTMLInputElement} */ (control('password_confirm')), 'The two passwords do not match.');
      return;
    }

    // 3. Send
    const cap = captcha ? await captcha : null;
    if (cap && !cap.ready()) { showFormError('Please complete the security check.'); return; }
    if (submitBtn) { submitBtn.setAttribute('aria-busy', 'true'); submitBtn.disabled = true; }
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(cap ? cap.header() : {}) },
        body: JSON.stringify(payload),
      });
      /** @type {any} */
      const data = await res.json().catch(() => ({}));
      cap?.reset();

      if (!res.ok) {
        if (res.status === 429) {
          const wait = res.headers.get('Retry-After');
          showFormError(wait ? `Too many attempts. Try again in ${wait} seconds.` : 'Too many attempts. Please wait and try again.');
          return;
        }
        const { text, field } = messageFromDetail(data.detail);
        if (!(field && fieldError(field, text))) showFormError(text);
        return;
      }

      if (referral) localStorage.setItem(PENDING_REFERRAL_KEY, referral);
      const address = data.email || payload.email;
      localStorage.setItem('pending_verification_email', address);
      location.href = `/verify-2fa?email=${encodeURIComponent(address)}`;
    } catch {
      showFormError('Network error. Check your connection and try again.');
    } finally {
      if (submitBtn && !location.pathname.endsWith('/verify-2fa')) {
        submitBtn.removeAttribute('aria-busy');
        submitBtn.disabled = false;
      }
    }
  });
}
