// @ts-check
import { saveToken, saveUser, clearSession } from './api.js';
import { check, clearError, setError } from '../components/auth-form.js';

const form = document.querySelector('form[data-auth="login"]');

if (form instanceof HTMLFormElement) {
  const email = /** @type {HTMLInputElement|null} */ (form.querySelector('input[name="email"], input[name="username"]'));
  const password = /** @type {HTMLInputElement|null} */ (form.querySelector('input[name="password"]'));
  const button = /** @type {HTMLButtonElement|null} */ (form.querySelector('[type="submit"]'));

  const controls = () => [...form.querySelectorAll('input, select, textarea')]
    .filter((control) => !(control instanceof HTMLInputElement && ['hidden', 'submit', 'button'].includes(control.type)))
    .filter((control) => !(control instanceof HTMLInputElement && control.disabled));

  const unlock = () => {
    button?.removeAttribute('aria-busy');
    button?.removeAttribute('disabled');
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!email || !password || button?.getAttribute('aria-busy') === 'true') return;

    let first = null;
    for (const control of controls()) {
      const message = check(control, form);
      if (message) {
        setError(control, message);
        first ??= control;
      } else {
        clearError(control);
      }
    }
    if (first) {
      first.focus();
      return;
    }

    button?.setAttribute('aria-busy', 'true');
    button?.setAttribute('disabled', '');
    clearSession();

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.value.trim(), password: password.value }),
      });

      /** @type {any} */
      let data = null;
      try { data = await response.json(); } catch { data = null; }

      if (!response.ok) {
        const detail = Array.isArray(data?.detail)
          ? data.detail.map((item) => item.msg || String(item)).join('. ')
          : data?.detail;
        if (response.status === 401) {
          setError(password, 'Incorrect email or password.');
          password.focus();
          password.select();
        } else if (response.status === 429) {
          const wait = response.headers.get('Retry-After');
          setError(password, wait ? `Too many attempts. Try again in ${wait} seconds.` : 'Too many attempts. Please wait and try again.');
          password.focus();
        } else {
          setError(password, detail || 'Unable to sign in. Please try again.');
          password.focus();
        }
        unlock();
        return;
      }

      if (data?.requires_2fa) {
        const address = data.email || email.value.trim();
        localStorage.setItem('pending_verification_email', address);
        location.href = `/verify-2fa?email=${encodeURIComponent(address)}`;
        return;
      }

      if (!data?.access_token) throw new Error('The server did not return an access token.');
      saveToken(data.access_token);

      try {
        const me = await fetch('/api/auth/me', {
          headers: { Accept: 'application/json', Authorization: `Bearer ${data.access_token}` },
        });
        if (me.ok) saveUser(await me.json());
      } catch {
        // The app shell will refresh the profile from /api/auth/me.
      }

      const rawNext = new URLSearchParams(location.search).get('next');
      const next = rawNext && /^\/app(?:\/|$|\?)/.test(rawNext) ? rawNext : '/app/';
      location.href = next;
    } catch (error) {
      setError(password, error instanceof Error ? error.message : 'Network error. Please try again.');
      password.focus();
      unlock();
    }
  });

  addEventListener('pageshow', () => {
    unlock();
    if (email?.getAttribute('aria-invalid') === 'true') clearError(email);
    if (password?.getAttribute('aria-invalid') === 'true') clearError(password);
  });
}
