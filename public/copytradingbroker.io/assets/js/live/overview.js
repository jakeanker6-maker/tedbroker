// @ts-check
/**
 * Overview: unified account value (trading, copies, baskets, plans), free cash, copies,
 * allocation by asset class and recent ledger activity.
 * Every section is either rendered from the database, shown as an explicit empty
 * state, or labelled as demo data. Static placeholder numbers are never shown as live.
 */
import { api, date, dateTimeAttr, int, money, percent } from './api.js';
import { h } from '../trade/dom.js';
import { hydrateChrome, initBase } from './base.js';
import { busy, clearEmpty, emptyState, markDemo, markLive, skeletonRows } from './shell.js';

const $ = (/** @type {string} */ s, root = document) => root.querySelector(s);
const $$ = (/** @type {string} */ s, root = document) => [...root.querySelectorAll(s)];

/** @param {Element|null} el @param {string} text */
function liveText(el, text) {
  if (!(el instanceof HTMLElement)) return;
  el.textContent = text;
  el.setAttribute('data-live-value', '');
}

/** @param {Element|null} el @param {number} value @param {'currency'|'number'|'percent'} [kind] */
function liveCount(el, value, kind = 'number') {
  if (!(el instanceof HTMLElement)) return;
  el.dataset.count = String(value);
  if (kind === 'currency') el.dataset.format = 'currency';
  if (kind === 'percent') {
    delete el.dataset.format;
    el.dataset.decimals = '1';
  }
  el.setAttribute('data-live-value', '');
  el.textContent = kind === 'currency'
    ? money(value)
    : kind === 'percent' ? percent(value, true) : int(value);
}

/** @param {HTMLElement} el @param {boolean} up */
function setTrend(el, up) {
  el.dataset.trend = up ? 'up' : 'down';
}

const CLASS_LABEL = /** @type {Record<string,string>} */ ({ stock: 'Stocks', etf: 'ETFs', crypto: 'Crypto', option: 'Options', cash: 'Cash', managed_plans: 'Managed plans' });

const TYPE_LABEL = /** @type {Record<string,string>} */ ({
  opening_balance: 'Opening balance', deposit: 'Deposit', withdrawal_hold: 'Withdrawal requested', withdrawal_release: 'Withdrawal cancelled',
  withdrawal: 'Withdrawal', adjustment: 'Adjustment', plan_invest: 'Plan investment', plan_refund: 'Plan refund', plan_payout: 'Plan payout',
  referral_bonus: 'Referral bonus', trade_buy: 'Buy', trade_sell: 'Sell', short_sale: 'Short sale', short_cover: 'Short cover', fee: 'Fee',
  option_premium: 'Option premium', exercise: 'Option exercise', assignment: 'Option assignment', dividend: 'Dividend', dividend_owed: 'Dividend owed (short)',
  borrow_fee: 'Borrow fee', margin_interest: 'Margin interest', copy_allocate: 'Copy allocation', copy_release: 'Copy funds returned', copy_pnl: 'Copy P&L', liquidation: 'Liquidation',
});
const HIDDEN_TYPES = new Set(['order_hold', 'order_release', 'withdrawal_hold', 'withdrawal_release']);   // holds only move reserved cash
/** Copy allocations are reservations: show the move out of (or back into) free cash. @param {any} e */
const shown = (e) => (Number(e.amount) !== 0 ? Number(e.amount) : String(e.type).startsWith('copy_') ? -Number(e.reserved_change || 0) : 0);

