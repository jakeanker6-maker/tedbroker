// @ts-check
/**
 * Client-side validation for the sign-in / sign-up forms (demo mode, no backend).
 *
 * <form data-component="auth-form" data-redirect="app/index.html" [data-auth="login"] novalidate>
 *   <div class="field">
 *     <label class="field__label" for="email">Email</label>
 *     <div class="field__control"><input class="field__input" id="email" type="email" required></div>
 *     <p class="field__error" id="email-error"><svg …/><span data-error-msg></span></p>
 *   </div>
 * Rules: [required], type=email format, minlength, pattern, data-match="otherId", required checkbox.
 * Custom messages: data-msg-required, data-msg-email, data-msg-match, data-msg-short, data-msg-pattern.
 *
 * Also exports setError/clearError, reused by the wallet dialogs.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** @param {Element} control */
function errorEl(control) {
  return control.closest('.field')?.querySelector('.field__error') || null;
}

/** @param {Element} el @param {string} id @param {boolean} on */
function toggleToken(el, id, on) {
  const tokens = new Set((el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
  if (on) tokens.add(id); else tokens.delete(id);
  if (tokens.size) el.setAttribute('aria-describedby', [...tokens].join(' '));
  else el.removeAttribute('aria-describedby');
}

/** Show an error on a control. @param {Element} control @param {string} message */
export function setError(control, message) {
  const err = errorEl(control);
  const field = control.closest('.field');
  control.setAttribute('aria-invalid', 'true');
  if (field instanceof HTMLElement) field.dataset.invalid = 'true';
  if (!err) return;
  const msg = err.querySelector('[data-error-msg]') || err;
  msg.textContent = message;
  if (err.id) toggleToken(control, err.id, true);
}

/** Clear an error from a control. @param {Element} control */
export function clearError(control) {
  const err = errorEl(control);
  const field = control.closest('.field');
  control.removeAttribute('aria-invalid');
  if (field instanceof HTMLElement) delete field.dataset.invalid;
  if (!err) return;
  const msg = err.querySelector('[data-error-msg]') || err;
  msg.textContent = '';
  if (err.id) toggleToken(control, err.id, false);
}

/**
 * Validate one control. Returns an error message or ''.
 * @param {HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement} c
 * @param {HTMLFormElement} form
 */
export function check(c, form) {
  const d = c.dataset;
  if (c instanceof HTMLInputElement && c.type === 'checkbox') {
    return c.required && !c.checked ? (d.msgRequired || 'Please accept to continue.') : '';
  }
  const v = c.value.trim();
  if (c.required && !v) return d.msgRequired || 'This field is required.';
  if (!v) return '';
  if (c instanceof HTMLInputElement) {
    if (c.type === 'email' && !EMAIL.test(v)) return d.msgEmail || 'Enter a valid email address, like name@example.com.';
    if (c.minLength > 0 && c.value.length < c.minLength) return d.msgShort || `Use at least ${c.minLength} characters.`;
    if (c.pattern && !new RegExp(`^(?:${c.pattern})$`).test(v)) return d.msgPattern || 'Check the format of this field.';
  }
  if (d.match) {
    const other = /** @type {HTMLInputElement|null} */ (form.querySelector(`#${CSS.escape(d.match)}`));
    if (other && other.value !== c.value) return d.msgMatch || 'The values don’t match.';
  }
  return '';
}

/** @param {HTMLFormElement} form */
export function init(form) {
  if (!(form instanceof HTMLFormElement)) return;
  const ac = new AbortController();
  const { signal } = ac;
  const controls = () => /** @type {(HTMLInputElement|HTMLSelectElement)[]} */ (
    [...form.querySelectorAll('input, select, textarea')].filter((c) => !(c instanceof HTMLInputElement && ['hidden', 'submit', 'button'].includes(c.type)))
  );

  // Clear an error as soon as the user edits the field.
  const onEdit = (/** @type {Event} */ e) => {
    const c = e.target;
    if (c instanceof Element && c.getAttribute('aria-invalid') === 'true') clearError(c);
  };
  form.addEventListener('input', onEdit, { signal });
  form.addEventListener('change', onEdit, { signal });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = /** @type {HTMLButtonElement|null} */ (form.querySelector('[type="submit"]'));
    if (btn?.getAttribute('aria-busy') === 'true') return;

    let first = null;
    for (const c of controls()) {
      const msg = check(c, form);
      if (msg) { setError(c, msg); first ??= c; } else clearError(c);
    }

    // Demo rule for sign-in: short passwords are "wrong".
    if (!first && form.dataset.auth === 'login') {
      const pw = /** @type {HTMLInputElement|null} */ (form.querySelector('input[name="password"]'));
      if (pw && pw.value.length < 8) { setError(pw, 'Incorrect password. 2 attempts left.'); first = pw; }
    }

    if (first) { first.focus(); return; }

    btn?.setAttribute('aria-busy', 'true');
    btn?.setAttribute('disabled', '');
    setTimeout(() => {
      location.href = new URL(form.dataset.redirect || 'index.html', location.href).href;
    }, 900);
  }, { signal });

  // bfcache: re-enable the button if the user navigates back.
  addEventListener('pageshow', () => {
    const btn = form.querySelector('[type="submit"]');
    btn?.removeAttribute('aria-busy');
    btn?.removeAttribute('disabled');
  }, { signal });

  return () => ac.abort();
}
