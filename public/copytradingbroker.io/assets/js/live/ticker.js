// @ts-check
/**
 * Market ticker tape. Prices come from /api/market/ticker (Finnhub + ECB reference rates).
 * The tape keeps its existing markup and scrolling loop; only the item values are live.
 */
import { api, esc } from './api.js';

const REFRESH_MS = 60000;
const RETRY_MS = 8000;
const MAX_ATTEMPTS = 6;
const DEMO = new URLSearchParams(location.search).has('demo');
const tapes = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('[data-market-tape]')]);

/** @param {string} symbol */
const decimalsFor = (symbol) => (/EUR|GBP/.test(symbol) ? 4 : 2);

/** @param {number|null} value @param {string} symbol */
function formatPrice(value, symbol) {
  if (value == null) return '—';
  const d = decimalsFor(symbol);
  return value.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** @param {number|null} pct */
function formatChange(pct) {
  if (pct == null) return { text: '—', trend: '' };
  const up = pct >= 0;
  return { text: `${up ? '+' : '−'}${Math.abs(pct).toFixed(2)}%`, trend: up ? 'up' : 'down' };
}

/**
 * @param {Array<{symbol: string, price: number|null, change_percent: number|null, source: string}>} items
 */
function itemsHtml(items) {
  return items.map((it) => {
    const ch = formatChange(it.change_percent);
    return `<li class="ticker__item" data-price title="${esc(it.source)}"><span class="ticker__sym">${esc(it.symbol)}</span><span class="ticker__px">${esc(formatPrice(it.price, it.symbol))}</span><span class="delta"${ch.trend ? ` data-trend="${ch.trend}"` : ''}>${esc(ch.text)}</span></li>`;
  }).join('');
}

/** @param {HTMLElement} tape @param {string} html */
function paint(tape, html) {
  const list = tape.querySelector('.ticker__list');
  if (!(list instanceof HTMLElement)) return;
  list.innerHTML = html;
  const clone = /** @type {HTMLElement} */ (list.cloneNode(true));
  clone.setAttribute('aria-hidden', 'true');
  clone.querySelectorAll('a, button').forEach((n) => n.setAttribute('tabindex', '-1'));
  tape.querySelector('.ticker__track')?.querySelector('[aria-hidden="true"]')?.remove();
  tape.querySelector('.ticker__track')?.append(clone);
}

/** Make sure the scrolling loop is running after the tape has content. */
function startLoop(tape) {
  const track = tape.querySelector('.ticker__track');
  if (!(track instanceof HTMLElement)) return;
  for (const a of track.getAnimations?.() || []) {
    if (a.playState !== 'running') a.play();
  }
}

let attempts = 0;
let timer = 0;

function schedule(ms) {
  clearTimeout(timer);
  timer = window.setTimeout(refresh, ms);
}

/**
 * Prices are rendered only when every item has a price. A partial response is retried rather
 * than showing dashes; the previous complete values stay on screen if a later refresh is partial.
 */
async function refresh() {
  try {
    const data = await api('/api/market/ticker');
    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length || items.some((it) => it.price == null)) throw new Error('Prices incomplete');
    const html = itemsHtml(items);
    for (const tape of tapes) {
      paint(tape, html);
      tape.dataset.updated = data?.updated_at || '';
      tape.removeAttribute('aria-busy');
      startLoop(tape);
    }
    attempts = 0;
    schedule(REFRESH_MS);
  } catch (err) {
    console.warn('[ticker]', err);
    attempts += 1;
    if (attempts < MAX_ATTEMPTS) {
      schedule(RETRY_MS);
      return;
    }
    for (const tape of tapes) {
      if (tape.querySelector('.ticker__item[data-price]')) continue;   // keep the last complete values
      paint(tape, '<li class="ticker__item"><span class="ticker__sym">Prices unavailable</span></li>');
      tape.setAttribute('aria-busy', 'false');
    }
    attempts = 0;
    schedule(REFRESH_MS);
  }
}

if (tapes.length) {
  if (DEMO && !localStorage.getItem('ted_access_token')) {
    for (const tape of tapes) paint(tape, '<li class="ticker__item"><span class="ticker__sym">Live prices require sign-in</span></li>');
  } else {
    refresh();
  }
}
