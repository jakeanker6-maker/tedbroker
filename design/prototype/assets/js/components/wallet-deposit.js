// @ts-check
/**
 * Three-step deposit dialog: Amount → Method → Confirm (demo mode).
 * <dialog id="deposit"><form data-component="wallet-deposit" novalidate>
 *   <ol data-steps style="--step:1"><li>…</li>×3</ol>
 *   <fieldset data-step="1"> … <input id="dep-amount" name="amount"> <button data-quick="100">
 *   <fieldset data-step="2"> radios name="method" (bank|crypto|paypal), [data-method-detail="…"], #dep-network, [data-dep-address]
 *   <fieldset data-step="3"> [data-sum="amount|method|fee|receive"]
 *   <button data-dep-back> <button type="submit" data-dep-next><span data-label>Continue</span></button>
 * Opens automatically when location.hash is #deposit. Resets when closed.
 */
import { format, toast } from '../lib/util.js';
import { clearError, setError } from './auth-form.js';

const MIN = 10;
const MAX = 1_000_000;
const FEES = { bank: 0, crypto: 0, paypal: 0.029 };
const ADDRESSES = {
  btc: 'bc1qdemo7ted0brokers0example0address9x',
  eth: '0xDEMO00TedBrokers00Example00Address0000',
  usdt: 'TDemoTedBrokersExampleAddress00000',
};

/** Parse "$1,000.50" → 1000.5 (NaN if empty/invalid). @param {string} s */
export const parseAmount = (s) => {
  const raw = s.trim().replace(/[\s,$]/g, '');
  return raw === '' || !/^\d*\.?\d*$/.test(raw) ? NaN : Number(raw);
};

/** @param {number} v */
export function amountError(v) {
  if (!Number.isFinite(v) || v <= 0) return 'Enter an amount to deposit.';
  if (v < MIN) return `The minimum deposit is ${format(MIN, 'currency', 0)}.`;
  if (v > MAX) return `The maximum deposit is ${format(MAX, 'currency', 0)}.`;
  return '';
}

