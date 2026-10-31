// @ts-check
/** Alerts tab: create price / % move / order-filled alerts and manage existing ones. */
import { api } from '../live/api.js';
import { toast } from '../lib/util.js';
import { h, price } from './dom.js';

const KIND_LABEL = /** @type {Record<string,string>} */ ({
  price_above: 'Price rises to', price_below: 'Price falls to', pct_move: 'Moves by % in a day', order_filled: 'An order fills',
});

/**
 * @param {HTMLElement} root
 * @param {{symbol: () => string, last: () => number}} ctx
 */
export function alertsPanel(root, ctx) {
  let seq = 0;
  let busy = false;
  const ids = { kind: 'al-kind', thr: 'al-thr', email: 'al-email', note: 'al-note', err: 'al-err', help: 'al-thr-help' };

  const kind = /** @type {HTMLSelectElement} */ (h('select', { class: 'field__select', id: ids.kind },
    ...Object.entries(KIND_LABEL).map(([v, t]) => h('option', { value: v }, t))));
  const thr = /** @type {HTMLInputElement} */ (h('input', { class: 'field__input mono', id: ids.thr, inputmode: 'decimal', autocomplete: 'off',
    'aria-describedby': `${ids.help} ${ids.err}` }));
  const thrHelp = h('p', { class: 'field__help', id: ids.help });
  const thrLabel = h('label', { class: 'field__label', for: ids.thr }, 'Price');
  const thrField = h('div', { class: 'field' }, thrLabel, h('div', { class: 'field__control' }, thr), thrHelp);
  const scope = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', id: 'al-scope' }));
  const scopeField = h('div', { class: 'field th-al__check', hidden: true }, h('label', { for: 'al-scope' }, scope, ' Only for this symbol'));
  const email = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', id: ids.email }));
  const note = /** @type {HTMLInputElement} */ (h('input', { class: 'field__input', id: ids.note, maxlength: 140, autocomplete: 'off' }));
  const err = h('p', { class: 'th-form__error', id: ids.err, role: 'alert', hidden: true });
  const submit = h('button', { class: 'btn btn--sm', type: 'submit' }, 'Create alert');
  const title = h('h2', { class: 'th-label', id: 'al-title' }, 'New alert');
  const form = h('form', { class: 'th-al__form', novalidate: true, 'aria-labelledby': 'al-title' }, title,
    h('div', { class: 'field' }, h('label', { class: 'field__label', for: ids.kind }, 'Alert me when'), h('div', { class: 'field__control' }, kind)),
    thrField, scopeField,
    h('div', { class: 'field' }, h('label', { class: 'field__label', for: ids.note }, 'Note (optional)'), h('div', { class: 'field__control' }, note)),
    h('div', { class: 'field th-al__check' }, h('label', { for: ids.email }, email, ' Also send me an email')),
    err, submit);
  const list = h('div', { 'aria-live': 'polite' });
  root.replaceChildren(h('div', { class: 'th-al' }, form, list));

  function sync() {
    const k = kind.value;
    const sym = ctx.symbol();
    thrField.hidden = k === 'order_filled';
    scopeField.hidden = k !== 'order_filled';
    scopeField.querySelector('label')?.replaceChildren(scope, ` Only for ${sym}`);
    thrLabel.textContent = k === 'pct_move' ? 'Change (%)' : 'Price ($)';
    const last = ctx.last();
    thrHelp.textContent = k === 'pct_move'
      ? `Alerts once per trading day when ${sym} is up or down this much from yesterday’s close.`
      : Number.isFinite(last) ? `${sym} last ${price(last)}. One-time alert.` : `One-time alert for ${sym}.`;
    if (k === 'order_filled') thrHelp.textContent = 'Every fill, including copy-trading and basket orders.';
    title.textContent = k === 'order_filled' ? 'New order-filled alert' : `New alert for ${sym}`;
    err.hidden = true;
    thr.removeAttribute('aria-invalid');
  }
  kind.addEventListener('change', () => {
    const last = ctx.last();
    const lvl = (/** @type {number} */ x) => String(x >= 1 ? Number(x.toFixed(2)) : Number(x.toPrecision(4)));
    if (kind.value === 'price_above' && Number.isFinite(last)) thr.value = lvl(last * 1.05);
    else if (kind.value === 'price_below' && Number.isFinite(last)) thr.value = lvl(last * 0.95);
    else if (kind.value === 'pct_move') thr.value = '5';
    sync();
  });
  thr.addEventListener('input', () => { thr.removeAttribute('aria-invalid'); err.hidden = true; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const k = kind.value;
    const v = thr.value.replace(/[$,%\s]/g, '');
    if (k !== 'order_filled' && !(Number(v) > 0)) {
      thr.setAttribute('aria-invalid', 'true');
      err.textContent = k === 'pct_move' ? 'Enter a percentage above 0.' : 'Enter a price above 0.';
      err.hidden = false;
      thr.focus();
      return;
    }
    busy = true;
    submit.setAttribute('aria-disabled', 'true');
    try {
      const body = { kind: k, email: email.checked, note: note.value.trim(),
        symbol: k === 'order_filled' ? (scope.checked ? ctx.symbol() : null) : ctx.symbol(),
        threshold: k === 'order_filled' ? null : v };
      const a = await api('/api/trading/alerts', { method: 'POST', body: JSON.stringify(body) });
      toast(`Alert created: ${a.description}`);
      note.value = '';
      await load();
      /** @type {HTMLElement|null} */ (list.querySelector('h2'))?.focus();
    } catch (ex) {
      err.textContent = /** @type {Error} */ (ex).message;
      err.hidden = false;
    } finally {
      busy = false;
      submit.removeAttribute('aria-disabled');
    }
  });

  async function load() {
    const mine = ++seq;
    if (!thr.value && kind.value !== 'order_filled') kind.dispatchEvent(new Event('change'));
    sync();
    try {
      const res = await api('/api/trading/alerts');
      if (mine !== seq) return;
      render(res.alerts || [], res.max_active);
    } catch (ex) {
      if (mine === seq) list.replaceChildren(h('p', { role: 'alert' }, /** @type {Error} */ (ex).message, ' ',
        h('button', { class: 'text-btn', type: 'button', onclick: () => load() }, 'Retry')));
    }
  }

  /** @param {any[]} rows @param {number} max */
  function render(rows, max) {
    const active = rows.filter((a) => a.status === 'active');
    const done = rows.filter((a) => a.status === 'triggered').slice(0, 10);
    const when = (/** @type {string} */ s) => (s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
    const table = (/** @type {string} */ caption, /** @type {any[]} */ items, /** @type {boolean} */ canDelete) => h('div', { class: 'ledger-wrap', tabindex: '0', role: 'region', 'aria-label': caption },
      h('table', { class: 'ledger th-table' }, h('caption', { class: 'sr-only' }, caption),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Alert'), h('th', { scope: 'col' }, canDelete ? 'Delivery' : 'Triggered'),
          h('th', { scope: 'col', class: 'is-num' }, canDelete ? 'Fired' : 'Value'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Actions')))),
        h('tbody', null, ...items.map((a) => h('tr', null,
          h('td', null, h('strong', null, a.description), a.note ? h('span', { class: 'muted' }, ` · ${a.note}`) : null),
          h('td', null, canDelete ? (a.email ? 'In app + email' : 'In app') : when(a.triggered_at)),
          h('td', { class: 'is-num mono' }, canDelete ? String(a.fired_count || 0) : a.kind === 'pct_move' ? `${a.trigger_value}%` : price(a.trigger_value)),
          h('td', { class: 'is-end' }, h('button', { class: 'text-btn', type: 'button', onclick: (/** @type {Event} */ ev) => remove(/** @type {HTMLButtonElement} */ (ev.currentTarget), a) },
            canDelete ? 'Delete' : 'Clear', h('span', { class: 'sr-only' }, ` alert: ${a.description}`))))))));
    const parts = [
      h('div', { class: 'block-head' }, h('h2', { tabindex: '-1' }, 'Active alerts ', h('small', null, `${active.length} of ${max}`))),
      active.length ? table('Active alerts', active, true) : h('p', { class: 'muted' }, 'No active alerts. Create one here; it shows in the bell menu when it fires.'),
    ];
    if (done.length) parts.push(h('div', { class: 'block-head mt-5' }, h('h2', null, 'Recently triggered')), table('Recently triggered alerts', done, false));
    list.replaceChildren(...parts);
  }

  /** @param {HTMLButtonElement} btn @param {any} a */
  async function remove(btn, a) {
    if (a.status === 'active' && !window.confirm(`Delete the alert “${a.description}”?`)) return;
    btn.disabled = true;
    try {
      await api(`/api/trading/alerts/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
      toast('Alert deleted');
      await load();
      /** @type {HTMLElement|null} */ (form.querySelector('select'))?.focus();
    } catch (ex) {
      btn.disabled = false;
      toast(/** @type {Error} */ (ex).message, { tone: 'error' });
    }
  }

  /** Symbol changed: suggest a fresh level for it. */
  function symbolChanged() { thr.value = ''; if (!root.closest('[hidden]')) load(); }

  return { load, sync, symbolChanged };
}
