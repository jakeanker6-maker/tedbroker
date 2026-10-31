// @ts-check
/**
 * Cycling feed of copied trades on the sign-in visual (illustrative, mock data).
 * <ul class="auth-feed" data-component="auth-feed" aria-live="off" role="list">
 *   <li class="auth-feed__row"><span class="auth-feed__what"><b>Elena V.</b> bought EUR/USD 1.0842</span><span class="auth-feed__meta">copied by 214</span></li>
 * </ul>
 * Every ~3s the first row is removed and a new one is appended from the pool.
 * Static under reduced motion; pauses while the tab is hidden.
 */
import { reducedMotion } from '../lib/util.js';

const POOL = [
  'Elena V. bought EUR/USD 1.0842 · copied by 214',
  'Marcus C. closed BTC/USD ▲ +3.1% · copied by 1,419',
  'Aisha R. bought AAPL 228.14 · copied by 932',
  'Jonas W. sold GBP/USD 1.2711 · copied by 388',
  'Priya N. bought XAU/USD 2,384.10 · copied by 651',
  'Marcus C. bought ETH/USD 3,540.80 · copied by 1,207',
  'Elena V. closed EUR/USD ▲ +0.6% · copied by 214',
  'Aisha R. closed TSLA ▼ −1.2% · copied by 540',
];

/** Build a row from "Name I. action · meta" using text nodes only. @param {string} line */
function row(line) {
  const [main, meta = ''] = line.split(' · ');
  const words = main.split(' ');
  const li = document.createElement('li');
  li.className = 'auth-feed__row';
  const what = document.createElement('span');
  what.className = 'auth-feed__what';
  const who = document.createElement('b');
  who.textContent = words.slice(0, 2).join(' ');
  const rest = words.slice(2).join(' ');
  what.append(who, ' ');
  const m = rest.match(/^(.*?)([▲▼])\s*(.+)$/);
  if (m) {
    const delta = document.createElement('span');
    delta.className = m[2] === '▲' ? 'gain' : 'loss';
    delta.textContent = `${m[2]} ${m[3]}`;
    what.append(m[1], delta);
  } else {
    what.append(rest);
  }
  const by = document.createElement('span');
  by.className = 'auth-feed__meta';
  by.textContent = meta;
  li.append(what, by);
  return li;
}

/** @param {HTMLElement} list */
export function init(list) {
  if (reducedMotion()) return;
  let i = list.children.length % POOL.length;
  const timer = setInterval(() => {
    if (document.hidden) return;
    list.firstElementChild?.remove();
    const li = row(POOL[i]);
    li.classList.add('is-new');
    list.append(li);
    i = (i + 1) % POOL.length;
  }, 3000);
  return () => clearInterval(timer);
}
