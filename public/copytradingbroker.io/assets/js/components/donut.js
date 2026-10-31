// @ts-check
/**
 * Donut ring built from its legend (the legend is the accessible source of truth).
 * <div class="donut" data-component="donut">
 *   <div class="donut__ring" data-ring><div class="donut__center"><strong>100%</strong><span>Allocated</span></div></div>
 *   <ul class="legend"><li data-value="42" style="--c: var(--teal-300)">Forex <strong>42%</strong> <span class="num">$20,250</span></li>…</ul>
 * </div>
 */
import { onVisible, reducedMotion, svg } from '../lib/util.js';

export function init(el) {
  const ring = el.querySelector('[data-ring]');
  const items = [...el.querySelectorAll('.legend li[data-value]')];
  if (!ring || !items.length) return;
  const total = items.reduce((s, li) => s + Number(li.getAttribute('data-value')), 0) || 1;
  const R = 42, C = 2 * Math.PI * R, GAP = 1.6;
  let offset = 0;
  const segs = items.map((li, i) => {
    const frac = Number(li.getAttribute('data-value')) / total;
    const len = Math.max(0, frac * C - GAP);
    const color = getComputedStyle(li).getPropertyValue('--c').trim() || 'currentColor';
    const seg = svg('circle', {
      cx: 50, cy: 50, r: R, class: 'donut__seg', stroke: color,
      'stroke-dasharray': `${len} ${C - len}`,
      'stroke-dashoffset': reducedMotion() ? String(-offset) : String(C - offset),
      'data-final': String(-offset), 'data-i': String(i),
    });
    offset += frac * C;
    return seg;
  });
  const svgEl = svg('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' }, [svg('circle', { cx: 50, cy: 50, r: R, class: 'donut__track' }), ...segs]);
  ring.prepend(svgEl);

  onVisible(el, () => requestAnimationFrame(() => segs.forEach((s, i) => {
    s.style.transitionDelay = `${i * 120}ms`;
    s.setAttribute('stroke-dashoffset', s.getAttribute('data-final') || '0');
  })), 0.3);

  const focus = (i) => {
    if (i == null) { el.removeAttribute('data-focus'); segs.forEach((s) => s.removeAttribute('data-active')); return; }
    el.setAttribute('data-focus', '');
    segs.forEach((s, j) => s.toggleAttribute('data-active', j === i));
  };
  items.forEach((li, i) => {
    li.addEventListener('pointerenter', () => focus(i));
    li.addEventListener('pointerleave', () => focus(null));
  });
}
