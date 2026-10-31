// @ts-check
/**
 * Unified portfolio: self-directed trading, copy trading, ETF baskets and managed plans in
 * one view. Data: /api/trading/portfolio/{summary,history}, /api/trading/positions,
 * /api/copy/links, /api/investments/portfolio. Refreshes live from the account stream.
 */
import { api } from './api.js';
import { initBase } from './base.js';
import { settle } from './shell.js';
import { toast } from '../lib/util.js';
import { $, $$, debounce, h, isOcc, occName, price, qty as fmtQty, setText, signedPct, signedUsd, tone, usdFmt } from '../trade/dom.js';
import { markDemo } from './shell.js';
import { PriceChart, ready as chartReady } from '../trade/chart.js';
import { accountStream } from '../trade/stream.js';

const CLASS_LABEL = /** @type {Record<string,string>} */ ({
  stock: 'Stocks', etf: 'ETFs', crypto: 'Crypto', option: 'Options', cash: 'Cash', managed_plans: 'Managed plans',
});
const state = { range: '1M', filter: 'all', /** @type {any[]} */ positions: [], sourceKey: '', histSeq: 0, refreshSeq: 0, demo: false, /** @type {{link: string, act: string}|null} */ focus: null };
/** @param {number} cols @param {string} msg */
const errorRow = (cols, msg) => h('tr', null, h('td', { colspan: cols }, h('div', { class: 'empty' }, h('p', { class: 'empty__title' }, 'Couldn’t load this section'), h('p', null, msg))));
/** @type {PriceChart|null} */ let chart = null;

/** @param {HTMLElement|null} list @param {{label: string, value: string, percent: string}[]} rows */
function hbars(list, rows) {
  if (!list) return;
  const shown = rows.filter((r) => Number(r.value) !== 0);
  if (!shown.length) { list.replaceChildren(h('li', { class: 'muted' }, 'Nothing here yet.')); return; }
  list.replaceChildren(...shown.sort((a, b) => Number(b.value) - Number(a.value)).map((r, i) => {
    const pct = Math.max(0, Number(r.percent));
    return h('li', { class: 'pf-hbar', style: `--i:${i}` },
      h('span', null, r.label), h('span', { class: 'pf-hbar__pct' }, `${pct.toFixed(1)}%`),
      h('span', { class: 'pf-hbar__amt' }, usdFmt(r.value)),
      h('span', { class: 'pf-hbar__track', 'aria-hidden': 'true' }, h('span', { class: 'pf-hbar__fill', style: `--w:${pct.toFixed(1)}%` })));
  }));
}

/** @param {any} s */
function renderSummary(s) {
  const set = (/** @type {string} */ k, /** @type {string} */ v, /** @type {string} */ [cls] = []) => {
    const el = $(`[data-pf="${k}"]`);
    if (!el) return;
    el.textContent = v;
    if (cls !== undefined) el.className = `${el.className.split(' ').filter((c) => !['gain', 'loss'].includes(c)).join(' ')} ${cls}`.trim();
  };
  set('total_value', usdFmt(s.total_value));
  set('day_pnl', signedUsd(s.day_pnl), [tone(s.day_pnl)]);
  set('day_pct', `${signedPct(s.day_pnl_percent)} since the previous close`);
  set('unrealized_pnl', signedUsd(s.unrealized_pnl), [tone(s.unrealized_pnl)]);
  // Free cash: the same figure the Wallet, Copy traders and Plans pages use (cash minus holds).
  set('cash', usdFmt(s.withdrawable ?? s.cash));
  set('cash_meta', Number(s.reserved) > 0 ? `${usdFmt(s.reserved)} held for orders, copies or withdrawals` : 'Free to trade or withdraw');
  set('buying_power', usdFmt(s.buying_power));
  set('bp_meta', s.account_type === 'margin' ? 'Margin account · stocks and ETFs' : 'Cash account');
  setText($('[data-pf-meta]'), `${s.positions_count} position${s.positions_count === 1 ? '' : 's'} · ${s.copy_trading?.copies || 0} cop${s.copy_trading?.copies === 1 ? 'y' : 'ies'} · ${s.plans?.count || 0} plan${s.plans?.count === 1 ? '' : 's'} · ${s.market?.equities === 'open' ? 'Market open' : 'Market closed'}` + (s.unpriced_positions ? ` · ${s.unpriced_positions} without a live price, counted at cost` : ''));
  $('[data-pf-summary]')?.removeAttribute('aria-busy');
  hbars($('[data-pf-sources]'), s.by_source || []);
  hbars($('[data-pf-classes]'), (s.by_asset_class || []).map((/** @type {any} */ c) => ({ ...c, label: CLASS_LABEL[c.asset_class] || c.asset_class })));
}

