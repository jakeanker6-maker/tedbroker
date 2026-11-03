// @ts-check
/**
 * Wallet: live balance, pending items, weekly cash flow, transaction ledger and the
 * deposit / withdrawal dialogs. Every figure and option comes from the account's
 * database records; history merges funding requests with posted ledger entries. The
 * dialogs submit to the existing request endpoints (admin approval credits the ledger).
 */
import { api, date, dateTimeAttr, int, money } from './api.js';
import { initBase, statusTag } from './base.js';
import { toast } from '../lib/util.js';
import { busy, markDemo, settle } from './shell.js';
import { clearError, setError } from '../components/auth-form.js';
import { h } from '../trade/dom.js';

const $ = (/** @type {string} */ s, root = document) => root.querySelector(s);
const $$ = (/** @type {string} */ s, root = document) => [...root.querySelectorAll(s)];
const MIN_AMOUNT = 10;
const MAX_DEPOSIT = 1000000;
/** Cash that can leave the account right now (excludes funds on hold). */
let withdrawable = 0;

/** @param {unknown} v */
const parseAmount = (v) => Number(String(v ?? '').replace(/[^0-9.]/g, ''));

/** @param {any} txn */
function kindOf(txn) {
  const t = String(txn.transaction_type || '').toLowerCase();
  if (t === 'deposit') return 'deposit';
  if (t === 'withdrawal') return 'withdrawal';
  if (t.includes('trade') || t.includes('copy')) return 'copy';
  if (t.includes('profit') || t.includes('payout') || t.includes('return') || t.includes('roi')) return 'payout';
  return 'other';
}

/** @param {any} txn */
function signed(txn) {
  const amount = Math.abs(Number(txn.amount || 0));
  const out = kindOf(txn) === 'withdrawal' || String(txn.transaction_type || '').toLowerCase() === 'investment';
  return `${out ? '−' : '+'}${money(amount)}`;
}

/** @param {Element|null} el */
const sectionOf = (el) => /** @type {HTMLElement|null} */ (el instanceof HTMLElement ? el : null);

async function boot() {
  const session = await initBase();
  const balanceSections = ['.wl-balance', '[aria-labelledby="flow-title"]', '[data-component="wallet-history"]'].map((s) => sectionOf($(s)));

  if (session.demo) {
    for (const el of balanceSections) markDemo(el, 'Demo preview: sample wallet activity.');
    return;
  }
  for (const el of balanceSections) busy(el);

  const [balRes, pendRes, txnRes, ledRes, bankRes, cryptoRes, addrRes] = await Promise.allSettled([
    api('/api/wallet/balance'),
    api('/api/wallet/pending-transactions'),
    api('/api/wallet/transactions'),
    api(`/api/wallet/activity?limit=200&types=${LEDGER_TYPES}`),
    api('/api/wallet/deposit-bank-accounts'),
    api('/api/crypto-wallets/'),
    api('/api/withdrawals/crypto-addresses'),
  ]);
  const entries = ledRes.status === 'fulfilled' ? ledRes.value.items || [] : [];
  renderWallet({ balRes, pendRes, txnRes, entries });
  const bal = readBalance(balRes);
  const bank = bankRes.status === 'fulfilled' ? bankRes.value : null;
  const wallets = cryptoRes.status === 'fulfilled' && Array.isArray(cryptoRes.value?.wallets) ? cryptoRes.value.wallets : [];
  const savedAddresses = addrRes.status === 'fulfilled' && Array.isArray(addrRes.value) ? addrRes.value : [];
  initDeposit({ balance: bal.cash, bank, wallets });
  initWithdraw({ balance: bal.withdrawable, savedAddresses });
  for (const el of balanceSections) busy(el, false);
}

