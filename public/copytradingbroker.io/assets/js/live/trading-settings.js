// @ts-check
/** Settings > Trading account: margin upgrade/downgrade and options-level application. */
import { api } from './api.js';
import { toast } from '../lib/util.js';

const root = document.querySelector('[data-trading-settings]');
const $ = (/** @type {string} */ s) => /** @type {HTMLElement|null} */ (root?.querySelector(s) || null);

/** @param {any} a */
function render(a) {
  const type = $('[data-ts-type]');
  if (type) {
    type.textContent = a.account_type === 'margin' ? 'Margin account' : 'Cash account';
    type.className = `tag tag--plain ${a.account_type === 'margin' ? 'tag--gain' : ''}`;
  }
  const meta = $('[data-ts-meta]');
  if (meta) {
    meta.textContent = a.account_type === 'margin'
      ? `Agreement accepted ${a.margin_agreement_at ? new Date(a.margin_agreement_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : ''} · Margin rate ${a.margin_interest_rate}% APR`
      : 'Trades settle with cash only. No borrowing or short selling.';
  }
  const form = $('[data-ts-margin-form]');
  if (form) form.hidden = a.account_type === 'margin';
  const down = $('[data-ts-downgrade]');
  if (down) down.hidden = a.account_type !== 'margin';
  const lvl = $('[data-ts-level]');
  if (lvl) lvl.textContent = a.options_level_name || `Level ${a.options_level}`;
  const sel = /** @type {HTMLSelectElement|null} */ ($('#ts-level'));
  if (sel) sel.value = String(Math.min(4, (a.options_level || 0) + 1));
}

async function load() {
  try { render(await api('/api/trading/account')); } catch (err) { console.error('[trading-settings]', err); }
}

$('[data-ts-margin-form]')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = /** @type {HTMLFormElement} */ (e.target);
  const err = $('[data-ts-margin-error]');
  const agreement = /** @type {HTMLInputElement} */ (f.elements.namedItem('agreement')).checked;
  const disclosure = /** @type {HTMLInputElement} */ (f.elements.namedItem('disclosure')).checked;
  if (!agreement || !disclosure) {
    if (err) { err.textContent = 'Accept both the agreement and the risk disclosure to continue.'; err.hidden = false; }
    return;
  }
  try {
    const a = await api('/api/trading/account/margin-upgrade', { method: 'POST',
      body: JSON.stringify({ accept_margin_agreement: true, accept_risk_disclosure: true }) });
    if (err) err.hidden = true;
    toast('Your account is now a margin account.');
    render({ ...a, options_level_name: a.options_level_name });
    load();
  } catch (e2) {
    if (err) { err.textContent = /** @type {Error} */ (e2).message; err.hidden = false; }
  }
});

$('[data-ts-downgrade-btn]')?.addEventListener('click', async () => {
  try {
    await api('/api/trading/account/cash-downgrade', { method: 'POST' });
    toast('Your account is now a cash account.');
    load();
  } catch (e) { toast(/** @type {Error} */ (e).message, { tone: 'error' }); }
});

$('[data-ts-options-form]')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = /** @type {HTMLFormElement} */ (e.target);
  const data = new FormData(f);
  const out = $('[data-ts-options-result]');
  try {
    const r = await api('/api/trading/account/options-level', { method: 'POST', body: JSON.stringify({
      level: Number(data.get('level')), experience: data.get('experience'), objective: data.get('objective'),
      understands_risk: data.get('understands_risk') === 'on' }) });
    if (out) {
      out.textContent = r.approved ? `Approved: ${r.options_level_name}.` : `Not approved: ${r.reasons.join(' ')} Your level is ${r.options_level_name}.`;
      out.className = `field__help ${r.approved ? 'gain' : 'loss'}`;
    }
    load();
  } catch (e2) {
    if (out) { out.textContent = /** @type {Error} */ (e2).message; out.className = 'field__help loss'; }
  }
});

if (root) {
  load();
  if (location.hash === '#trading') setTimeout(() => document.getElementById('set-tab-trading')?.click(), 50);
}
