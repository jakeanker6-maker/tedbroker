// @ts-check
/**
 * Investment plans. Robo Advisor, ETF automation, DeFi and Options plans are loaded from
 * their plan endpoints and every category can be activated from one dialog (#activate-dialog).
 * The amount comes from free cash (withdrawable); the server enforces the minimum and the
 * balance and its error detail is shown in the dialog. "Your active plans" shows each
 * activated plan's value, P&L and progress (GET /api/investments/active-plans). After a
 * successful activation the free cash, the active plans and the plan lists are refreshed.
 */
import { api, date, int, money } from './api.js';
import { initBase } from './base.js';
import { busy, markDemo, settle } from './shell.js';
import { clearError, setError } from '../components/auth-form.js';
import { bindAmountField } from '../components/amount-field.js';
import { toast } from '../lib/util.js';
import { h, signedPct, signedUsd, tone, usdFmt } from '../trade/dom.js';
import { CATEGORY_LABEL, fetchActivePlans, pctText, progressBar } from './plan-progress.js';

/**
 * @typedef {{ key: string, ledger: string, endpoint: string, label: string, activatePath: (id: string) => string }} Category
 */

/** @type {Category[]} */
const CATEGORIES = [
  { key: 'robo', ledger: 'robo-ledger', endpoint: '/api/plans/', label: CATEGORY_LABEL.robo, activatePath: () => '/api/investments/invest' },
  { key: 'etf', ledger: 'etf-ledger', endpoint: '/api/etf-plans/', label: CATEGORY_LABEL.etf, activatePath: (id) => `/api/etf-plans/activate/${encodeURIComponent(id)}` },
  { key: 'defi', ledger: 'defi-ledger', endpoint: '/api/defi-plans/', label: CATEGORY_LABEL.defi, activatePath: (id) => `/api/defi-plans/activate/${encodeURIComponent(id)}` },
  { key: 'options', ledger: 'options-ledger', endpoint: '/api/options-plans/', label: CATEGORY_LABEL.options, activatePath: (id) => `/api/options-plans/activate/${encodeURIComponent(id)}` },
];

/** @param {string} id */
const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '');

/** @param {unknown} v */
const pct = (v) => `${Number(v || 0).toFixed(Number(v) % 1 ? 1 : 0)}%`;

const state = {
  cash: 0,
  cashOk: false,
  busy: false,
  /** @type {Map<string, {category: Category, plan: any}>} button key (category:id) -> plan */
  plans: new Map(),
  /** @type {{key: string, category: Category, plan: any, min: number}|null} */
  active: null,
  /** @type {string|null} button key the dialog returns focus to */
  returnKey: null,
};

/** Bounds for the amount field; mutated for each plan opened. */
const amountOpts = { min: 0, max: Infinity, minText: 'Minimum investment' };

/**
 * @typedef {{
 *   dlg: HTMLDialogElement, form: HTMLFormElement, input: HTMLInputElement, field: HTMLElement,
 *   submit: HTMLButtonElement, short: HTMLElement, category: HTMLElement, name: HTMLElement,
 *   min: HTMLElement, cash: HTMLElement
 * }} ActivateDialog
 */

/** @type {ActivateDialog|null} */
let els = null;
/** @type {ReturnType<typeof bindAmountField>|null} */
let amount = null;

/** @returns {ActivateDialog|null} */
function grabDialog() {
  const dlg = document.getElementById('activate-dialog');
  if (!(dlg instanceof HTMLDialogElement)) return null;
  const form = dlg.querySelector('form');
  const input = dlg.querySelector('input[name="amount"]');
  const field = input?.closest('.field');
  const submit = dlg.querySelector('[data-activate-submit]');
  const short = dlg.querySelector('[data-activate-short]');
  const category = dlg.querySelector('[data-act="category"]');
  const name = dlg.querySelector('[data-act="name"]');
  const min = dlg.querySelector('[data-act="min"]');
  const cash = dlg.querySelector('[data-act="cash"]');
  if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLInputElement) || !(field instanceof HTMLElement)
    || !(submit instanceof HTMLButtonElement) || !(short instanceof HTMLElement) || !(category instanceof HTMLElement)
    || !(name instanceof HTMLElement) || !(min instanceof HTMLElement) || !(cash instanceof HTMLElement)) return null;
  return { dlg, form, input, field, submit, short, category, name, min, cash };
}

