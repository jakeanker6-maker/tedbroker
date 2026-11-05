// @ts-check
/**
 * Copy traders: the live trader directory plus real copy relationships (/api/copy/links).
 * Copying a trader moves the chosen allocation from free cash into a dedicated copy
 * bucket; the trader's fills are mirrored in proportion. Each trader row shows either
 * the start-copy form (amount + copy stop-loss -> confirm dialog -> POST /api/copy/links)
 * or the manage panel for an existing copy (live value and P&L, pause/resume, add or
 * withdraw funds, stop). Refreshes from the account stream and every 15 s.
 */
import { api, int, money } from './api.js';
import { initBase } from './base.js';
import { toast } from '../lib/util.js';
import { busy, markDemo, settle } from './shell.js';
import { $, $$, debounce, h, setText, signedPct, signedUsd, tone, usdFmt } from '../trade/dom.js';
import { accountStream } from '../trade/stream.js';

const LEVEL = (/** @type {number} */ r) => (r <= 3 ? 'Low' : r <= 6 ? 'Medium' : 'High');
const SPEC = /** @type {Record<string,string>} */ ({ forex: 'Forex', crypto: 'Crypto', stocks: 'Stocks', options: 'Options', commodities: 'Commodities' });
const STATUS = /** @type {Record<string,[string,string]>} */ ({ active: ['Copying', 'tag--gain'], paused: ['Paused', 'tag--pending'], stopping: ['Closing positions', 'tag--pending'] });
const FLOOR = 10;   // server-side minimum allocation for any trader

