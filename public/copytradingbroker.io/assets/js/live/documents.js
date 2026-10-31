// @ts-check
/**
 * Documents center: realized gains report (FIFO / average cost, CSV), monthly statement PDFs
 * and trade confirmation PDFs. Data: /api/documents, /api/documents/realized-gains.
 */
import { api, download } from './api.js';
import { initBase } from './base.js';
import { markDemo, settle } from './shell.js';
import { toast } from '../lib/util.js';
import { $, $$, h, setText, signedUsd, tone, usdFmt } from '../trade/dom.js';

const state = { year: 0, method: 'fifo', seq: 0 };
const monthName = (/** @type {string} */ p) => {
  const [y, m] = p.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};
const shortDate = (/** @type {string} */ d) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** @param {HTMLButtonElement} btn @param {string} path @param {string} name */
async function save(btn, path, name) {
  if (btn.getAttribute('aria-busy') === 'true') return;
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  try {
    await download(path, name);
  } catch (err) {
    toast(/** @type {Error} */ (err).message, { tone: 'error' });
  } finally {
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
  }
}

/** @param {any} idx */
function renderLists(idx) {
  const st = $('[data-doc-statements]');
  st?.replaceChildren(...(idx.statements.length ? idx.statements.map((/** @type {any} */ s) => h('li', { class: 'doc-item' },
    h('span', null, h('strong', null, monthName(s.period)), s.partial ? h('span', { class: 'muted' }, ' · to date') : null),
    h('button', { class: 'btn btn--sm btn--outline', type: 'button',
      onclick: (/** @type {Event} */ e) => save(/** @type {HTMLButtonElement} */ (e.currentTarget), `/api/documents/statements/${s.period}.pdf`, `ted-statement-${s.period}.pdf`) },
    'PDF', h('span', { class: 'sr-only' }, ` statement for ${monthName(s.period)}`))))
    : [h('li', { class: 'muted' }, 'Statements appear after your first deposit.')]));
  const cf = $('[data-doc-confirmations]');
  cf?.replaceChildren(...(idx.confirmations.length ? idx.confirmations.map((/** @type {any} */ c) => {
    const label = `${c.side.replace(/_/g, ' ')} ${c.qty} ${c.symbol}`;
    return h('li', { class: 'doc-item' },
      h('span', null, h('strong', null, label), h('span', { class: 'muted' },
        ` · ${new Date(c.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${c.avg_price ? ` · avg ${usdFmt(c.avg_price)}` : ''}${c.source !== 'manual' ? ` · ${c.source}` : ''}`)),
      h('button', { class: 'btn btn--sm btn--outline', type: 'button',
        onclick: (/** @type {Event} */ e) => save(/** @type {HTMLButtonElement} */ (e.currentTarget), `/api/documents/confirmations/${c.order_id}.pdf`, `ted-confirmation-${c.symbol}-${c.order_id.slice(-6)}.pdf`) },
      'PDF', h('span', { class: 'sr-only' }, ` confirmation: ${label}`)));
  }) : [h('li', { class: 'muted' }, 'No executed orders yet.')]));
}

