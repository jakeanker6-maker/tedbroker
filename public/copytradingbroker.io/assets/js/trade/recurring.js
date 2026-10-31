// @ts-check
/** Recurring tab: invest a fixed amount in the current symbol or one of your ETF baskets on a schedule. */
import { api } from '../live/api.js';
import { toast } from '../lib/util.js';
import { h, usdFmt } from './dom.js';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const FREQ = /** @type {Record<string,string>} */ ({ weekly: 'Every week', biweekly: 'Every two weeks', monthly: 'Every month' });

/** @param {HTMLElement} root @param {{symbol: () => string, assetClass: () => string}} ctx */
export function recurringPanel(root, ctx) {
  let seq = 0;
  let busy = false;
  /** @type {any[]} */ let baskets = [];

  const target = /** @type {HTMLSelectElement} */ (h('select', { class: 'field__select', id: 'rc-target' }));
  const amount = /** @type {HTMLInputElement} */ (h('input', { class: 'field__input mono', id: 'rc-amount', inputmode: 'decimal', autocomplete: 'off',
    placeholder: '50.00', 'aria-describedby': 'rc-amount-help rc-err' }));
  const freq = /** @type {HTMLSelectElement} */ (h('select', { class: 'field__select', id: 'rc-freq' },
    ...Object.entries(FREQ).map(([v, t]) => h('option', { value: v }, t))));
  const dayLabel = h('label', { class: 'field__label', for: 'rc-day' }, 'On');
  const day = /** @type {HTMLSelectElement} */ (h('select', { class: 'field__select', id: 'rc-day' }));
  const err = h('p', { class: 'th-form__error', id: 'rc-err', role: 'alert', hidden: true });
  const noTarget = h('p', { class: 'field__help', hidden: true }, 'Pick a stock, ETF or crypto in the Trading Hub, or create an ETF basket, to invest regularly.');
  const submit = h('button', { class: 'btn btn--sm', type: 'submit' }, 'Start recurring investment');
  const form = h('form', { class: 'th-al__form', novalidate: true, 'aria-labelledby': 'rc-title' },
    h('h2', { class: 'th-label', id: 'rc-title' }, 'Invest regularly'),
    h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'rc-target' }, 'Invest in'), h('div', { class: 'field__control' }, target)),
    h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'rc-amount' }, 'Amount'), h('div', { class: 'field__control' }, h('span', { class: 'field__affix' }, '$'), amount),
      h('p', { class: 'field__help', id: 'rc-amount-help' }, 'Bought with a dollar-amount market order (fractional shares). Minimum $5.')),
    h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'rc-freq' }, 'How often'), h('div', { class: 'field__control' }, freq)),
    h('div', { class: 'field' }, dayLabel, h('div', { class: 'field__control' }, day)),
    h('p', { class: 'fineprint' }, 'Runs at 10:00 ET. Stocks, ETFs and baskets run on trading days (the next one if the market is closed); crypto runs any day. Paid from your cash; skipped and notified if there is not enough.'),
    noTarget, err, submit);
  const list = h('div', { 'aria-live': 'polite' });
  root.replaceChildren(h('div', { class: 'th-al' }, form, list));

  function fillDays() {
    const keep = day.value;
    const monthly = freq.value === 'monthly';
    dayLabel.textContent = monthly ? 'Day of the month' : 'Weekday';
    const crypto = target.value === `symbol:${ctx.symbol()}` && ctx.assetClass() === 'crypto';
    const opts = monthly ? Array.from({ length: 28 }, (_, i) => [String(i + 1), String(i + 1)])
      : WEEKDAYS.map((w, i) => [String(i), w]).filter(([v]) => crypto || Number(v) < 5);
    day.replaceChildren(...opts.map(([v, t]) => h('option', { value: v }, t)));
    if ([...day.options].some((o) => o.value === keep)) day.value = keep;
  }

  function fillTargets() {
    const keep = target.value;
    const sym = ctx.symbol();
    const canSym = ['stock', 'etf', 'crypto'].includes(ctx.assetClass());
    target.replaceChildren(
      ...(canSym ? [h('option', { value: `symbol:${sym}` }, sym)] : []),
      ...(baskets.length ? [h('optgroup', { label: 'Your ETF baskets' }, ...baskets.map((b) => h('option', { value: `basket:${b.id}` }, b.name)))] : []));
    if ([...target.options].some((o) => o.value === keep)) target.value = keep;
    submit.toggleAttribute('disabled', !target.options.length);
    noTarget.hidden = target.options.length > 0;
    fillDays();
  }
  freq.addEventListener('change', fillDays);
  target.addEventListener('change', fillDays);
  amount.addEventListener('input', () => { amount.removeAttribute('aria-invalid'); err.hidden = true; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || !target.value) return;
    const v = amount.value.replace(/[$,\s]/g, '');
    if (!(Number(v) >= 5)) {
      amount.setAttribute('aria-invalid', 'true');
      err.textContent = 'Enter an amount of at least $5.';
      err.hidden = false;
      amount.focus();
      return;
    }
    const [kind, ref] = target.value.split(':');
    busy = true;
    submit.setAttribute('aria-disabled', 'true');
    try {
      const p = await api('/api/trading/recurring', { method: 'POST', body: JSON.stringify({
        kind, symbol: kind === 'symbol' ? ref : null, basket_id: kind === 'basket' ? ref : null,
        amount: v, frequency: freq.value, day: Number(day.value) }) });
      toast(`Recurring investment set: ${p.description}`);
      amount.value = '';
      await load();
      /** @type {HTMLElement|null} */ (list.querySelector('h2'))?.focus();
    } catch (ex) {
      err.textContent = /** @type {Error} */ (ex).message;
      err.hidden = false;
    } finally {
      busy = false;
      submit.removeAttribute('aria-disabled');
      submit.toggleAttribute('disabled', !target.options.length);
    }
  });

  async function load() {
    const mine = ++seq;
    try {
      const [plansR, basketsR] = await Promise.allSettled([api('/api/trading/recurring'), api('/api/trading/baskets')]);
      if (mine !== seq) return;
      if (plansR.status === 'rejected') throw plansR.reason;
      const plans = plansR.value;
      const mineB = basketsR.status === 'fulfilled' ? basketsR.value : { baskets: [] };
      baskets = (mineB.baskets || []).map((/** @type {any} */ b) => ({ id: b.id, name: b.name }));
      fillTargets();
      render(plans.plans || []);
    } catch (ex) {
      if (mine === seq) list.replaceChildren(h('p', { role: 'alert' }, /** @type {Error} */ (ex).message, ' ',
        h('button', { class: 'text-btn', type: 'button', onclick: () => load() }, 'Retry')));
    }
  }

  /** @param {any[]} plans */
  function render(plans) {
    const when = (/** @type {string} */ s) => (s ? new Date(s).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET' : '—');
    list.replaceChildren(
      h('div', { class: 'block-head' }, h('h2', { tabindex: '-1' }, 'Your recurring investments ', h('small', null, String(plans.length)))),
      plans.length ? h('div', { class: 'ledger-wrap', tabindex: '0', role: 'region', 'aria-label': 'Recurring investments' },
        h('table', { class: 'ledger th-table' }, h('caption', { class: 'sr-only' }, 'Recurring investments'),
          h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Plan'), h('th', { scope: 'col' }, 'Next run'),
            h('th', { scope: 'col', class: 'is-num' }, 'Invested'), h('th', { scope: 'col' }, 'Last run'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Actions')))),
          h('tbody', null, ...plans.map((p) => h('tr', null,
            h('td', null, h('strong', null, p.description), p.status === 'paused' ? h('span', { class: 'tag tag--plain tag--pending th-rc__tag' }, 'Paused') : null),
            h('td', { class: 'mono' }, p.status === 'paused' ? '—' : when(p.next_run)),
            h('td', { class: 'is-num mono' }, `${usdFmt(p.invested)} · ${p.runs} run${p.runs === 1 ? '' : 's'}`),
            h('td', { class: 'muted' }, p.last_run ? `${when(p.last_run)}: ${p.last_result}` : 'Not run yet'),
            h('td', { class: 'is-end' }, h('span', { class: 'th-row-actions' },
              h('button', { class: 'text-btn text-btn--muted', type: 'button', onclick: (/** @type {Event} */ ev) => act(/** @type {HTMLButtonElement} */ (ev.currentTarget), p, 'PATCH', { status: p.status === 'active' ? 'paused' : 'active' }) },
                p.status === 'active' ? 'Pause' : 'Resume', h('span', { class: 'sr-only' }, ` ${p.description}`)),
              h('button', { class: 'text-btn', type: 'button', onclick: (/** @type {Event} */ ev) => act(/** @type {HTMLButtonElement} */ (ev.currentTarget), p, 'DELETE') },
                'Delete', h('span', { class: 'sr-only' }, ` ${p.description}`)))))))))
        : h('p', { class: 'muted' }, 'No recurring investments yet.'));
  }

  /** @param {HTMLButtonElement} btn @param {any} p @param {'PATCH'|'DELETE'} method @param {any} [body] */
  async function act(btn, p, method, body) {
    if (method === 'DELETE' && !window.confirm(`Delete “${p.description}”? Past purchases stay in your portfolio.`)) return;
    btn.disabled = true;
    try {
      await api(`/api/trading/recurring/${encodeURIComponent(p.id)}`, { method, body: body ? JSON.stringify(body) : undefined });
      toast(method === 'DELETE' ? 'Recurring investment deleted' : body.status === 'paused' ? 'Paused' : 'Resumed');
      await load();
      target.focus();
    } catch (ex) {
      btn.disabled = false;
      toast(/** @type {Error} */ (ex).message, { tone: 'error' });
    }
  }

  return { load, symbolChanged: () => { fillTargets(); } };
}
