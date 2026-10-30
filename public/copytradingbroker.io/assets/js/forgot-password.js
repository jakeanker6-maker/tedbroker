// @ts-check
/**
 * Password reset, three steps:
 *  1. POST /api/auth/forgot-password            {email}         -> emails a 6-digit code
 *  2. POST /api/auth/verify-password-reset-code {email, code}   -> {reset_token}
 *  3. POST /api/auth/reset-password              {token, new_password, confirm_password}
 * The reset token lives in memory only. Resend re-runs step 1.
 */
const API = '/api';
const COOLDOWN = 30;

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const steps = { email: $('step-email'), code: $('step-code'), password: $('step-password'), done: $('step-done') };
const statusEl = $('reset-status');
const otp = /** @type {HTMLInputElement[]} */ ([...document.querySelectorAll('#step-code .otp__input')]);
const resendBtn = /** @type {HTMLButtonElement} */ ($('resend-code'));
const cooldownEl = resendBtn.querySelector('[data-cooldown]');

/** @type {string} */ let email = '';
/** @type {string} */ let resetToken = '';

/** @param {'email'|'code'|'password'|'done'} name */
function show(name) {
  for (const [key, el] of Object.entries(steps)) el.hidden = key !== name;
  const focusTarget = { email: 'email', code: null, password: 'new-password', done: null }[name];
  if (name === 'code') otp[0]?.focus();
  else if (focusTarget) $(focusTarget).focus();
}

/** @param {string} id @param {string} msg */
function setError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.hidden = !msg;
  if (id === 'code-error') otp.forEach((i) => i.classList.toggle('is-error', !!msg));
  if (msg) announce(msg);
}
/** @param {string} msg */
function announce(msg) { statusEl.textContent = msg; }

/** @param {string} path @param {unknown} body */
async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = 'Something went wrong. Please try again.';
    if (res.status === 429) msg = 'Too many attempts. Please wait a few minutes and try again.';
    else if (typeof data.detail === 'string') msg = data.detail;
    else if (Array.isArray(data.detail) && data.detail[0]?.msg) msg = data.detail[0].msg;
    throw new Error(msg);
  }
  return data;
}

/** @param {number} seconds */
function startCooldown(seconds = COOLDOWN) {
  let left = seconds;
  resendBtn.disabled = true;
  const tick = () => {
    if (cooldownEl) cooldownEl.textContent = left > 0 ? `(${left}s)` : '';
    if (left <= 0) { resendBtn.disabled = false; return; }
    left -= 1;
    setTimeout(tick, 1000);
  };
  tick();
}

/** Step 1: request a reset code. Also used for resend. */
async function requestCode(/** @type {string} */ address) {
  const data = await post('/auth/forgot-password', { email: address });
  email = data.email || address;
  $('verify-email').textContent = email;
  otp.forEach((i) => { i.value = ''; });
  setError('code-error', '');
  show('code');
  startCooldown();
  announce(data.message || 'A verification code has been sent.');
}

$('forgot-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = /** @type {HTMLInputElement} */ ($('email'));
  setError('email-error', '');
  if (!input.checkValidity()) { setError('email-error', 'Enter a valid email address.'); input.focus(); return; }
  const btn = /** @type {HTMLButtonElement} */ ($('send-code'));
  btn.disabled = true;
  try { await requestCode(input.value.trim()); }
  catch (err) { setError('email-error', /** @type {Error} */ (err).message); }
  finally { btn.disabled = false; }
});

// OTP box behaviour: digit-only, auto-advance, backspace, paste of 6 digits
otp.forEach((input, idx) => {
  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '');
    if (digits.length > 1) {
      [...digits.slice(0, 6)].forEach((d, k) => { if (idx + k < 6) otp[idx + k].value = d; });
      otp[Math.min(idx + digits.length, 5)].focus();
    } else {
      input.value = digits;
      if (digits && idx < 5) otp[idx + 1].focus();
    }
    setError('code-error', '');
    if (otp.every((i) => i.value)) /** @type {HTMLFormElement} */ ($('verify-code-form')).requestSubmit();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace' && !input.value && idx > 0) { e.preventDefault(); otp[idx - 1].value = ''; otp[idx - 1].focus(); }
    if (e.key === 'ArrowLeft' && idx > 0) { e.preventDefault(); otp[idx - 1].focus(); }
    if (e.key === 'ArrowRight' && idx < 5) { e.preventDefault(); otp[idx + 1].focus(); }
  });
  input.addEventListener('paste', (e) => {
    e.preventDefault();
    const digits = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    [...digits].forEach((d, k) => { otp[k].value = d; });
    otp[Math.min(digits.length, 5)].focus();
    if (digits.length === 6) /** @type {HTMLFormElement} */ ($('verify-code-form')).requestSubmit();
  });
});

$('verify-code-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = otp.map((i) => i.value).join('');
  if (code.length !== 6) { setError('code-error', 'Enter all 6 digits of the code.'); return; }
  const btn = /** @type {HTMLButtonElement} */ ($('verify-submit'));
  btn.disabled = true;
  try {
    const data = await post('/auth/verify-password-reset-code', { email, code });
    resetToken = data.reset_token;
    setError('code-error', '');
    show('password');
  } catch (err) {
    setError('code-error', /** @type {Error} */ (err).message);
    otp.forEach((i) => { i.value = ''; });
    otp[0].focus();
  } finally { btn.disabled = false; }
});

resendBtn.addEventListener('click', async () => {
  resendBtn.disabled = true;
  try { await requestCode(email); }
  catch (err) { setError('code-error', /** @type {Error} */ (err).message); resendBtn.disabled = false; }
});

$('reset-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = /** @type {HTMLInputElement} */ ($('new-password'));
  const cf = /** @type {HTMLInputElement} */ ($('confirm-password'));
  setError('password-error', '');
  const v = pw.value;
  if (v.length < 8 || !/[A-Z]/.test(v) || !/[a-z]/.test(v) || !/[0-9]/.test(v)) {
    setError('password-error', 'Use at least 8 characters, with an uppercase letter, a lowercase letter and a number.');
    pw.focus(); return;
  }
  if (pw.value !== cf.value) { setError('password-error', 'The two passwords do not match.'); cf.focus(); return; }
  const btn = /** @type {HTMLButtonElement} */ ($('save-password'));
  btn.disabled = true;
  try {
    const data = await post('/auth/reset-password', {
      token: resetToken,
      new_password: pw.value,
      confirm_password: cf.value,
    });
    resetToken = '';
    announce(data.message || 'Password updated.');
    show('done');
  } catch (err) {
    setError('password-error', /** @type {Error} */ (err).message);
  } finally { btn.disabled = false; }
});

show('email');