async function loadHistory() {
  const seq = ++state.histSeq;
  const note = $('[data-pf-chart-note]');
  try {
    const hist = await api(`/api/trading/portfolio/history?range=${encodeURIComponent(state.range)}`);
    await chartReady();
    if (seq !== state.histSeq) return;
    hist.points = Array.isArray(hist.points) ? hist.points : [];
    chart = chart || new PriceChart(/** @type {HTMLElement} */ ($('[data-pf-chart]')));
    const pts = hist.points.map((/** @type {any} */ p) => ({ t: p.t, o: Number(p.value), h: Number(p.value), l: Number(p.value), c: Number(p.value) }));
    chart.setData(pts, state.range === '1D' || state.range === '1W' ? 60 : 86400);
    const ch = $('[data-pf-change]');
    if (ch) { ch.textContent = `${signedUsd(hist.change)} (${signedPct(hist.change_percent)})`; ch.className = tone(hist.change); }
    if (note) {
      note.textContent = hist.points.length < 3
        ? 'History builds up from now on: a point is recorded every minute while you hold positions and at every market close.'
        : 'Recorded from your account snapshots (every minute while you hold positions, and at each close).';
    }
  } catch (err) {
    console.error('[portfolio] history', err);
    if (seq === state.histSeq && note) note.textContent = 'Account history could not be loaded. Try another range or reload the page.';
  }
}

function renderFilter() {
  const el = $('[data-pf-filter]');
  if (!el) return;
  const sources = new Map([['all', 'All']]);
  for (const p of state.positions) sources.set(p.bucket, p.bucket_label);
  if (!sources.has(state.filter)) state.filter = 'all';
  const key = [...sources.keys()].join('|');
  if (key === state.sourceKey) {
    $$('[data-value]', el).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === state.filter)));
    return;
  }
  state.sourceKey = key;
  el.replaceChildren(...[...sources].map(([b, label]) => h('button', {
    class: 'seg__btn', type: 'button', 'aria-pressed': String(b === state.filter), dataset: { value: b },
  }, label.replace(/^Copying /, ''))));
}

function renderHoldings() {
  const tbody = $('[data-pf-holdings]');
  if (!tbody) return;
  const rows = state.positions.filter((p) => state.filter === 'all' || p.bucket === state.filter);
  setText($('[data-pf-hold-count]'), `${rows.length}`);
  if (!rows.length) {
    tbody.replaceChildren(h('tr', null, h('td', { colspan: 8 }, h('div', { class: 'empty' },
      h('p', { class: 'empty__title' }, 'No holdings yet'),
      h('p', null, 'Buy a stock, ETF, crypto or option in the Trading Hub, start an ETF basket, or copy a trader.'),
      h('p', { class: 'mt-3' }, h('a', { class: 'link-arrow', href: 'trade.html' }, 'Open the Trading Hub'))))));
    return;
  }
  tbody.replaceChildren(...rows.map((p) => h('tr', null,
    h('td', null, h('div', { class: 'pf-name' },
      h('strong', null, h('a', { href: `trade.html?symbol=${encodeURIComponent(p.symbol)}` }, isOcc(p.symbol) ? occName(p.symbol) : p.symbol)),
      h('span', null, `${Number(p.qty) < 0 ? 'Short · ' : ''}${p.asset_class === 'option' ? 'Option' : p.name || ''}`))),
    h('td', { class: 'opt-sm' }, p.bucket_label),
    h('td', { class: 'is-num' }, fmtQty(p.qty)),
    h('td', { class: 'is-num opt' }, price(p.avg_cost)),
    h('td', { class: 'is-num opt' }, price(p.mark)),
    h('td', { class: 'is-num' }, usdFmt(p.market_value)),
    h('td', { class: `is-num opt ${tone(p.day_pnl)}` }, p.day_pnl == null ? '—' : signedUsd(p.day_pnl)),
    h('td', { class: `is-num ${tone(p.unrealized_pnl)}` }, signedUsd(p.unrealized_pnl), h('span', { class: 'pf-pct' }, signedPct(p.unrealized_pnl_percent))))));
}