/** Account value history behind the hero chart (ledger + position snapshots). */
async function wireHistoryChart() {
  const chart = /** @type {HTMLElement|null} */ ($('#pv-chart'));
  const seg = $('.seg[data-target="pv-chart"]');
  if (!(chart instanceof HTMLElement)) return;
  const note = document.createElement('p');
  note.className = 'fineprint';
  note.textContent = 'Account value: cash plus positions at real market prices, copies and plans. Managed plans are valued on their modelled schedule, not at market.';
  chart.after(note);
  const host = /** @type {HTMLElement} */ (chart.parentElement);

  /** @param {string} range */
  const load = async (range) => {
    try {
      const data = await api(`/api/trading/portfolio/history?range=${encodeURIComponent(range)}`);
      const pts = Array.isArray(data.points) ? data.points : [];
      if (pts.length < 2) {
        chart.hidden = true; note.hidden = true;
        emptyState(host, 'Your history starts now', 'A point is recorded every minute while you hold positions and at each market close.');
        return;
      }
      clearEmpty(host);
      chart.hidden = false; note.hidden = false;
      const short = (/** @type {number} */ t) => new Date(t * 1000).toLocaleDateString('en-US', range === '1W' ? { weekday: 'short' } : { day: 'numeric', month: 'short' });
      const last = Number(pts[pts.length - 1].value);
      chart.setAttribute('aria-label', `Account value over this period, ending at ${money(last)}. Use arrow keys to inspect values.`);
      chart.dispatchEvent(new CustomEvent('chart:update', {
        detail: { series: pts.map((/** @type {any} */ p) => Number(p.value).toFixed(2)).join(','), labels: pts.map((/** @type {any} */ p) => short(p.t)).join(','), animate: true },
      }));
    } catch {
      chart.hidden = true; note.hidden = true;
      emptyState(host, 'Chart unavailable', 'Account history could not be loaded.');
    }
  };
  seg?.addEventListener('seg:change', (e) => {
    const value = /** @type {CustomEvent} */ (e).detail?.value;
    if (value) load(String(value));
  });
  await load(seg?.querySelector('[aria-pressed="true"]')?.textContent?.trim() || '1M');
}

/** @param {Element|null} section */
const sectionOf = (section) => /** @type {HTMLElement|null} */ (section instanceof HTMLElement ? section : null);

/** @param {Element|null} parent @param {...(Node|string)} kids */
const put = (parent, ...kids) => { if (parent) parent.replaceChildren(...kids); };