/** Render balances, cash flow and history from settled requests. Failures show explicit errors, never zeros. */
function renderWallet({ balRes, pendRes, txnRes, entries }) {
  const bal = readBalance(balRes);
  const pending = pendRes.status === 'fulfilled' ? pendRes.value : null;
  const txns = txnRes.status === 'fulfilled' && Array.isArray(txnRes.value) ? txnRes.value : [];
  if (balRes.status === 'rejected' || pendRes.status === 'rejected') console.error('[wallet] balances failed', balRes, pendRes);
  if (balRes.status === 'rejected') showBalanceError(); else renderBalance(bal, pending, pendRes.status === 'fulfilled');
  if (txnRes.status === 'rejected') showFlowError(); else renderBars(txns);
  renderHistory(txns, entries, txnRes.status === 'rejected');
}

/** Shown instead of figures when the balance request fails: never a $0.00 that looks real. */
function showBalanceError() {
  const main = $('.wl-balance__main .hero-value__num');
  if (main instanceof HTMLElement) { main.removeAttribute('data-count'); main.textContent = 'Couldn’t load'; }
  for (const el of $$('[data-bal]')) el.textContent = 'Couldn’t load';
  const bp = $('[data-buying-power]');
  if (bp) bp.textContent = 'Couldn’t load';
}

function showFlowError() {
  const p = $('[data-flow-loading]') || $('.wl-bars-wrap p');
  if (p) p.textContent = 'Cash flow couldn’t be loaded. Reload the page to try again.';
}

/**
 * Normalise /api/wallet/balance. Older servers only return `balance`.
 * @param {PromiseSettledResult<any>} res
 * @returns {{cash: number, withdrawable: number, buyingPower: number, reserved: number}}
 */
function readBalance(res) {
  const v = res.status === 'fulfilled' ? res.value || {} : {};
  const cash = Number(v.cash ?? v.balance ?? 0);
  return {
    cash,
    withdrawable: Number(v.withdrawable ?? cash),
    buyingPower: Number(v.buying_power ?? cash),
    reserved: Number(v.reserved ?? 0),
  };
}

/**
 * @param {{cash: number, withdrawable: number, buyingPower: number, reserved: number}} bal
 * @param {any} pending
 */
function renderBalance(bal, pending, pendingOk = true) {
  const main = $('.wl-balance__main .hero-value__num');
  if (main instanceof HTMLElement) {
    main.removeAttribute('data-count');
    main.dataset.format = 'currency';
    main.setAttribute('data-live-value', '');
    main.textContent = money(bal.cash);
  }
  const set = (/** @type {string} */ key, /** @type {string} */ text) => {
    const el = $(`[data-bal="${key}"]`);
    if (el) el.textContent = text;
  };
  const bp = $('[data-bal="buying-power"] strong');
  if (bp) bp.textContent = money(bal.buyingPower);
  set('withdrawable', money(bal.withdrawable));
  set('held', bal.reserved > 0 ? `${money(bal.reserved)} on hold for pending requests` : 'Nothing on hold');
  if (!pendingOk) {
    set('pending-deposit', 'Couldn’t load');
    set('pending-withdrawal', 'Couldn’t load');
    set('pending-withdrawal-meta', '');
    const t = $('[data-bal="pending-deposit-tag"]');
    if (t) t.textContent = '';
    return;
  }
  set('pending-deposit', money(pending?.pending_deposits?.total_amount || 0));
  set('pending-withdrawal', money(pending?.pending_withdrawals?.total_amount || 0));
  const depTag = $('[data-bal="pending-deposit-tag"]');
  if (depTag) {
    const n = Number(pending?.pending_deposits?.count || 0);
    depTag.className = `tag tag--plain ${n ? 'tag--pending' : ''}`;
    depTag.textContent = n ? `${int(n)} deposit${n === 1 ? '' : 's'} in review` : 'None in progress';
  }
  const n = Number(pending?.pending_withdrawals?.count || 0);
  set('pending-withdrawal-meta', n ? `${int(n)} withdrawal${n === 1 ? '' : 's'} awaiting approval` : 'None in progress');
}