async function loadGains() {
  const mine = ++state.seq;
  const body = $('[data-doc-rows]');
  if (!state.year) {
    body?.replaceChildren(h('tr', null, h('td', { colspan: 9, class: 'muted' }, 'No trades yet, so there is nothing to report.')));
    $('[data-doc-summary]')?.replaceChildren();
    return;
  }
  $('[data-doc-gains]')?.setAttribute('aria-busy', 'true');
  try {
    const r = await api(`/api/documents/realized-gains?year=${state.year}&method=${state.method}`);
    if (mine !== state.seq) return;
    const sum = r.summary;
    const stat = (/** @type {string} */ label, /** @type {string} */ value, /** @type {string} */ meta, cls = '') => h('div', { class: 'stat' },
      h('span', { class: 'stat__label' }, label), h('span', { class: `stat__value mono ${cls}` }, value), h('span', { class: 'stat__meta' }, meta));
    $('[data-doc-summary]')?.replaceChildren(
      stat('Net gain / loss', signedUsd(r.net_gain_loss), `${r.rows.length} sale${r.rows.length === 1 ? '' : 's'} in ${r.year}`, tone(r.net_gain_loss)),
      stat('Short-term', signedUsd(sum.short.gain), `Proceeds ${usdFmt(sum.short.proceeds)}`, tone(sum.short.gain)),
      stat('Long-term', signedUsd(sum.long.gain), `Proceeds ${usdFmt(sum.long.proceeds)}`, tone(sum.long.gain)),
      stat('Wash sales', usdFmt(r.wash_sale_disallowed), Number(r.wash_sale_disallowed) ? 'Loss possibly disallowed' : 'None flagged'));
    body?.replaceChildren(...(r.rows.length ? r.rows.map((/** @type {any} */ x) => h('tr', null,
      h('td', null, h('div', { class: 'doc-sym' }, h('strong', null, x.symbol), h('span', null, `${x.description !== x.symbol ? x.description : ''}${x.position === 'short' ? ' · short' : ''}${x.source !== 'self' ? ` · ${x.source.startsWith('copy:') ? 'copy' : 'basket'}` : ''}`))),
      h('td', { class: 'is-num mono' }, x.quantity),
      h('td', { class: 'opt mono' }, shortDate(x.date_acquired)),
      h('td', { class: 'mono' }, shortDate(x.date_sold)),
      h('td', { class: 'is-num mono opt' }, usdFmt(x.proceeds)),
      h('td', { class: 'is-num mono opt' }, usdFmt(x.cost_basis)),
      h('td', { class: `is-num mono ${tone(x.gain_loss)}` }, signedUsd(x.gain_loss)),
      h('td', { class: 'opt-sm' }, x.term === 'long' ? 'Long' : 'Short'),
      h('td', { class: 'is-num mono opt-sm' }, x.wash_sale ? h('span', { class: 'tag tag--plain tag--pending' }, usdFmt(x.wash_sale_disallowed)) : '—')))
      : [h('tr', null, h('td', { colspan: 9, class: 'muted' }, `Nothing was sold in ${state.year}.`))]));
  } catch (err) {
    if (mine === state.seq) {
      $('[data-doc-summary]')?.replaceChildren();
      body?.replaceChildren(h('tr', null, h('td', { colspan: 9 }, h('p', { role: 'alert' }, /** @type {Error} */ (err).message))));
    }
  } finally {
    if (mine === state.seq) $('[data-doc-gains]')?.removeAttribute('aria-busy');
  }
}

async function boot() {
  const session = await initBase();
  if (session.demo) {
    markDemo(/** @type {HTMLElement} */ ($('[data-doc-gains]')), 'Sign in to see your documents.');
    const signIn = () => h('li', { class: 'muted' }, 'Sign in to see your documents.');
    $('[data-doc-statements]')?.replaceChildren(signIn());
    $('[data-doc-confirmations]')?.replaceChildren(signIn());
    $('[data-doc-rows]')?.replaceChildren(h('tr', null, h('td', { colspan: 9, class: 'muted' }, 'Sign in to see your realized gains.')));
    /** @type {HTMLButtonElement} */ ($('[data-doc-csv]')).disabled = true;
    return;
  }
  let idx;
  try {
    idx = await api('/api/documents');
  } catch (err) {
    toast(/** @type {Error} */ (err).message, { tone: 'error' });
    $('[data-doc-statements]')?.replaceChildren(h('li', { role: 'alert' }, 'Documents could not be loaded. Reload the page to try again.'));
    return;
  }
  renderLists(idx);
  const yearSel = /** @type {HTMLSelectElement} */ ($('[data-doc-year]'));
  // Only years with real activity are offered; with none, the selector says so.
  const years = idx.tax_years;
  yearSel.replaceChildren(...(years.length
    ? years.map((/** @type {number} */ y) => h('option', { value: String(y) }, String(y)))
    : [h('option', { value: '' }, 'No activity yet')]));
  state.year = years.length ? years[0] : 0;
  yearSel.disabled = !years.length;
  yearSel.addEventListener('change', () => { state.year = Number(yearSel.value); loadGains(); });
  $('[data-doc-method]')?.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-value]'));
    if (!b) return;
    state.method = b.dataset.value || 'fifo';
    $$('[data-value]', /** @type {HTMLElement} */ ($('[data-doc-method]'))).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    loadGains();
  });
  const csv = /** @type {HTMLButtonElement} */ ($('[data-doc-csv]'));
  csv.disabled = !idx.tax_years.length;
  csv.addEventListener('click', () => save(csv, `/api/documents/realized-gains.csv?year=${state.year}&method=${state.method}`,
    `ted-realized-gains-${state.year}-${state.method}.csv`));
  setText($('.page-head__meta'), `${idx.statements.length} statement${idx.statements.length === 1 ? '' : 's'} · ${idx.confirmations.length} confirmation${idx.confirmations.length === 1 ? '' : 's'}`);
  await loadGains();
}

boot().catch((err) => console.error('[documents]', err)).finally(() => settle());