async function boot() {
  const regions = {
    hero: sectionOf($('section[aria-labelledby="pv-label"]')),
    stats: sectionOf($('section[aria-label="Account summary"]')),
    copies: sectionOf($('#copies-title')?.closest('section') || null),
    alloc: sectionOf($('#alloc-title')?.closest('section') || null),
    activity: sectionOf($('#activity-title')?.closest('section') || null),
  };
  let session;
  try {
    session = await initBase();
  } catch (err) {
    failAll(regions, err);
    return;
  }

  if (session.demo) {
    for (const r of Object.values(regions)) {
      busy(r, false);
      markDemo(r, 'Demo preview: placeholder values, not your account.');
    }
    return;
  }

  const { me } = session;
  const copiesBody = regions.copies?.querySelector('tbody') || null;
  const activityBody = regions.activity?.querySelector('tbody') || null;
  skeletonRows(copiesBody, 6, 3);
  skeletonRows(activityBody, 4, 4);

  /** @type {PromiseSettledResult<any>[]} */
  const results = await Promise.allSettled([
    api('/api/trading/portfolio/summary'),
    api('/api/wallet/pending-transactions'),
    api('/api/wallet/activity?limit=25'),
    api('/api/copy/links'),
  ]);
  const value = (/** @type {number} */ i) => (results[i].status === 'fulfilled' ? results[i].value : null);
  const sum = value(0);
  const pending = value(1) || { pending_deposits: { count: 0, total_amount: 0 }, pending_withdrawals: { count: 0, total_amount: 0 } };
  const activity = (value(2)?.items || []).filter((/** @type {any} */ e) => !HIDDEN_TYPES.has(e.type) && !e.internal && shown(e) !== 0);
  const links = value(3)?.links || [];

  hydrateChrome(me, { copies: links.length });

  /* ---------- page meta: market status ---------- */
  const mk = $('[data-market-status]');
  if (mk && !sum) { mk.className = 'muted'; mk.textContent = 'Market status unavailable'; }
  if (mk && sum?.market) {
    const open = sum.market.equities === 'open';
    mk.className = open ? 'gain' : 'muted';
    mk.textContent = open ? '● US markets open' : `● US markets ${sum.market.equities === 'pre' ? 'in pre-market' : sum.market.equities === 'post' ? 'after hours' : 'closed'} · crypto 24/7`;
  }

  /* ---------- hero value ---------- */
  const hero = $('.hero-value__num');
  if (hero && sum) liveCount(hero, Number(sum.total_value), 'currency');
  else if (hero) liveText(hero, '—');
  const delta = $('.hero-value__delta');
  if (delta instanceof HTMLElement && !sum) { delete delta.dataset.trend; liveText(delta, 'Your account value couldn’t be loaded. Reload to try again.'); }
  if (delta instanceof HTMLElement && sum) {
    const pl = Number(sum.day_pnl || 0);
    setTrend(delta, pl >= 0);
    liveText(delta, `${pl >= 0 ? '+' : '−'}${money(Math.abs(pl))} (${percent(Number(sum.day_pnl_percent || 0), true)}) today`);
  }
  const pvLabel = $('#pv-label');
  if (pvLabel) pvLabel.textContent = 'Total account value';
  await wireHistoryChart();
  busy(regions.hero, false);

  /* ---------- stat strip ---------- */
  // Same definitions as the Wallet and Copy traders pages: cash = total cash; free = cash minus holds (withdrawable).
  const cashTotal = sum ? Number(sum.cash) : 0;
  const freeCash = sum ? Number(sum.withdrawable) : 0;
  for (const stat of $$('.stat-strip .stat')) {
    const lab = $('.stat__label', stat);
    const label = lab?.textContent?.trim() || '';
    if (!sum && (label.startsWith('Wallet balance') || label.startsWith('Total return') || label.startsWith('Unrealized'))) {
      const v = $('.stat__value .delta', stat) || $('.stat__value', stat);
      if (v instanceof HTMLElement) { delete v.dataset.trend; liveText(v, '—'); }
      liveText($('.stat__meta', stat), 'Couldn’t load');
    } else if (label.startsWith('Active copies') && results[3].status === 'rejected') {
      liveText($('.stat__value', stat), '—');
      const tag = $('.tag', stat);
      if (tag) { tag.className = 'tag tag--plain'; tag.textContent = 'Couldn’t load'; }
    } else if (label.startsWith('Pending') && results[1].status === 'rejected') {
      liveText($('.stat__value', stat), '—');
      const tag = $('.tag', stat);
      if (tag) { tag.className = 'tag tag--plain'; tag.textContent = 'Couldn’t load'; }
    } else if (label.startsWith('Wallet balance')) {
      liveCount($('.stat__value', stat), cashTotal, 'currency');
      liveText($('.stat__meta', stat), sum && Number(sum.reserved) > 0
        ? `${money(freeCash)} free · ${money(Number(sum.reserved))} held`
        : `${money(freeCash)} free to trade or copy`);
    } else if (label.startsWith('Active copies')) {
      liveCount($('.stat__value', stat), links.length);
      const tag = $('.tag', stat);
      if (tag) {
        const paused = links.filter((/** @type {any} */ l) => l.status !== 'active').length;
        tag.className = 'tag tag--plain ' + (links.length ? 'tag--gain' : 'tag--pending');
        tag.textContent = links.length ? `${links.length - paused} copying${paused ? ` · ${paused} paused` : ''}` : 'No active copies';
      }
    } else if (label.startsWith('Total return') || label.startsWith('Unrealized')) {
      if (lab) lab.textContent = 'Unrealized P&L';
      const target = $('.stat__value .delta', stat) || $('.stat__value', stat);
      if (target instanceof HTMLElement && sum) {
        const u = Number(sum.unrealized_pnl || 0);
        setTrend(target, u >= 0);
        liveText(target, `${u >= 0 ? '+' : '−'}${money(Math.abs(u))}`);
      }
      liveText($('.stat__meta', stat), sum ? `${int(sum.positions_count)} open position${sum.positions_count === 1 ? '' : 's'}` : '—');
    } else if (label.startsWith('Pending')) {
      const dep = pending.pending_deposits || { count: 0, total_amount: 0 };
      const wd = pending.pending_withdrawals || { count: 0, total_amount: 0 };
      liveText($('.stat__value', stat), money(Number(dep.count ? dep.total_amount : wd.total_amount) || 0));
      const tag = $('.tag', stat);
      if (tag) {
        tag.className = 'tag tag--plain ' + (dep.count || wd.count ? 'tag--pending' : 'tag--plain');
        tag.textContent = dep.count
          ? `${int(dep.count)} deposit${dep.count === 1 ? '' : 's'}`
          : wd.count ? `${int(wd.count)} withdrawal${wd.count === 1 ? '' : 's'}` : 'Nothing pending';
      }
    }
  }
  busy(regions.stats, false);

  /* ---------- active copies ---------- */
  const small = $('#copies-title small');
  if (small) small.textContent = `${int(links.length)} trader${links.length === 1 ? '' : 's'}`;
  const heads = regions.copies?.querySelectorAll('thead th') || [];
  if (heads[1]) heads[1].textContent = 'Value';
  if (heads[2]) heads[2].textContent = 'P/L';
  if (heads[3]) heads[3].textContent = 'Positions';
  if (copiesBody) {
    if (results[3].status === 'rejected') {
      put(copiesBody, h('tr', null, h('td', { colspan: 6 }, h('div', { class: 'empty' },
        h('p', { class: 'empty__title' }, 'Your copies couldn’t be loaded'), h('p', null, 'Reload the page to try again.')))));
    } else if (!links.length) {
      put(copiesBody, h('tr', null, h('td', { colspan: 6 }, h('div', { class: 'empty' },
        h('p', { class: 'empty__title' }, 'No active copies yet'), h('p', null, 'Browse the trader directory to start copying.')))));
    } else {
      put(copiesBody, ...links.map((/** @type {any} */ l, /** @type {number} */ i) => {
        const name = String(l.trader_name || 'Trader');
        const pl = Number(l.pnl || 0);
        const [txt, cls] = l.status === 'active' ? ['Copying', 'tag--gain'] : l.status === 'paused' ? ['Paused', 'tag--pending'] : ['Closing', 'tag--pending'];
        return h('tr', null,
          h('td', null, h('div', { class: 'person' },
            h('span', { class: `avatar ${['', 'avatar--amber', 'avatar--navy'][i % 3]}`.trim(), 'aria-hidden': 'true' }, name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()),
            h('div', null, h('div', { class: 'person__name' }, name), h('div', { class: 'person__meta' }, `${money(Number(l.allocated))} put in`)))),
          h('td', { class: 'is-num' }, money(Number(l.equity))),
          h('td', { class: 'is-num' }, h('span', { class: 'delta', 'data-trend': pl >= 0 ? 'up' : 'down' }, `${pl >= 0 ? '+' : '−'}${money(Math.abs(pl))}`)),
          h('td', { class: 'opt' }, String(l.positions)),
          h('td', null, h('span', { class: `tag tag--plain ${cls}` }, txt)),
          h('td', { class: 'is-end' }, h('a', { class: 'text-btn', href: 'copy-traders.html' }, 'Manage', h('span', { class: 'sr-only' }, ` ${name}`))));
      }));
    }
  }
  copiesBody?.removeAttribute('aria-busy');
  busy(regions.copies, false);

  /* ---------- allocation donut (by asset class) ---------- */
  const allocSection = regions.alloc;
  const donut = $('.donut');
  document.querySelector('[data-alloc-loading]')?.remove();
  if (donut instanceof HTMLElement && allocSection) {
    const legend = $('.legend', donut);
    const entries = (sum?.by_asset_class || [])
      .map((/** @type {any} */ c) => /** @type {[string, number]} */ ([CLASS_LABEL[c.asset_class] || c.asset_class, Number(c.value)]))
      .filter((/** @type {[string, number]} */ [, v]) => v > 0)
      .sort((/** @type {[string, number]} */ a, /** @type {[string, number]} */ b) => b[1] - a[1]);
    const colors = [1, 2, 3, 4, 5, 6].map((n) => `var(--chart-cat-${n})`);
    const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
    if (!sum) {
      donut.hidden = true;
      emptyState(allocSection, 'Allocation unavailable', 'Your account summary couldn’t be loaded.');
    } else if (!entries.length) {
      donut.hidden = true;
      emptyState(allocSection, 'No allocation yet', 'Fund your wallet, trade or copy a trader to see your split.');
    } else {
      clearEmpty(allocSection);
      donut.hidden = false;
      put(legend, ...entries.map(([label, v], i) => {
        const p = Math.round((v / total) * 100);
        return h('li', { 'data-value': String(p), style: `--c: ${colors[i % colors.length]}` }, `${label} `, h('strong', null, `${p}%`), h('span', { class: 'num' }, money(v, true)));
      }));
      put($('.donut__center', donut), h('strong', null, String(entries.length)), h('span', null, entries.length === 1 ? 'Class' : 'Classes'));
      $('svg', donut)?.remove();
      donut.removeAttribute('data-focus');
      try {
        const { init } = await import('../components/donut.js');
        init(donut);
      } catch { /* non-critical */ }
    }
  }
  busy(allocSection, false);

  /* ---------- recent activity (ledger) ---------- */
  if (activityBody) {
    if (results[2].status === 'rejected') {
      put(activityBody, h('tr', null, h('td', { colspan: 4 }, h('div', { class: 'empty' },
        h('p', { class: 'empty__title' }, 'Recent activity couldn’t be loaded'), h('p', null, 'Reload the page to try again.')))));
    } else if (activity.length) {
      put(activityBody, ...activity.slice(0, 6).map((/** @type {any} */ e) => {
        const amt = shown(e);
        return h('tr', null,
          h('td', { class: 'mono muted nowrap' }, h('time', { datetime: dateTimeAttr(e.created_at) }, date(e.created_at, true))),
          h('td', null, h('strong', null, `${String(e.bucket || '').startsWith('copy:') ? 'Copied trade · ' : ''}${TYPE_LABEL[e.type] || e.type}`), e.description ? h('span', { class: 'muted' }, ` · ${e.description}`) : null),
          h('td', null, h('span', { class: 'tag tag--plain' }, bucketLabel(String(e.bucket || '')))),
          h('td', { class: `is-num ${amt >= 0 ? 'gain' : 'loss'}` }, `${amt >= 0 ? '+' : '−'}${money(Math.abs(amt))}`));
      }));
      clearEmpty(regions.activity);
    } else {
      put(activityBody, h('tr', null, h('td', { colspan: 4 }, h('div', { class: 'empty' },
        h('p', { class: 'empty__title' }, 'No activity yet'), h('p', null, 'Deposits, trades, copies and withdrawals will appear here.')))));
    }
    activityBody.removeAttribute('aria-busy');
  }
  busy(regions.activity, false);
  for (const r of [regions.stats, regions.copies, regions.alloc, regions.activity]) markLive(r);
}

