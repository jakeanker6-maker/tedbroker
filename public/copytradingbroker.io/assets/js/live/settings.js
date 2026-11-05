// @ts-check
/**
 * Settings: profile, security status, login history, language, verification and payout accounts,
 * all read from the account. Controls the backend cannot change yet are disabled
 * and explained, and unsupported sections are labelled as demo data.
 */
import { api, date, esc, saveUser } from './api.js';
import { initBase } from './base.js';
import { busy, markDemo, settle } from './shell.js';
import { toast } from '../lib/util.js';
import { currentLanguage, setLanguage } from "./i18n.js";
import { clearError, setError } from '../components/auth-form.js';
import { initPayout } from './payout.js';

const $ = (/** @type {string} */ s, root = document) => root.querySelector(s);
const $$ = (/** @type {string} */ s, root = document) => [...root.querySelectorAll(s)];

/** @param {string} title @param {HTMLElement|null} el */
const disable = (el, title) => {
  if (!(el instanceof HTMLElement)) return;
  if (el instanceof HTMLButtonElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.disabled = true;
  el.setAttribute('aria-disabled', 'true');
  if (title) el.title = title;
};

async function boot() {
  const session = await initBase();
  // Payout accounts load on their own (own busy state); demo mode is handled inside.
  initPayout(session.demo).catch((err) => console.error('[payout]', err));
  const sections = {
    personal: $('#set-panel-personal'),
    security: $('#set-panel-security'),
    preferences: $('#set-panel-preferences'),
    verification: $('#set-panel-verification'),
  };

  if (session.demo) {
    markDemo($('#set-notify-title')?.closest('.set-row') || null, 'Demo preview: notification settings are not saved.');
    markDemo($('#set-logins-title')?.closest('.set-row') || null, 'Demo preview: sample sign-in devices.');
    return;
  }

  const me = session.me;
  for (const panel of Object.values(sections)) if (panel) busy(panel);

  const [onbRes, dataRes, histRes, prefRes] = await Promise.allSettled([
    api('/api/onboarding/status'),
    api('/api/onboarding/data'),
    api('/api/auth/login-history?limit=10'),
    api('/api/language/preference'),
  ]);
  const onboarding = onbRes.status === 'fulfilled' ? onbRes.value : null;
  const onboardingData = dataRes.status === 'fulfilled' ? dataRes.value : null;
  const history = histRes.status === 'fulfilled' && Array.isArray(histRes.value?.history) ? histRes.value.history : [];
  const preference = prefRes.status === 'fulfilled' ? prefRes.value : null;
  const completedSteps = new Set(Array.isArray(onboarding?.completed_steps) ? onboarding.completed_steps : []);

  renderPersonal(me, onboardingData);
  wirePersonal(me);
  renderSecurity(me, onboarding, completedSteps);
  renderHistory(history);
  renderPreferences(preference);
  renderVerification(onboarding, completedSteps);
  wirePasswordDialog(me);
  disableUnsupported(me);

  markDemo($('#set-notify-title')?.closest('.set-row') || null, 'Notification preferences are not saved yet.');
  busy(sections.personal, false);
  busy(sections.security, false);
  busy(sections.preferences, false);
  busy(sections.verification, false);
}

/**
 * @param {any} me
 * @param {any} data
 */
function renderPersonal(me, data) {
  const first = data?.personal_info?.first_name || String(me.full_name || '').split(/\s+/)[0] || '';
  const last = data?.personal_info?.last_name || String(me.full_name || '').split(/\s+/).slice(1).join(' ') || '';
  setValue('#pd-first', first);
  setValue('#pd-last', last);
  setValue('#pd-user', me.username || '');
  setValue('#pd-phone', me.phone || '');

  const country = /** @type {HTMLSelectElement|null} */ ($('#pd-country'));
  if (country) {
    const wanted = String(me.country || '');
    const match = [...country.options].find((o) => o.value === wanted || o.textContent === wanted);
    if (!match) {
      country.insertBefore(new Option('Not set', ''), country.firstChild);
    }
    country.value = match ? match.value : '';
  }

  const address = data?.address || {};
  setValue('#pd-address', address.street || '');
  setValue('#pd-city', address.city || '');
  setValue('#pd-postal', address.zip_code || '');

  const username = /** @type {HTMLInputElement|null} */ ($('#pd-user'));
  disable(username, 'Usernames cannot be changed here.');
  for (const id of ['#pd-address', '#pd-city', '#pd-postal']) {
    disable(/** @type {HTMLElement|null} */ ($(id)), 'Address is set during identity verification.');
  }
  const foot = $('.set-form-foot .set-meta');
  if (foot) foot.textContent = 'Address details are set during identity verification. Your email is managed under Security.';
}

/** @param {string} selector @param {string} value */
function setValue(selector, value) {
  const el = /** @type {HTMLInputElement|null} */ ($(selector));
  if (el) el.value = value;
}

/** @param {any} me */
function wirePersonal(me) {
  const form = /** @type {HTMLFormElement|null} */ ($('#set-panel-personal form'));
  if (!form) return;
  form.removeAttribute('data-demo-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const first = /** @type {HTMLInputElement} */ ($('#pd-first', form)).value.trim();
    const last = /** @type {HTMLInputElement} */ ($('#pd-last', form)).value.trim();
    const phone = /** @type {HTMLInputElement} */ ($('#pd-phone', form)).value.trim();
    const country = /** @type {HTMLSelectElement} */ ($('#pd-country', form)).value;
    const button = /** @type {HTMLButtonElement|null} */ (form.querySelector('[type="submit"]'));
    button?.setAttribute('aria-busy', 'true');
    if (button) button.disabled = true;
    try {
      const updated = await api('/api/auth/update-profile', {
        method: 'PUT',
        body: JSON.stringify({ full_name: `${first} ${last}`.trim(), phone, country: country || null }),
      });
      saveUser(updated);
      toast('Personal details saved');
    } catch (err) {
      toast(/** @type {Error} */ (err).message || 'Could not save your details.');
    } finally {
      button?.removeAttribute('aria-busy');
      if (button) button.disabled = false;
    }
    void me;
  });
}