async function loadBalance() {
  const avail = document.querySelector('[data-plans-avail]');
  try {
    // Plans are paid from free cash (cash minus holds), the same amount the server enforces.
    const b = await api('/api/wallet/balance');
    state.cash = Number(b?.withdrawable ?? b?.balance ?? 0);
    state.cashOk = true;
    if (avail) avail.textContent = money(state.cash);
  } catch (err) {
    console.error('[plans] balance', err);
    state.cashOk = false;
    if (avail) avail.textContent = 'Couldn’t load';
  }
}

/* ---------- Active plans ---------- */

/**
 * Show one state of the active-plans section.
 * @param {'loading'|'empty'|'error'|'rows'} kind
 * @param {any[]} [rows]
 */
function showActive(kind, rows = []) {
  const section = document.getElementById('active-plans');
  if (!section) return;
  const el = (/** @type {string} */ s) => /** @type {HTMLElement|null} */ (section.querySelector(s));
  const count = el('[data-active-count]');
  const loading = el('[data-active-loading]');
  const empty = el('[data-active-empty]');
  const error = el('[data-active-error]');
  const wrap = el('[data-active-wrap]');
  const body = el('[data-active-rows]');
  if (loading) loading.hidden = kind !== 'loading';
  if (empty) empty.hidden = kind !== 'empty';
  if (error) error.hidden = kind !== 'error';
  if (wrap) wrap.hidden = kind !== 'rows';
  if (count) count.textContent = kind === 'rows' || kind === 'empty' ? int(rows.length) : '';
  if (body && kind === 'rows') body.replaceChildren(...rows.map(activeRow));
  busy(section, kind === 'loading');
}

/** @param {any} p */
function activeRow(p) {
  const name = p.plan_name || 'Plan';
  const category = CATEGORY_LABEL[p.plan_category] || 'Plan';
  return h('tr', null,
    h('td', null, h('strong', { class: 'plan-active__name' }, name)),
    h('td', { class: 'opt-sm' }, category),
    h('td', { class: 'is-num' }, usdFmt(p.amount_invested)),
    h('td', { class: 'is-num' }, usdFmt(p.current_value)),
    h('td', { class: `is-num ${tone(p.profit_loss)}` },
      signedUsd(p.profit_loss),
      h('span', { class: 'plan-pnl__pct' }, signedPct(p.profit_loss_percent))),
    h('td', null,
      h('span', { class: 'plan-progress-cell' },
        progressBar(p.progress_percent, name),
        h('span', { class: 'mono' }, pctText(p.progress_percent)))),
    h('td', { class: 'opt' }, p.time_remaining || '—'),
    h('td', { class: 'is-num opt-sm' }, date(p.maturity_date)));
}

async function loadActive() {
  try {
    const rows = await fetchActivePlans();
    showActive(rows.length ? 'rows' : 'empty', rows);
  } catch (err) {
    console.error('[plans] active', err);
    showActive('error');
  }
}

/* ---------- Plan lists ---------- */

/** @param {HTMLTableElement} table @param {...Node} bodies */
function replaceBodies(table, ...bodies) {
  table.querySelectorAll(':scope > tbody').forEach((b) => b.remove());
  table.append(...bodies);
}

/**
 * A failed request is reported as an error, never as "no plans".
 * @param {Category} c @param {HTMLTableElement} table @param {unknown} err
 */
function renderError(c, table, err) {
  console.error('[plans]', c.label, err);
  replaceBodies(table, h('tbody', null, h('tr', null,
    h('td', { colspan: 6 }, h('div', { class: 'empty', role: 'alert' },
      h('p', { class: 'empty__title', text: `${c.label} plans couldn’t be loaded` }),
      h('p', { text: 'Reload the page to try again.' }))))));
}

/**
 * @param {Category} c @param {HTMLTableElement} table @param {any[]} plans
 */
function renderCategory(c, table, plans) {
  if (!plans.length) {
    replaceBodies(table, h('tbody', null, h('tr', null,
      h('td', { colspan: 6 }, h('div', { class: 'empty' },
        h('p', { class: 'empty__title', text: `No ${c.label} plans are open yet` }),
        h('p', { text: 'New plans will appear here when they are published.' }))))));
    return;
  }
  replaceBodies(table, ...plans.map((plan) => planBody(c, plan)));
}

