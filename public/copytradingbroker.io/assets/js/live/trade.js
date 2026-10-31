// @ts-check
/**
 * Trading Hub page controller (app/trade.html).
 * Real market data, simulated execution, funds from the wallet. Live updates over SSE.
 */
import { api } from './api.js';
import { initBase } from './base.js';
import { settle } from './shell.js';
import { reducedMotion, toast } from '../lib/util.js';
import { $, $$, h, debounce, isOcc, occName, price, setText, signedPct, signedUsd, tone, usdFmt } from '../trade/dom.js';
import { PriceChart, ready as chartReady } from '../trade/chart.js';
import { PriceStream, accountStream } from '../trade/stream.js';
import { createTicket } from '../trade/ticket.js';
import { activityTable, historyTable, openOrdersTable, positionsTable } from '../trade/blotter.js';
import { symbolSearch, watchlist } from '../trade/watchlist.js';
import { optionsChain } from '../trade/chain.js';
import { basketsPanel } from '../trade/baskets.js';
import { companyPanel } from '../trade/company.js';
import { alertsPanel } from '../trade/alerts.js';
import { recurringPanel } from '../trade/recurring.js';

const params = new URLSearchParams(location.search);
const state = {
  symbol: (params.get('symbol') || 'AAPL').toUpperCase(),
  assetClass: 'stock',
  range: '1D',
  /** @type {any} */ account: null,
  /** @type {any[]} */ positions: [],
  /** @type {any[]} */ groups: [],
  /** @type {Map<string, any>} */ quotes: new Map(),
  /** @type {string[]} */ watchSymbols: [],
  ticketSymbol: '',
  lastPx: NaN,
};

/** @type {PriceChart|null} */ let chart = null;

const SESSION_LABEL = /** @type {Record<string,[string,string]>} */ ({
  open: ['Market open', 'tag--gain'], pre: ['Pre-market', 'tag--pending'], post: ['After hours', 'tag--pending'], closed: ['Market closed', ''],
});

/* ------------------------------------------------------------------ quote header */
/** @param {any} q */
function renderQuote(q) {
  const root = $('[data-quote]');
  if (!root) return;
  root.removeAttribute('aria-busy');
  const set = (/** @type {string} */ k, /** @type {any} */ v) => setText($(`[data-q="${k}"]`, root), v);
  set('symbol', state.symbol);
  if (q.name) set('name', q.name);
  const ex = $('[data-q="exchange"]', root);
  if (ex) ex.textContent = q.exchange ? `· ${q.exchange}` : '';
  const last = Number(q.last);
  const lastEl = $('[data-q="last"]', root);
  if (lastEl) {
    lastEl.textContent = price(last);
    if (Number.isFinite(state.lastPx) && last !== state.lastPx) {
      lastEl.classList.remove('tick--up', 'tick--down');
      lastEl.classList.add(last > state.lastPx ? 'tick--up' : 'tick--down');
      clearTimeout(/** @type {any} */ (lastEl).tm);
      /** @type {any} */ (lastEl).tm = setTimeout(() => lastEl.classList.remove('tick--up', 'tick--down'), 600);
    }
  }
  state.lastPx = last;
  const ch = $('[data-q="change"]', root);
  if (ch) {
    ch.textContent = q.change == null ? '—' : `${signedUsd(q.change)} (${signedPct(q.change_percent)}) today`;
    ch.className = `th-quote__change mono ${tone(q.change)}`;
  }
  set('bid', price(q.bid)); set('ask', price(q.ask)); set('open', price(q.open)); set('high', price(q.high));
  set('low', price(q.low)); set('prev_close', price(q.prev_close));
  // Crypto quotes come from the 24-hour statistics: label them as such, never as today's open or previous close.
  const crypto = q.asset_class === 'crypto';
  const dtFor = (key) => $(`[data-q="${key}"]`, root)?.previousElementSibling;
  const prevLabel = dtFor('prev_close'), openLabel = dtFor('open');
  if (prevLabel) prevLabel.textContent = crypto ? '24h open' : 'Prev close';
  if (openLabel) openLabel.textContent = crypto ? 'Open today' : 'Open';
  if (crypto) set('open', '—');
  const sess = $('[data-q="session"]', root);
  if (sess) {
    const [t, c] = q.asset_class === 'crypto' ? ['Trades 24/7', 'tag--gain'] : (SESSION_LABEL[q.session] || ['', '']);
    sess.textContent = t;
    sess.className = `tag tag--plain ${c}`;
  }
  const spread = $('[data-q="spread"]', root);
  if (spread) spread.hidden = q.spread_model !== 'synthetic';
  const feed = $('[data-q="feed"]', root);
  if (feed) {
    // Only meaningful while the instrument trades: a closed market's last price is expected to be old.
    const trading = q.asset_class === 'crypto' || ['open', 'pre', 'post'].includes(q.session);
    feed.hidden = !(trading && q.feed === 'delayed' && q.asset_class !== 'option');
  }
  set('asof', q.as_of ? `As of ${new Date(q.as_of).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' })} ET${q.stale ? ' · last trade' : ''}` : '');
  document.title = `${state.symbol} ${price(last)} — Trade — TED Brokers`;
}

