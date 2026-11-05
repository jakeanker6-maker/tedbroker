// @ts-check
/**
 * Settings → Payout accounts: the bank account and crypto wallets that withdrawals use.
 * Reads and writes /api/withdrawals/*. Server values are only ever set as text. A failed
 * request shows an explicit message in place of the list, never empty or sample rows.
 */
import { api } from './api.js';
import { busy, markDemo } from './shell.js';
import { toast } from '../lib/util.js';
import { h } from '../trade/dom.js';
import { clearError, setError } from '../components/auth-form.js';

const CRYPTO_LIMIT = 3;
const $ = (/** @type {string} */ s, root = document) => /** @type {HTMLElement|null} */ (root.querySelector(s));

/** @type {{ok: boolean, account: any|null}} */
let bank = { ok: true, account: null };
/** @type {{ok: boolean, items: any[]}} */
let crypto = { ok: true, items: [] };
/** Pending delete awaiting confirmation in the dialog. @type {null | {title: string, text: string, status: HTMLElement|null, run: () => Promise<void>}} */
let pending = null;

/** @param {string} v */
const maskNumber = (v) => (v ? `•••• ${v.slice(-4)}` : '');
/** @param {string} v */
const maskAddress = (v) => (v.length > 12 ? `${v.slice(0, 6)}…${v.slice(-4)}` : v);

/**
 * @param {HTMLElement|null} el
 * @param {string} text
 * @param {'error'|'ok'} [tone]
 */
function showMsg(el, text, tone = 'error') {
  if (!el) return;
  el.textContent = text;
  el.dataset.tone = text ? tone : '';
}

/** @param {HTMLElement|null} el @param {boolean} on */
function setBusy(el, on) {
  if (!(el instanceof HTMLButtonElement)) return;
  el.disabled = on;
  if (on) el.setAttribute('aria-busy', 'true'); else el.removeAttribute('aria-busy');
}

/** Fetch both lists. Each request settles on its own, so one failure does not hide the other. */
async function load() {
  showMsg($('[data-payout-bank-status]'), '');
  showMsg($('[data-payout-crypto-status]'), '');
  const [bankRes, cryptoRes] = await Promise.allSettled([
    api('/api/withdrawals/bank-accounts'),
    api('/api/withdrawals/crypto-addresses'),
  ]);
  if (bankRes.status === 'rejected') console.error('[payout] bank accounts failed', bankRes.reason);
  if (cryptoRes.status === 'rejected') console.error('[payout] crypto addresses failed', cryptoRes.reason);
  bank = bankRes.status === 'fulfilled' && Array.isArray(bankRes.value)
    ? { ok: true, account: bankRes.value[0] || null }
    : { ok: false, account: null };
  crypto = cryptoRes.status === 'fulfilled' && Array.isArray(cryptoRes.value)
    ? { ok: true, items: cryptoRes.value }
    : { ok: false, items: [] };
  renderBank();
  renderCrypto();
}

function renderBank() {
  const saved = $('[data-payout-bank-saved]');
  const form = $('[data-payout-bank-form]');
  const status = $('[data-payout-bank-status]');
  if (!saved || !form) return;
  if (!bank.ok) {
    saved.hidden = true;
    form.hidden = true;
    showMsg(status, 'Your bank account couldn’t be loaded. Reload the page to try again.');
    return;
  }
  const a = bank.account;
  saved.hidden = !a;
  form.hidden = !!a;
  if (!a) return;

  const facts = /** @type {Array<[string, string]>} */ ([
    ['Bank name', a.bank_name],
    ['Account holder', a.account_name],
    ['Account number', maskNumber(String(a.account_number || ''))],
    ['SWIFT / BIC', a.swift_code],
    ['IBAN', a.iban ? maskNumber(String(a.iban)) : ''],
  ].filter(([, v]) => v));
  const list = $('[data-payout-bank-facts]');
  list?.replaceChildren(...facts.flatMap(([k, v]) => [
    h('dt', { class: 'payout-facts__key' }, k),
    h('dd', { class: 'payout-facts__value' }, v),
  ]));

  const tag = $('[data-payout-bank-tag]');
  if (tag) {
    tag.className = `tag tag--plain ${a.is_verified ? 'tag--gain' : 'tag--pending'}`;
    tag.textContent = a.is_verified ? 'Verified' : 'Awaiting verification';
  }
}