/** @param {HTMLFormElement} form */
export function init(form) {
  const dialog = form.closest('dialog');
  if (!(form instanceof HTMLFormElement) || !(dialog instanceof HTMLDialogElement)) return;
  const ac = new AbortController();
  const { signal } = ac;
  const $ = (/** @type {string} */ s) => form.querySelector(s);

  const steps = /** @type {HTMLFieldSetElement[]} */ ([...form.querySelectorAll('[data-step]')]);
  const indicator = /** @type {HTMLElement|null} */ ($('[data-steps]'));
  const amount = /** @type {HTMLInputElement} */ ($('#dep-amount'));
  const network = /** @type {HTMLSelectElement|null} */ ($('#dep-network'));
  const address = $('[data-dep-address]');
  const addressCopy = $('[data-dep-address-copy]');
  const back = /** @type {HTMLButtonElement} */ ($('[data-dep-back]'));
  const next = /** @type {HTMLButtonElement} */ ($('[data-dep-next]'));
  const nextLabel = next.querySelector('[data-label]') || next;
  let step = 1;

  const method = () => /** @type {HTMLInputElement|null} */ ($('input[name="method"]:checked'))?.value || 'bank';

  const renderMethod = () => {
    const m = method();
    form.querySelectorAll('[data-method-detail]').forEach((el) => {
      if (el instanceof HTMLElement) el.hidden = el.dataset.methodDetail !== m;
    });
  };

  const renderNetwork = () => {
    if (!network || !address) return;
    const a = ADDRESSES[network.value] || ADDRESSES.btc;
    address.textContent = a;
    addressCopy?.setAttribute('data-copy', a);
  };

  const renderQuick = () => {
    const v = parseAmount(amount.value);
    form.querySelectorAll('[data-quick]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-quick')) === v)));
  };

  const renderSummary = () => {
    const v = parseAmount(amount.value);
    const m = method();
    const fee = Math.round(v * FEES[m] * 100) / 100;
    const label = /** @type {HTMLElement|null} */ ($(`input[name="method"][value="${m}"]`))?.dataset.name || m;
    const net = m === 'crypto' && network ? ` · ${network.selectedOptions[0]?.textContent || ''}` : '';
    const set = (/** @type {string} */ k, /** @type {string} */ t) => { const el = $(`[data-sum="${k}"]`); if (el) el.textContent = t; };
    set('amount', format(v, 'currency', 2));
    set('method', label + net);
    set('fee', fee ? `${format(fee, 'currency', 2)} (2.9%)` : format(0, 'currency', 2));
    set('receive', format(v - fee, 'currency', 2));
  };

  /** @param {number} n @param {boolean} [focus] */
  const go = (n, focus = true) => {
    step = n;
    steps.forEach((fs) => { fs.hidden = Number(fs.dataset.step) !== n; });
    if (indicator) {
      indicator.style.setProperty('--step', String(n));
      [...indicator.children].forEach((li, i) => {
        if (i + 1 === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
        li.toggleAttribute('data-done', i + 1 < n);
      });
    }
    back.textContent = n === 1 ? 'Cancel' : 'Back';
    nextLabel.textContent = n === 3 ? 'Confirm deposit' : 'Continue';
    if (n === 3) renderSummary();
    if (!focus) return;
    const target = n === 1 ? amount : n === 2 ? $('input[name="method"]:checked') : next;
    /** @type {HTMLElement|null} */ (target)?.focus();
  };

  const reset = () => {
    form.reset();
    next.removeAttribute('aria-busy');
    next.disabled = false;
    clearError(amount);
    renderMethod();
    renderNetwork();
    renderQuick();
    go(1, false);
    if (location.hash === '#deposit') history.replaceState(null, '', location.pathname + location.search);
  };

  const confirm = () => {
    if (next.getAttribute('aria-busy') === 'true') return;
    next.setAttribute('aria-busy', 'true');
    next.disabled = true;
    setTimeout(() => {
      toast('Deposit request created — pending confirmation');
      dialog.close();
    }, 700);
  };

  const advance = () => {
    if (step === 1) {
      const msg = amountError(parseAmount(amount.value));
      if (msg) { setError(amount, msg); amount.focus(); return; }
      clearError(amount);
      amount.value = format(parseAmount(amount.value), 'number', parseAmount(amount.value) % 1 ? 2 : 0);
      go(2);
    } else if (step === 2) {
      go(3);
    } else {
      confirm();
    }
  };

  form.addEventListener('submit', (e) => { e.preventDefault(); advance(); }, { signal });

  // Enter on a radio advances too (implicit submission doesn't cover radios everywhere).
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type === 'radio') { e.preventDefault(); advance(); }
  }, { signal });

  back.addEventListener('click', () => { if (step === 1) dialog.close(); else go(step - 1); }, { signal });

  form.addEventListener('click', (e) => {
    const q = /** @type {HTMLElement} */ (e.target).closest('[data-quick]');
    if (!q) return;
    amount.value = format(Number(q.getAttribute('data-quick')), 'number', 0);
    clearError(amount);
    renderQuick();
    amount.focus();
  }, { signal });

  amount.addEventListener('input', () => { clearError(amount); renderQuick(); }, { signal });
  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.name === 'method') renderMethod();
    if (t === network) renderNetwork();
  }, { signal });

  dialog.addEventListener('close', reset, { signal });

  const openFromHash = () => { if (location.hash === '#deposit' && !dialog.open) dialog.showModal(); };
  addEventListener('hashchange', openFromHash, { signal });

  renderMethod();
  renderNetwork();
  renderQuick();
  go(1, false);
  openFromHash(); // the amount input carries `autofocus`, so showModal() lands there

  return () => ac.abort();
}