const STATUS = /** @type {Record<string,[string,string]>} */ ({ active: ['Copying', 'tag--gain'], paused: ['Paused', 'tag--pending'], stopping: ['Closing positions', 'tag--pending'] });

/** @param {any[]} links */
function renderCopies(links) {
  const tbody = $('[data-pf-copies]');
  if (!tbody) return;
  setText($('[data-pf-copies-count]'), `${links.length}`);
  $$('.rail__aside--live').forEach((el) => { el.textContent = `${links.length} live`; el.hidden = !links.length; });
  if (!links.length) {
    tbody.replaceChildren(h('tr', null, h('td', { colspan: 7 }, h('div', { class: 'empty' },
      h('p', { class: 'empty__title' }, 'You aren’t copying any traders'),
      h('p', null, 'Copy a trader to mirror their trades automatically in your portfolio.'),
      h('p', { class: 'mt-3' }, h('a', { class: 'link-arrow', href: 'copy-traders.html' }, 'Browse traders'))))));
    return;
  }
  tbody.replaceChildren(...links.map((l) => {
    const [label, cls] = STATUS[l.status] || [l.status, ''];
    const actions = h('span', { class: 'pf-actions' });
    if (l.status === 'active' || l.status === 'paused') {
      actions.append(
        h('button', { class: 'text-btn text-btn--muted', type: 'button', dataset: { link: l.id, act: 'toggle' }, onclick: (/** @type {Event} */ e) => act(/** @type {HTMLButtonElement} */ (e.currentTarget), l, { status: l.status === 'active' ? 'paused' : 'active' }, l.status === 'active' ? 'Copy paused' : 'Copy resumed') },
          l.status === 'active' ? 'Pause' : 'Resume', h('span', { class: 'sr-only' }, ` copying ${l.trader_name}`)),
        h('button', { class: 'text-btn', type: 'button', dataset: { link: l.id, act: 'stop' }, onclick: (/** @type {Event} */ e) => stopCopy(/** @type {HTMLButtonElement} */ (e.currentTarget), l) }, 'Stop', h('span', { class: 'sr-only' }, ` copying ${l.trader_name}`)));
    }
    return h('tr', null,
      h('td', null, h('div', { class: 'pf-name', tabindex: '-1', dataset: { linkName: l.id } }, h('strong', null, l.trader_name), h('span', null, `${l.positions} position${l.positions === 1 ? '' : 's'}${l.note ? ` · ${l.note}` : ''}`))),
      h('td', null, h('span', { class: `tag tag--plain ${cls}` }, label)),
      h('td', { class: 'is-num' }, usdFmt(l.allocated)),
      h('td', { class: 'is-num opt' }, usdFmt(l.equity)),
      h('td', { class: `is-num ${tone(l.pnl)}` }, signedUsd(l.pnl), h('span', { class: 'pf-pct' }, signedPct(l.pnl_percent))),
      h('td', { class: 'is-num opt' }, usdFmt(l.cash)),
      h('td', { class: 'is-end' }, actions));
  }));
  if (state.focus) {
    const { link, act: a } = state.focus;
    state.focus = null;
    const target = $(`[data-link="${CSS.escape(link)}"][data-act="${a}"]`) || $(`[data-link-name="${CSS.escape(link)}"]`);
    target?.focus();
  }
}

/** @param {HTMLButtonElement} btn @param {() => Promise<unknown>} fn */
async function guarded(btn, fn) {
  if (btn.getAttribute('aria-busy') === 'true') return;
  btn.setAttribute('aria-busy', 'true');
  btn.disabled = true;
  try { await fn(); } finally { btn.removeAttribute('aria-busy'); btn.disabled = false; }
}