/**
 * @param {any} me
 * @param {any} onboarding
 * @param {Set<string>} completedSteps
 */
function renderSecurity(me, onboarding, completedSteps) {
  const identityDone = !!onboarding?.is_onboarding_complete || completedSteps.has('kyc');
  const checks = {
    email: !!me.is_verified,
    '2fa': !!me.two_fa_enabled,
    password: !!me.has_password,
    identity: identityDone,
  };
  const on = Object.values(checks).filter(Boolean).length;
  const level = on >= 4 ? 'strong' : on >= 2 ? 'medium' : 'weak';

  const labels = {
    email: ['Email verified', 'Email not verified'],
    '2fa': ['2FA enabled', '2FA not enabled'],
    password: ['Password set', 'No password set'],
    identity: ['Identity verified', 'Identity verification pending'],
  };
  for (const [key, ok] of Object.entries(checks)) {
    const li = $(`[data-set-check="${key}"]`);
    if (!(li instanceof HTMLElement)) continue;
    li.dataset.state = ok ? 'on' : 'off';
    const glyph = li.querySelector('[data-glyph]');
    if (glyph) glyph.textContent = ok ? '✓' : '○';
    const label = li.querySelector('[data-label]');
    const pair = labels[/** @type {keyof typeof labels} */ (key)];
    if (label && pair) label.textContent = ok ? pair[0] : pair[1];
  }
  const identityLink = $('[data-set-check="identity"] a');
  if (identityLink instanceof HTMLElement) identityLink.hidden = identityDone;
  const text = $('[data-set-meter-text]');
  if (text) text.textContent = `${level[0].toUpperCase()}${level.slice(1)} · ${on} of 4 protections on`;
  const meter = $('[data-set-meter]');
  if (meter instanceof HTMLElement) {
    meter.dataset.level = level;
    meter.querySelectorAll('span').forEach((span, i) => span.classList.toggle('is-on', i < Math.min(4, Math.ceil(on)) && on > 0));
  }

  const emailStatus = $('[data-email-status]');
  if (emailStatus) {
    emailStatus.hidden = false;
    emailStatus.textContent = me.is_verified ? 'Verified' : 'Not verified';
    emailStatus.className = `tag tag--plain ${me.is_verified ? 'tag--gain' : 'tag--pending'}`;
  }

  const twoFa = /** @type {HTMLInputElement|null} */ ($('#set-2fa'));
  if (twoFa) {
    twoFa.checked = !!me.two_fa_enabled;
    disable(twoFa, 'Changing two-factor authentication is not available in this app yet.');
  }
  const status = $('[data-set-2fa-status]');
  if (status) {
    status.textContent = me.two_fa_enabled ? 'Enabled' : 'Not enabled';
    status.className = `tag tag--plain ${me.two_fa_enabled ? 'tag--gain' : 'tag--pending'}`;
  }
  const meta = $('[data-set-2fa-meta]');
  if (meta) meta.textContent = 'Codes are sent to your email when you sign in.';
  $('[data-set-2fa-only]')?.remove();

  const pwMeta = $('#set-panel-security .set-line .mono');
  if (pwMeta) pwMeta.textContent = me.has_password ? 'Password is set for email sign-in' : 'No password set. You sign in with Google.';
  const pwButton = /** @type {HTMLButtonElement|null} */ ($('[data-dialog-open="set-password-dialog"]'));
  if (!me.has_password) disable(pwButton, 'Set a password from the sign-in page first.');

  const emailLine = $('#set-email-title')?.closest('.set-row')?.querySelector('.cluster');
  if (emailLine) {
    const emailText = emailLine.querySelector('span');
    const tag = emailLine.querySelector('.tag');
    if (emailText) emailText.textContent = me.email || '';
    if (tag) {
      tag.textContent = me.is_verified ? 'Verified' : 'Not verified';
      tag.className = `tag tag--plain ${me.is_verified ? 'tag--gain' : 'tag--pending'}`;
    }
  }
  disable(/** @type {HTMLElement|null} */ ($('[data-dialog-open="set-email-dialog"]')), 'Changing your email is not available in this app yet.');
}

