// @ts-check
/** Options chain (calls | strike | puts) and the multi-leg strategy builder. */
import { api } from '../live/api.js';
import { toast } from '../lib/util.js';
import { PayoffChart, ready } from './chart.js';
import { $, $$, h, occName, price, setText, usdFmt } from './dom.js';

/** Options quote in cents. @param {unknown} v */
const cents = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(2));

/**
 * @param {HTMLElement} root [data-chain]
 * @param {{
 *   underlying: () => string,
 *   positionQty: (s: string) => number,
 *   onPick: (contract: string, o: {side: string, type: string, limit: number}) => void,
 *   onPlaced: () => void,
 * }} ctx
 */
export function optionsChain(root, ctx) {
  const expBar = /** @type {HTMLElement} */ ($('[data-expiries]', root));
  const rowsEl = /** @type {HTMLElement} */ ($('[data-chain-rows]', root));
  const note = $('[data-chain-note]', root);
  let count = '10';
  let expiry = '';
  /** @type {string[]} */ let expiries = [];
  /** @type {any} */ let chain = null;
  let loadedFor = '';
  /** @type {any} */ let timer = null;

  let loadSeq = 0;
  async function load(force = false) {
    const sym = ctx.underlying();
    if (!sym) return;
    const mine = ++loadSeq;
    const current = () => mine === loadSeq && sym === ctx.underlying();   // drop stale responses
    if (loadedFor !== sym) {
      expiries = []; expiry = ''; chain = null; loadedFor = sym;
      rowsEl.replaceChildren(h('tr', { class: 'th-empty' }, h('td', { colspan: 11 }, 'Loading options…')));
      try {
        const exps = (await api(`/api/market/options/${encodeURIComponent(sym)}/expiries`)).expiries || [];
        if (!current()) return;
        expiries = exps;
      } catch (err) {
        if (!current()) return;
        expBar.replaceChildren();
        rowsEl.replaceChildren(h('tr', { class: 'th-empty' }, h('td', { colspan: 11 }, /** @type {Error} */ (err).message || 'Options are not available for this symbol.')));
        setText(note, '');
        return;
      }
      expiry = expiries[0] || '';
      renderExpiries();
    }
    if (!expiry) return;
    try {
      const data = await api(`/api/market/options/${encodeURIComponent(sym)}/chain?expiry=${encodeURIComponent(expiry)}`);
      if (!current()) return;
      chain = data;
      render();
    } catch (err) {
      if (force && current()) toast(/** @type {Error} */ (err).message, { tone: 'error' });
    }
  }

  function renderExpiries() {
    const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    expBar.replaceChildren(...expiries.slice(0, 18).map((e) => h('button', {
      class: 'seg__btn', type: 'button', 'aria-pressed': String(e === expiry), dataset: { value: e },
    }, fmt.format(new Date(`${e}T00:00:00Z`)))));
  }

  function render() {
    if (!chain) return;
    const spot = Number(chain.underlying_quote?.last);
    const strikes = [...new Set([...chain.calls, ...chain.puts].map((r) => r.strike))].sort((a, b) => a - b);
    let shown = strikes;
    if (count !== 'all') {
      const n = Number(count);
      const atm = strikes.reduce((best, k, i) => (Math.abs(k - spot) < Math.abs(strikes[best] - spot) ? i : best), 0);
      shown = strikes.slice(Math.max(0, atm - n / 2), atm + n / 2);
    }
    const calls = new Map(chain.calls.map((/** @type {any} */ r) => [r.strike, r]));
    const puts = new Map(chain.puts.map((/** @type {any} */ r) => [r.strike, r]));
    let spotMarked = false;
    rowsEl.replaceChildren(...shown.map((k) => {
      const c = calls.get(k), p = puts.get(k);
      const markSpot = !spotMarked && k >= spot;
      if (markSpot) spotMarked = true;
      return h('tr', { class: markSpot ? 'is-spot' : null },
        ...side(c, true), h('td', { class: 'is-num th-chain__strike' }, price(k)), ...side(p, false));
    }));
    syncSpans();
    const theo = [...chain.calls, ...chain.puts].some((r) => r.theoretical);
    setText(note, `Underlying ${price(spot)} · ${chain.days_to_expiry} days to expiry · Yahoo Finance option snapshot${theo ? ' · Italic prices are theoretical (no live quote)' : ''}. Select a bid to sell or an ask to buy.`);
  }

  /** @param {any} r @param {boolean} isCall */
  function side(r, isCall) {
    if (!r) return ['', 'c-iv', 'c-vol', '', ''].map((c) => h('td', { class: c || null }, ''));
    const itm = r.in_the_money ? 'is-num is-itm' : 'is-num';
    const btn = (/** @type {'bid'|'ask'} */ which) => h('button', {
      class: `th-px-btn${r.theoretical ? ' is-theo' : ''}`, type: 'button',
      'aria-label': `${which === 'bid' ? 'Sell' : 'Buy'} ${occName(r.symbol)} at ${cents(r[which])}${r.in_the_money ? ', in the money' : ''}${r.theoretical ? ', theoretical price' : ''}`,
      onclick: () => {
        const held = ctx.positionQty(r.symbol);
        const s = which === 'ask' ? (held < 0 ? 'buy_to_close' : 'buy_to_open') : (held > 0 ? 'sell_to_close' : 'sell_to_open');
        ctx.onPick(r.symbol, { side: s, type: 'limit', limit: r[which] || r.mid });
      },
    }, cents(r[which]));
    const cells = [
      h('td', { class: itm }, Number(r.delta).toFixed(2)),
      h('td', { class: `${itm} c-iv` }, `${(Number(r.iv) * 100).toFixed(1)}%`),
      h('td', { class: `${itm} c-vol` }, `${r.volume ?? '—'} / ${r.open_interest ?? '—'}`),
      h('td', { class: itm }, btn('bid')),
      h('td', { class: itm }, btn('ask')),
    ];
    // calls: Delta IV Vol/OI Bid Ask | strike | puts mirror it: Bid Ask Vol/OI IV Delta
    const [delta, iv, vol, bid, ask] = cells;
    return isCall ? cells : [bid, ask, vol, iv, delta];
  }

  /** Calls/Puts group headers span however many columns the container query leaves visible. */
  function syncSpans() {
    const shown = (/** @type {string} */ c) => { const th = $(`thead .${c}`, root); return th ? getComputedStyle(th).display !== 'none' : true; };
    const span = 3 + (shown('c-iv') ? 1 : 0) + (shown('c-vol') ? 1 : 0);
    $$('[data-span]', root).forEach((th) => { /** @type {HTMLTableCellElement} */ (th).colSpan = span; });
  }
  new ResizeObserver(syncSpans).observe(/** @type {HTMLElement} */ ($('.th-chain__wrap', root)));

  expBar.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-value]'));
    if (!b) return;
    expiry = b.dataset.value || '';
    renderExpiries();
    load(true);
  });
  $('[data-strike-count]', root)?.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-value]'));
    if (!b) return;
    count = b.dataset.value || '10';
    $$('[data-value]', $('[data-strike-count]', root) || root).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    render();
  });

  const builder = strategyBuilder(() => ({ chain, expiries, expiry, underlying: ctx.underlying() }), ctx.onPlaced);
  $('[data-open-builder]', root)?.addEventListener('click', () => builder.open());

  return {
    /** Start/stop auto refresh while the panel is visible. @param {boolean} visible */
    visible(visible) {
      clearInterval(timer);
      if (visible) { load(); timer = setInterval(() => load(), 30000); }
    },
    reset() { loadedFor = ''; chain = null; },
  };
}