const firstName = (/** @type {string} */ name) => String(name || 'trader').trim().split(/\s+/)[0];
const safeId = (/** @type {string} */ id) => `trader-${String(id).replace(/[^a-zA-Z0-9_-]/g, '')}`;
const pct = (/** @type {number} */ v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;

const state = {
  available: 0,
  /** @type {Map<string, any>} trader_id -> live link */ links: new Map(),
  /** @type {Map<string, (link: any) => void>} trader_id -> form renderer */ forms: new Map(),
  ready: false,   // links + balance loaded at least once; forms stay disabled until then
  seq: 0,
  /** @type {string|null} trader whose manage panel should take focus after the next render */ focus: null,
};

async function loadLinks() {
  const res = await api('/api/copy/links');
  state.links = new Map((res.links || []).map((/** @type {any} */ l) => [String(l.trader_id), l]));
}

async function loadBalance() {
  const b = await api('/api/wallet/balance');
  state.available = Number(b.withdrawable ?? b.balance ?? 0);
}

function renderHead(/** @type {number} */ traderCount) {
  const meta = $('.page-head__meta');
  if (meta) {
    meta.replaceChildren(`${int(traderCount)} trader${traderCount === 1 ? '' : 's'} available · Free cash `,
      h('span', { class: 'page-head__strong' }, money(state.available)));
  }
  const n = [...state.links.values()].filter((l) => l.status !== 'stopped').length;
  $$('.rail a[aria-current="page"] .rail__aside').forEach((a) => { a.textContent = `${int(n)} live`; a.hidden = n === 0; });
}

const refresh = debounce(async () => {
  const seq = ++state.seq;
  try {
    const [links, bal] = await Promise.all([api('/api/copy/links'), api('/api/wallet/balance')]);
    if (seq !== state.seq) return;   // a newer refresh is in flight
    state.links = new Map((links.links || []).map((/** @type {any} */ l) => [String(l.trader_id), l]));
    state.available = Number(bal.withdrawable ?? bal.balance ?? 0);
    state.ready = true;
    setLoadError(false);
    for (const [tid, render] of state.forms) render(state.links.get(tid) || null);
    renderHead(state.forms.size);
  } catch (err) { console.error('[copy-traders] refresh', err); }
}, 250);

/** Banner shown when copies or free cash could not be loaded (forms are disabled meanwhile). */
function setLoadError(/** @type {boolean} */ on) {
  let el = $('[data-copy-load-error]');
  if (!on) { if (el) el.hidden = true; return; }
  if (!el) {
    el = h('div', { class: 'empty', role: 'alert', 'data-copy-load-error': '' },
      h('p', { class: 'empty__title' }, 'Your copies couldn’t be loaded'),
      h('p', null, 'Copy controls are turned off until your current copies and free cash load.'),
      h('button', { class: 'btn btn--sm btn--outline', type: 'button', onclick: () => refresh() }, 'Retry'));
    $('[data-component="traders-filter"]')?.before(el);
  }
  el.hidden = false;
}

/** Signature of the directory last rendered, so an unchanged list is not rebuilt. */
let directorySig = '';
let directoryBusy = false;

/** Detail-row ids of the rows the user has expanded, so a re-render keeps them open. */
function expandedDetailIds(/** @type {HTMLElement} */ table) {
  return new Set($$('tbody.trader [data-expand][aria-expanded="true"]', table)
    .map((b) => b.getAttribute('aria-controls') || '')
    .filter(Boolean));
}

/**
 * Build the trader rows from a directory response. Called on load and again whenever the
 * list changes (an admin created, edited or removed a trader while this page was open).
 * @param {HTMLElement} section
 * @param {any[]} traders
 * @param {boolean} failed the directory request failed
 */
async function renderDirectory(section, traders, failed) {
  const table = /** @type {HTMLTableElement|null} */ ($('table', section));
  // Row template lives in an inert <template> so no seed figures are ever rendered or auto-initialised.
  const template = /** @type {HTMLTableSectionElement|null} */ (/** @type {HTMLTemplateElement|null} */ (document.getElementById('trader-row-template'))?.content.querySelector('tbody.trader') || null);
  const empty = /** @type {HTMLElement|null} */ ($('[data-filter-empty]', section));
  const count = $('[data-filter-count]', section);
  if (!table || !template) return;

  const open = table.querySelector('tbody.trader') ? expandedDetailIds(table) : null;
  state.forms.clear();
  $$('tbody.trader', table).forEach((r) => r.remove());   // drop the approved demo rows and the previous render
  renderHead(traders.length);

  if (!traders.length) {
    if (count) count.textContent = failed ? 'Traders could not be loaded' : 'No traders available';
    if (empty) {
      empty.replaceChildren(h('tr', null, h('td', { colspan: 9 }, h('div', { class: 'empty' },
        h('p', { class: 'empty__title' }, failed ? 'The trader directory couldn’t be loaded' : 'No traders are available yet'),
        h('p', null, failed ? 'Reload the page to try again.' : 'New trader profiles will appear here when they are published.')))));
      empty.hidden = false;
    }
  } else if (empty) {
    empty.hidden = true;
  }

  const frags = traders.map((t, i) => renderTrader(t, i, template, open));
  table.append(...frags, ...(empty ? [empty] : []));

  if (traders.length) {
    const filter = await import('../components/traders-filter.js');
    filter.init(section);   // re-applies the active search and filters to the new rows
  }
}

/**
 * Poll the directory and re-render when an admin change is visible. Skipped while the user
 * is typing in a trader row or a dialog is open, so nothing they are editing is replaced.
 * @param {HTMLElement} section
 */
async function refreshDirectory(section) {
  if (directoryBusy || document.querySelector('dialog[open]')) return;
  const active = /** @type {HTMLElement|null} */ (document.activeElement);
  const typingInRow = Boolean(active && section.contains(active) && !active.closest('.filterbar')
    && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName));
  if (typingInRow) return;
  directoryBusy = true;
  try {
    const traders = await api('/api/traders/');
    if (!Array.isArray(traders)) return;
    const sig = JSON.stringify(traders);
    if (sig === directorySig) return;
    directorySig = sig;
    await renderDirectory(section, traders, false);
  } catch (err) {
    console.error('[copy-traders] directory refresh', err);
  } finally {
    directoryBusy = false;
  }
}

