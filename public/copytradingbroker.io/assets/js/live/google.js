// @ts-check
/**
 * Google sign-in for the login and sign-up pages.
 *
 * Flow (matches the original implementation):
 *  1. A [data-google-signin] button navigates to /api/auth/google/login.
 *  2. The backend redirects to Google, then to /api/auth/google/callback.
 *  3. The callback redirects to /login#token=<jwt> on success, or
 *     /login?error=oauth_failed on failure or cancel.
 *  4. This module runs on the login page, stores the token, loads the profile,
 *     and routes to /onboarding (incomplete), /welcome (not approved) or /app/.
 *
 * The token is only ever read from the URL fragment, which the browser never
 * sends to the server. The fragment is cleared straight after it is read.
 */
import { saveToken, saveUser, clearSession } from './api.js';
import { resolvePostAuthPath } from './gate.js';

const START_URL = '/api/auth/google/login';
const APP_URL = '/app/';

const buttons = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('[data-google-signin]')]);
const message = /** @type {HTMLElement|null} */ (document.getElementById('google-status'));

/** @param {string} text @param {'error'|'info'} [kind] */
function report(text, kind = 'error') {
  if (!message) return;
  message.textContent = text;
  message.hidden = false;
  message.dataset.kind = kind;
}

/** @param {boolean} busy */
function setBusy(busy) {
  for (const b of buttons) {
    b.disabled = busy;
    if (busy) b.setAttribute('aria-busy', 'true');
    else b.removeAttribute('aria-busy');
  }
}

for (const button of buttons) {
  button.addEventListener('click', () => {
    setBusy(true);
    clearSession();
    location.href = START_URL;
  });
}

/** Read and clear the token or error from the URL. */
function readReturnParams() {
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  const search = new URLSearchParams(location.search);
  const error = search.get('error');
  if (token || error) history.replaceState(null, '', location.pathname);
  return { token, error };
}

/** @param {string} token */
async function completeSignIn(token) {
  setBusy(true);
  report('Signing you in…', 'info');
  saveToken(token);

  try {
    const me = await fetch('/api/auth/me', {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    if (!me.ok) throw new Error('profile');
    saveUser(await me.json());
  } catch {
    clearSession();
    report('Google sign-in could not be completed. Please try again.');
    setBusy(false);
    return;
  }

  const target = (await resolvePostAuthPath()) || APP_URL;
  location.replace(target);
}

const { token, error } = readReturnParams();
if (error) {
  report('Google sign-in was cancelled or failed. Please try again.');
} else if (token) {
  completeSignIn(token);
}