/**
 * One plan: the ledger row plus its Details row, which holds the Activate button.
 * @param {Category} c @param {any} plan
 */
function planBody(c, plan) {
  const id = safeId(plan.id);
  const key = `${c.key}:${id}`;
  state.plans.set(key, { category: c, plan });
  const detailId = `plan-${c.key}-${id}`;
  const name = plan.name || 'Plan';
  const term = Number(plan.holding_period_months ?? plan.duration_months ?? 0);
  const min = Number(plan.minimum_investment || 0);
  const ret = Number(plan.expected_return_percent || 0);
  const subs = plan.current_subscribers;
  const tags = Array.isArray(plan.tags) ? plan.tags.map(String).filter(Boolean) : [];

  const activate = plan.is_active === false
    ? h('p', { class: 'muted' }, 'This plan is not open for new activations.')
    : h('div', { class: 'plan-activate' },
      h('p', { class: 'field__help' }, `Minimum ${money(min)}. The amount is taken from your free cash.`),
      h('button', { class: 'btn', type: 'button', 'data-activate': key, 'aria-haspopup': 'dialog' },
        'Activate', h('span', { class: 'sr-only' }, ` ${name}`)));

  return h('tbody', { class: 'plan', dataset: { planId: id } },
    h('tr', null,
      h('td', null, h('div', { class: 'plan-name' },
        h('span', { class: 'plan-name__title', text: name }),
        h('span', { class: 'plan-name__desc', text: plan.description || plan.plan_type || plan.portfolio_type || '' }))),
      h('td', { class: 'is-num' }, usdFmt(plan.minimum_investment)),
      h('td', { class: 'is-num' },
        h('span', { class: 'plan-ret', text: pct(ret) }),
        h('span', { class: 'sr-only', text: ' per year, target set by TED Brokers' })),
      h('td', { class: 'is-num opt-sm', text: term ? `${term} mo` : '—' }),
      h('td', { class: 'is-num opt', text: subs != null ? int(subs) : '—' }),
      h('td', { class: 'is-end' },
        h('button', { class: 'text-btn xp-btn', type: 'button', 'data-expand': 'plans', 'aria-controls': detailId, 'aria-expanded': 'false', 'data-label-open': 'Hide', 'data-label-closed': 'Details' },
          h('span', { 'data-label': '', text: 'Details' })))),
    h('tr', { class: 'ledger__detail', id: detailId, hidden: true },
      h('td', { colspan: 6 },
        h('div', { class: 'ledger__detail-inner plan-detail' },
          h('div', { class: 'plan-detail__col' },
            h('h3', { class: 'stat__label', text: 'About this plan' }),
            h('p', { text: plan.description || 'No description has been published for this plan.' }),
            tags.length ? h('p', { class: 'fineprint', text: tags.join(' · ') }) : null),
          h('div', { class: 'plan-detail__col' }, activate)))));
}

async function loadLists() {
  const results = await Promise.allSettled(CATEGORIES.map((c) => api(c.endpoint)));
  state.plans.clear();
  CATEGORIES.forEach((c, i) => {
    const table = /** @type {HTMLTableElement|null} */ (document.getElementById(c.ledger));
    if (!table) return;
    const section = table.closest('section');
    const counter = section?.querySelector('.block-head small') || null;
    const res = results[i];
    if (res.status === 'rejected') {
      renderError(c, table, res.reason);
      if (counter) counter.textContent = '';
    } else {
      const plans = Array.isArray(res.value) ? res.value : [];
      renderCategory(c, table, plans);
      if (counter) counter.textContent = `${int(plans.length)} plan${plans.length === 1 ? '' : 's'}`;
    }
    busy(section, false);
  });
}

/* ---------- Activation dialog ---------- */