async function boot() {
  const session = await initBase();
  const section = /** @type {HTMLElement|null} */ ($('[data-component="traders-filter"]'));
  if (!section) return;

  if (session.demo) {
    markDemo(section, 'Demo preview: sample traders, not the live directory.');
    const filter = await import('../components/traders-filter.js');
    filter.init(section);
    return;
  }

  busy(section);
  const table = /** @type {HTMLTableElement|null} */ ($('table', section));
  if (!table || !document.getElementById('trader-row-template')) return;

  const [tradersRes, linksRes, balRes] = await Promise.allSettled([api('/api/traders/'), loadLinks(), loadBalance()]);
  const traders = tradersRes.status === 'fulfilled' && Array.isArray(tradersRes.value) ? tradersRes.value : [];
  state.ready = linksRes.status === 'fulfilled' && balRes.status === 'fulfilled';
  if (!state.ready) setLoadError(true);
  directorySig = tradersRes.status === 'fulfilled' ? JSON.stringify(traders) : '';

  const th = table.querySelector('thead th:nth-child(2)');
  if (th) th.textContent = 'YTD return';
  const th3 = table.querySelector('thead th:nth-child(3) .sr-only');
  if (th3) th3.textContent = 'Stats source';
  const caption = table.querySelector('caption');
  if (caption) caption.textContent = 'Traders available to copy. Live figures come from each trader’s account since it started trading on this platform.';

  await renderDirectory(section, traders, tradersRes.status === 'rejected');
  wireConfirm();
  accountStream({ balance: () => refresh(), fill: () => refresh(), position: () => refresh() });
  setInterval(() => { if (!document.hidden) refresh(); }, 15000);
  setInterval(() => { if (!document.hidden) refreshDirectory(section); }, 30000);
}

function tradePrice(tr) {
  const v = Number(tr.entry_price ?? tr.current_price ?? tr.price);
  if (!Number.isFinite(v) || v <= 0) return '—';
  return v < 10 ? `$${v.toFixed(4)}` : money(v, true);
}

