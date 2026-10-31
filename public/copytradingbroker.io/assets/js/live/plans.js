// @ts-check
/**
 * Investment plans: Robo Advisor, ETF, DeFi and Options ledgers are rebuilt from the
 * plan collections in the database. Robo plans can be invested in through the
 * investments API; other plan types show their terms but cannot be activated yet.
 * The illustrative risk map and static projections are removed, because the
 * database does not store per-plan risk scores or projections.
 */
import { api, esc, int, money } from './api.js';
import { initBase } from './base.js';
import { busy, markDemo, settle } from './shell.js';
import { clearError, setError } from '../components/auth-form.js';
import { toast } from '../lib/util.js';

const $ = (/** @type {string} */ s, root = document) => root.querySelector(s);

const CATEGORIES = [
  { key: 'robo', ledger: 'robo-ledger', endpoint: '/api/plans/', investable: true, label: 'Robo Advisor' },
  { key: 'etf', ledger: 'etf-ledger', endpoint: '/api/etf-plans/', investable: false, label: 'ETF automation' },
  { key: 'defi', ledger: 'defi-ledger', endpoint: '/api/defi-plans/', investable: false, label: 'DeFi' },
  { key: 'options', ledger: 'options-ledger', endpoint: '/api/options-plans/', investable: false, label: 'Options' },
];

/** @param {string} id */
const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, '');

/** @param {unknown} v */
const pct = (v) => `${Number(v || 0).toFixed(Number(v) % 1 ? 1 : 0)}%`;

async function boot() {
  const session = await initBase();
  const sections = CATEGORIES.map((c) => ({ ...c, table: /** @type {HTMLTableElement|null} */ (document.getElementById(c.ledger)) }));
  const mapSection = $('[data-component="plans-map"]')?.closest('section') || null;

  if (session.demo) {
    for (const c of sections) markDemo(c.table?.closest('section') || null, 'Demo preview: sample plans.');
    return;
  }

  mapSection?.remove();
  for (const c of sections) busy(c.table?.closest('section') || null);

  const balanceRes = await Promise.allSettled([api('/api/wallet/balance')]);
  // Plans are paid from free cash (cash minus holds), the same amount the server enforces.
  const balance = balanceRes[0].status === 'fulfilled' ? Number(balanceRes[0].value?.withdrawable ?? balanceRes[0].value?.balance ?? 0) : 0;
  const availEl = document.querySelector('[data-plans-avail]');
  if (availEl) availEl.textContent = balanceRes[0].status === 'fulfilled' ? money(balance) : 'Couldn’t load';

  const results = await Promise.allSettled(sections.map((c) => api(c.endpoint)));
  sections.forEach((c, i) => {
    const res = results[i];
    if (res.status === 'rejected') {
      renderError(c, res.reason);
    } else {
      renderCategory(c, Array.isArray(res.value) ? res.value : [], balance);
    }
    busy(c.table?.closest('section') || null, false);
  });

  for (const c of sections) {
    c.table?.closest('section')?.querySelector('.block-head small')?.replaceChildren(
      document.createTextNode(`${int(c.table?.querySelectorAll('tbody.plan').length || 0)} plan${(c.table?.querySelectorAll('tbody.plan').length || 0) === 1 ? '' : 's'}`),
    );
  }

  wireInvest();
}

/**
 * @param {{key: string, ledger: string, investable: boolean, label: string, table: HTMLTableElement|null}} c
 * @param {any[]} plans
 * @param {number} balance
 */
/** A failed request is reported as an error, never as "no plans". @param {{table: HTMLTableElement|null, label: string}} c @param {unknown} err */
function renderError(c, err) {
  const table = c.table;
  if (!table) return;
  console.error('[plans]', c.label, err);
  table.querySelectorAll('tbody').forEach((b) => b.remove());
  const body = document.createElement('tbody');
  body.innerHTML = `<tr><td colspan="6"><div class="empty" role="alert"><p class="empty__title">${esc(c.label)} plans couldn’t be loaded</p><p>Reload the page to try again.</p></div></td></tr>`;
  table.append(body);
}