/** @param {any[]} history */
function renderHistory(history) {
  const body = $('[data-set-sessions]');
  if (!body) return;
  if (!history.length) {
    body.innerHTML = `<tr><td colspan="5"><div class="empty"><p class="empty__title">No sign-ins recorded yet</p><p>Your recent sign-ins will appear here.</p></div></td></tr>`;
    return;
  }
  body.innerHTML = history.map((h) => {
    const device = h.device_info && typeof h.device_info === 'object' ? h.device_info : {};
    const location = h.location && typeof h.location === 'object' ? h.location : {};
    const where = [location.city, location.country].filter((v) => v && !['Local', 'N/A', 'Unknown'].includes(String(v))).join(', ') || 'Unknown';
    const when = new Date(String(h.timestamp || ''));
    const label = [device.browser, device.os].filter(Boolean).join(' · ') || 'Unknown device';
    const ok = h.success === true || h.success === 'True';
    return `<tr>
      <td><span class="set-device">${esc(label)}</span></td>
      <td class="opt-sm nowrap">${esc(where)}</td>
      <td class="opt mono nowrap">${esc(h.ip_address || '—')}</td>
      <td class="nowrap">${Number.isNaN(when.getTime()) ? '—' : esc(date(when))}</td>
      <td class="is-end"><span class="tag tag--plain ${ok ? 'tag--gain' : 'tag--loss'}">${ok ? 'Signed in' : esc(String(h.failure_reason || 'Failed'))}</span></td>
    </tr>`;
  }).join('');
}

/**
 * @param {any} preference
 */
function renderPreferences(preference) {
  const select = /** @type {HTMLSelectElement|null} */ ($('#pref-lang'));
  if (select) {
    // An unset preference shows the language in use (the region default), not a fixed option.
    const code = String(preference?.preferred_language || currentLanguage());
    if (![...select.options].some((o) => o.value === code)) select.append(new Option(code, code));
    select.value = code;
  }
  const form = /** @type {HTMLFormElement|null} */ ($('#set-panel-preferences form'));
  if (form) {
    form.removeAttribute('data-demo-form');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const lang = /** @type {HTMLSelectElement} */ ($('#pref-lang', form)).value;
      const button = /** @type {HTMLButtonElement|null} */ (form.querySelector('[type="submit"]'));
      if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
      try {
        await api('/api/language/preference', { method: 'PUT', body: JSON.stringify({ language: lang }) });
        setLanguage(lang, 'user');
        toast('Language saved to your account');
      } catch (err) {
        toast(/** @type {Error} */ (err).message || 'Could not save your language.');
      } finally {
        if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
      }
    });
  }
  const currency = /** @type {HTMLSelectElement|null} */ ($('#pref-currency'));
  if (currency) {
    currency.disabled = true;
    currency.title = 'Display currency is not saved yet.';
    const help = $('#pref-currency-help');
    if (help) help.textContent = 'Not saved yet. Balances are always held in USD.';
  }
}

