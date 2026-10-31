// @ts-check
/**
 * Settings → Security panel behaviour.
 *
 * Contracts (all inside the element carrying data-component="set-security" unless noted):
 *  - [data-set-2fa]            <input type="checkbox" role="switch" class="switch"> — change opens a dialog,
 *                              the switch only flips after the dialog is confirmed.
 *  - [data-set-2fa-status]     inline tag describing 2FA state.   [data-set-2fa-meta] "Added …" line.
 *  - [data-set-2fa-only]       elements shown only while 2FA is on. [data-set-2fa-disable] opens the disable dialog.
 *  - [data-set-meter] / [data-set-meter-text] / [data-set-check="2fa"] — security score UI.
 *  - [data-set-goto="tabId"]   link that selects another settings tab.
 *  - [data-set-sessions]       tbody of login history; [data-set-signout] per-row buttons; rows carry data-device.
 *  - [data-set-signout-all]    opens #set-signout-dialog; [data-set-signout-all-confirm] (in dialog) confirms.
 *  - #set-2fa-enable / #set-2fa-disable dialogs containing form[data-set-otp="enable|disable"] with input[name="code"].
 *  - [data-set-qr] (in enable dialog) receives a generated decorative QR SVG.
 *  - #pw-new / #pw-confirm (password dialog): confirm must match.
 */
import { format, rng, svg, toast } from '../lib/util.js';

const byId = (id) => document.getElementById(id);