/** @param {any[]} txns */
function renderBars(txns) {
  const wrap = $('.wl-bars-wrap');
  if (!wrap) return;
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 90);
  const buckets = Array.from({ length: 13 }, () => 0);
  const labels = Array.from({ length: 13 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i * 7 + 7);
    return `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })}`;
  });
  let inflow = 0, outflow = 0;
  for (const t of txns) {
    const d = new Date(t.created_at);
    if (Number.isNaN(d.getTime()) || d < start || d > now) continue;
    const status = String(t.status || '').toLowerCase();
    if (!['completed', 'settled', 'approved'].includes(status)) continue;
    const amount = Math.abs(Number(t.amount || 0));
    const out = kindOf(t) === 'withdrawal' || String(t.transaction_type || '').toLowerCase() === 'investment';
    const idx = Math.min(12, Math.max(0, Math.floor((d.getTime() - start.getTime()) / (7 * 86400000))));
    if (out) { buckets[idx] -= amount; outflow += amount; } else { buckets[idx] += amount; inflow += amount; }
  }
  const legend = $$('.wl-legend b');
  if (legend[0]) legend[0].textContent = money(inflow, true);
  if (legend[1]) legend[1].textContent = money(outflow, true);
  if (legend[2]) {
    const net = inflow - outflow;
    legend[2].textContent = `${net >= 0 ? '+' : '−'}${money(Math.abs(net), true)}`;
    legend[2].className = net >= 0 ? 'gain' : 'loss';
  }
  const fresh = document.createElement('div');
  fresh.className = 'bars';
  fresh.setAttribute('role', 'img');
  fresh.setAttribute('aria-label', `Weekly net cash flow over the last 13 weeks: ${money(inflow, true)} in, ${money(outflow, true)} out.`);
  fresh.dataset.format = 'currency';
  fresh.dataset.values = buckets.map((v) => Math.round(v)).join(',');
  fresh.dataset.labels = labels.join(',');
  wrap.replaceChildren(fresh);
  import('../components/bars.js').then((m) => m.init(fresh)).catch(() => {});
}

/** @type {(() => void)|undefined} */
let disposeHistory;

const LEDGER_KIND = /** @type {Record<string,string>} */ ({
  trade_buy: 'trade', trade_sell: 'trade', short_sale: 'trade', short_cover: 'trade', fee: 'trade', option_premium: 'trade',
  exercise: 'trade', assignment: 'trade', dividend: 'trade', dividend_owed: 'trade', borrow_fee: 'trade', margin_interest: 'trade', liquidation: 'trade',
  copy_allocate: 'copy', copy_release: 'copy', copy_pnl: 'copy',
  plan_invest: 'plan', plan_refund: 'plan', plan_payout: 'plan',
  referral_bonus: 'other', adjustment: 'other', opening_balance: 'other',
});
const LEDGER_LABEL = /** @type {Record<string,string>} */ ({
  trade_buy: 'Buy', trade_sell: 'Sell', short_sale: 'Short sale', short_cover: 'Short cover', fee: 'Trading fee', option_premium: 'Option premium',
  exercise: 'Option exercise', assignment: 'Option assignment', dividend: 'Dividend', dividend_owed: 'Dividend owed on short', borrow_fee: 'Stock borrow fee',
  margin_interest: 'Margin interest', liquidation: 'Liquidation', copy_allocate: 'Copy allocation', copy_release: 'Copy funds returned', copy_pnl: 'Copy P&L',
  plan_invest: 'Plan investment', plan_refund: 'Plan refund', plan_payout: 'Plan payout', referral_bonus: 'Referral bonus', adjustment: 'Balance adjustment',
  opening_balance: 'Opening balance',
});
/** Ledger types shown in history. Deposits/withdrawals come from their requests (which carry status). */
export const LEDGER_TYPES = Object.keys(LEDGER_KIND).join(',');

/**
 * Transaction history: deposit and withdrawal requests (with their approval status) merged
 * with posted ledger entries for trading, copy trading, plans and adjustments.
 * @param {any[]} txns @param {any[]} entries
 */
