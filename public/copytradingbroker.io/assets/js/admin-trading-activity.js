/*
 * Admin: "Trading Activity" tab. Read-only monitor of stocks, ETFs, options and crypto
 * bought and sold by users, served from GET /api/admin/trading/activity/*.
 * Views: Trades (summary, filters, paged table), Assets (holdings, asset detail with
 * price chart and trade markers), Traders (ranking, trader portfolio detail).
 * Server data is only ever written with textContent / createElement. Charts are hand-rolled SVG.
 */
(function () {
  'use strict';

  const API = '/api/admin/trading/activity';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const TRADES_PAGE = 50;
  const TRADERS_PAGE = 100;
  const CLASS_LABELS = { stock: 'Stock', etf: 'ETF', option: 'Option', crypto: 'Crypto' };
  const BUCKET_LABELS = { self: 'Self-directed', copy: 'Copy trading', basket: 'ETF basket', all: 'All' };
  const MANUAL_NOTE = 'Manual trades only. Automated trading (bots, copy trading, ETF baskets, recurring orders) is excluded.';
  const RANGE_LABELS = { '1D': 'today', '1W': 'the last week', '1M': 'the last month', '3M': 'the last 3 months', '1Y': 'the last year', ALL: 'all time' };

  const state = {
    opened: false,
    view: 'trades',
    range: '1M',
    assetClass: 'all',
    side: 'all',
    bucket: 'all',
    tradesPage: 0,
    tradesTotal: 0,
    assetsSort: 'market_value',
    tradersSort: 'equity',
    tradersOffset: 0,
    tradersTotal: 0,
    detail: null, // { kind: 'asset' | 'trader', id: string }
  };

  const seqs = {};
  function nextSeq(key) { seqs[key] = (seqs[key] || 0) + 1; return seqs[key]; }
  function isCurrent(key, n) { return seqs[key] === n; }

  const $ = (id) => document.getElementById(id);

  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'style') n.style.cssText = v;
      else if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children) if (c != null && c !== false) n.append(c instanceof Node ? c : String(c));
    return n;
  }

  function svgEl(tag, attrs, ...children) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, String(v));
    for (const c of children) if (c != null) n.append(c instanceof Node ? c : String(c));
    return n;
  }

  // ---------------------------------------------------------------- formatting

  const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usdSmallFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6 });
  const qtyFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
  const pctFmt = new Intl.NumberFormat('en-US', { signDisplay: 'exceptZero', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const intFmt = new Intl.NumberFormat('en-US');

  function num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function usd(v) {
    const n = num(v);
    if (n == null) return '—';
    return (Math.abs(n) > 0 && Math.abs(n) < 1 ? usdSmallFmt : usdFmt).format(n);
  }
  function qty(v) {
    const n = num(v);
    return n == null ? '—' : qtyFmt.format(n);
  }
  function int(v) {
    const n = num(v);
    return n == null ? '—' : intFmt.format(n);
  }
  function pct(v) {
    const n = num(v);
    return n == null ? '—' : `${pctFmt.format(n)}%`;
  }
  function signClass(v) {
    const n = num(v);
    if (n == null || n === 0) return '';
    return n > 0 ? 'ta-gain' : 'ta-loss';
  }
  // Epoch milliseconds from a unix-seconds number, unix-ms number, numeric string or ISO string.
  function toMs(t) {
    if (t == null || t === '') return NaN;
    if (typeof t === 'number') return t < 1e12 ? t * 1000 : t;
    const s = String(t).trim();
    if (/^\d+(\.\d+)?$/.test(s)) return toMs(Number(s));
    return Date.parse(s);
  }
  function when(t) {
    const ms = toMs(t);
    return Number.isFinite(ms) ? new Date(ms).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  }
  function whenShort(t, withTime) {
    const ms = toMs(t);
    if (!Number.isFinite(ms)) return '—';
    const d = new Date(ms);
    return withTime
      ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  // Text for any server field: a missing or empty value renders as "—", never "undefined".
  function txt(v) { return v == null || v === '' ? '—' : String(v); }
  function classLabel(c) { return CLASS_LABELS[c] || txt(c); }
  function bucketText(item) {
    return item.bucket_label || BUCKET_LABELS[item.bucket] || item.bucket || '—';
  }
  function sideText(direction) {
    if (direction === 'buy') return 'Buy';
    if (direction === 'sell') return 'Sell';
    return direction ? String(direction) : '—';
  }

  // ---------------------------------------------------------------- API + status helpers

  function errorMessage(data, res) {
    const d = data && data.detail;
    if (d && typeof d === 'object' && !Array.isArray(d) && d.message) return String(d.message);
    if (typeof d === 'string' && d) return d;
    return `Request failed (${res.status}).`;
  }

  async function api(path, params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params || {})) {
      if (v == null || v === '') continue;
      qs.append(k, String(v));
    }
    const query = qs.toString();
    const res = await adminFetch(`${API}${path}${query ? `?${query}` : ''}`);
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (!res.ok) throw serverError(errorMessage(data, res));
    if (data == null) throw serverError('The server returned an empty response.');
    return data;
  }

  // Errors that carry a message meant for the user (from the API). Anything else is shown generically.
  function serverError(message) {
    const e = new Error(message);
    e.fromServer = true;
    return e;
  }
  function userMessage(err) {
    return err && err.fromServer && err.message ? err.message : 'Could not load this data. Try again.';
  }

  // status: { node, state: 'loading' | 'error' | '' , text }
  function setStatus(node, kind, text) {
    if (!node) return;
    node.className = 'ta-status' + (kind === 'error' ? ' ta-status-error' : '');
    node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    node.textContent = text || '';
    node.hidden = !text;
  }

  function emptyNote(text) {
    return el('div', { class: 'ta-empty' }, text);
  }

  // Runs a request for `key`; ignores stale responses; clears the container on error.
  async function run(key, statusNode, container, loadingText, fetcher, render) {
    const n = nextSeq(key);
    setStatus(statusNode, 'loading', loadingText);
    try {
      const data = await fetcher();
      if (!isCurrent(key, n)) return;
      render(data);
      setStatus(statusNode, '', '');
    } catch (err) {
      if (!isCurrent(key, n)) return;
      if (container) container.replaceChildren();
      if (key === 'trades') resetTradesPager();
      setStatus(statusNode, 'error', userMessage(err));
    }
  }

  // ---------------------------------------------------------------- table builder

  // cols: [{ label, num }]; rows: [{ cells: [Node|string], onClick? }]
  function buildTable(caption, cols, rows, emptyText) {
    const thead = el('thead', null, el('tr', null,
      ...cols.map((c) => el('th', { scope: 'col', class: c.num ? 'ta-num' : null }, c.label))));
    const tbody = el('tbody');
    if (!rows.length) {
      tbody.append(el('tr', null, el('td', { colspan: cols.length, class: 'ta-muted' }, emptyText)));
    }
    for (const r of rows) {
      const tr = el('tr', { class: r.onClick ? 'ta-row-click' : null });
      r.cells.forEach((cell, i) => {
        tr.append(el('td', { class: cols[i] && cols[i].num ? 'ta-num' : null }, cell));
      });
      // Inner buttons carry no handler of their own, so their clicks bubble here once.
      if (r.onClick) tr.addEventListener('click', () => r.onClick());
      tbody.append(tr);
    }
    return el('div', { class: 'ta-table-wrap' },
      el('table', { class: 'ta-table' },
        el('caption', { class: 'ta-sr-only' }, caption),
        thead, tbody));
  }

  function linkButton(text, onClick, ariaLabel) {
    return el('button', { type: 'button', class: 'ta-btn-link', onclick: onClick, 'aria-label': ariaLabel || null }, text || '—');
  }

  function badge(kind, text) {
    return el('span', { class: `ta-badge ta-badge-${kind}` }, text);
  }

  function statCard(label, value, sub, cls) {
    return el('div', { class: 'ta-stat' },
      el('span', { class: 'ta-stat-label' }, label),
      el('span', { class: `ta-stat-value ${cls || ''}` }, value),
      sub ? el('span', { class: 'ta-stat-sub' }, sub) : null);
  }

  // ---------------------------------------------------------------- SVG line chart

  // points: [{ t: ms, v: number }], markers: [{ t: ms, v: number, direction, title }]
  function lineChart(opts) {
    const points = (opts.points || [])
      .map((p) => ({ t: toMs(p.t), v: num(p.v) }))
      .filter((p) => Number.isFinite(p.t) && p.v != null)
      .sort((a, b) => a.t - b.t);

    if (points.length === 0) {
      return el('div', { class: 'ta-chart-empty' }, opts.emptyText || 'No price history for this range yet.');
    }
    if (points.length === 1) {
      return el('div', { class: 'ta-chart-empty' },
        `Only one data point so far (${usd(points[0].v)}). A line appears once there is more history.`);
    }

    const W = 720;
    const H = 240;
    const pad = { l: 76, r: 16, t: 16, b: 30 };
    const innerW = W - pad.l - pad.r;
    const innerH = H - pad.t - pad.b;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;

    const markers = (opts.markers || [])
      .map((m) => ({ t: toMs(m.t), v: num(m.v), direction: m.direction, title: m.title }))
      .filter((m) => Number.isFinite(m.t) && m.v != null && m.t >= t0 && m.t <= t1);

    let minV = Math.min(...points.map((p) => p.v), ...markers.map((m) => m.v));
    let maxV = Math.max(...points.map((p) => p.v), ...markers.map((m) => m.v));
    if (maxV === minV) {
      const d = Math.abs(maxV) * 0.01 || 1;
      minV -= d;
      maxV += d;
    }

    const xOf = (t) => (t1 === t0 ? pad.l + innerW / 2 : pad.l + ((t - t0) / (t1 - t0)) * innerW);
    const yOf = (v) => pad.t + (1 - (v - minV) / (maxV - minV)) * innerH;

    const first = points[0].v;
    const last = points[points.length - 1].v;
    const change = last - first;
    const changePct = first !== 0 ? (change / first) * 100 : null;
    const label = opts.ariaName || 'Price';
    const aria = `${label}: first ${usd(first)}, last ${usd(last)}, ${change >= 0 ? 'up' : 'down'} ${usd(Math.abs(change))}`
      + (changePct == null ? '' : ` (${pct(changePct)})`) + ` over ${RANGE_LABELS[opts.range] || 'the range'}.`;

    const path = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.t).toFixed(2)} ${yOf(p.v).toFixed(2)}`)
      .join(' ');

    const svg = svgEl('svg', {
      class: 'ta-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': aria,
    });

    // Gridlines at the top and bottom of the scale, with min/max labels.
    svg.append(
      svgEl('line', { class: 'ta-chart-grid', x1: pad.l, x2: W - pad.r, y1: pad.t, y2: pad.t }),
      svgEl('line', { class: 'ta-chart-grid', x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b }),
      svgEl('text', { class: 'ta-chart-axis', x: pad.l - 8, y: pad.t, 'text-anchor': 'end', 'dominant-baseline': 'hanging' }, usd(maxV)),
      svgEl('text', { class: 'ta-chart-axis', x: pad.l - 8, y: H - pad.b, 'text-anchor': 'end', 'dominant-baseline': 'baseline' }, usd(minV)),
      svgEl('text', { class: 'ta-chart-axis', x: pad.l, y: H - 8, 'text-anchor': 'start' }, opts.formatTime(t0)),
      svgEl('text', { class: 'ta-chart-axis', x: W - pad.r, y: H - 8, 'text-anchor': 'end' }, opts.formatTime(t1)),
      svgEl('path', { class: 'ta-chart-line', d: path }),
    );

    const lastX = xOf(t1);
    const lastY = yOf(last);
    svg.append(svgEl('circle', { cx: lastX.toFixed(2), cy: lastY.toFixed(2), r: 4, fill: '#2b6cb0' }));

    for (const m of markers) {
      const x = xOf(m.t);
      const y = yOf(m.v);
      const isBuy = m.direction === 'buy';
      const shape = isBuy
        ? `${x.toFixed(2)},${(y - 8).toFixed(2)} ${(x - 6).toFixed(2)},${(y + 4).toFixed(2)} ${(x + 6).toFixed(2)},${(y + 4).toFixed(2)}`
        : `${x.toFixed(2)},${(y + 8).toFixed(2)} ${(x - 6).toFixed(2)},${(y - 4).toFixed(2)} ${(x + 6).toFixed(2)},${(y - 4).toFixed(2)}`;
      svg.append(svgEl('polygon', { class: isBuy ? 'ta-marker-buy' : 'ta-marker-sell', points: shape },
        svgEl('title', null, m.title || `${sideText(m.direction)} at ${usd(m.v)}`)));
    }

    const wrap = el('div', null, svg);
    if (opts.showTotals !== false && (changePct != null || change !== 0)) {
      wrap.prepend(el('p', { class: 'ta-totals' },
        `${opts.ariaName || 'Price'} ${change >= 0 ? '+' : '−'}${usd(Math.abs(change))}`
        + (changePct == null ? '' : ` (${pct(changePct)})`) + ` over ${RANGE_LABELS[opts.range] || 'the range'}`));
    }
    return wrap;
  }

  // ---------------------------------------------------------------- range/class/view controls

  function setPressed(attr, value) {
    document.querySelectorAll(`#tab-trading-activity [${attr}]`).forEach((b) => {
      b.setAttribute('aria-pressed', String(b.getAttribute(attr) === value));
    });
  }

  function showListView(view) {
    ['trades', 'assets', 'traders'].forEach((v) => {
      const sec = $(`ta-view-${v}`);
      if (sec) sec.hidden = v !== view;
    });
    const detail = $('ta-detail');
    if (detail) detail.hidden = true;
  }

  // ---------------------------------------------------------------- Trades view

  function loadSummary() {
    return run('summary', $('ta-summary-status'), $('ta-summary'), 'Loading summary…',
      () => api('/summary', { range: state.range, asset_class: state.assetClass }),
      renderSummary);
  }

  function renderSummary(d) {
    const box = $('ta-summary');
    const t = d.trades || {};
    const realized = num(t.realized_pnl);
    box.replaceChildren(
      statCard('Trades', int(t.count)),
      statCard('Buys / Sells', `${int(t.buys)} / ${int(t.sells)}`),
      statCard('Volume', usd(t.volume)),
      statCard('Fees', usd(t.fees)),
      statCard('Realized P&L', usd(t.realized_pnl), null, signClass(realized)),
      statCard('Active traders', int(d.active_traders)),
    );
  }

  function loadTrades() {
    const page = state.tradesPage;
    return run('trades', $('ta-trades-status'), $('ta-trades-table'), 'Loading trades…',
      () => api('/trades', {
        range: state.range,
        asset_class: state.assetClass,
        side: state.side,
        bucket: state.bucket,
        limit: TRADES_PAGE,
        offset: page * TRADES_PAGE,
      }),
      renderTrades);
  }

  function renderTrades(d) {
    const items = d.items || [];
    const total = num(d.total) || 0;
    state.tradesTotal = total;
    const offset = state.tradesPage * TRADES_PAGE;

    const rows = items.map((it) => ({
      cells: [
        when(it.ts),
        linkButton((it.user && it.user.email) || '—', () => openTrader(it.user && it.user.id)),
        linkButton(txt(it.symbol), () => openAsset(it.symbol), `Open ${txt(it.symbol)} asset detail`),
        classLabel(it.asset_class),
        badge(it.direction === 'buy' ? 'buy' : it.direction === 'sell' ? 'sell' : 'neutral', sideText(it.direction)),
        qty(it.qty),
        usd(it.price),
        usd(it.gross),
        usd(it.fee),
        el('span', { class: signClass(it.realized_pnl) }, it.realized_pnl == null ? '—' : usd(it.realized_pnl)),
        bucketText(it),
      ],
    }));

    const cols = [
      { label: 'Time' }, { label: 'Trader' }, { label: 'Symbol' }, { label: 'Class' }, { label: 'Side' },
      { label: 'Qty', num: true }, { label: 'Price', num: true }, { label: 'Gross', num: true },
      { label: 'Fee', num: true }, { label: 'Realized P&L', num: true }, { label: 'Bucket' },
    ];
    const emptyText = state.side !== 'all' || state.bucket !== 'all'
      ? 'No trades match these filters.' : `No trades in ${RANGE_LABELS[state.range] || 'this range'}.`;
    $('ta-trades-table').replaceChildren(buildTable('Trades', cols, rows, emptyText));

    const from = total === 0 ? 0 : offset + 1;
    const to = offset + items.length;
    $('ta-trades-count').textContent = total === 0 ? 'Showing 0 of 0' : `Showing ${from}–${to} of ${int(total)}`;
    $('ta-trades-prev').disabled = state.tradesPage === 0;
    $('ta-trades-next').disabled = offset + items.length >= total;
  }

  function resetTradesPager() {
    $('ta-trades-count').textContent = '—';
    $('ta-trades-prev').disabled = true;
    $('ta-trades-next').disabled = true;
  }

  // ---------------------------------------------------------------- Assets view

  function loadAssets() {
    return run('assets', $('ta-assets-status'), $('ta-assets-table'), 'Loading assets…',
      () => api('/holdings', { asset_class: state.assetClass, sort: state.assetsSort, limit: 100 }),
      renderAssets);
  }

  function renderAssets(d) {
    const items = d.items || [];
    const rows = items.map((h) => ({
      onClick: () => openAsset(h.symbol),
      cells: [
        el('div', null,
          el('button', { type: 'button', class: 'ta-btn-link', 'aria-label': `Open ${txt(h.symbol)} asset detail` }, txt(h.symbol)),
          h.name ? el('div', { class: 'ta-muted', style: 'font-size:12px;' }, h.name) : null),
        classLabel(h.asset_class),
        int(h.holders),
        qty(h.net_qty),
        usd(h.cost_basis),
        usd(h.market_value),
        el('span', { class: signClass(h.unrealized_pnl) },
          `${usd(h.unrealized_pnl)}${num(h.unrealized_pnl_percent) == null ? '' : ` (${pct(h.unrealized_pnl_percent)})`}`),
        el('span', { class: signClass(h.change_percent) }, pct(h.change_percent)),
      ],
    }));
    const cols = [
      { label: 'Symbol' }, { label: 'Class' }, { label: 'Holders', num: true }, { label: 'Net qty', num: true },
      { label: 'Cost basis', num: true }, { label: 'Market value', num: true }, { label: 'Unrealized P&L', num: true },
      { label: 'Change', num: true },
    ];
    $('ta-assets-table').replaceChildren(buildTable('Assets held by users', cols, rows,
      'No open positions in these assets.'));
  }

  // ---------------------------------------------------------------- Traders view

  function loadTraders(append) {
    const offset = append ? state.tradersOffset : 0;
    return run('traders', $('ta-traders-status'), append ? null : $('ta-traders-table'),
      append ? 'Loading more traders…' : 'Loading traders…',
      () => api('/traders', {
        range: state.range,
        asset_class: state.assetClass,
        sort: state.tradersSort,
        limit: TRADERS_PAGE,
        offset,
      }),
      (d) => renderTraders(d, append, offset));
  }

  function renderTraders(d, append, offset) {
    const items = d.items || [];
    const total = num(d.total) || 0;
    state.tradersTotal = total;
    state.tradersOffset = offset + items.length;

    const rows = items.map((t) => ({
      onClick: () => openTrader(t.user && t.user.id),
      cells: [
        el('div', null,
          el('button', { type: 'button', class: 'ta-btn-link' }, txt(t.user && t.user.email)),
          t.user && t.user.full_name ? el('div', { class: 'ta-muted', style: 'font-size:12px;' }, t.user.full_name) : null),
        int(t.open_positions),
        usd(t.positions_value),
        el('span', { class: signClass(t.unrealized_pnl) }, usd(t.unrealized_pnl)),
        el('span', { class: signClass(t.realized_pnl_range) }, usd(t.realized_pnl_range)),
        el('span', { class: signClass(t.realized_pnl) }, usd(t.realized_pnl)),
        int(t.trades),
        usd(t.volume),
        when(t.last_trade_at),
      ],
    }));
    const cols = [
      { label: 'Trader' }, { label: 'Open positions', num: true }, { label: 'Positions value', num: true },
      { label: 'Unrealized', num: true }, { label: 'Realized (range)', num: true }, { label: 'Realized (lifetime)', num: true },
      { label: 'Trades (range)', num: true }, { label: 'Volume (range)', num: true }, { label: 'Last trade' },
    ];
    const table = buildTable('Traders', cols, rows, 'No manual trading activity in this range.');
    const container = $('ta-traders-table');
    const existingBody = append ? container.querySelector('tbody') : null;
    if (existingBody && rows.length) {
      // Load more: append the new rows to the existing table body.
      table.querySelectorAll('tbody tr').forEach((tr) => existingBody.append(tr));
    } else {
      container.replaceChildren(table);
    }

    const more = $('ta-traders-more');
    more.hidden = state.tradersOffset >= total;
    $('ta-traders-count').textContent = `Showing ${int(state.tradersOffset)} of ${int(total)} traders`;
  }

  // ---------------------------------------------------------------- Asset detail

  function openAsset(symbol) {
    if (!symbol) return;
    state.detail = { kind: 'asset', id: symbol };
    showDetail();
    return loadDetail();
  }

  function loadAssetDetail(symbol, n) {
    return api(`/assets/${encodeURIComponent(symbol)}`, { range: state.range })
      .then((d) => { if (isCurrent('detail', n)) renderAssetDetail(d); });
  }

  function renderAssetDetail(d) {
    const body = $('ta-detail-body');
    const q = d.quote;
    const candles = d.candles && Array.isArray(d.candles.points) ? d.candles : null;
    const ts = d.trades_summary || {};
    const totals = d.totals || {};

    const priceBlock = el('div', { style: 'text-align:right;' },
      el('div', { class: 'ta-price' }, q ? usd(q.last) : '—'),
      el('div', { class: `ta-stat-sub ${signClass(q && q.change_percent)}`, style: 'font-size:14px; font-weight:600;' },
        q ? pct(q.change_percent) : 'No quote'),
      q && q.stale ? el('div', { class: 'ta-muted', style: 'font-size:12px;' }, 'Quote may be stale.') : null);

    const points = candles ? candles.points.map((p) => ({ t: p.t, v: p.c })) : [];
    const markers = (d.trade_markers || []).map((m) => ({
      t: m.t,
      v: m.price,
      direction: m.direction,
      title: `${sideText(m.direction)} ${qty(m.qty)} at ${usd(m.price)}${m.user_email ? ` by ${m.user_email}` : ''}`,
    }));
    const chartBody = candles
      ? lineChart({ points, markers, ariaName: 'Price', range: state.range, formatTime: (ms) => whenShort(ms, state.range === '1D') })
      : el('div', { class: 'ta-chart-empty' }, d.candles_unavailable_reason || 'Price history is unavailable for this asset.');

    const holders = (d.holders || []).map((h) => ({
      cells: [
        linkButton((h.user && h.user.email) || '—', () => openTrader(h.user && h.user.id)),
        h.bucket_label || BUCKET_LABELS[h.bucket] || h.bucket || '—',
        qty(h.qty),
        usd(h.avg_cost),
        usd(h.mark),
        usd(h.market_value),
        el('span', { class: signClass(h.unrealized_pnl) },
          `${usd(h.unrealized_pnl)}${num(h.unrealized_pnl_percent) == null ? '' : ` (${pct(h.unrealized_pnl_percent)})`}`),
        el('span', { class: signClass(h.realized_pnl) }, usd(h.realized_pnl)),
        whenShort(h.opened_at, false),
      ],
    }));
    const holdersCols = [
      { label: 'Trader' }, { label: 'Bucket' }, { label: 'Qty', num: true }, { label: 'Avg cost', num: true },
      { label: 'Mark', num: true }, { label: 'Market value', num: true }, { label: 'Unrealized', num: true },
      { label: 'Realized', num: true }, { label: 'Opened' },
    ];

    body.replaceChildren(
      el('div', { class: 'ta-detail-head' },
        el('div', null,
          el('h2', { class: 'ta-detail-title', id: 'ta-detail-heading', tabindex: '-1' }, d.symbol || '—'),
          el('p', { class: 'ta-detail-meta' }, [d.name, classLabel(d.asset_class)].filter(Boolean).join(' · '))),
        priceBlock),
      el('section', { class: 'ta-card', 'aria-labelledby': 'ta-asset-chart-title' },
        el('div', { class: 'ta-card-head' },
          el('h3', { id: 'ta-asset-chart-title' }, 'Price'),
          candles && candles.source ?         el('span', { class: 'ta-muted', style: 'font-size:12px;' }, `Source: ${txt(candles.source)}`) : null),
        chartBody,
        el('p', { class: 'ta-totals' }, 'Buy markers ▲ green, sell markers ▼ red, at the trade price and time.')),
      el('section', { class: 'ta-card', 'aria-labelledby': 'ta-asset-trades-title' },
        el('h3', { id: 'ta-asset-trades-title' }, `Trades in ${RANGE_LABELS[state.range] || 'range'}`),
        el('div', { class: 'ta-stats' },
          statCard('Trades', int(ts.count)),
          statCard('Buys / Sells', `${int(ts.buys)} / ${int(ts.sells)}`),
          statCard('Buy volume', usd(ts.buy_volume)),
          statCard('Sell volume', usd(ts.sell_volume)),
          statCard('Fees', usd(ts.fees)),
          statCard('Realized P&L', usd(ts.realized_pnl), null, signClass(ts.realized_pnl)))),
      el('section', { class: 'ta-card', 'aria-labelledby': 'ta-asset-holders-title' },
        el('h3', { id: 'ta-asset-holders-title' }, 'Holders'),
        buildTable('Holders of this asset', holdersCols, holders, 'No trader holds this asset.'),
        el('p', { class: 'ta-totals' },
          `Totals: ${int(totals.holders)} holders · market value ${usd(totals.market_value)} · `
          + `unrealized ${usd(totals.unrealized_pnl)} · realized ${usd(totals.realized_pnl)}`)),
    );
  }

  // ---------------------------------------------------------------- Trader portfolio

  function openTrader(userId) {
    if (!userId) return;
    state.detail = { kind: 'trader', id: userId };
    showDetail();
    return loadDetail();
  }

  function loadTraderDetail(userId, n) {
    return api(`/traders/${encodeURIComponent(userId)}/portfolio`, { range: state.range })
      .then((d) => { if (isCurrent('detail', n)) renderTraderDetail(d); });
  }

  // Manual positions value over time. Only recorded snapshots are plotted, never a fake line.
  function buildHistoryCard(hist) {
    const range = state.range;
    const points = (Array.isArray(hist.points) ? hist.points : [])
      .map((p) => ({ t: p.t, v: p.value }))
      .filter((p) => num(p.v) != null && Number.isFinite(toMs(p.t)));
    let body;
    if (points.length === 0) {
      body = emptyNote('Manual value history starts with the first snapshot; nothing recorded yet for this range.');
    } else if (points.length === 1) {
      body = el('div', { class: 'ta-chart-empty' },
        `Current value ${usd(points[0].v)}. Manual value history is not yet available for this range.`);
    } else {
      body = lineChart({
        points, markers: [], ariaName: 'Manual positions value', range, showTotals: false,
        formatTime: (ms) => whenShort(ms, range === '1D'),
      });
    }
    const changeNum = num(hist.change);
    const changePctNum = num(hist.change_percent);
    const changeText = changeNum == null ? '—' : `${changeNum >= 0 ? '+' : '−'}${usd(Math.abs(changeNum))}`;
    return el('section', { class: 'ta-card', 'aria-labelledby': 'ta-trader-chart-title' },
      el('div', { class: 'ta-card-head' },
        el('h3', { id: 'ta-trader-chart-title' }, 'Manual positions value'),
        el('span', { class: 'ta-muted', style: 'font-size:12px;' }, 'Manual trades only')),
      body,
      el('p', { class: 'ta-totals' },
        `Change ${changeText} · ${changePctNum == null ? '—' : pct(changePctNum)} over ${RANGE_LABELS[range] || 'the range'}`));
  }

  function renderTraderDetail(d) {
    const body = $('ta-detail-body');
    const s = d.summary || {};
    const user = d.user || {};

    // Allocation is manual positions by asset class: value and an unsigned share of the total.
    const allocation = (d.allocation || []).map((a) => {
      const share = num(a.percent);
      const p = share == null ? 0 : Math.max(0, Math.min(100, share));
      return el('li', { class: 'ta-alloc-row' },
        el('span', null, classLabel(a.asset_class)),
        el('span', { class: 'ta-alloc-bar', role: 'presentation' },
          el('span', { class: 'ta-alloc-fill', style: `width:${p.toFixed(2)}%` })),
        el('span', { style: 'text-align:right; font-variant-numeric:tabular-nums;' },
          `${usd(a.value)} · ${share == null ? '—' : `${share.toFixed(2)}%`}`));
    });

    const positions = (d.positions || []).map((p) => ({
      cells: [
        p.symbol || '—',
        p.bucket_label || BUCKET_LABELS[p.bucket] || p.bucket || '—',
        classLabel(p.asset_class),
        qty(p.qty),
        usd(p.avg_cost),
        p.priced === false ? '—' : usd(p.mark),
        usd(p.market_value),
        el('span', { class: signClass(p.unrealized_pnl) },
          `${usd(p.unrealized_pnl)}${num(p.unrealized_pnl_percent) == null ? '' : ` (${pct(p.unrealized_pnl_percent)})`}`),
        el('span', { class: signClass(p.realized_pnl) }, usd(p.realized_pnl)),
      ],
    }));
    const posCols = [
      { label: 'Symbol' }, { label: 'Bucket' }, { label: 'Class' }, { label: 'Qty', num: true },
      { label: 'Avg cost', num: true }, { label: 'Mark', num: true }, { label: 'Market value', num: true },
      { label: 'Unrealized', num: true }, { label: 'Realized', num: true },
    ];

    const trades = (d.trades && d.trades.items ? d.trades.items : d.trades || []);
    const tradeItems = Array.isArray(trades) ? trades : [];
    const tradeList = tradeItems.length
      ? el('ul', { class: 'ta-trade-list' }, ...tradeItems.map((t) => el('li', null,
        badge(t.direction === 'buy' ? 'buy' : t.direction === 'sell' ? 'sell' : 'neutral', sideText(t.direction)),
        el('span', null,
          el('strong', null, t.symbol || '—'), ` · ${qty(t.qty)} @ ${usd(t.price)}`,
          el('span', { class: 'ta-trade-meta', style: 'display:block;' }, `${when(t.ts)} · ${bucketText(t)}`)),
        el('span', { class: signClass(t.realized_pnl), style: 'text-align:right; font-variant-numeric:tabular-nums;' },
          t.realized_pnl == null ? '—' : usd(t.realized_pnl)))))
      : emptyNote(`No trades in ${RANGE_LABELS[state.range] || 'this range'}.`);

    const historyCard = buildHistoryCard(d.history || {});
    body.replaceChildren(
      el('div', { class: 'ta-detail-head' },
        el('div', null,
          el('h2', { class: 'ta-detail-title', id: 'ta-detail-heading', tabindex: '-1' }, txt(user.email)),
          el('p', { class: 'ta-detail-meta' }, user.full_name || ''))),
      el('p', { class: 'ta-scope-note' }, MANUAL_NOTE),
      el('div', { class: 'ta-stats' },
        statCard('Positions value', usd(s.positions_value)),
        statCard('Unrealized P&L', usd(s.unrealized_pnl), null, signClass(s.unrealized_pnl)),
        statCard('Realized (lifetime)', usd(s.realized_pnl_lifetime), null, signClass(s.realized_pnl_lifetime)),
        statCard('Realized (range)', usd(s.realized_pnl_range), null, signClass(s.realized_pnl_range)),
        statCard('Trades (range)', int(s.trades_range)),
        statCard('Volume (range)', usd(s.volume_range))),
      historyCard,
      el('div', { class: 'ta-two-col' },
        el('section', { class: 'ta-card', 'aria-labelledby': 'ta-trader-alloc-title' },
          el('h3', { id: 'ta-trader-alloc-title' }, 'Allocation'),
          allocation.length ? el('ul', { class: 'ta-alloc' }, ...allocation) : emptyNote('No manual positions to allocate.')),
        el('section', { class: 'ta-card', 'aria-labelledby': 'ta-trader-trades-title' },
          el('h3', { id: 'ta-trader-trades-title' }, `Trades in ${RANGE_LABELS[state.range] || 'range'}`),
          tradeList)),
      el('section', { class: 'ta-card', 'aria-labelledby': 'ta-trader-pos-title' },
        el('h3', { id: 'ta-trader-pos-title' }, 'Open positions'),
        buildTable('Open positions', posCols, positions, 'No manual open positions.')),
    );
  }

  // ---------------------------------------------------------------- detail panel

  function showDetail() {
    ['trades', 'assets', 'traders'].forEach((v) => {
      const sec = $(`ta-view-${v}`);
      if (sec) sec.hidden = true;
    });
    $('ta-detail').hidden = false;
    $('ta-detail-body').replaceChildren();
    setStatus($('ta-detail-status'), '', '');
  }

  function loadDetail() {
    const d = state.detail;
    if (!d) return Promise.resolve();
    const n = nextSeq('detail');
    const statusNode = $('ta-detail-status');
    setStatus(statusNode, 'loading', d.kind === 'asset' ? `Loading ${d.id}…` : 'Loading trader portfolio…');
    const work = d.kind === 'asset' ? loadAssetDetail(d.id, n) : loadTraderDetail(d.id, n);
    return work
      .then(() => { if (isCurrent('detail', n)) setStatus(statusNode, '', ''); })
      .catch((err) => {
        if (!isCurrent('detail', n)) return;
        $('ta-detail-body').replaceChildren();
        setStatus(statusNode, 'error', userMessage(err));
      })
      .then(() => {
        const h = $('ta-detail-heading');
        if (h && isCurrent('detail', n) && $('ta-detail-body').contains(h)) h.focus({ preventScroll: false });
      });
  }

  function closeDetail() {
    nextSeq('detail'); // invalidate any in-flight detail request
    state.detail = null;
    $('ta-detail-body').replaceChildren();
    setStatus($('ta-detail-status'), '', '');
    showView(state.view);
  }

  // ---------------------------------------------------------------- orchestration

  function loadCurrent() {
    if (state.view === 'trades') return Promise.all([loadSummary(), loadTrades()]);
    if (state.view === 'assets') return loadAssets();
    if (state.view === 'traders') return loadTraders(false);
    return Promise.resolve();
  }

  function showView(view) {
    state.view = view;
    setPressed('data-ta-view', view);
    showListView(view);
    loadCurrent();
  }

  function refresh() {
    if (state.detail) return loadDetail();
    return loadCurrent();
  }

  function bindControls() {
    const root = $('tab-trading-activity');
    if (!root || root.dataset.taBound === '1') return;
    root.dataset.taBound = '1';

    root.querySelectorAll('[data-ta-range]').forEach((b) => b.addEventListener('click', () => {
      const r = b.getAttribute('data-ta-range');
      if (r === state.range) return;
      state.range = r;
      state.tradesPage = 0;
      state.tradersOffset = 0;
      setPressed('data-ta-range', r);
      if (state.detail) loadDetail(); else loadCurrent();
    }));

    root.querySelectorAll('[data-ta-class]').forEach((b) => b.addEventListener('click', () => {
      const c = b.getAttribute('data-ta-class');
      if (c === state.assetClass) return;
      state.assetClass = c;
      state.tradesPage = 0;
      state.tradersOffset = 0;
      setPressed('data-ta-class', c);
      if (!state.detail) loadCurrent();
    }));

    root.querySelectorAll('[data-ta-view]').forEach((b) => b.addEventListener('click', () => {
      // Switching views always leaves any open detail panel and reloads the chosen view.
      state.detail = null;
      nextSeq('detail');
      $('ta-detail-body').replaceChildren();
      setStatus($('ta-detail-status'), '', '');
      state.tradersOffset = 0;
      showView(b.getAttribute('data-ta-view'));
    }));

    $('ta-side').addEventListener('change', (e) => {
      state.side = e.target.value;
      state.tradesPage = 0;
      loadTrades();
    });
    $('ta-bucket').addEventListener('change', (e) => {
      state.bucket = e.target.value;
      state.tradesPage = 0;
      loadTrades();
    });
    $('ta-trades-prev').addEventListener('click', () => {
      if (state.tradesPage === 0) return;
      state.tradesPage -= 1;
      loadTrades();
    });
    $('ta-trades-next').addEventListener('click', () => {
      if ((state.tradesPage + 1) * TRADES_PAGE >= state.tradesTotal) return;
      state.tradesPage += 1;
      loadTrades();
    });

    $('ta-assets-sort').addEventListener('change', (e) => {
      state.assetsSort = e.target.value;
      loadAssets();
    });
    $('ta-traders-sort').addEventListener('change', (e) => {
      state.tradersSort = e.target.value;
      state.tradersOffset = 0;
      loadTraders(false);
    });
    $('ta-traders-more').addEventListener('click', () => loadTraders(true));

    $('ta-back').addEventListener('click', closeDetail);
    $('ta-refresh').addEventListener('click', refresh);

    setPressed('data-ta-range', state.range);
    setPressed('data-ta-class', state.assetClass);
    setPressed('data-ta-view', state.view);
  }

  // Public API: called by admin-dashboard.js switchTab('trading-activity').
  function open() {
    if (!$('tab-trading-activity')) return;
    bindControls();
    if (state.opened) return;
    state.opened = true;
    showListView(state.view);
    loadCurrent();
  }

  window.tradingActivity = { open };
})();