/** @param {'connecting'|'live'|'reconnecting'|'offline'} s */
function streamState(s) {
  const el = $('[data-stream-status]');
  if (!el) return;
  const map = { connecting: ['Connecting', 'tag--pending'], live: ['Live', 'tag--gain'], reconnecting: ['Reconnecting', 'tag--pending'], offline: ['Offline', 'tag--loss'] };
  const [t, c] = map[s];
  el.textContent = t;
  el.className = `tag tag--plain ${c}`;
}

/* ------------------------------------------------------------------ data loading */
let candleSeq = 0;
async function loadCandles() {
  const note = $('[data-chart-note]');
  const mine = ++candleSeq;
  try {
    const data = await api(`/api/market/candles/${encodeURIComponent(state.symbol)}?range=${encodeURIComponent(state.range)}`);
    if (mine !== candleSeq) return;          // a newer symbol/range request won
    await chartReady();
    if (!chart) {
      chart = new PriceChart(/** @type {HTMLElement} */ ($('[data-price-chart]')));
    }
    chart.setData(data.candles || [], data.interval_seconds);
    setText(note, `${data.source}${state.range === '1D' && state.assetClass !== 'crypto' ? ' · includes pre- and after-hours' : ''} · times in ET`);
  } catch (err) {
    if (mine !== candleSeq) return;
    // Never leave the previous symbol's bars under the new quote: clear the chart and say why.
    if (chart) chart.setData([], 60);
    setText(note, /** @type {Error} */ (err).message || 'Chart data is not available right now.');
  }
}

let selSeq = 0;
/** Switch the chart/quote/chain to a symbol. Option symbols open their contract in the ticket
 *  and chart the underlying. Out-of-order responses are dropped; failures roll back. */
async function selectSymbol(/** @type {string} */ raw) {
  const occ = isOcc(raw) ? raw : '';
  const symbol = (occ ? occ.trim().split(/\s|\d/)[0] : raw).toUpperCase();
  const mine = ++selSeq;
  const previous = state.symbol;
  let q;
  try {
    q = await api(`/api/market/quote/${encodeURIComponent(symbol)}`);
  } catch (err) {
    if (mine !== selSeq) return;
    toast(`${symbol}: ${/** @type {Error} */ (err).message}`, { tone: 'error' });
    state.symbol = previous;                     // keep every panel on the last good symbol
    return;
  }
  if (mine !== selSeq) return;
  state.symbol = q.symbol;
  state.assetClass = q.asset_class;
  state.lastPx = NaN;
  state.quotes.set(q.symbol, q);
  const url = new URL(location.href);
  url.searchParams.set('symbol', occ || q.symbol);
  window.history.replaceState(null, '', url);
  renderQuote(q);
  if (occ) openContract(occ);
  else { state.ticketSymbol = q.symbol; ticket.setInstrument({ symbol: q.symbol, asset_class: q.asset_class, name: q.name }); }
  const optionsTab = document.getElementById('tab-options');
  const optionable = ['stock', 'etf'].includes(state.assetClass);
  if (optionsTab) {
    if (!optionable && optionsTab.getAttribute('aria-selected') === 'true') document.getElementById('tab-positions')?.click();
    optionsTab.hidden = !optionable;
  }
  chain.reset();
  if (optionable && document.getElementById('panel-options')?.hidden === false) chain.visible(true);
  company.reset();
  if (tabOpen('tab-company')) company.load(state.symbol);
  if (tabOpen('tab-alerts')) alertsUi.symbolChanged();
  if (tabOpen('tab-recurring')) recurringUi.symbolChanged();
  wl.markCurrent();
  loadCandles();
  updateStreams();
}

