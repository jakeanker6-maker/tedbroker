// @ts-check
/** Stock screener page: filters -> /api/market/screener, results link to the Trading Hub. */
import { api } from './api.js';
import { initBase } from './base.js';
import { settle } from './shell.js';
import { toast } from '../lib/util.js';
import { $, h, price, setText, signedPct, tone } from '../trade/dom.js';

const PAGE = 50;
const CAPS = /** @type {Record<string,[number|null, number|null]>} */ ({
  mega: [200e9, null], large: [10e9, 200e9], mid: [2e9, 10e9], small: [300e6, 2e9], micro: [null, 300e6],
});
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const state = { offset: 0, total: 0, seq: 0, sectors: /** @type {Set<string>} */ (new Set()) };
const form = /** @type {HTMLFormElement} */ ($('[data-sc-form]'));

/** @param {string} name */
const val = (name) => /** @type {HTMLInputElement} */ (form.elements.namedItem(name)).value.replace(/[$,%\s]/g, '');

function query() {
  const p = new URLSearchParams();
  const [sort, dir] = val('sort').split(':');
  p.set('sort', sort);
  p.set('ascending', String(dir === 'asc'));
  if (state.sectors.size) p.set('sector', [...state.sectors].join(','));
  const cap = CAPS[val('cap')];
  if (cap?.[0] != null) p.set('market_cap_min', String(cap[0]));
  if (cap?.[1] != null) p.set('market_cap_max', String(cap[1]));
  for (const n of ['price_min', 'price_max', 'change_min', 'change_max', 'volume_min', 'pe_max']) {
    const v = val(n);
    if (v === '') continue;
    if (!Number.isFinite(Number(v))) throw Object.assign(new Error('Filters must be numbers.'), { field: n });
    p.set(n, v);
  }
  p.set('limit', String(PAGE));
  p.set('offset', String(state.offset));
  return p;
}

function fieldError(/** @type {string} */ msg, /** @type {string} [field] */ field) {
  const err = /** @type {HTMLElement} */ ($('[data-sc-error]'));
  err.textContent = msg;
  err.hidden = !msg;
  form.querySelectorAll('[aria-invalid]').forEach((x) => { x.removeAttribute('aria-invalid'); x.removeAttribute('aria-describedby'); });
  if (field) {
    const el = /** @type {HTMLInputElement} */ (form.elements.namedItem(field));
    el.setAttribute('aria-invalid', 'true');
    el.setAttribute('aria-describedby', 'sc-err');
    el.focus();
  }
}