/** @param {any} t @param {number} index @param {HTMLTableSectionElement} template */
function renderTrader(t, index, template, openIds) {
  const id = String(t.id);
  const name = String(t.full_name || 'Trader');
  // Performance is shown for a live track record (stats_source "live") or for figures the platform
  // team entered ("admin"); missing values stay null and render as "—".
  const source = t.stats_source ?? (t.stats_live ? 'live' : null);
  const live = source === 'live';
  const shown = source === 'live' || source === 'admin';
  const num = (/** @type {unknown} */ v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const risk = num(t.risk_score);
  const ytd = shown ? num(t.ytd_return) : null;
  const win = shown ? num(t.win_rate) : null;
  const dd = shown ? num(t.max_drawdown) : null;
  const aum = shown ? num(t.assets_under_management) : null;
  const min = Math.max(FLOOR, Number(t.minimum_copy_amount || 0));
  const copiers = Number(t.copiers || 0);
  const dash = '—';
  const pctOrDash = (/** @type {number|null} */ v) => (v == null ? dash : `−${Math.abs(v).toFixed(1)}%`);
  const spec = String(t.specialization || '').toLowerCase();
  const specLabel = SPEC[spec] || String(t.specialization || 'Trader');
  const detailId = `${safeId(id)}-detail`;

  const body = /** @type {HTMLTableSectionElement} */ (template.cloneNode(true));
  body.removeAttribute('data-ready');
  Object.assign(body.dataset, { name, spec, risk: risk == null ? '' : String(risk), win: win == null ? '' : String(win),
    return: ytd == null ? '' : String(ytd), copiers: String(copiers), dd: dd == null ? '' : String(dd) });

  const row = /** @type {HTMLTableRowElement} */ (body.querySelector(':scope > tr'));
  const detail = /** @type {HTMLTableRowElement} */ (body.querySelector('tr.ledger__detail'));
  // First render opens the first trader; later renders keep whatever the user had expanded.
  const open = openIds ? openIds.has(detailId) : index === 0;
  row.toggleAttribute('data-expanded', open);
  detail.hidden = !open;
  detail.id = detailId;

  const cells = row.children;
  const person = cells[0].querySelector('.person');
  const avatar = person?.querySelector('.avatar');
  if (avatar) {
    avatar.className = `avatar ${['avatar--amber', 'avatar--navy', 'avatar--accent'][index % 3]}`;
    avatar.textContent = name.split(/\s+/).map((p) => p[0] || '').join('').slice(0, 2).toUpperCase();
  }
  setText(/** @type {HTMLElement|null} */ (person?.querySelector('.person__name') || null), name);
  setText(/** @type {HTMLElement|null} */ (person?.querySelector('.person__meta') || null),
    `${specLabel}${t.strategy_label ? ` · ${t.strategy_label}` : t.description ? ` · ${String(t.description).split(/[.!?]/)[0].slice(0, 64)}` : ''}`);

  const ret = cells[1].querySelector('.delta');
  if (ret) {
    if (ytd == null) { ret.textContent = dash; ret.removeAttribute('data-trend'); }
    else { ret.textContent = pct(ytd); ret.setAttribute('data-trend', ytd >= 0 ? 'up' : 'down'); }
  }
  cells[2].replaceChildren(live ? h('span', { class: 'tag tag--plain tag--gain' }, 'Live')
    : source === 'admin' ? h('span', { class: 'tag tag--plain' }, 'Platform figures')
      : h('span', { class: 'muted' }, 'No record yet'));
  cells[3].textContent = win == null ? dash : `${win.toFixed(1)}%`;
  cells[4].textContent = pctOrDash(dd);
  const riskbar = cells[5].querySelector('.riskbar');
  if (riskbar instanceof HTMLElement) {
    if (risk == null) {
      riskbar.removeAttribute('data-level');
      riskbar.style.removeProperty('--risk');
      riskbar.replaceChildren(dash);
    } else {
      riskbar.dataset.level = risk <= 3 ? 'low' : risk <= 6 ? 'med' : 'high';
      riskbar.style.setProperty('--risk', String(risk));
      riskbar.replaceChildren(h('span', { class: 'riskbar__track' }), `${risk}/10`, h('span', { class: 'sr-only' }, ` · ${LEVEL(risk)}`));
    }
  }
  cells[6].textContent = int(copiers);
  cells[7].textContent = money(min, true);

  const expand = /** @type {HTMLButtonElement|null} */ (cells[8].querySelector('[data-expand]'));
  if (expand) {
    expand.setAttribute('aria-controls', detailId);
    expand.setAttribute('aria-expanded', String(open));
    expand.dataset.labelOpen = 'Hide';
    expand.dataset.labelClosed = 'Details';
    setText(/** @type {HTMLElement|null} */ (expand.querySelector('[data-label]')), open ? 'Hide' : 'Details');
    setText(/** @type {HTMLElement|null} */ (expand.querySelector('.sr-only')), ` for ${name}`);
  }

  /* Detail column 1: return figure; no synthetic 12-month chart. */
  setText(/** @type {HTMLElement|null} */ (detail.querySelector('.trader-detail__head h3')), 'Year-to-date return');
  detail.querySelector('.trader-detail__big')?.replaceChildren(ytd == null
    ? h('span', { class: 'muted' }, dash)
    : h('span', { class: 'delta', 'data-trend': ytd >= 0 ? 'up' : 'down' }, pct(ytd)));
  const since = t.stats_since && Number.isFinite(Date.parse(t.stats_since)) ? new Date(t.stats_since).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  setText(/** @type {HTMLElement|null} */ (detail.querySelector('.trader-detail__sub')),
    live ? `Live from this trader’s account since ${since} · ${int(t.closed_trades || 0)} closed trades.`
      : source === 'admin' ? 'Figures published by the TED Brokers team. They are not measured from a trading account.'
        : 'No live track record yet. Figures appear once this trader’s account has trading history.');
  detail.querySelector('.trader-detail__chart')?.replaceWith(h('p', { class: 'field__help' }, 'Past performance is not indicative of future results.'));

  /* Strategy */
  setText(/** @type {HTMLElement|null} */ (detail.querySelector('.trader-detail__strategy')), t.description || 'No strategy description provided.');
  detail.querySelector('.trader-detail__stats')?.replaceChildren(...[
    ['AUM', aum == null ? dash : money(aum, true)],
    ['Min. to copy', money(min, true)],
    ['Max drawdown', pctOrDash(dd)],
    ['Win rate', win == null ? dash : `${win.toFixed(1)}%`],
  ].map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v))));

  /* Recent trades */
  const trades = Array.isArray(t.recent_trades) ? t.recent_trades.slice(0, 3) : [];
  detail.querySelector('.trader-detail__trades')?.replaceChildren(...(trades.length
    ? trades.map((/** @type {any} */ tr) => h('li', null,
      h('span', { class: 'mono' }, tr.symbol || tr.ticker || '—'),
      h('span', { class: 'trader-detail__side' }, ['short', 'sell'].includes(String(tr.side || '').toLowerCase()) ? 'Sell' : 'Buy'),
      h('span', { class: 'mono' }, tradePrice(tr))))
    : [h('li', { class: 'muted' }, 'No recent trades shared.')]));

  wireCopyForm(body, { id, name, first: firstName(name), risk, min });
  return body;
}