/** Show an option contract in the ticket (keeps the chart on its underlying). @param {string} occ */
function openContract(occ) {
  state.ticketSymbol = occ;
  ticket.setInstrument({ symbol: occ, asset_class: 'option', name: occName(occ) });
  updateStreams();
}

/** Show a load error with a retry button inside a table. @param {string} sel @param {number} cols @param {string} msg */
function tableError(sel, cols, msg) {
  $(sel)?.replaceChildren(h('tr', { class: 'th-empty' }, h('td', { colspan: cols }, `${msg} `,
    h('button', { class: 'text-btn', type: 'button', onclick: () => refreshTrading() }, 'Retry'))));
}

const refreshTrading = debounce(async () => {
  const [pos, strat, open, hist] = await Promise.allSettled([
    api('/api/trading/positions'), api('/api/trading/strategies'),
    api('/api/trading/orders?status=open&limit=100'), api('/api/trading/orders?status=closed&limit=50'),
  ]);
  if (pos.status === 'fulfilled') {
    state.positions = pos.value.positions || [];
    state.groups = strat.status === 'fulfilled' ? strat.value.strategies || [] : state.groups;
    positions.render(state.positions, state.groups);
    setText($('[data-tab-count="positions"]'), String(state.positions.length));
  } else tableError('[data-positions]', 8, 'Positions could not be loaded.');
  if (open.status === 'fulfilled') {
    openOrders.render(open.value.orders || []);
    setText($('[data-tab-count="orders"]'), String((open.value.orders || []).length));
  } else tableError('[data-open-orders]', 6, 'Orders could not be loaded.');
  if (hist.status === 'fulfilled') historyTbl.render(hist.value.orders || []);
  else tableError('[data-history]', 6, 'Order history could not be loaded.');
  ticket.refresh();
  updateStreams();
}, 250);

const refreshAccount = debounce(async () => {
  try {
    const a = await api('/api/trading/account');
    state.account = a;
    const m = a.margin || {};
    const set = (/** @type {string} */ k, /** @type {string} */ v) => setText($(`[data-acct="${k}"]`), v);
    set('total_value', usdFmt(a.total_value));
    set('cash', usdFmt(a.cash));
    set('buying_power', usdFmt(m.buying_power?.stock ?? a.buying_power));
    set('option_bp', usdFmt(m.buying_power?.option));
    set('crypto_bp', usdFmt(m.buying_power?.crypto));
    set('margin_debit', usdFmt(m.margin_debit));
    set('excess_liquidity', usdFmt(m.excess_liquidity));
    set('day_trades_left', a.day_trades_left == null ? 'No limit' : String(a.day_trades_left));
    const day = $('[data-acct="day_pnl"]');
    if (day) { day.textContent = `${signedUsd(a.day_pnl)} (${signedPct(a.day_pnl_percent)})`; day.className = `mono ${tone(a.day_pnl)}`; }
    setText($('[data-acct-type]'), `${a.account_type === 'margin' ? 'Margin' : 'Cash'} · Options L${a.options_level}`);
    $$('[data-margin-only]').forEach((x) => { x.hidden = a.account_type !== 'margin'; });
    renderCallBand(a.margin_calls || []);
    ticket.refresh();
  } catch (err) { console.error('[trade] account', err); }
}, 250);