function renderHistory(txns, entries = [], txnFailed = false) {
  const section = $('[data-component="wallet-history"]');
  const body = section?.querySelector('tbody');
  if (!(section instanceof HTMLElement) || !body) return;
  const countEl = section.querySelector('[data-history-count]');
  if (countEl && txnFailed) countEl.textContent = 'Transactions couldn’t be loaded';
  const rows = [
    ...txns.filter((t) => ['deposit', 'withdrawal'].includes(kindOf(t))).map((t) => {
      const kind = kindOf(t);
      const st = String(t.status || '').toLowerCase();
      const status = statusTag(t.status);
      const out = kind === 'withdrawal';
      return { at: t.created_at, kind, title: t.description || (out ? 'Withdrawal' : 'Deposit'), sub: t.payment_method || '', ref: t.reference_number || '—',
        status, amountCls: st === 'rejected' || st === 'failed' ? 'wl-void' : out ? 'loss' : 'gain', amount: `${out ? '−' : '+'}${money(Math.abs(Number(t.amount || 0)))}` };
    }),
    ...entries.map((e) => ({ e, a: Number(e.amount) !== 0 ? Number(e.amount) : String(e.type).startsWith('copy_') ? -Number(e.reserved_change || 0) : 0 }))
      .filter(({ e, a }) => LEDGER_KIND[e.type] && !e.internal && a !== 0).map(({ e, a }) => {
      const copied = String(e.bucket || '').startsWith('copy:');
      return { at: e.created_at, kind: copied ? 'copy' : LEDGER_KIND[e.type], title: `${copied ? 'Copied trade · ' : ''}${LEDGER_LABEL[e.type] || e.type}`, sub: e.description || '', ref: '—',
        status: { cls: 'tag tag--plain', label: 'Posted' }, amountCls: a >= 0 ? 'gain' : 'loss', amount: `${a >= 0 ? '+' : '−'}${money(Math.abs(a))}` };
    }),
  ].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));

  const counts = /** @type {Record<string, number>} */ ({ all: rows.length, deposit: 0, withdrawal: 0, trade: 0, copy: 0, plan: 0 });
  for (const r of rows) if (r.kind in counts) counts[r.kind]++;
  $$('[data-filter]', section).forEach((tab) => {
    const small = tab.querySelector('small');
    if (small) small.textContent = int(counts[tab.getAttribute('data-filter') || 'all'] ?? 0);
  });
  const emptyRow = h('tr', { class: 'wl-empty', 'data-history-empty': '', hidden: rows.length > 0 }, h('td', { colspan: 5 }, h('div', { class: 'empty' },
    h('p', { class: 'empty__title', 'data-history-empty-title': '' }, 'No transactions yet'), h('p', null, 'Entries appear here as soon as they’re created.'))));
  body.replaceChildren(...rows.map((r) => h('tr', { 'data-type': r.kind },
    h('td', { class: 'mono muted nowrap' }, h('time', { datetime: dateTimeAttr(r.at) }, date(r.at))),
    h('td', null, h('div', { class: 'wl-desc' }, h('strong', null, r.title), h('span', null, r.sub))),
    h('td', { class: 'opt wl-ref' }, r.ref),
    h('td', null, h('span', { class: r.status.cls }, r.status.label)),
    h('td', { class: `is-num ${r.amountCls}` }, r.amount))), emptyRow);
  disposeHistory?.();
  import('../components/wallet-history.js').then((m) => {
    disposeHistory = m.init(section);
  }).catch(() => {});
}

/* ---------- dialog helpers ---------- */

/**
 * @param {HTMLElement|null} el
 * @param {boolean} on
 */
const setBusy = (el, on) => {
  if (!(el instanceof HTMLButtonElement)) return;
  el.disabled = on;
  if (on) el.setAttribute('aria-busy', 'true'); else el.removeAttribute('aria-busy');
};

/**
 * @param {{balance: number, bank: any, wallets: any[]}} data
 */