/** @param {HTMLButtonElement} btn @param {any} l @param {any} body @param {string} done */
function act(btn, l, body, done) {
  return guarded(btn, async () => {
    try {
      await api(`/api/copy/links/${encodeURIComponent(l.id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast(`${done}: ${l.trader_name}`);
      state.focus = { link: l.id, act: 'toggle' };
      refresh();
    } catch (err) { toast(/** @type {Error} */ (err).message || 'Could not update this copy.', { tone: 'error' }); }
  });
}

/** @param {HTMLButtonElement} btn @param {any} l */
function stopCopy(btn, l) {
  const n = Number(l.positions);
  const what = n ? `Its ${n} position${n === 1 ? '' : 's'} will be sold at market and the cash returned to your account.` : 'Its cash will be returned to your account.';
  if (!window.confirm(`Stop copying ${l.trader_name}? ${what}`)) return;
  return guarded(btn, async () => {
    try {
      await api(`/api/copy/links/${encodeURIComponent(l.id)}`, { method: 'DELETE' });
      toast(`Stopping ${l.trader_name}: positions are being closed`);
      state.focus = { link: l.id, act: 'stop' };
      refresh();
    } catch (err) { toast(/** @type {Error} */ (err).message || 'Could not stop this copy.', { tone: 'error' }); }
  });
}

/** @param {any} p */
function renderPlans(p) {
  const tbody = $('[data-pf-plans]');
  if (!tbody) return;
  const invs = (p?.investments || []).filter((/** @type {any} */ i) => i.status === 'active');
  setText($('[data-pf-plans-count]'), `${invs.length}`);
  if (!invs.length) {
    tbody.replaceChildren(h('tr', null, h('td', { colspan: 5, class: 'muted' }, 'No active managed plans.')));
    return;
  }
  tbody.replaceChildren(...invs.map((/** @type {any} */ i) => h('tr', null,
    h('td', null, h('strong', null, i.plan_name)),
    h('td', { class: 'is-num opt-sm' }, usdFmt(i.amount_invested)),
    h('td', { class: 'is-num' }, usdFmt(i.current_value)),
    h('td', { class: `is-num ${tone(i.profit_loss)}` }, signedUsd(i.profit_loss), h('span', { class: 'pf-pct' }, signedPct(i.profit_loss_percent))),
    h('td', { class: 'mono muted opt' }, Number.isFinite(Date.parse(i.maturity_date)) ? new Date(i.maturity_date).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'))));
}

let loadedOnce = false;
const refresh = debounce(async () => {
  const seq = ++state.refreshSeq;
  const [sum, pos, links, plans] = await Promise.allSettled([
    api('/api/trading/portfolio/summary'), api('/api/trading/positions'),
    api('/api/copy/links'), api('/api/investments/portfolio'),
  ]);
  if (seq !== state.refreshSeq) return;   // a newer refresh is in flight
  const first = !loadedOnce;
  loadedOnce = true;
  if (sum.status === 'fulfilled') renderSummary(sum.value);
  else if (first) {
    setText($('[data-pf-meta]'), 'Your portfolio could not be loaded. Reload the page to try again.');
    $('[data-pf-summary]')?.removeAttribute('aria-busy');
    toast('Your portfolio could not be loaded. Try again shortly.', { tone: 'error' });
  }
  if (pos.status === 'fulfilled') { state.positions = pos.value.positions || []; renderFilter(); renderHoldings(); }
  else if (first) $('[data-pf-holdings]')?.replaceChildren(errorRow(8, 'Your holdings could not be loaded. Reload the page to try again.'));
  if (links.status === 'fulfilled') renderCopies(links.value.links || []);
  else if (first) $('[data-pf-copies]')?.replaceChildren(errorRow(7, 'Your copies could not be loaded. Reload the page to try again.'));
  if (plans.status === 'fulfilled') renderPlans(plans.value);
  else if (first) $('[data-pf-plans]')?.replaceChildren(errorRow(5, 'Your plans could not be loaded. Reload the page to try again.'));
}, 300);

$('[data-pf-range]')?.addEventListener('click', (e) => {
  const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-value]'));
  if (!b) return;
  if (state.demo) return;
  state.range = b.dataset.value || '1M';
  $$('[data-value]', /** @type {HTMLElement} */ ($('[data-pf-range]'))).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  loadHistory();
});
$('[data-pf-filter]')?.addEventListener('click', (e) => {
  const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-value]'));
  if (!b) return;
  state.filter = b.dataset.value || 'all';
  renderFilter(); renderHoldings();
});

async function boot() {
  const session = await initBase();
  if (session.demo) {
    state.demo = true;
    setText($('[data-pf-meta]'), 'Sign in to see your portfolio.');
    const summary = $('[data-pf-summary]');
    summary?.removeAttribute('aria-busy');
    markDemo(summary, 'Demo preview: sign in to see your account.');
    return;
  }
  await Promise.all([refresh(), loadHistory()]);
  accountStream({ balance: () => refresh(), fill: () => refresh(), position: () => refresh() });
  setInterval(() => { if (!document.hidden) refresh(); }, 30000);   // prices move between fills
}

boot().catch((err) => console.error('[portfolio]', err)).finally(() => settle());