/**
 * @param {HTMLTableSectionElement} body
 * @param {{ id: string, name: string, first: string, risk: number|null, min: number }} trader
 */
function wireCopyForm(body, trader) {
  const form = /** @type {HTMLFormElement|null} */ (body.querySelector('.copy-form'));
  if (!form) return;
  const { id, name, first, risk, min } = trader;
  const sid = safeId(id);
  form.removeAttribute('data-component');
  form.removeAttribute('data-dialog');
  form.dataset.live = 'true';
  form.dataset.traderId = id;

  /* Start view: the existing amount + stop-loss fields, re-keyed per trader. */
  const fields = $$(':scope > .field', form);
  const amount = /** @type {HTMLInputElement} */ (form.querySelector('input[name="amount"]'));
  const sl = /** @type {HTMLInputElement} */ (form.querySelector('input[name="stoploss"]'));
  const amtHelp = /** @type {HTMLElement} */ (amount.closest('.field')?.querySelector('p.field__help'));
  const amtErr = /** @type {HTMLElement} */ (amount.closest('.field')?.querySelector('.field__error'));
  const availOut = /** @type {HTMLElement} */ (amount.closest('.field')?.querySelector('.copy-form__row .field__help'));
  const slOut = /** @type {HTMLElement} */ (form.querySelector('[data-sl-out]'));
  const slHelp = /** @type {HTMLElement} */ (sl.closest('.field')?.querySelector('p.field__help'));
  amount.id = `${sid}-amt`; amtHelp.id = `${sid}-amt-help`; amtErr.id = `${sid}-amt-err`;
  amount.closest('.field')?.querySelector('label')?.setAttribute('for', amount.id);
  amount.setAttribute('aria-describedby', `${amtHelp.id} ${amtErr.id}`);
  amount.min = String(min);
  amount.value = String(min);
  amtHelp.textContent = `Minimum to copy ${first}: ${money(min, true)}. This moves from your free cash into a copy allocation.`;
  sl.id = `${sid}-sl`; slHelp.id = `${sid}-sl-help`;
  sl.closest('.field')?.querySelector('label')?.setAttribute('for', sl.id);
  sl.setAttribute('aria-describedby', slHelp.id);
  slHelp.textContent = 'If the copy falls this far below what you put in, its positions are sold and the cash returns to you.';
  const slText = () => `Stop copying at −${sl.value}%`;
  sl.addEventListener('input', () => { slOut.textContent = slText(); sl.setAttribute('aria-valuetext', slText()); });
  const errText = /** @type {HTMLElement|null} */ (amtErr.querySelector('[data-error-msg]'));
  amount.addEventListener('input', () => amount.removeAttribute('aria-invalid'));
  const errLink = /** @type {HTMLElement|null} */ (amtErr.querySelector('.field__error-link'));

  const status = /** @type {HTMLElement} */ (form.querySelector('[data-copy-status]'));
  status.tabIndex = -1;
  const submit = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
  const label = /** @type {HTMLElement} */ (form.querySelector('[data-copy-label]'));
  const fundsNote = h('p', { class: 'field__help', id: `${sid}-cash-note`, hidden: true });
  submit.before(fundsNote);

  /* Manage view, built once and filled on each render. */
  const out = /** @type {Record<string, HTMLElement>} */ ({});
  const stat = (/** @type {string} */ k, /** @type {string} */ t) => h('div', null, h('dt', null, t), out[k] = h('dd', { class: 'mono' }, '—'));
  const fundsInput = /** @type {HTMLInputElement} */ (h('input', { class: 'field__input amount-input', id: `${sid}-funds`, type: 'number', inputmode: 'decimal', min: '1', step: 'any', placeholder: '0.00', 'aria-describedby': `${sid}-funds-help ${sid}-funds-err` }));
  const fundsErr = h('span', { 'data-error-msg': '' });
  fundsInput.addEventListener('input', () => fundsInput.removeAttribute('aria-invalid'));
  const btn = (/** @type {string} */ cls, /** @type {string} */ text, /** @type {() => void} */ fn) => h('button', { class: cls, type: 'button', onclick: fn }, text, h('span', { class: 'sr-only' }, ` · ${name}`));
  const toggleBtn = btn('btn btn--sm btn--outline', 'Pause', () => toggle());
  const stopBtn = btn('btn btn--sm btn--ghost', 'Stop copying', () => stopCopy());
  let inFlight = false;
  const manage = h('div', { class: 'copy-manage', hidden: true },
    h('dl', { class: 'copy-manage__stats' }, stat('allocated', 'Put in'), stat('equity', 'Value now'), stat('pnl', 'P&L'), stat('cash', 'Uninvested'), stat('positions', 'Positions'), stat('sl', 'Copy stop-loss')),
    out.note = h('p', { class: 'field__help', hidden: true }),
    h('div', { class: 'field' },
      h('label', { class: 'field__label', for: fundsInput.id }, 'Change allocation'),
      h('div', { class: 'field__control' }, h('span', { class: 'field__affix' }, '$'), fundsInput),
      out.fundsHelp = h('p', { class: 'field__help', id: `${sid}-funds-help` }, 'Add from free cash, or withdraw uninvested cash back to it.'),
      h('p', { class: 'field__error', id: `${sid}-funds-err` }, fundsErr)),
    h('div', { class: 'copy-manage__actions' },
      btn('btn btn--sm', 'Add funds', () => funds('add_funds')),
      btn('btn btn--sm btn--outline', 'Withdraw', () => funds('withdraw_funds')),
      toggleBtn, stopBtn),
    h('p', null, h('a', { class: 'link-arrow', href: 'portfolio.html' }, 'See positions in your portfolio')));
  form.append(manage);

  /** @type {any} */ let link = null;

  /** @param {any} l */
  function render(l) {
    link = l;
    const copying = !!l;
    fields.forEach((f) => { f.hidden = copying; });
    submit.hidden = copying;
    manage.hidden = !copying;
    form.setAttribute('aria-label', copying ? `Manage your copy of ${name}` : `Copy ${name}`);
    status.hidden = !copying;
    if (!copying) {
      availOut.textContent = `Free cash ${money(state.available)}`;
      const short = state.available < min;
      fundsNote.hidden = !short;
      fundsNote.replaceChildren(...(short ? [`You need ${money(min, true)} of free cash to copy ${first}. `, h('a', { href: 'wallet.html#deposit' }, 'Add funds')] : []));
      submit.disabled = short || !state.ready;
      if (short) submit.setAttribute('aria-describedby', fundsNote.id); else submit.removeAttribute('aria-describedby');
      label.textContent = `Copy ${first}`;
      if (state.focus === id) { state.focus = null; amount.focus(); }
      return;
    }
    fundsNote.hidden = true;
    const [txt, cls] = STATUS[l.status] || [l.status, ''];
    status.replaceChildren(h('span', { class: `tag tag--plain ${cls}` }, l.status === 'active' ? `Copying ${first}` : txt));
    out.allocated.textContent = usdFmt(l.allocated);
    out.equity.textContent = usdFmt(l.equity);
    out.pnl.textContent = `${signedUsd(l.pnl)} (${signedPct(l.pnl_percent)})`;
    out.pnl.className = `mono ${tone(l.pnl)}`;
    out.cash.textContent = usdFmt(l.cash);
    out.positions.textContent = String(l.positions);
    out.sl.textContent = l.stop_loss_pct ? `−${Number(l.stop_loss_pct)}%` : 'Off';
    const notes = [];
    if (l.status === 'paused') notes.push('Paused: new trades from this trader are not copied. Open positions stay open.');
    if (l.status === 'stopping') notes.push('Selling this copy’s positions. The cash returns to your account when they fill (stock orders fill when the market opens).');
    if (l.last_skip) notes.push(`Last skipped trade: ${l.last_skip.symbol} (${l.last_skip.reason}).`);
    if (l.note) notes.push(l.note);
    out.note.hidden = !notes.length;
    out.note.textContent = notes.join(' ');
    out.fundsHelp.textContent = `Free cash ${money(state.available)} · withdrawable from this copy ${usdFmt(l.cash)}.`;
    const live = l.status === 'active' || l.status === 'paused';
    if (toggleBtn.firstChild) toggleBtn.firstChild.textContent = l.status === 'paused' ? 'Resume' : 'Pause';
    for (const b of $$('button', manage)) /** @type {HTMLButtonElement} */ (b).disabled = !live || inFlight;
    fundsInput.disabled = !live || inFlight;
    if (state.focus === id) {
      state.focus = null;
      (live ? toggleBtn : status).focus();
    }
  }
  state.forms.set(id, render);
  render(state.links.get(id) || null);

  /** @param {Record<string, unknown>} body @param {string} done */
  async function patch(body, done) {
    if (!link || inFlight) return;
    inFlight = true;
    const controls = [...$$('button', manage), fundsInput];
    controls.forEach((c) => { /** @type {HTMLButtonElement|HTMLInputElement} */ (c).disabled = true; });
    manage.setAttribute('aria-busy', 'true');
    try {
      await api(`/api/copy/links/${encodeURIComponent(link.id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast(done);
      fundsInput.value = '';
    } catch (err) {
      toast(/** @type {Error} */ (err).message || 'Could not update this copy.', { tone: 'error' });
    } finally {
      inFlight = false;
      manage.removeAttribute('aria-busy');
      controls.forEach((c) => { /** @type {HTMLButtonElement|HTMLInputElement} */ (c).disabled = false; });
      refresh();
    }
  }
  function toggle() {
    if (!link) return;
    const pausing = link.status === 'active';
    patch({ status: pausing ? 'paused' : 'active' }, pausing ? `Paused copying ${name}` : `Resumed copying ${name}`);
  }
  /** @param {'add_funds'|'withdraw_funds'} kind */
  function funds(kind) {
    const v = Number(fundsInput.value);
    let msg = '';
    if (!(v > 0)) msg = 'Enter an amount first.';
    else if (kind === 'add_funds' && v > state.available) msg = `You have ${money(state.available)} of free cash.`;
    else if (kind === 'withdraw_funds' && link && v > Number(link.cash)) msg = `Only ${usdFmt(link.cash)} of this copy is uninvested.`;
    fundsInput.setAttribute('aria-invalid', String(!!msg));
    fundsErr.textContent = msg;
    if (msg) { fundsInput.focus(); return; }
    patch({ [kind]: v.toFixed(2) }, kind === 'add_funds' ? `Added ${money(v)} to your copy of ${name}` : `Withdrew ${money(v)} from your copy of ${name}`);
  }
  async function stopCopy() {
    if (!link || inFlight) return;
    const n = Number(link.positions);
    const what = n ? `Its ${n} position${n === 1 ? '' : 's'} will be sold at market and the cash returned to your account.` : 'Its cash will be returned to your account.';
    if (!window.confirm(`Stop copying ${name}? ${what}`)) return;
    inFlight = true;
    stopBtn.disabled = true;
    try {
      await api(`/api/copy/links/${encodeURIComponent(link.id)}`, { method: 'DELETE' });
      toast(`Stopping your copy of ${name}`);
      state.focus = id;
    } catch (err) {
      toast(/** @type {Error} */ (err).message || 'Could not stop this copy.', { tone: 'error' });
    } finally {
      inFlight = false;
      stopBtn.disabled = false;
      refresh();
    }
  }

  /* Start copying: validate, confirm, POST. */
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (link || submit.disabled || !state.ready) return;
    const v = Number(amount.value);
    let msg = '';
    if (!(v > 0)) msg = 'Enter an amount to allocate.';
    else if (v < min) msg = `The minimum to copy ${first} is ${money(min, true)}.`;
    else if (v > state.available) msg = `You have ${money(state.available)} of free cash.`;
    amount.setAttribute('aria-invalid', String(!!msg));
    if (errText) errText.textContent = msg;
    if (errLink) errLink.hidden = !(v > state.available);
    if (msg) { amount.focus(); return; }
    openConfirm({ trader_id: id, name, amount: v, stop: Number(sl.value), risk });
  }, true);
}

/** @type {{trader_id: string, name: string, amount: number, stop: number, risk: number|null}|null} */
let pending = null;

/** @param {{trader_id: string, name: string, amount: number, stop: number, risk: number|null}} p */
function openConfirm(p) {
  const dlg = /** @type {HTMLDialogElement|null} */ (document.getElementById('copy-confirm'));
  if (!dlg) return;
  pending = p;
  const set = (/** @type {string} */ k, /** @type {string} */ v) => setText(/** @type {HTMLElement|null} */ (dlg.querySelector(`[data-confirm="${k}"]`)), v);
  set('trader', p.name);
  set('amount', money(p.amount));
  set('stop', `Stop copying at −${p.stop}%`);
  set('risk', p.risk == null ? 'Not rated' : `${p.risk}/10 · ${LEVEL(p.risk)}`);
  set('after', money(state.available - p.amount));
  set('note', 'Your allocation mirrors this trader’s trades in proportion, using real prices. You can lose some or all of it. Past performance is not indicative of future results.');
  const after = dlg.querySelector('[data-confirm="after"]')?.previousElementSibling;
  if (after) after.textContent = 'Free cash after';
  dlg.showModal();
}

function wireConfirm() {
  const dlg = /** @type {HTMLDialogElement|null} */ (document.getElementById('copy-confirm'));
  const go = /** @type {HTMLButtonElement|null} */ (dlg?.querySelector('[data-confirm-submit]') || null);
  if (!dlg || !go) return;
  go.addEventListener('click', async () => {
    if (!pending || go.getAttribute('aria-busy') === 'true') return;
    const p = pending;
    go.setAttribute('aria-busy', 'true');
    go.disabled = true;
    try {
      await api('/api/copy/links', { method: 'POST', body: JSON.stringify({ trader_id: p.trader_id, allocation: p.amount.toFixed(2), stop_loss_pct: p.stop }) });
      state.focus = p.trader_id;
      dlg.close();
      pending = null;
      toast(`You’re now copying ${p.name}`);
      refresh();
    } catch (err) {
      toast(/** @type {Error} */ (err).message || 'Could not start copying.', { tone: 'error' });
    } finally {
      go.removeAttribute('aria-busy');
      go.disabled = false;
    }
  });
}

boot().catch((err) => console.error('[copy-traders]', err)).finally(() => settle());