function initDeposit({ bank, wallets }) {
  const form = /** @type {HTMLFormElement|null} */ ($('[data-deposit-form]'));
  const dialog = /** @type {HTMLDialogElement|null} */ ($('#deposit'));
  if (!form || !dialog) return;
  const amount = /** @type {HTMLInputElement} */ ($('#dep-amount', form));
  const next = /** @type {HTMLButtonElement} */ ($('[data-dep-next]', form));
  const back = /** @type {HTMLButtonElement} */ ($('[data-dep-back]', form));
  const steps = $$('[data-step]', form);
  const indicator = /** @type {HTMLElement|null} */ ($('[data-steps]', form));
  const nextLabel = /** @type {HTMLElement} */ ($('[data-label]', next));
  const network = /** @type {HTMLSelectElement} */ ($('#dep-network', form));
  const address = $('[data-dep-address]', form);
  const addressCopy = /** @type {HTMLElement|null} */ ($('[data-dep-address-copy]', form));
  const bankRadio = /** @type {HTMLInputElement} */ ($('input[name="method"][value="bank"]', form));
  const cryptoRadio = /** @type {HTMLInputElement} */ ($('input[name="method"][value="crypto"]', form));
  const bankMeta = $('[data-dep-bank-meta]', form);
  const methodStatus = $('[data-dep-method-status]', form);
  const cryptoMeta = $('[data-dep-crypto-meta]', form);
  let step = 1;

  // Bank details (real account bank record only).
  const hasBank = !!(bank && bank.bank_name && bank.account_number);
  $$('[data-dep-bank]', form).forEach((el) => {
    const key = el.getAttribute('data-dep-bank');
    const value = key === 'bank_name' ? bank?.bank_name
      : key === 'account_name' ? bank?.account_name
      : key === 'account_number' ? bank?.account_number
      : bank?.swift_code || bank?.routing_number;
    el.textContent = value || '—';
  });
  if (bankMeta) bankMeta.textContent = hasBank ? 'Bank transfer to your account' : 'No bank details configured for deposits';
  bankRadio.disabled = !hasBank;

  // Crypto deposit wallets (platform wallets from the database).
  network.replaceChildren(...wallets.map((w) => {
    const o = document.createElement('option');
    o.value = String(w.id);
    o.textContent = `${w.currency}${w.network ? ` (${w.network})` : ''}`;
    return o;
  }));
  const walletById = new Map(wallets.map((w) => [String(w.id), w]));
  const qrImg = /** @type {HTMLImageElement|null} */ ($('[data-dep-qr]', form));
  const qrStatus = $('[data-dep-qr-status]', form);
  /** @type {Map<string, string>} wallet id -> data URL, so switching networks does not refetch */
  const qrCache = new Map();
  let qrRequest = 0;
  /** Load the admin-configured QR for the selected wallet (authenticated base64 endpoint). */
  const renderQr = async () => {
    const w = walletById.get(network.value) || wallets[0];
    if (!qrImg || !qrStatus) return;
    const token = ++qrRequest;
    qrImg.hidden = true;
    qrImg.removeAttribute('src');
    if (!w) { qrStatus.textContent = 'No QR code available.'; return; }
    let src = qrCache.get(String(w.id));
    if (!src) {
      qrStatus.textContent = 'Loading QR code…';
      try {
        const res = await api(`/api/crypto-wallets/${encodeURIComponent(String(w.id))}/qr/base64`);
        src = res?.qr_code;
        if (!src) throw new Error('QR code missing from response');
        qrCache.set(String(w.id), src);
      } catch (err) {
        console.error('[wallet] QR code failed', err);
        if (token === qrRequest) qrStatus.textContent = 'QR code couldn’t be loaded. Copy the address below instead.';
        return;
      }
    }
    if (token !== qrRequest) return;
    qrImg.src = src;
    qrImg.alt = `${w.currency}${w.network ? ` (${w.network})` : ''} deposit address QR code`;
    qrImg.hidden = false;
    qrStatus.textContent = 'Scan with your wallet app to fill in the address.';
  };
  const renderAddress = () => {
    const w = walletById.get(network.value) || wallets[0];
    if (address) address.textContent = w?.wallet_address || '—';
    addressCopy?.setAttribute('data-copy', w?.wallet_address || '');
  };
  network.addEventListener('change', () => { renderAddress(); renderQr(); });
  const hasCrypto = wallets.length > 0;
  cryptoRadio.disabled = !hasCrypto;
  if (cryptoMeta) cryptoMeta.textContent = hasCrypto ? 'Send from a wallet you control' : 'No deposit wallets configured';
  renderAddress();
  if (!hasBank && hasCrypto) cryptoRadio.checked = true;
  if (!hasBank && !hasCrypto) next.disabled = true;

  const method = () => /** @type {HTMLInputElement|null} */ ($('input[name="method"]:checked', form))?.value || 'bank';
  // PayPal is listed but not available yet: choosing it shows a notice and blocks Continue.
  // Continue uses aria-disabled for PayPal so it stays focusable and the notice is announced.
  const renderMethod = () => {
    const m = method();
    form.querySelectorAll('[data-method-detail]').forEach((el) => {
      if (el instanceof HTMLElement) el.hidden = el.dataset.methodDetail !== m;
    });
    const paypal = m === 'paypal';
    if (methodStatus) methodStatus.textContent = paypal ? 'PayPal deposit isn’t available at the moment.' : '';
    if (step === 2) {
      next.setAttribute('aria-disabled', String(paypal));
      if (paypal) next.setAttribute('aria-describedby', 'dep-method-status'); else next.removeAttribute('aria-describedby');
    }
    if (m === 'crypto' && step === 2) renderQr();
  };
  const renderSummary = () => {
    const v = parseAmount(amount.value);
    const m = method();
    const set = (/** @type {string} */ k, /** @type {string} */ t) => { const el = $(`[data-sum="${k}"]`, form); if (el) el.textContent = t; };
    set('amount', money(v));
    set('method', m === 'crypto' ? 'Cryptocurrency' : m === 'paypal' ? 'PayPal' : 'Bank transfer');
    set('destination', m === 'crypto'
      ? `${network.selectedOptions[0]?.textContent || ''}`
      : (bank?.bank_name || '—'));
  };
  const go = (/** @type {number} */ n) => {
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
    if (n === 1) {
      next.disabled = !hasBank && !hasCrypto;
      next.removeAttribute('aria-disabled');
      next.removeAttribute('aria-describedby');
    }
    if (n === 2) renderMethod();
    if (n === 3) renderSummary();
  };
  const reset = () => {
    form.reset();
    clearError(amount);
    setBusy(next, false);
    bankRadio.checked = hasBank || !hasCrypto;
    cryptoRadio.checked = !hasBank && hasCrypto;
    form.querySelectorAll('[data-quick]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    if (methodStatus) methodStatus.textContent = '';
    renderAddress();
    go(1);
  };

  form.querySelectorAll('[data-quick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      amount.value = btn.getAttribute('data-quick') || '';
      form.querySelectorAll('[data-quick]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      clearError(amount);
    });
  });
  form.addEventListener('change', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.name === 'method') renderMethod();
  });
  back.addEventListener('click', () => {
    if (step === 1) { dialog.close(); return; }
    go(step - 1);
  });
  dialog.addEventListener('close', reset);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (step === 1) {
      const v = parseAmount(amount.value);
      const msg = !Number.isFinite(v) || v <= 0 ? 'Enter an amount to deposit.'
        : v < MIN_AMOUNT ? `The minimum deposit is ${money(MIN_AMOUNT)}.`
        : v > MAX_DEPOSIT ? `The maximum deposit is ${money(MAX_DEPOSIT)}.` : '';
      if (msg) { setError(amount, msg); amount.focus(); return; }
      clearError(amount);
      go(2);
      return;
    }
    if (step === 2) {
      if (method() === 'paypal') return;
      go(3);
      return;
    }

    const v = parseAmount(amount.value);
    const m = method();
    if (m === 'paypal') return;
    /** @type {Record<string, any>} */
    const body = { amount: v, payment_method: m === 'crypto' ? 'Cryptocurrency' : 'Bank Transfer' };
    if (m === 'bank') {
      body.bank_name = bank?.bank_name || '';
    } else {
      const w = walletById.get(network.value) || wallets[0];
      if (!w) { toast('No deposit wallet is configured.'); return; }
      body.crypto_type = w.currency;
      body.wallet_address = w.wallet_address;
    }
    setBusy(next, true);
    try {
      const res = await api('/api/wallet/deposit', { method: 'POST', body: JSON.stringify(body) });
      const ref = res?.transaction?.reference_number;
      toast(ref ? `Deposit ${ref} submitted. It will show as pending until confirmed.` : 'Deposit submitted. It will show as pending until confirmed.');
      dialog.close();
      await refreshAfterChange();
    } catch (err) {
      toast(/** @type {Error} */ (err).message || 'The deposit could not be submitted.');
    } finally {
      setBusy(next, false);
    }
  });
  go(1);
  if (location.hash === '#deposit' && !dialog.open) dialog.showModal();
}

