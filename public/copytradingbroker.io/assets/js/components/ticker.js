// @ts-check
/** Seamless ticker: duplicates the list (hidden from AT) so the CSS -50% loop is continuous,
 *  and nudges prices every few seconds so the band feels live. */
import { reducedMotion } from '../lib/util.js';

export function init(el) {
  const track = el.querySelector('.ticker__track');
  const list = el.querySelector('.ticker__list');
  if (!track || !list) return;
  const clone = /** @type {HTMLElement} */ (list.cloneNode(true));
  clone.setAttribute('aria-hidden', 'true');
  clone.querySelectorAll('a, button').forEach((n) => n.setAttribute('tabindex', '-1'));
  track.append(clone);
  if (reducedMotion()) return;

  const lang = document.documentElement.lang || 'en';
  setInterval(() => {
    const items = list.querySelectorAll('.ticker__item');
    const idx = Math.floor(Math.random() * items.length);
    for (const l of [list, clone]) {
      const item = l.querySelectorAll('.ticker__item')[idx];
      const px = item?.querySelector('.ticker__px');
      const dl = item?.querySelector('.delta');
      if (!px || !dl) continue;
      const raw = Number((px.textContent || '').replace(/,/g, ''));
      if (!raw) continue;
      const decimals = ((px.textContent || '').split('.')[1] || '').length;
      const pct = Number((dl.textContent || '0').replace(/[^\d.-]/g, '')) * (dl.getAttribute('data-trend') === 'down' ? -1 : 1);
      const move = (Math.random() - 0.48) * 0.0012;
      const next = raw * (1 + move);
      const nextPct = pct + move * 100;
      px.textContent = next.toLocaleString(lang, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      dl.setAttribute('data-trend', nextPct >= 0 ? 'up' : 'down');
      dl.textContent = `${nextPct >= 0 ? '+' : '−'}${Math.abs(nextPct).toFixed(2)}%`;
    }
  }, 2200);
}