export function init(root) {
  const sw = /** @type {HTMLInputElement|null} */ (root.querySelector('[data-set-2fa]'));
  const enableDlg = /** @type {HTMLDialogElement|null} */ (byId('set-2fa-enable'));
  const disableDlg = /** @type {HTMLDialogElement|null} */ (byId('set-2fa-disable'));

  /* ---------- Security score ---------- */
  const renderScore = () => {
    const checks = [...root.querySelectorAll('[data-set-check]')];
    const on = checks.filter((c) => c.getAttribute('data-state') !== 'off').length;
    const total = checks.length || 4;
    const meter = root.querySelector('[data-set-meter]');
    if (meter instanceof HTMLElement) {
      meter.querySelectorAll('span').forEach((s, i) => s.classList.toggle('is-on', i < on));
      meter.dataset.level = on >= 3 ? 'strong' : on === 2 ? 'fair' : 'weak';
    }
    const text = root.querySelector('[data-set-meter-text]');
    const word = on >= 3 ? 'Strong' : on === 2 ? 'Fair' : 'Weak';
    if (text) text.textContent = `${word} · ${format(on, 'number', 0)} of ${format(total, 'number', 0)} protections on`;
  };

  /* ---------- 2FA ---------- */
  const set2fa = (on) => {
    if (sw) sw.checked = on;
    const tag = root.querySelector('[data-set-2fa-status]');
    if (tag) {
      tag.className = on ? 'tag tag--plain tag--gain' : 'tag tag--plain tag--loss';
      tag.textContent = on ? 'Enabled via authenticator app' : 'Off';
    }
    const meta = root.querySelector('[data-set-2fa-meta]');
    if (meta) {
      const today = new Intl.DateTimeFormat(document.documentElement.lang || 'en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
      meta.textContent = on ? `Added ${today} · Authenticator (TOTP)` : 'Your account is protected by password only.';
    }
    root.querySelectorAll('[data-set-2fa-only]').forEach((el) => { /** @type {HTMLElement} */ (el).hidden = !on; });
    const check = root.querySelector('[data-set-check="2fa"]');
    if (check) {
      check.setAttribute('data-state', on ? 'on' : 'off');
      const glyph = check.querySelector('[data-glyph]');
      if (glyph) glyph.textContent = on ? '✓' : '○';
      const label = check.querySelector('[data-label]');
      if (label) label.textContent = on ? '2FA enabled' : '2FA off';
    }
    renderScore();
  };

  sw?.addEventListener('change', () => {
    const want = sw.checked;
    sw.checked = !want; // nothing changes until the dialog is confirmed; cancelling leaves it as it was
    (want ? enableDlg : disableDlg)?.showModal();
  });
  root.querySelector('[data-set-2fa-disable]')?.addEventListener('click', () => disableDlg?.showModal());

  for (const dlg of [enableDlg, disableDlg]) {
    const form = dlg?.querySelector('form[data-set-otp]');
    if (!dlg || !(form instanceof HTMLFormElement)) continue;
    const input = /** @type {HTMLInputElement|null} */ (form.querySelector('input[name="code"]'));
    const submit = form.querySelector('[type="submit"]');
    input?.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
      if (input.getAttribute('aria-invalid') === 'true' && input.value.length === 6) input.removeAttribute('aria-invalid');
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!input || submit?.hasAttribute('disabled')) return;
      if (!/^\d{6}$/.test(input.value)) {
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      input.removeAttribute('aria-invalid');
      submit?.setAttribute('aria-busy', 'true');
      submit?.setAttribute('disabled', '');
      setTimeout(() => {
        submit?.removeAttribute('aria-busy');
        submit?.removeAttribute('disabled');
        const on = form.dataset.setOtp === 'enable';
        dlg.close();
        set2fa(on);
        sw?.focus();
        toast(on ? 'Two-factor authentication is on' : 'Two-factor authentication is off');
      }, 800);
    });
    dlg.addEventListener('close', () => { form.reset(); input?.removeAttribute('aria-invalid'); });
  }

  /* Decorative QR (demo only — it encodes nothing). */
  const qrHost = enableDlg?.querySelector('[data-set-qr]');
  if (qrHost) qrHost.prepend(fakeQr());

  /* ---------- Go to another tab ---------- */
  root.addEventListener('click', (e) => {
    const link = /** @type {HTMLElement} */ (e.target).closest('[data-set-goto]');
    if (!link) return;
    const tab = byId(link.getAttribute('data-set-goto') || '');
    if (!tab) return;
    e.preventDefault();
    tab.click();
    tab.focus();
    tab.scrollIntoView({ block: 'nearest' });
  });

  /* ---------- Login history ---------- */
  const sessions = root.querySelector('[data-set-sessions]');
  const sessionsRegion = /** @type {HTMLElement|null} */ (sessions?.closest('[role="region"]') || null);
  const signoutAllBtn = /** @type {HTMLButtonElement|null} */ (root.querySelector('[data-set-signout-all]'));
  const signoutDlg = /** @type {HTMLDialogElement|null} */ (byId('set-signout-dialog'));
  const otherRows = () => [...(sessions?.querySelectorAll('tr[data-device]') || [])].filter((r) => r.querySelector('[data-set-signout]'));
  const syncSignoutAll = () => {
    if (!signoutAllBtn) return;
    const none = otherRows().length === 0;
    signoutAllBtn.disabled = none;
    signoutAllBtn.textContent = none ? 'No other sessions' : 'Sign out of all other sessions';
  };

  sessions?.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('[data-set-signout]');
    if (!btn) return;
    const row = btn.closest('tr');
    if (!row) return;
    const name = row.getAttribute('data-device') || 'that device';
    const rows = otherRows();
    const i = rows.indexOf(row);
    const next = rows[i + 1] || rows[i - 1];
    row.remove();
    const nextBtn = /** @type {HTMLElement|null} */ (next?.querySelector('[data-set-signout]') || null);
    (nextBtn || sessionsRegion)?.focus();
    syncSignoutAll();
    toast(`Signed out of ${name}`);
  });

  signoutAllBtn?.addEventListener('click', () => signoutDlg?.showModal());
  signoutDlg?.querySelector('[data-set-signout-all-confirm]')?.addEventListener('click', () => {
    const rows = otherRows();
    rows.forEach((r) => r.remove());
    signoutDlg.close();
    syncSignoutAll();
    sessionsRegion?.focus();
    const n = rows.length;
    const one = new Intl.PluralRules(document.documentElement.lang || 'en').select(n) === 'one';
    toast(`Signed out of ${format(n, 'number', 0)} other ${one ? 'session' : 'sessions'}`);
  });
  syncSignoutAll();

  /* ---------- Password dialog: confirm must match ---------- */
  const pwNew = /** @type {HTMLInputElement|null} */ (byId('pw-new'));
  const pwConfirm = /** @type {HTMLInputElement|null} */ (byId('pw-confirm'));
  const checkMatch = () => {
    if (!pwNew || !pwConfirm) return;
    const bad = pwConfirm.value !== '' && pwConfirm.value !== pwNew.value;
    pwConfirm.setCustomValidity(bad ? 'Passwords don’t match' : '');
    if (bad) pwConfirm.setAttribute('aria-invalid', 'true'); else pwConfirm.removeAttribute('aria-invalid');
  };
  pwNew?.addEventListener('input', checkMatch);
  pwConfirm?.addEventListener('input', checkMatch);
  pwConfirm?.closest('dialog')?.addEventListener('close', () => {
    const form = pwConfirm.form;
    form?.reset();
    pwConfirm.removeAttribute('aria-invalid');
    pwConfirm.setCustomValidity('');
    pwNew?.dispatchEvent(new Event('input')); // reset the strength meter
  });

  renderScore();
}

/** 25×25 dot grid with three finder patterns. Decorative only. */
function fakeQr() {
  const N = 25, r = rng(48211);
  const nodes = [];
  const inFinder = (x, y) => (x < 8 && y < 8) || (x >= N - 8 && y < 8) || (x < 8 && y >= N - 8);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (inFinder(x, y) || r() < 0.5) continue;
      nodes.push(svg('circle', { cx: x + 0.5, cy: y + 0.5, r: 0.42 }));
    }
  }
  for (const [fx, fy] of [[0, 0], [N - 7, 0], [0, N - 7]]) {
    nodes.push(svg('rect', { x: fx + 0.5, y: fy + 0.5, width: 6, height: 6, rx: 1, fill: 'none', stroke: 'currentColor', 'stroke-width': 1 }));
    nodes.push(svg('rect', { x: fx + 2, y: fy + 2, width: 3, height: 3, rx: 0.6 }));
  }
  return svg('svg', { viewBox: `0 0 ${N} ${N}`, fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' }, nodes);
}