let bandKey = '';
/** Margin-call band. Re-rendered (and so re-announced) only when the call itself changes. @param {any[]} calls */
function renderCallBand(calls) {
  const band = $('[data-margin-call]');
  if (!band) return;
  const key = calls.length ? `${calls[0].id}|${calls[0].amount}|${calls[0].status}` : '';
  if (key === bandKey) return;
  bandKey = key;
  band.hidden = !calls.length;
  if (!calls.length) return;
  const c = calls[0];
  const due = new Date(c.due_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  band.replaceChildren(h('strong', null, `${c.type === 'fed' ? 'Fed (Reg T) call' : 'Margin call'}: ${usdFmt(c.amount)} due ${due} ET. `),
    'Deposit funds or reduce positions. Positions may be liquidated if the call is not met. ',
    h('a', { href: 'wallet.html#deposit' }, 'Deposit funds'));
}

async function loadActivity() {
  try { activity.render((await api('/api/trading/activity?limit=100')).items || []); } catch (err) { console.error(err); }
}

/* ------------------------------------------------------------------ streams */
const prices = new PriceStream((q) => {
  // stream quotes omit name/exchange/session: keep them from the REST quote
  const merged = { ...state.quotes.get(q.symbol), ...q };
  state.quotes.set(q.symbol, merged);
  if (q.symbol === state.symbol) {
    renderQuote(merged);
    if (Number.isFinite(Number(q.last))) chart?.tick(Number(q.last), Number(q.ts));
  }
  wl.tick(q);
  positions.tick(q);
}, () => {}, streamState);

function updateStreams() {
  prices.set([state.symbol, state.ticketSymbol, ...state.watchSymbols, ...state.positions.map((p) => p.symbol)].slice(0, 60));
}

/* ------------------------------------------------------------------ wiring */
/** Trading Hub orders trade the self-directed bucket. @param {string} s */
const selfQty = (s) => Number(state.positions.find((p) => p.symbol === s && p.bucket === 'self')?.qty || 0);
const ticketForm = /** @type {HTMLFormElement} */ ($('[data-ticket]'));
const ticket = createTicket(ticketForm, {
  account: () => state.account,
  positionQty: selfQty,
  quote: (s) => state.quotes.get(s),
  onPlaced: () => { refreshTrading(); refreshAccount(); },
});

const positions = positionsTable(/** @type {HTMLElement} */ ($('[data-positions]')), {
  onSelect: (s, ac) => (ac === 'option' ? openContract(s) : selectSymbol(s)),
  onClose: async (p) => {
    const short = Number(p.qty) < 0;
    if (p.asset_class === 'option') openContract(p.symbol);
    else if (p.symbol !== state.symbol) await selectSymbol(p.symbol);
    const side = p.asset_class === 'option' ? (short ? 'buy_to_close' : 'sell_to_close') : (short ? 'buy_to_cover' : 'sell');
    ticket.prefill({ side, type: 'market', qty: Math.abs(Number(p.qty)) });
  },
});
const openOrders = openOrdersTable(/** @type {HTMLElement} */ ($('[data-open-orders]')), () => { refreshTrading(); refreshAccount(); });
const historyTbl = historyTable(/** @type {HTMLElement} */ ($('[data-history]')));
const activity = activityTable(/** @type {HTMLElement} */ ($('[data-activity]')));

const wl = watchlist({
  select: /** @type {HTMLSelectElement} */ ($('[data-watchlist-select]')),
  list: /** @type {HTMLElement} */ ($('[data-watchlist]')),
  toggle: /** @type {HTMLButtonElement} */ ($('[data-watch-toggle]')),
}, { onSelect: (s) => selectSymbol(s), onSymbols: (s) => { state.watchSymbols = s; updateStreams(); }, current: () => state.symbol });

const chain = optionsChain(/** @type {HTMLElement} */ ($('[data-chain]')), {
  underlying: () => state.symbol,
  positionQty: selfQty,
  onPick: (occ, o) => { openContract(occ); ticket.prefill(o); },
  onPlaced: () => { refreshTrading(); refreshAccount(); },
});
const company = companyPanel(/** @type {HTMLElement} */ ($('[data-company]')));
const alertsUi = alertsPanel(/** @type {HTMLElement} */ ($('[data-alerts]')), {
  symbol: () => state.symbol,
  last: () => Number(state.quotes.get(state.symbol)?.last ?? NaN),
});
const recurringUi = recurringPanel(/** @type {HTMLElement} */ ($('[data-recurring]')), {
  symbol: () => state.symbol, assetClass: () => state.assetClass,
});
/** @param {string} id */
const tabOpen = (id) => document.getElementById(id)?.getAttribute('aria-selected') === 'true';
const baskets = basketsPanel(/** @type {HTMLElement} */ ($('[data-baskets]')), () => { refreshTrading(); refreshAccount(); });

symbolSearch(/** @type {HTMLElement} */ ($('[data-symbol-search]')), (r) => selectSymbol(r.symbol));

$('[data-range]')?.addEventListener('click', (e) => {
  const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-value]'));
  if (!b) return;
  state.range = b.dataset.value || '1D';
  $$('[data-value]', /** @type {HTMLElement} */ ($('[data-range]'))).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  loadCandles();
});
$('[data-chart-style]')?.addEventListener('click', (e) => {
  const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-value]'));
  if (!b || !chart) return;
  $$('[data-value]', /** @type {HTMLElement} */ ($('[data-chart-style]'))).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  chart.setStyle(/** @type {'area'|'candle'} */ (b.dataset.value));
});