function renderCategory(c, plans, balance) {
  const table = c.table;
  if (!table) return;
  const head = table.querySelector('thead tr');
  if (head) {
    head.innerHTML = `<th scope="col">Plan</th><th scope="col" class="is-num">Minimum</th><th scope="col" class="is-num">Target return <span class="plans-th-note">set by TED Brokers</span></th><th scope="col" class="is-num opt-sm">Term</th><th scope="col" class="is-num opt">Subscribers</th><th scope="col"><span class="sr-only">Action</span></th>`;
  }
  table.querySelectorAll('tbody').forEach((b) => b.remove());

  if (!plans.length) {
    const body = document.createElement('tbody');
    body.innerHTML = `<tr><td colspan="6"><div class="empty"><p class="empty__title">No ${esc(c.label)} plans are open yet</p><p>New plans will appear here when they are published.</p></div></td></tr>`;
    table.append(body);
    return;
  }

  for (const plan of plans) {
    const id = safeId(plan.id);
    const term = Number(plan.holding_period_months ?? plan.duration_months ?? 0);
    const min = Number(plan.minimum_investment || 0);
    const ret = Number(plan.expected_return_percent || 0);
    const subs = plan.current_subscribers;
    const body = document.createElement('tbody');
    body.className = 'plan';
    body.dataset.planId = id;
    body.innerHTML = `<tr>
      <td><div class="plan-name"><span class="plan-name__title">${esc(plan.name)}</span><span class="plan-name__desc">${esc(plan.description || plan.plan_type || plan.portfolio_type || '')}</span></div></td>
      <td class="is-num">${esc(money(min))}</td>
      <td class="is-num"><span class="plan-ret">${esc(pct(ret))}</span><span class="sr-only"> per year, target set by TED Brokers</span></td>
      <td class="is-num opt-sm">${term ? `${term} mo` : '—'}</td>
      <td class="is-num opt">${subs != null ? esc(int(subs)) : '—'}</td>
      <td class="is-end"><button class="text-btn xp-btn" type="button" data-expand="plans" aria-controls="plan-${id}" aria-expanded="false" data-label-open="Hide" data-label-closed="Details"><span data-label>Details</span></button></td>
    </tr>
    <tr class="ledger__detail" id="plan-${id}" hidden>
      <td colspan="6">
        <div class="ledger__detail-inner plan-detail">
          <div class="plan-detail__col">
            <h3 class="stat__label">About this plan</h3>
            <p>${esc(plan.description || 'No description has been published for this plan.')}</p>
            ${Array.isArray(plan.tags) && plan.tags.length ? `<p class="fineprint">${plan.tags.map((t) => esc(t)).join(' · ')}</p>` : ''}
          </div>
          <div class="plan-detail__col">
            ${c.investable ? investForm(plan, id, min, balance) : '<p class="muted">Activation for this plan type is not available in this app yet.</p>'}
          </div>
        </div>
      </td>
    </tr>`;
    table.append(body);
  }
}

/**
 * @param {any} plan
 * @param {string} id
 * @param {number} min
 * @param {number} balance
 */
function investForm(plan, id, min, balance) {
  return `<form class="plan-form" novalidate aria-label="Invest in ${esc(plan.name)}" data-invest data-plan-id="${esc(plan.id)}" data-min="${min}">
    <div class="field">
      <div class="plan-form__row"><label class="field__label" for="inv-${id}">Amount</label><span class="field__help">Available ${esc(money(balance))}</span></div>
      <div class="field__control"><span class="field__affix">$</span><input class="field__input amount-input" id="inv-${id}" name="amount" type="number" inputmode="decimal" min="${min}" step="any" required aria-describedby="inv-${id}-help"></div>
      <p class="field__help" id="inv-${id}-help">Minimum ${esc(money(min))}. Funds are taken from your wallet balance.</p>
      <p class="field__error" id="inv-${id}-err"><span data-error-msg></span></p>
    </div>
    <button class="btn btn--block" type="submit">Invest</button>
  </form>`;
}

function wireInvest() {
  document.addEventListener('submit', async (event) => {
    const form = /** @type {HTMLFormElement} */ (event.target);
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-invest')) return;
    event.preventDefault();
    const input = /** @type {HTMLInputElement|null} */ (form.querySelector('input[name="amount"]'));
    if (!input) return;
    clearError(input);
    const amount = Number(input.value);
    const min = Number(form.dataset.min || 0);
    if (!Number.isFinite(amount) || amount < min) {
      setError(input, `Enter at least ${money(min)}.`);
      input.focus();
      return;
    }
    const button = /** @type {HTMLButtonElement|null} */ (form.querySelector('[type="submit"]'));
    if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
    try {
      await api('/api/investments/invest', {
        method: 'POST',
        body: JSON.stringify({ plan_id: form.dataset.planId, amount }),
      });
      toast(`Invested ${money(amount)}. Your portfolio has been updated.`);
      form.reset();
    } catch (err) {
      setError(input, /** @type {Error} */ (err).message || 'The investment could not be placed.');
      input.focus();
    } finally {
      if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
    }
  });
}

boot().catch((err) => console.error('[plans]', err)).finally(() => settle());