function renderCrypto() {
  const list = $('[data-payout-crypto-list]');
  const count = $('[data-payout-crypto-count]');
  const empty = $('[data-payout-crypto-empty]');
  const full = $('[data-payout-crypto-full]');
  const form = $('[data-payout-crypto-form]');
  const status = $('[data-payout-crypto-status]');
  if (!list || !count || !empty || !full || !form) return;
  if (!crypto.ok) {
    list.replaceChildren();
    list.hidden = true;
    count.textContent = '—';
    empty.hidden = true;
    full.hidden = true;
    form.hidden = true;
    showMsg(status, 'Your crypto wallets couldn’t be loaded. Reload the page to try again.');
    return;
  }
  const items = crypto.items;
  count.textContent = `${items.length} of ${CRYPTO_LIMIT} used`;
  empty.hidden = items.length > 0;
  list.hidden = items.length === 0;
  list.replaceChildren(...items.map(cryptoItem));
  const atLimit = items.length >= CRYPTO_LIMIT;
  form.hidden = atLimit;
  full.hidden = !atLimit;
}

/** @param {any} w */
function cryptoItem(w) {
  const verified = !!w.is_verified;
  const title = [w.currency, w.network].filter(Boolean).join(' · ');
  const address = String(w.wallet_address || '');
  const masked = maskAddress(address);
  return h('li', { class: 'payout-item' },
    h('div', { class: 'payout-item__main' },
      h('strong', { class: 'payout-item__title' }, title || String(w.currency || 'Wallet')),
      w.label ? h('span', { class: 'payout-item__label' }, String(w.label)) : null,
      h('span', { class: 'payout-item__addr mono' }, masked)),
    h('div', { class: 'payout-item__side' },
      h('span', { class: `tag tag--plain ${verified ? 'tag--gain' : 'tag--pending'}` }, verified ? 'Verified' : 'Awaiting verification'),
      h('button', {
        class: 'btn btn--sm btn--outline',
        type: 'button',
        dataset: { payoutCryptoDelete: String(w.id) },
        'aria-label': `Delete ${title || 'crypto'} wallet ${masked}`,
      }, 'Delete')));
}

/**
 * Open the shared confirm dialog for a delete.
 * @param {{title: string, text: string, status: HTMLElement|null, run: () => Promise<void>}} job
 */
function confirmDelete(job) {
  const dialog = /** @type {HTMLDialogElement|null} */ ($('#payout-confirm-dialog'));
  if (!dialog) return;
  pending = job;
  const title = $('[data-payout-confirm-title]');
  const text = $('[data-payout-confirm-text]');
  if (title) title.textContent = job.title;
  if (text) text.textContent = job.text;
  dialog.showModal();
}

/** @param {any} err */
const messageOf = (err) => /** @type {Error} */ (err)?.message || 'Something went wrong. Try again.';