let demo = false;
// On phones the panel sits below the chart: bring a tapped tab's panel into view (not for programmatic opens).
document.querySelector('[data-th-tabs]')?.addEventListener('click', (e) => {
  const tab = /** @type {HTMLElement|null} */ (/** @type {Element} */ (e.target).closest('[role="tab"]'));
  if (!tab || !e.isTrusted || !matchMedia('(width < 48rem)').matches) return;
  const panel = document.getElementById(tab.getAttribute('aria-controls') || '');
  if (panel && !panel.hidden) requestAnimationFrame(() => panel.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }));
});

document.addEventListener('tabs:change', (e) => {
  const id = /** @type {CustomEvent} */ (e).detail?.tab?.id;
  if (demo) return;
  chain.visible(id === 'tab-options');
  if (id === 'tab-baskets') baskets.load();
  if (id === 'tab-company') company.load(state.symbol);
  if (id === 'tab-alerts') alertsUi.load();
  if (id === 'tab-recurring') recurringUi.load();
  if (id === 'tab-activity') loadActivity();
  const url = new URL(location.href);
  url.searchParams.set('tab', String(id).replace('tab-', ''));
  window.history.replaceState(null, '', url);
});

// Shortcuts use a modifier (WCAG 2.1.4): Alt+B buy, Alt+S sell (Alt+F search lives in watchlist.js).
document.addEventListener('keydown', (e) => {
  if (!e.altKey || e.metaKey || e.ctrlKey || document.querySelector('dialog[open]')) return;
  if (e.code === 'KeyB') { e.preventDefault(); ticket.focusAction('buy'); }
  if (e.code === 'KeyS') { e.preventDefault(); ticket.focusAction('sell'); }
});
$$('[data-mobile-action]').forEach((a) => a.addEventListener('click', () => ticket.focusAction(/** @type {any} */ (a.dataset.mobileAction))));

/* ------------------------------------------------------------------ boot */
async function boot() {
  const session = await initBase();
  if (session.demo) {
    demo = true;
    toast('Sign in to use the Trading Hub.');
    return;
  }
  accountStream({
    balance: () => refreshAccount(),
    order: () => refreshTrading(),
    fill: (f) => { refreshTrading(); refreshAccount(); if (f.source !== 'manual') toast(`${f.kind === 'trade' ? 'Filled' : f.kind}: ${f.qty} ${isOcc(f.symbol) ? occName(f.symbol) : f.symbol} @ ${price(f.price)}`); },
    position: () => refreshTrading(),
    margin_call: () => refreshAccount(),
    notice: (n) => toast(n.title ? `${n.title}: ${n.message}` : n.message),
    alert: (a) => { toast(`Alert: ${a.title}`); if (tabOpen('tab-alerts')) alertsUi.load(); },
  });
  await Promise.all([wl.load(), refreshAccount(), refreshTrading()]);
  await selectSymbol(state.symbol);
  const tab = params.get('tab');
  if (tab) document.getElementById(`tab-${tab}`)?.click();
  // 9 tabs scroll horizontally on small screens: keep the selected one in view
  document.querySelector('[role="tab"][aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

boot().catch((err) => console.error('[trade]', err)).finally(() => settle());