/** @param {HTMLButtonElement} btn */
function openActivate(btn) {
  const key = btn.dataset.activate || '';
  const entry = state.plans.get(key);
  if (!els || !amount || !entry) return;
  const { category, plan } = entry;
  const min = Number(plan.minimum_investment || 0);
  state.active = { key, category, plan, min };
  state.returnKey = key;

  els.category.textContent = category.label;
  els.name.textContent = plan.name || 'Plan';
  els.min.textContent = money(min);
  els.cash.textContent = state.cashOk ? money(state.cash) : 'Couldn’t load';
  amountOpts.min = min;
  amountOpts.max = state.cashOk ? state.cash : Infinity;
  els.input.min = String(min);
  els.input.value = String(min);
  els.short.hidden = !(state.cashOk && state.cash < min);
  clearInvalid();
  setBusy(false);

  els.dlg.showModal();
  els.input.focus();
  els.input.select();
}

function clearInvalid() {
  if (!els) return;
  clearError(els.input);
  els.input.removeAttribute('aria-invalid');
  delete els.field.dataset.error;
  const link = els.field.querySelector('[data-error-funds]');
  if (link instanceof HTMLElement) link.hidden = true;
}

/** @param {boolean} on */
function setBusy(on) {
  if (!els) return;
  state.busy = on;
  els.submit.disabled = on;
  if (on) {
    els.submit.setAttribute('aria-busy', 'true');
    els.form.setAttribute('aria-busy', 'true');
  } else {
    els.submit.removeAttribute('aria-busy');
    els.form.removeAttribute('aria-busy');
  }
}

/** @param {string} key */
function focusButton(key) {
  const btn = [...document.querySelectorAll('[data-activate]')].find((el) => el instanceof HTMLElement && el.dataset.activate === key);
  if (btn instanceof HTMLElement) btn.focus();
}

/** @param {SubmitEvent} event */
async function submitActivate(event) {
  event.preventDefault();
  if (!els || !amount || !state.active || state.busy) return;
  const { key, category, plan } = state.active;
  const r = amount.validate();
  if (!r.ok) return;
  if (!/^\d+(\.\d{1,2})?$/.test(String(r.value))) {
    setError(els.input, 'Enter an amount with at most two decimal places.');
    els.input.focus();
    return;
  }

  setBusy(true);
  try {
    const res = await api(category.activatePath(String(plan.id)), {
      method: 'POST',
      body: JSON.stringify({ plan_id: plan.id, amount: r.value }),
    });
    const invested = Number(res?.amount_invested ?? r.value);
    state.active = null;
    els.dlg.close();   // the close handler returns focus to the trigger
    toast(`${res?.plan_name || plan.name || 'Plan'} activated with ${money(invested)}.`);
    await Promise.all([loadBalance(), loadActive(), loadLists()]);
    // The list was re-rendered, so the trigger may be new: move focus back if it was lost.
    if (!document.activeElement || document.activeElement === document.body) focusButton(key);
    state.returnKey = null;
  } catch (err) {
    setError(els.input, /** @type {Error} */ (err).message || 'The plan could not be activated.');
    els.input.focus();
  } finally {
    setBusy(false);
  }
}

/* ---------- Boot ---------- */

async function boot() {
  const session = await initBase();
  const active = document.getElementById('active-plans');

  if (session.demo) {
    for (const c of CATEGORIES) {
      const table = document.getElementById(c.ledger);
      markDemo(table?.closest('section') || null, 'Demo preview: sample plans.');
    }
    if (active) active.hidden = true;
    return;
  }

  document.querySelector('[data-component="plans-map"]')?.closest('section')?.remove();
  for (const c of CATEGORIES) busy(document.getElementById(c.ledger)?.closest('section') || null);
  busy(active);

  els = grabDialog();
  if (els) {
    amount = bindAmountField(els.field, amountOpts);
    els.form.addEventListener('submit', submitActivate);
    // Esc and Cancel wait for the request in flight; the result is then shown in the dialog.
    els.dlg.addEventListener('cancel', (e) => { if (state.busy) e.preventDefault(); });
    els.dlg.addEventListener('close', () => {
      state.active = null;
      if (state.returnKey) focusButton(state.returnKey);
    });
  }

  document.querySelector('.plans')?.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    const btn = target.closest('[data-activate]');
    if (btn instanceof HTMLButtonElement) openActivate(btn);
  });

  await Promise.all([loadBalance(), loadActive(), loadLists()]);
}

boot().catch((err) => console.error('[plans]', err)).finally(() => settle());
