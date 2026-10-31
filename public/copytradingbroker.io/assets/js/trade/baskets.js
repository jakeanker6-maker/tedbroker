// @ts-check
/** ETF baskets tab: owned baskets (value, drift, actions), template gallery, custom builder. */
import { api } from '../live/api.js';
import { toast } from '../lib/util.js';
import { h, signedPct, signedUsd, tone, usdFmt } from './dom.js';

const PALETTE = ['var(--teal-300)', 'var(--navy-300)', 'var(--amber-400)', 'var(--red-400)', 'var(--slate-300)', 'var(--teal-700)'];

/** @param {{symbol: string, weight?: string, target?: string, actual?: string}[]} rows @param {'weight'|'target'|'actual'} key */
function weightBar(rows, key) {
  return h('div', { class: 'th-weightbar', role: 'img', 'aria-label': rows.map((r) => `${r.symbol} ${Number(r[key]).toFixed(1)}%`).join(', ') },
    ...rows.map((r, i) => h('span', { style: `inline-size:${Number(r[key])}%;background:${PALETTE[i % PALETTE.length]}` })));
}

/** @param {HTMLElement} root @param {() => void} onChange */
export function basketsPanel(root, onChange) {
  /** @type {any[]} */ let templates = [];

  async function load() {
    try {
      const [mine, tpl] = await Promise.all([api('/api/trading/baskets'), templates.length ? null : api('/api/trading/baskets/templates')]);
      if (tpl) templates = tpl.templates;
      render(mine.baskets || []);
    } catch (err) {
      root.replaceChildren(h('p', { class: 'muted' }, /** @type {Error} */ (err).message));
    }
  }

  /** Inline amount form. @param {string} label @param {(v: string) => Promise<void>} submit @param {string} [placeholder] */
  function inlineForm(label, submit, placeholder = 'Amount') {
    const input = /** @type {HTMLInputElement} */ (h('input', { class: 'field__input mono', inputmode: 'decimal', placeholder, 'aria-label': `${label}: ${placeholder}`, size: 8 }));
    const btn = h('button', { class: 'btn btn--sm', type: 'submit' }, label);
    const form = h('form', { class: 'th-basket-actions' }, input, btn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = input.value.replace(/[$,%\s]/g, '');
      if (!(Number(v) > 0)) { input.focus(); return; }
      btn.setAttribute('disabled', '');
      try { await submit(v); } catch (err) { toast(/** @type {Error} */ (err).message, { tone: 'error' }); } finally { btn.removeAttribute('disabled'); }
    });
    return form;
  }

  /** @param {string} path @param {any} body @param {string} done */
  async function act(path, body, done) {
    const res = await api(path, { method: body === undefined ? 'POST' : 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
    const n = res.orders?.length ?? 0;
    toast(`${done}${n ? ` · ${n} order${n === 1 ? '' : 's'}` : ''}`);
    await load();
    onChange();
  }

  /** @param {any[]} mine */
  function render(mine) {
    const sections = [];
    sections.push(h('div', { class: 'block-head' }, h('h2', null, 'Your ETF baskets')));
    if (!mine.length) sections.push(h('p', { class: 'muted' }, 'You have no baskets yet. Start with a model portfolio below or build your own.'));
    for (const b of mine) {
      const actions = h('div', { class: 'th-basket-actions' });
      const panel = h('div');
      const show = (/** @type {HTMLElement} */ el) => panel.replaceChildren(el);
      actions.append(
        h('button', { class: 'text-btn', type: 'button', onclick: () => show(inlineForm('Invest', (v) => act(`/api/trading/baskets/${encodeURIComponent(b.id)}/invest`, { amount: v }, `Investing $${v} in ${b.name}`))) }, 'Invest'),
        h('button', { class: 'text-btn', type: 'button', onclick: async (/** @type {Event} */ e) => {
          const btn = /** @type {HTMLButtonElement} */ (e.currentTarget);
          if (btn.disabled) return;
          btn.disabled = true;                                   // no double submits
          try { await act(`/api/trading/baskets/${encodeURIComponent(b.id)}/rebalance`, undefined, `${b.name} rebalanced`); }
          catch (err) { toast(/** @type {Error} */ (err).message, { tone: 'error' }); }
          finally { btn.disabled = false; }
        } }, 'Rebalance'),
        h('button', { class: 'text-btn', type: 'button', onclick: () => show(inlineForm('Sell %', (v) => act(`/api/trading/baskets/${encodeURIComponent(b.id)}/sell`, { percent: v }, `Selling ${v}% of ${b.name}`), 'Percent')) }, 'Sell'),
        h('button', { class: 'text-btn', type: 'button', onclick: () => show(autoForm(b)) }, b.auto_invest ? `Auto: ${usdFmt(b.auto_invest.amount)} ${b.auto_invest.frequency}` : 'Auto-invest'));
      sections.push(h('div', { class: 'th-basket-row' },
        h('div', null, h('h3', null, b.name),
          h('p', null, `${usdFmt(b.value)} · `, h('span', { class: tone(b.pnl) }, `${signedUsd(b.pnl)} (${signedPct(b.pnl_percent)})`), ` · drift ${Number(b.max_drift).toFixed(1)}%`)),
        h('div', null,
          h('div', { class: 'th-weights' }, ...b.holdings.map((/** @type {any} */ x) => h('span', null, `${x.symbol} ${Number(x.actual).toFixed(1)}% / ${Number(x.target).toFixed(0)}%`))),
          weightBar(b.holdings, 'actual'), weightBar(b.holdings, 'target')),
        h('div', null, actions, panel)));
    }
    sections.push(h('div', { class: 'block-head' }, h('h2', null, 'Model portfolios')));
    for (const t of templates) {
      sections.push(h('div', { class: 'th-basket-row' },
        h('div', null, h('h3', null, t.name), h('p', null, `${t.risk} risk · ${t.description}`)),
        h('div', null, h('div', { class: 'th-weights' }, ...t.holdings.map((/** @type {any} */ x) => h('span', { title: x.name }, `${x.symbol} ${Number(x.weight)}%`))), weightBar(t.holdings, 'weight')),
        inlineForm('Invest', async (v) => {
          await api('/api/trading/baskets', { method: 'POST', body: JSON.stringify({ template_id: t.id, amount: v }) });
          toast(`Investing $${v} in ${t.name}`);
          await load(); onChange();
        })));
    }
    sections.push(customBuilder());
    root.replaceChildren(h('div', { class: 'th-baskets' }, ...sections));
  }

  /** @param {any} b */
  function autoForm(b) {
    const amount = /** @type {HTMLInputElement} */ (h('input', { class: 'field__input mono', inputmode: 'decimal', placeholder: 'Amount', 'aria-label': 'Auto-invest amount', size: 7, value: b.auto_invest?.amount || '' }));
    const freq = /** @type {HTMLSelectElement} */ (h('select', { class: 'field__select', 'aria-label': 'Frequency' }, h('option', { value: 'weekly' }, 'Weekly'), h('option', { value: 'monthly' }, 'Monthly')));
    if (b.auto_invest) freq.value = b.auto_invest.frequency;
    const form = h('form', { class: 'th-basket-actions' }, amount, freq, h('button', { class: 'btn btn--sm', type: 'submit' }, 'Save'),
      b.auto_invest ? h('button', { class: 'text-btn text-btn--muted', type: 'button', onclick: async () => {
        try {
          await api(`/api/trading/baskets/${encodeURIComponent(b.id)}/auto-invest`, { method: 'PATCH', body: JSON.stringify({}) });
          toast('Auto-invest turned off'); load();
        } catch (err) { toast(/** @type {Error} */ (err).message, { tone: 'error' }); }
      } }, 'Turn off') : null);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(`/api/trading/baskets/${encodeURIComponent(b.id)}/auto-invest`, { method: 'PATCH', body: JSON.stringify({ amount: amount.value, frequency: freq.value }) });
        toast(`Auto-invest set: ${usdFmt(amount.value)} ${freq.value}`);
        load();
      } catch (err) { toast(/** @type {Error} */ (err).message, { tone: 'error' }); }
    });
    return form;
  }

  function customBuilder() {
    const rowsEl = h('div', { class: 'th-weights', style: 'display:grid;gap:var(--space-2)' });
    const total = h('span', { class: 'mono' }, 'Total 0%');
    const name = /** @type {HTMLInputElement} */ (h('input', { class: 'field__input', placeholder: 'Basket name', 'aria-label': 'Basket name', maxlength: 60 }));
    const amount = /** @type {HTMLInputElement} */ (h('input', { class: 'field__input mono', inputmode: 'decimal', placeholder: 'Amount to invest', 'aria-label': 'Amount to invest' }));
    const addRow = () => {
      if (rowsEl.children.length >= 20) return;
      const i = rowsEl.children.length + 1;
      const row = h('div', { class: 'th-basket-actions', style: 'justify-content:flex-start' },
        h('input', { class: 'field__input mono', placeholder: 'ETF symbol', 'aria-label': `ETF ${i} symbol`, size: 8, 'data-sym': '' }),
        h('input', { class: 'field__input mono', inputmode: 'decimal', placeholder: 'Weight %', 'aria-label': `ETF ${i} weight`, size: 6, 'data-w': '' }),
        h('button', { class: 'text-btn text-btn--muted', type: 'button', onclick: () => { row.remove(); sum(); } }, 'Remove'));
      rowsEl.append(row);
    };
    const sum = () => {
      const raw = [...rowsEl.querySelectorAll('[data-w]')].reduce((a, i) => a + (Number(/** @type {HTMLInputElement} */ (i).value) || 0), 0);
      const t = Math.round(raw * 100) / 100;                  // 33.3 + 33.3 + 33.4 = 100, not 100.00000000000001
      const ok = Math.abs(t - 100) < 0.005;
      total.textContent = ok ? `Total ${t}% ✓` : `Total ${t}% (${t > 100 ? '▲' : '▼'} ${Math.abs(Math.round((t - 100) * 100) / 100)}% ${t > 100 ? 'over' : 'short'})`;
      total.className = `mono ${ok ? 'gain' : 'loss'}`;
    };
    rowsEl.addEventListener('input', sum);
    addRow(); addRow();
    const form = h('form', { class: 'th-basket-row' },
      h('div', null, h('h3', null, 'Build your own'), h('p', null, 'Up to 20 ETFs. Weights must total 100%.'), name),
      h('div', null, rowsEl, h('p', null, h('button', { class: 'text-btn', type: 'button', onclick: addRow }, 'Add ETF'), ' · ', total)),
      h('div', { class: 'th-basket-actions' }, amount, h('button', { class: 'btn btn--sm', type: 'submit' }, 'Create basket')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const holdings = [...rowsEl.children].map((r) => ({
        symbol: /** @type {HTMLInputElement} */ (r.querySelector('[data-sym]')).value.trim(),
        weight: /** @type {HTMLInputElement} */ (r.querySelector('[data-w]')).value.trim() })).filter((x) => x.symbol);
      try {
        await api('/api/trading/baskets', { method: 'POST', body: JSON.stringify({ name: name.value || 'My basket', holdings, amount: amount.value || undefined }) });
        toast('Basket created');
        await load(); onChange();
      } catch (err) { toast(/** @type {Error} */ (err).message, { tone: 'error' }); }
    });
    return form;
  }

  return { load };
}