/** @param {boolean} [focusResults] */
async function run(focusResults = false) {
  let p;
  try { p = query(); } catch (err) { fieldError(/** @type {Error} */ (err).message, /** @type {any} */ (err).field); return; }
  fieldError('');
  const mine = ++state.seq;
  const body = $('[data-sc-rows]');
  $('[data-sc-wrap]')?.setAttribute('aria-busy', 'true');
  setText($('[data-sc-count]'), 'Loading…');
  try {
    const r = await api(`/api/market/screener?${p}`);
    if (mine !== state.seq) return;
    state.total = r.total;
    setText($('[data-sc-count]'), r.total ? `${r.total.toLocaleString('en-US')} match${r.total === 1 ? '' : 'es'}` : 'No matches');
    body?.replaceChildren(...(r.rows.length ? r.rows.map((/** @type {any} */ x) => h('tr', null,
      h('td', null, h('div', { class: 'sc-sym' }, h('a', { href: `trade.html?symbol=${encodeURIComponent(x.symbol)}` }, h('strong', null, x.symbol)), h('span', null, x.name))),
      h('td', { class: 'is-num mono' }, price(x.price)),
      h('td', { class: `is-num mono ${tone(x.change_percent)}` }, x.change_percent == null ? '—' : signedPct(x.change_percent)),
      h('td', { class: 'is-num mono opt-sm' }, x.volume ? compact.format(x.volume) : '—'),
      h('td', { class: 'is-num mono' }, x.market_cap ? `$${compact.format(x.market_cap)}` : '—'),
      h('td', { class: 'is-num mono opt' }, x.pe ? Number(x.pe).toFixed(1) : '—'),
      h('td', { class: 'is-num mono opt' }, x.week52_low && x.week52_high ? `${price(x.week52_low)} – ${price(x.week52_high)}` : '—'),
      h('td', { class: 'opt mono' }, x.earnings_at && x.earnings_at * 1000 > Date.now() - 86400000
        ? new Date(x.earnings_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—')))
      : [h('tr', null, h('td', { colspan: 8, class: 'muted' }, 'No stocks match these filters. Try widening them.'))]));
    const pager = /** @type {HTMLElement} */ ($('[data-sc-pager]'));
    pager.hidden = r.total <= PAGE;
    setText($('[data-sc-page]'), `${state.offset + 1}–${Math.min(state.offset + PAGE, r.total)} of ${r.total.toLocaleString('en-US')}`);
    /** @type {HTMLButtonElement} */ ($('[data-sc-prev]')).disabled = state.offset === 0;
    /** @type {HTMLButtonElement} */ ($('[data-sc-next]')).disabled = state.offset + PAGE >= r.total;
    setText($('[data-sc-note]'), r.note || 'Screener data from Yahoo Finance, may be delayed up to 15 minutes.');
    if (focusResults) /** @type {HTMLElement|null} */ ($('#sc-results-title'))?.focus();
  } catch (err) {
    if (mine !== state.seq) return;
    setText($('[data-sc-count]'), '');
    /** @type {HTMLElement} */ ($('[data-sc-pager]')).hidden = true;
    body?.replaceChildren(h('tr', null, h('td', { colspan: 8 }, h('p', { role: 'alert' }, /** @type {Error} */ (err).message))));
  } finally {
    if (mine === state.seq) $('[data-sc-wrap]')?.removeAttribute('aria-busy');
  }
}

function renderSectors(/** @type {string[]} */ sectors) {
  $('[data-sc-sectors]')?.replaceChildren(...sectors.map((s) => h('button', {
    class: 'sc-chip', type: 'button', 'aria-pressed': String(state.sectors.has(s)),
    onclick: (/** @type {Event} */ e) => {
      const b = /** @type {HTMLElement} */ (e.currentTarget);
      if (state.sectors.has(s)) state.sectors.delete(s); else state.sectors.add(s);
      b.setAttribute('aria-pressed', String(state.sectors.has(s)));
      state.offset = 0;
      run();
    },
  }, s)));
}

const PRESETS = /** @type {Record<string, Record<string,string>>} */ ({
  gainers: { cap: 'large', sort: 'change:desc', change_min: '1' },
  value: { pe_max: '15', sort: 'market_cap:desc', cap: 'large' },
  active: { sort: 'volume:desc', volume_min: '5000000' },
});

async function boot() {
  const session = await initBase();
  if (session.demo) {
    $('[data-sc-rows]')?.replaceChildren(h('tr', null, h('td', { colspan: 8, class: 'muted' }, 'Sign in to use the screener.')));
    return;
  }
  try {
    const opts = await api('/api/market/screener/options');
    renderSectors(opts.sectors);
  } catch { renderSectors([]); }
  form.addEventListener('submit', (e) => { e.preventDefault(); state.offset = 0; run(); });
  form.addEventListener('reset', () => {
    state.sectors.clear();
    setTimeout(() => { document.querySelectorAll('.sc-chip').forEach((c) => c.setAttribute('aria-pressed', 'false')); fieldError(''); }, 0);
  });
  form.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-sc-preset]'));
    if (!b) return;
    form.reset();
    state.sectors.clear();
    document.querySelectorAll('.sc-chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    for (const [k, v] of Object.entries(PRESETS[b.dataset.scPreset || ''] || {})) {
      /** @type {HTMLInputElement} */ (form.elements.namedItem(k)).value = v;
    }
    state.offset = 0;
    run();
  });
  $('[data-sc-prev]')?.addEventListener('click', () => { state.offset = Math.max(0, state.offset - PAGE); run(true); });
  $('[data-sc-next]')?.addEventListener('click', () => { state.offset += PAGE; run(true); });
  await run();
}

boot().catch((err) => console.error('[screener]', err)).finally(() => settle());