/** Account-level label for a ledger row's bucket (no per-entry status exists). @param {string} b */
function bucketLabel(b) {
  if (b === 'self') return 'Self-directed';
  if (b.startsWith('copy:')) return 'Copy trading';
  if (b.startsWith('basket:')) return 'ETF basket';
  if (b.startsWith('plan')) return 'Plan';
  return b ? 'Cash' : '—';
}

/** The page script could not start or the account could not be verified: say so, show no figures.
 * @param {Record<string, HTMLElement|null>} regions @param {unknown} err */
function failAll(regions, err) {
  console.error('[overview]', err);
  for (const el of $$('[data-live-value]')) el.textContent = '—';
  for (const el of $$('[data-live-tag]')) { el.className = 'tag tag--plain'; el.textContent = 'Couldn’t load'; }
  const meta = $('[data-market-status]');
  if (meta) { meta.className = 'muted'; meta.textContent = 'Market status unavailable'; }
  const body = regions.copies?.querySelector('tbody') || null;
  put(body, h('tr', null, h('td', { colspan: 6 }, h('div', { class: 'empty' },
    h('p', { class: 'empty__title' }, 'Your copies couldn’t be loaded'), h('p', null, 'Reload the page or sign in again.')))));
  const act = regions.activity?.querySelector('tbody') || null;
  put(act, h('tr', null, h('td', { colspan: 4 }, h('div', { class: 'empty' },
    h('p', { class: 'empty__title' }, 'Recent activity couldn’t be loaded'), h('p', null, 'Reload the page or sign in again.')))));
  for (const r of Object.values(regions)) busy(r, false);
  if (regions.alloc) {
    $('.donut') instanceof HTMLElement && /** @type {HTMLElement} */ ($('.donut')).setAttribute('hidden', '');
    emptyState(regions.alloc, 'Allocation unavailable', 'Your account summary couldn’t be loaded.');
  }
}

boot().catch((err) => {
  console.error('[overview]', err);
  for (const el of $$('[data-skeleton][aria-busy="true"]')) el.setAttribute('aria-busy', 'false');
});