/* ======================================================================== strategy builder */
const TEMPLATES = /** @type {Record<string, {api: string, legs: (k: (o: number) => number) => Array<[string, number|null, string, number, boolean?]>}>} */ ({
  // [right|'S', strike offset in steps (null = stock), side, ratio, far expiry?]
  bull_call: { api: 'vertical', legs: () => [['C', 0, 'buy', 1], ['C', 1, 'sell', 1]] },
  bear_put: { api: 'vertical', legs: () => [['P', 0, 'buy', 1], ['P', -1, 'sell', 1]] },
  bull_put: { api: 'vertical', legs: () => [['P', 0, 'sell', 1], ['P', -1, 'buy', 1]] },
  bear_call: { api: 'vertical', legs: () => [['C', 0, 'sell', 1], ['C', 1, 'buy', 1]] },
  long_straddle: { api: 'straddle', legs: () => [['C', 0, 'buy', 1], ['P', 0, 'buy', 1]] },
  long_strangle: { api: 'strangle', legs: () => [['C', 1, 'buy', 1], ['P', -1, 'buy', 1]] },
  iron_condor: { api: 'iron_condor', legs: () => [['P', -2, 'buy', 1], ['P', -1, 'sell', 1], ['C', 1, 'sell', 1], ['C', 2, 'buy', 1]] },
  butterfly: { api: 'butterfly', legs: () => [['C', -1, 'buy', 1], ['C', 0, 'sell', 2], ['C', 1, 'buy', 1]] },
  calendar: { api: 'calendar', legs: () => [['C', 0, 'sell', 1], ['C', 0, 'buy', 1, true]] },
  covered_call: { api: 'covered_call', legs: () => [['S', null, 'buy', 100], ['C', 1, 'sell', 1]] },
  collar: { api: 'collar', legs: () => [['S', null, 'buy', 100], ['P', -1, 'buy', 1], ['C', 1, 'sell', 1]] },
});

