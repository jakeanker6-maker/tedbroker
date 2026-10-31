// @ts-check
/** Sparkline: <span class="spark" data-component="spark" data-series="walk:24,seed=3,drift=.4"></span>
 *  Colour follows trend automatically (data-trend set to up|down). */
import { parseSeries, smoothPath, svg } from '../lib/util.js';

export function init(el) {
  const data = parseSeries(el.dataset.series);
  if (data.length < 2) return;
  const W = 100, H = 28;
  const min = Math.min(...data), max = Math.max(...data);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * W, 2 + (1 - (v - min) / (max - min || 1)) * (H - 4)]);
  el.dataset.trend = data[data.length - 1] >= data[0] ? 'up' : 'down';
  el.setAttribute('aria-hidden', 'true');
  el.replaceChildren(svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', width: '100%', height: '100%' }, [
    svg('path', { d: smoothPath(pts), 'vector-effect': 'non-scaling-stroke' }),
  ]));
}
