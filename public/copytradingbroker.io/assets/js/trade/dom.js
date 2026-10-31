// @ts-check
/** DOM + formatting helpers for the Trading Hub. Server data is only ever set as text. */

export const $ = (/** @type {string} */ s, /** @type {ParentNode} */ root = document) => /** @type {HTMLElement|null} */ (root.querySelector(s));
export const $$ = (/** @type {string} */ s, /** @type {ParentNode} */ root = document) => /** @type {HTMLElement[]} */ ([...root.querySelectorAll(s)]);

/**
 * Element builder: h('td', {class: 'is-num', dataset: {sym: 'AAPL'}}, 'text', childEl)
 * @param {string} tag
 * @param {Record<string, any>|null} [attrs]
 * @param {...(Node|string|number|null|undefined|false)} children
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'text') el.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

/** @param {HTMLElement|null} el @param {unknown} text */
export function setText(el, text) {
  if (el) el.textContent = text == null || text === '' ? '—' : String(text);
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Price formatting: 2 dp above $1, more precision for sub-dollar prices. @param {unknown} v */
export function price(v) {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return '—';
  const dp = Math.abs(n) >= 1 ? 2 : Math.abs(n) >= 0.01 ? 4 : 6;
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
/** @param {unknown} v */
export const usdFmt = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? '—' : usd.format(Number(v)));
/** Signed money with arrow, e.g. "▲ +$12.40". @param {unknown} v */
export function signedUsd(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || v === null || v === undefined) return '—';
  const arrow = n > 0 ? '▲ ' : n < 0 ? '▼ ' : '';
  return `${arrow}${n > 0 ? '+' : n < 0 ? '−' : ''}${usd.format(Math.abs(n))}`;
}
/** @param {unknown} v */
export function signedPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || v === null || v === undefined) return '';
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`;
}
/** @param {unknown} v */
export const tone = (v) => (Number(v) > 0 ? 'gain' : Number(v) < 0 ? 'loss' : '');
/** Quantity: drop trailing zeros. @param {unknown} v */
export function qty(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 8 });
}
const dtFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
/** @param {unknown} v */
export function dateTime(v) {
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? '—' : `${dtFmt.format(d)} ET`;
}

/** Friendly option name from an OCC symbol ("AAPL  261218C00200000"). @param {string} s */
export function occName(s) {
  const m = /^([A-Z.]{1,6})\s*(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(String(s).trim());
  if (!m) return s;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const strike = Number(m[6]) / 1000;
  return `${m[1]} ${months[Number(m[3]) - 1]} ${Number(m[4])} '${m[2]} $${strike} ${m[5] === 'C' ? 'Call' : 'Put'}`;
}
export const isOcc = (/** @type {string} */ s) => /^[A-Z.]{1,6}\s*\d{6}[CP]\d{8}$/.test(String(s).trim());

/** Human labels for order sides and types. */
export const SIDE_LABEL = /** @type {Record<string,string>} */ ({
  buy: 'Buy', sell: 'Sell', sell_short: 'Sell short', buy_to_cover: 'Buy to cover',
  buy_to_open: 'Buy to open', sell_to_open: 'Sell to open', buy_to_close: 'Buy to close', sell_to_close: 'Sell to close',
});
export const TYPE_LABEL = /** @type {Record<string,string>} */ ({
  market: 'Market', limit: 'Limit', stop: 'Stop', stop_limit: 'Stop limit', trailing_stop: 'Trailing stop',
  net_limit: 'Net limit', exercise: 'Exercise', expiration: 'Expiration', assignment: 'Assignment',
});

/** Debounce. @template {(...a: any[]) => void} F @param {F} fn @param {number} ms */
export function debounce(fn, ms) {
  /** @type {any} */ let t;
  return /** @type {F} */ ((...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); });
}