/** Wire form, list and dialog listeners once. */
function wire() {
  const bankForm = /** @type {HTMLFormElement|null} */ ($('[data-payout-bank-form]'));
  const cryptoForm = /** @type {HTMLFormElement|null} */ ($('[data-payout-crypto-form]'));
  const dialog = /** @type {HTMLDialogElement|null} */ ($('#payout-confirm-dialog'));
  const confirmBtn = /** @type {HTMLButtonElement|null} */ ($('[data-payout-confirm]'));

  $('[data-payout-bank-delete]')?.addEventListener('click', () => confirmDelete({
    title: 'Delete this bank account?',
    text: 'Bank withdrawals will stop going to this account. You can add a new bank account afterwards.',
    status: $('[data-payout-bank-status]'),
    run: async () => {
      await api('/api/withdrawals/bank-accounts/' + encodeURIComponent(String(bank.account?.id)), { method: 'DELETE' });
      await load();
      toast('Bank account deleted');
    },
  }));

  $('[data-payout-crypto-list]')?.addEventListener('click', (event) => {
    const btn = /** @type {HTMLElement|null} */ (event.target instanceof Element ? event.target.closest('[data-payout-crypto-delete]') : null);
    if (!btn) return;
    const id = btn.dataset.payoutCryptoDelete || '';
    confirmDelete({
      title: 'Delete this wallet?',
      text: 'Withdrawals can no longer be sent to this wallet. You can save another one afterwards.',
      status: $('[data-payout-crypto-status]'),
      run: async () => {
        await api('/api/withdrawals/crypto-addresses/' + encodeURIComponent(id), { method: 'DELETE' });
        await load();
        toast('Crypto wallet deleted');
      },
    });
  });

  dialog?.addEventListener('close', () => { pending = null; });
  confirmBtn?.addEventListener('click', async () => {
    const job = pending;
    if (!job || !dialog) return;
    setBusy(confirmBtn, true);
    try {
      await job.run();
      dialog.close();
    } catch (err) {
      dialog.close();
      await load().catch(() => {});
      showMsg(job.status, messageOf(err));
    } finally {
      setBusy(confirmBtn, false);
    }
  });

  bankForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = $('[data-payout-bank-status]');
    const submit = /** @type {HTMLButtonElement|null} */ ($('[data-payout-bank-submit]', bankForm));
    const required = /** @type {HTMLInputElement[]} */ ([...bankForm.querySelectorAll('input[required]')]);
    let firstBad = null;
    for (const input of required) {
      clearError(input);
      if (!input.value.trim()) {
        setError(input, 'This field is required.');
        firstBad ||= input;
      }
    }
    if (firstBad) { firstBad.focus(); return; }

    const data = new FormData(bankForm);
    /** @type {Record<string, string>} */
    const body = {};
    for (const key of ['account_name', 'account_number', 'bank_name', 'swift_code', 'iban', 'routing_number']) {
      const v = String(data.get(key) ?? '').trim();
      if (v) body[key] = v;
    }
    setBusy(submit, true);
    try {
      await api('/api/withdrawals/bank-accounts', { method: 'POST', body: JSON.stringify(body) });
      bankForm.reset();
      await load();
      showMsg(status, 'Bank account saved. It can be used for withdrawals once our team verifies it.', 'ok');
    } catch (err) {
      await load().catch(() => {});
      showMsg(status, messageOf(err));
    } finally {
      setBusy(submit, false);
    }
  });

  cryptoForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = $('[data-payout-crypto-status]');
    const submit = /** @type {HTMLButtonElement|null} */ ($('[data-payout-crypto-submit]', cryptoForm));
    const address = /** @type {HTMLInputElement|null} */ ($('#pc-address', cryptoForm));
    if (!address) return;
    clearError(address);
    const wallet = address.value.trim();
    if (wallet.length < 10 || wallet.length > 100) {
      setError(address, 'Enter a wallet address of 10 to 100 characters.');
      address.focus();
      return;
    }
    const data = new FormData(cryptoForm);
    /** @type {Record<string, string>} */
    const body = { currency: String(data.get('currency') || ''), wallet_address: wallet };
    for (const key of ['network', 'label']) {
      const v = String(data.get(key) ?? '').trim();
      if (v) body[key] = v;
    }
    setBusy(submit, true);
    try {
      await api('/api/withdrawals/crypto-addresses', { method: 'POST', body: JSON.stringify(body) });
      cryptoForm.reset();
      await load();
      showMsg(status, 'Wallet saved. It can be used for withdrawals once our team verifies it.', 'ok');
    } catch (err) {
      await load().catch(() => {});
      showMsg(status, messageOf(err));
    } finally {
      setBusy(submit, false);
    }
  });
}

/** Open the tab when the page is loaded or navigated to with #payout (tabs.js attaches its listeners asynchronously). */
function openFromHash() {
  if (location.hash !== '#payout') return;
  const tab = document.getElementById('set-tab-payout');
  let tries = 0;
  const attempt = () => {
    if (!tab || tab.getAttribute('aria-selected') === 'true' || tries++ > 40) return;
    tab.click();
    setTimeout(attempt, 50);
  };
  attempt();
}

/**
 * @param {boolean} demo
 */
export async function initPayout(demo) {
  const root = /** @type {HTMLElement|null} */ ($('[data-payout]'));
  if (!root) return;
  addEventListener('hashchange', openFromHash);
  openFromHash();

  if (demo) {
    // Demo preview never shows accounts: explain it, and hide the forms and lists.
    for (const section of root.querySelectorAll('.set-row')) {
      markDemo(section, 'Demo preview: payout accounts are not loaded.');
    }
    $('[data-payout-bank-form]')?.setAttribute('hidden', '');
    $('[data-payout-crypto-form]')?.setAttribute('hidden', '');
    $('[data-payout-bank-saved]')?.setAttribute('hidden', '');
    showMsg($('[data-payout-bank-status]'), 'Payout accounts are not available in demo mode.', 'ok');
    showMsg($('[data-payout-crypto-status]'), 'Payout accounts are not available in demo mode.', 'ok');
    const count = $('[data-payout-crypto-count]');
    if (count) count.textContent = '—';
    busy(root, false);
    return;
  }

  busy(root);
  wire();
  try {
    await load();
  } finally {
    busy(root, false);
  }
}
