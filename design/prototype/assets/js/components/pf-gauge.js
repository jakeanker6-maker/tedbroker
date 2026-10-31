// @ts-check
/**
 * Semicircle risk gauge. The visible text next to it is the accessible source of truth;
 * the SVG is decorative.
 *
 * <div class="pf-gauge" data-component="pf-gauge" data-value="5.2" data-max="10" data-level="med">
 *   <div class="pf-gauge__dial" data-gauge><span class="pf-gauge__value">5.2</span></div>
 *   …text…
 * </div>
 * Animates arc + needle from 0 on first view; renders the final state under reduced motion.
 */
import { onVisible, reducedMotion, svg } from '../lib/util.js';

const ARC = 'M10 60 A50 50 0 0 1 110 60';

export function init(el) {
  const value = Number(el.dataset.value || 0);
  const max = Number(el.dataset.max || 10) || 10;
  const target = Math.min(1, Math.max(0, value / max));
  const host = el.querySelector('[data-gauge]') || el;

  const ticks = [];
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (1 - i / 10);
    const r1 = 40, r2 = i % 5 ? 37 : 34;
    ticks.push(svg('line', {
      x1: (60 + Math.cos(a) * r1).toFixed(2), y1: (60 - Math.sin(a) * r1).toFixed(2),
      x2: (60 + Math.cos(a) * r2).toFixed(2), y2: (60 - Math.sin(a) * r2).toFixed(2),
      class: 'pf-gauge__tick',
    }));
  }
  const arc = svg('path', { d: ARC, pathLength: 100, class: 'pf-gauge__arc', 'stroke-dasharray': '0 100' });
  const needle = svg('g', { class: 'pf-gauge__needle', transform: 'rotate(-90 60 60)' }, [
    svg('line', { x1: 60, y1: 60, x2: 60, y2: 22 }),
    svg('circle', { cx: 60, cy: 60, r: 3.5 }),
  ]);
  const root = svg('svg', { viewBox: '0 0 120 66', 'aria-hidden': 'true', focusable: 'false' }, [
    svg('path', { d: ARC, class: 'pf-gauge__track' }),
    arc,
    ...ticks,
    needle,
  ]);
  host.prepend(root);

  const set = (q) => {
    arc.setAttribute('stroke-dasharray', `${(q * 100).toFixed(2)} 100`);
    needle.setAttribute('transform', `rotate(${(-90 + 180 * q).toFixed(2)} 60 60)`);
  };

  if (reducedMotion()) { set(target); return; }
  set(0);
  onVisible(el, () => {
    const t0 = performance.now(), dur = 1200;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      set(target * (1 - Math.pow(1 - p, 4)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, 0.4);
}