/**
 * @param {{balance: number, savedAddresses: any[]}} data
 */
function initWithdraw({ balance, savedAddresses }) {
  const form = /** @type {HTMLFormElement|null} */ ($('[data-withdraw-form]'));
  const dialog = /** @type {HTMLDialogElement|null} */ ($('#withdraw'));
  if (!form || !dialog) return;
  const amount = /** @type {HTMLInputElement} */ ($('#wd-amount', form));
  const help = $('#wd-amount-help', form);
  const first = /** @type {HTMLElement} */ ($('[data-wd-first]', form));
  const cryptoField = /** @type {HTMLElement} */ ($('[data-wd-crypto-field]', form));
  const address = /** @type {HTMLSelectElement} */ ($('#wd-address', form));
  const cryptoMeta = $('[data-wd-crypto-meta]', form);
  const verifyWrap = /** @type {HTMLElement} */ ($('[data-wd-verify]', form));
  const verify = /** @type {HTMLInputElement} */ ($('#wd-verify', form));
  const msg = /** @type {HTMLElement} */ ($('[data-wd-msg]', form));
  const submit = /** @type {HTMLButtonElement} */ ($('[data-wd-submit]', form));
  const cryptoRadio = /** @type {HTMLInputElement} */ ($('input[name="destination"][value="crypto"]', form));
  /** @type {string|null} */
  let requestId = null;
  let phase = 'request';

  withdrawable = balance;
  if (help) help.textContent = `Available to withdraw ${money(balance)} · Min ${money(MIN_AMOUNT)}`;
  form.dataset.available = String(balance);

  const addresses = savedAddresses.filter((a) => a && a.wallet_address && a.currency);
  address.replaceChildren(...addresses.map((a) => {
    const o = document.createElement('option');
    o.value = String(a.id);
    o.textContent = `${a.currency}${a.network ? ` (${a.network})` : ''} · ${String(a.wallet_address).slice(0, 6)}…${String(a.wallet_address).slice(-4)}`;
    return o;
  }));
  const hasCrypto = addresses.length > 0;
  cryptoRadio.disabled = !hasCrypto;
  if (cryptoMeta) cryptoMeta.textContent = hasCrypto ? 'Send to one of your saved addresses' : 'Add a crypto address first';

  const destination = () => /** @type {HTMLInputElement|null} */ ($('input[name="destination"]:checked', form))?.value || 'bank';
  const renderDestination = () => {
    cryptoField.hidden = destination() !== 'crypto';
  };
  form.addEventListener('change', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.name === 'destination') renderDestination();
  });
  renderDestination();

  const setPhase = (/** @type {'request'|'verify'} */ p) => {
    phase = p;
    form.dataset.phase = p;
    first.hidden = p === 'verify';
    verifyWrap.hidden = p !== 'verify';
    msg.hidden = p !== 'verify';
    submit.textContent = p === 'verify' ? 'Verify withdrawal' : 'Request withdrawal';
    if (p === 'verify') verify.focus();
  };

  const reset = () => {
    requestId = null;
    form.reset();
    clearError(amount);
    clearError(address);
    clearError(verify);
    setPhase('request');
    renderDestination();
    setBusy(submit, false);
  };
  dialog.addEventListener('close', reset);

  verify.addEventListener('input', () => {
    verify.value = verify.value.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase();
    clearError(verify);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (phase === 'verify') {
      const code = verify.value.trim().toUpperCase();
      if (!/^[A-Z0-9]{8}$/.test(code)) { setError(verify, 'Enter the 8-character verification code.'); verify.focus(); return; }
      clearError(verify);
      setBusy(submit, true);
      try {
        await api('/api/withdrawals/verify-code', {
          method: 'POST',
          body: JSON.stringify({ request_id: requestId, verification_code: code }),
        });
        toast('Withdrawal verified and awaiting approval');
        dialog.close();
        await refreshAfterChange();
      } catch (err) {
        setError(verify, /** @type {Error} */ (err).message || 'Verification failed.');
        verify.focus();
      } finally {
        setBusy(submit, false);
      }
      return;
    }

    const v = parseAmount(amount.value);
    const msgText = !Number.isFinite(v) || v <= 0 ? 'Enter an amount to withdraw.'
      : v < MIN_AMOUNT ? `The minimum withdrawal is ${money(MIN_AMOUNT)}.`
      : v > withdrawable ? `Exceeds the ${money(withdrawable)} available to withdraw.` : '';
    if (msgText) { setError(amount, msgText); amount.focus(); return; }
    clearError(amount);

    const crypto = destination() === 'crypto';
    /** @type {Record<string, any>} */
    const body = { amount: v, withdrawal_method: crypto ? 'Cryptocurrency' : 'Bank Transfer' };
    if (crypto) {
      const chosen = addresses.find((a) => String(a.id) === address.value);
      if (!chosen) { setError(address, 'Choose a saved crypto address.'); address.focus(); return; }
      clearError(address);
      body.crypto_type = chosen.currency;
      body.wallet_address = chosen.wallet_address;
    }
    setBusy(submit, true);
    try {
      const res = await api('/api/wallet/withdraw', { method: 'POST', body: JSON.stringify(body) });
      requestId = res?.request_id || null;
      if (!requestId) throw new Error('The withdrawal was created without a request reference. Contact support.');
      setPhase('verify');
      await refreshAfterChange();
    } catch (err) {
      toast(/** @type {Error} */ (err).message || 'The withdrawal request could not be created.');
    } finally {
      setBusy(submit, false);
    }
  });

}

/** Re-read balance, pending items, cash flow and history after a change. */
async function refreshAfterChange() {
  const [balRes, pendRes, txnRes, ledRes] = await Promise.allSettled([
    api('/api/wallet/balance'),
    api('/api/wallet/pending-transactions'),
    api('/api/wallet/transactions'),
    api(`/api/wallet/activity?limit=200&types=${LEDGER_TYPES}`),
  ]);
  renderWallet({ balRes, pendRes, txnRes, entries: ledRes.status === 'fulfilled' ? ledRes.value.items || [] : [] });
  const bal = readBalance(balRes);
  withdrawable = bal.withdrawable;
  const help = $('#wd-amount-help');
  if (help) help.textContent = `Available to withdraw ${money(bal.withdrawable)} · Min ${money(MIN_AMOUNT)}`;
  const form = $('[data-withdraw-form]');
  if (form instanceof HTMLFormElement) form.dataset.available = String(bal.withdrawable);
}

boot().catch((err) => console.error('[wallet]', err)).finally(() => settle());