/** @param {() => {chain: any, expiries: string[], expiry: string, underlying: string}} source @param {() => void} onPlaced */
function strategyBuilder(source, onPlaced) {
  const dlg = /** @type {HTMLDialogElement} */ (document.getElementById('strategy-builder'));
  const sel = /** @type {HTMLSelectElement} */ ($('[data-b-strategy]', dlg));
  const widthSel = /** @type {HTMLSelectElement} */ ($('[data-b-width]', dlg));
  const qtyIn = /** @type {HTMLInputElement} */ ($('[data-b-qty]', dlg));
  const limitIn = /** @type {HTMLInputElement} */ ($('[data-b-limit]', dlg));
  const placeBtn = /** @type {HTMLButtonElement} */ ($('[data-b-place]', dlg));
  /** @type {PayoffChart|null} */ let payoff = null;
  /** @type {any} */ let lastBody = null;
  /** @type {any} */ let preview = null;
  let seq = 0;
  let draftKey = '';
  let clientId = crypto.randomUUID();

  async function contractsFor() {
    const { chain, expiries, expiry, underlying } = source();
    if (!chain) throw new Error('Load the options chain first.');
    const spot = Number(chain.underlying_quote?.last);
    const strikes = [...new Set(chain.calls.map((/** @type {any} */ r) => r.strike))].sort((a, b) => a - b);
    const atm = strikes.reduce((best, k, i) => (Math.abs(k - spot) < Math.abs(strikes[best] - spot) ? i : best), 0);
    const w = Number(widthSel.value || 1);
    const tpl = TEMPLATES[sel.value];
    let far = null;
    const legs = [];
    for (const [right, off, sideName, ratio, isFar] of tpl.legs(() => 0)) {
      if (right === 'S') { legs.push({ symbol: underlying, side: sideName, ratio, label: `${ratio} shares ${underlying}` }); continue; }
      const k = strikes[Math.min(strikes.length - 1, Math.max(0, atm + /** @type {number} */ (off) * w))];
      let rows = right === 'C' ? chain.calls : chain.puts;
      if (isFar) {
        const nextExp = expiries[expiries.indexOf(expiry) + 1];
        if (!nextExp) throw new Error('A calendar needs a later expiration.');
        far = far || await api(`/api/market/options/${encodeURIComponent(underlying)}/chain?expiry=${encodeURIComponent(nextExp)}`);
        rows = right === 'C' ? far.calls : far.puts;
      }
      const row = rows.reduce((/** @type {any} */ best, /** @type {any} */ r) => (Math.abs(r.strike - k) < Math.abs(best.strike - k) ? r : best), rows[0]);
      legs.push({ symbol: row.symbol, side: sideName, ratio, label: occName(row.symbol), bid: row.bid, ask: row.ask });
    }
    return legs;
  }

  async function update() {
    const s = ++seq;
    const warn = $('[data-b-warnings]', dlg);
    warn?.replaceChildren();
    try {
      const legs = await contractsFor();
      $('[data-b-legs]', dlg)?.replaceChildren(...legs.map((l) => h('tr', null,
        h('td', null, `${l.side === 'buy' ? 'Buy' : 'Sell'}${l.ratio > 1 && l.ratio < 100 ? ` ${l.ratio}×` : ''}`),
        h('td', null, l.label), h('td', { class: 'is-num' }, l.bid === undefined ? '' : cents(l.bid)), h('td', { class: 'is-num' }, l.ask === undefined ? '' : cents(l.ask)))));
      const body = { strategy: TEMPLATES[sel.value].api, qty: Math.max(1, Math.floor(Number(qtyIn.value) || 1)), type: 'net_limit',
        legs: legs.map((l) => ({ symbol: l.symbol, side: l.side, ratio: l.ratio })) };
      const p = await api('/api/trading/orders/multileg/preview', { method: 'POST', body: JSON.stringify({ ...body, net_price: '0', price_effect: 'debit' }) });
      if (s !== seq) return;
      preview = p;
      lastBody = body;
      const key = JSON.stringify(body);
      if (key !== draftKey) { draftKey = key; clientId = crypto.randomUUID(); }   // same draft -> same id on retry
      setText($('[data-b-net]', dlg), `${usdFmt(p.net_mid)} ${p.price_effect}`);
      setText($('[data-b-maxp]', dlg), p.payoff.unlimited_profit ? 'Unlimited' : usdFmt(p.payoff.max_profit));
      setText($('[data-b-maxl]', dlg), p.payoff.unlimited_loss ? 'Unlimited' : usdFmt(p.payoff.max_loss));
      setText($('[data-b-be]', dlg), p.payoff.breakevens.map((/** @type {number} */ b) => price(b)).join(' / ') || '—');
      setText($('[data-b-req]', dlg), usdFmt(p.requirement));
      setText($('[data-b-effect]', dlg), p.price_effect);
      if (document.activeElement !== limitIn) limitIn.value = p.estimated_net;
      warn?.replaceChildren(...(p.warnings || []).map((/** @type {string} */ w) => h('li', null, w)));
      placeBtn.disabled = !p.can_place;
      await ready();
      payoff = payoff || new PayoffChart(/** @type {HTMLElement} */ ($('[data-payoff-chart]', dlg)));
      payoff.setData(p.payoff.points);
    } catch (err) {
      if (s !== seq) return;
      placeBtn.disabled = true;
      warn?.replaceChildren(h('li', null, /** @type {Error} */ (err).message));
    }
  }

  placeBtn.addEventListener('click', async () => {
    if (!lastBody || !preview) return;
    placeBtn.disabled = true;
    try {
      const o = await api('/api/trading/orders/multileg', { method: 'POST', body: JSON.stringify({
        ...lastBody, client_order_id: clientId, net_price: limitIn.value || preview.estimated_net,
        price_effect: preview.price_effect === 'even' ? 'debit' : preview.price_effect }) });
      dlg.close();
      draftKey = ''; clientId = crypto.randomUUID();
      toast(o.status === 'filled' ? `Strategy filled at ${usdFmt(o.avg_fill_price)} ${o.price_effect || ''}` : 'Strategy order placed (working)');
      onPlaced();
    } catch (err) {
      $('[data-b-warnings]', dlg)?.replaceChildren(h('li', null, /** @type {Error} */ (err).message));
    } finally {
      placeBtn.disabled = !preview?.can_place;
    }
  });
  for (const x of [sel, widthSel, qtyIn]) x.addEventListener('change', update);

  return {
    open() {
      widthSel.replaceChildren(...[1, 2, 3, 4, 5].map((n) => h('option', { value: n }, `${n} strike${n > 1 ? 's' : ''}`)));
      dlg.showModal();
      update();
    },
  };
}