/**
 * @param {any} onboarding
 * @param {Set<string>} completedSteps
 */
function renderVerification(onboarding, completedSteps) {
  const steps = [
    { key: 'personal_info', label: 'Personal info' },
    { key: 'address', label: 'Address' },
    { key: 'kyc', label: 'ID document' },
  ];
  const list = $('#set-panel-verification .set-kyc');
  if (list) {
    const firstOpen = steps.findIndex((s) => !completedSteps.has(s.key));
    list.innerHTML = steps.map((s, i) => {
      const done = completedSteps.has(s.key);
      const current = !done && i === firstOpen;
      const num = done ? '✓' : String(i + 1).padStart(2, '0');
      const tag = done
        ? '<span class="tag tag--plain tag--gain">Completed</span>'
        : current ? '<span class="tag tag--plain tag--pending">In progress</span>' : '<span class="tag tag--plain">Not started</span>';
      return `<li class="set-kyc__step" ${done ? 'data-done' : current ? 'data-current' : ''}>
        <span class="set-kyc__num" aria-hidden="true">${num}</span>
        <div class="set-kyc__body"><h3 class="set-kyc__title">${esc(s.label)}</h3><p>${tag}</p></div>
      </li>`;
    }).join('');
  }
  const remaining = steps.filter((s) => !completedSteps.has(s.key)).length;
  const tabSmall = $('#set-tab-verification small');
  if (tabSmall) tabSmall.textContent = remaining ? `${remaining} step${remaining === 1 ? '' : 's'} left` : 'Complete';

  const form = /** @type {HTMLFormElement|null} */ ($('#set-panel-verification form'));
  if (form) {
    form.removeAttribute('data-component');
    form.removeAttribute('novalidate');
    form.addEventListener('submit', (event) => event.preventDefault());
    const file = /** @type {HTMLInputElement|null} */ ($('#kyc-file', form));
    disable(file, 'Document upload is not available in this app yet.');
    const submit = /** @type {HTMLButtonElement|null} */ (form.querySelector('[type="submit"]'));
    disable(submit, 'Document upload is not available in this app yet.');
    const help = $('#kyc-file-help', form);
    if (help) help.textContent = 'Document upload is not available in this app yet.';
    const status = $('[data-set-kyc-status]');
    if (status) status.textContent = completedSteps.has('kyc') ? 'Submitted' : 'Not uploaded';
  }
  void onboarding;
}

/** @param {any} me */
function wirePasswordDialog(me) {
  const form = /** @type {HTMLFormElement|null} */ ($('#set-password-dialog form'));
  if (!form) return;
  form.removeAttribute('data-demo-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const current = /** @type {HTMLInputElement} */ ($('#pw-current', form));
    const next = /** @type {HTMLInputElement} */ ($('#pw-new', form));
    const confirm = /** @type {HTMLInputElement} */ ($('#pw-confirm', form));
    clearError(current); clearError(next); clearError(confirm);
    if (next.value.length < 8) { setError(next, 'Use at least 8 characters.'); next.focus(); return; }
    if (next.value !== confirm.value) { setError(confirm, 'The passwords do not match.'); confirm.focus(); return; }
    const button = /** @type {HTMLButtonElement|null} */ (form.querySelector('[type="submit"]'));
    if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ old_password: current.value, new_password: next.value }),
      });
      form.reset();
      /** @type {HTMLDialogElement|null} */ (form.closest('dialog'))?.close();
      toast('Password updated');
    } catch (err) {
      setError(current, /** @type {Error} */ (err).message || 'Could not update your password.');
      current.focus();
    } finally {
      if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
    }
  });
  void me;
}

/** @param {any} me */
function disableUnsupported(me) {
  const reason = 'Not available in this app yet.';
  for (const btn of $$('[data-set-signout], [data-set-signout-all]')) disable(/** @type {HTMLElement} */ (btn), reason);
  disable(/** @type {HTMLElement|null} */ ($('[data-dialog-open="set-close-dialog"]')), reason);
  $$('[data-set-goto]').forEach(() => {});
  void me;
}

boot().catch((err) => console.error('[settings]', err)).finally(() => settle());
