// @ts-check
/**
 * Area / line chart with glow, draw-in animation, crosshair tooltip and keyboard scrubbing.
 *
 * <div class="chart" data-component="chart"
 *      data-series="walk:60,seed=4,drift=.5,start=40100,end=48216"   (or "1,2,3")
 *      data-compare="walk:60,seed=9,start=40100,end=44960"            (optional dashed series)
 *      data-band-low="…" data-band-high="…"                           (optional range band)
 *      data-format="currency" data-decimals="2"
 *      data-start="2026-09-27" data-step="1"                          (x labels: days)
 *      data-labels="Jan,Feb,…"                                        (or explicit x labels)
 *      data-yaxis="4" data-xaxis="5" data-dots data-series-name="Portfolio" data-compare-name="S&P 500"
 *      aria-label="Portfolio value, last 30 days"></div>
 *
 * Events: dispatch `chart:update` with detail {series, compare, bandLow, bandHigh} to re-render.
 */
import { format, nextId, onVisible, parseSeries, reducedMotion, smoothPath, svg } from '../lib/util.js';

export function init(el) {
  const state = {
    series: parseSeries(el.dataset.series),
    compare: parseSeries(el.dataset.compare),
    bandLow: parseSeries(el.dataset.bandLow),
    bandHigh: parseSeries(el.dataset.bandHigh),
    drawn: false,
  };
  el.setAttribute('role', 'img');
  if (!el.hasAttribute('tabindex')) el.tabIndex = 0;

  const draw = () => render(el, state);
  new ResizeObserver(() => draw()).observe(el);

  el.addEventListener('chart:update', (/** @type {CustomEvent} */ e) => {
    const d = e.detail || {};
    if (d.series) state.series = typeof d.series === 'string' ? parseSeries(d.series) : d.series;
    if (d.compare !== undefined) state.compare = typeof d.compare === 'string' ? parseSeries(d.compare) : d.compare;
    if (d.bandLow !== undefined) state.bandLow = typeof d.bandLow === 'string' ? parseSeries(d.bandLow) : d.bandLow;
    if (d.bandHigh !== undefined) state.bandHigh = typeof d.bandHigh === 'string' ? parseSeries(d.bandHigh) : d.bandHigh;
    if (d.labels) el.dataset.labels = d.labels;
    if (d.start) el.dataset.start = d.start;
    if (d.step) el.dataset.step = String(d.step);
    draw();
    if (d.animate === false) return; // live-updating tools redraw without replaying the draw-in
    state.drawn = false;
    animateIn(el, state);
  });

  onVisible(el, () => animateIn(el, state), 0.3);
}

function animateIn(el, state) {
  if (reducedMotion() || state.drawn) return;
  state.drawn = true;
  const line = el.querySelector('.chart__line:not(.chart__line--compare)');
  if (!(line instanceof SVGPathElement)) return;
  el.style.setProperty('--len', String(Math.ceil(line.getTotalLength())));
  el.classList.remove('is-drawing');
  void el.offsetWidth; // restart animation
  el.classList.add('is-drawing');
  line.addEventListener('animationend', () => el.classList.remove('is-drawing'), { once: true });
}

function labelFor(el, i, n) {
  if (el.dataset.labels) {
    const l = el.dataset.labels.split(',');
    return l[Math.round((i / Math.max(1, n - 1)) * (l.length - 1))] || '';
  }
  if (el.dataset.start) {
    const d = new Date(el.dataset.start + 'T12:00:00');
    d.setDate(d.getDate() + i * Number(el.dataset.step || 1));
    return new Intl.DateTimeFormat(document.documentElement.lang || 'en', { day: 'numeric', month: 'short' }).format(d);
  }
  return '';
}

function render(el, state) {
  const { series, compare, bandLow, bandHigh } = state;
  if (!series.length) return;
  const rect = el.getBoundingClientRect();
  const W = Math.max(120, rect.width), H = Math.max(60, rect.height);
  const yTicks = Number(el.dataset.yaxis || 0);
  const xTicks = Number(el.dataset.xaxis || 0);
  const kind = el.dataset.format || 'number';
  const dec = Number(el.dataset.decimals ?? 0);
  const padL = yTicks ? 64 : 2, padR = 8, padT = 12, padB = xTicks ? 26 : 4;

  const all = [...series, ...compare, ...bandLow, ...bandHigh];
  let min = Math.min(...all), max = Math.max(...all);
  const span = max - min || 1;
  min -= span * 0.08; max += span * 0.08;
  if (el.hasAttribute('data-floor-zero')) min = Math.max(0, min);
  const n = series.length;
  const x = (i) => padL + (i / Math.max(1, n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const pts = series.map((v, i) => [x(i), y(v)]);

  const gid = nextId('grad'), pid = nextId('dots');
  const children = [];
  const defs = svg('defs', {}, [
    svg('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, [
      svg('stop', { offset: '0%', 'stop-color': 'var(--chart-line)', 'stop-opacity': '.32' }),
      svg('stop', { offset: '100%', 'stop-color': 'var(--chart-line)', 'stop-opacity': '0' }),
    ]),
    svg('pattern', { id: pid, width: 16, height: 16, patternUnits: 'userSpaceOnUse' }, [svg('circle', { cx: 1, cy: 1, r: 1, class: 'chart__dots' })]),
  ]);
  children.push(defs);
  if (el.hasAttribute('data-dots')) children.push(svg('rect', { x: padL, y: 0, width: W - padL, height: H - padB, fill: `url(#${pid})` }));

  for (let t = 0; t <= yTicks && yTicks; t++) {
    const v = min + ((max - min) * t) / yTicks;
    const yy = y(v);
    children.push(svg('line', { x1: padL, x2: W - padR, y1: yy, y2: yy, class: 'chart__grid' }));
    const lab = svg('text', { x: 0, y: yy + 3.5, class: 'chart__axis' });
    lab.textContent = format(v, kind === 'percent' ? 'number' : kind === 'currency' ? 'compact' : kind, 0).replace(/^/, kind === 'currency' ? '$' : '');
    children.push(lab);
  }
  for (let t = 0; t < xTicks; t++) {
    const i = Math.round((t / Math.max(1, xTicks - 1)) * (n - 1));
    const lab = svg('text', { x: x(i), y: H - 6, class: 'chart__axis', 'text-anchor': t === 0 ? 'start' : t === xTicks - 1 ? 'end' : 'middle' });
    lab.textContent = labelFor(el, i, n);
    children.push(lab);
  }

  if (bandLow.length && bandHigh.length) {
    const lo = bandLow.map((v, i) => [x(i * ((n - 1) / Math.max(1, bandLow.length - 1))), y(v)]);
    const hi = bandHigh.map((v, i) => [x(i * ((n - 1) / Math.max(1, bandHigh.length - 1))), y(v)]).reverse();
    const d = smoothPath(lo) + ' L' + smoothPath(hi).slice(1) + ' Z';
    children.push(svg('path', { d, class: 'chart__band' }));
  }

  const line = smoothPath(pts);
  const base = H - padB;
  children.push(svg('path', { d: `${line} L${pts[n - 1][0]},${base} L${pts[0][0]},${base} Z`, fill: `url(#${gid})`, class: 'chart__area' }));
  if (compare.length) {
    const cp = compare.map((v, i) => [x(i * ((n - 1) / Math.max(1, compare.length - 1))), y(v)]);
    children.push(svg('path', { d: smoothPath(cp), class: 'chart__line chart__line--compare' }));
  }
  const trendDown = el.hasAttribute('data-auto-trend') && series[n - 1] < series[0];
  children.push(svg('path', { d: line, class: 'chart__line' + (trendDown ? ' chart__line--loss' : '') }));
  const [ex, ey] = pts[n - 1];
  if (!el.hasAttribute('data-no-end')) {
    children.push(svg('circle', { cx: ex, cy: ey, r: 4, class: 'chart__end-pulse' }));
    children.push(svg('circle', { cx: ex, cy: ey, r: 3.5, class: 'chart__end' }));
  }
  const cursor = svg('line', { x1: 0, x2: 0, y1: padT, y2: base, class: 'chart__cursor' });
  const point = svg('circle', { cx: 0, cy: 0, r: 5, class: 'chart__point' });
  children.push(cursor, point);

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' }, children);
  let tip = el.querySelector('.chart__tooltip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'chart__tooltip'; tip.setAttribute('aria-hidden', 'true'); }
  el.replaceChildren(root, tip);

  const seriesName = el.dataset.seriesName || '';
  const compareName = el.dataset.compareName || '';
  const show = (i) => {
    i = Math.max(0, Math.min(n - 1, i));
    const [px, py] = pts[i];
    cursor.setAttribute('x1', String(px)); cursor.setAttribute('x2', String(px));
    point.setAttribute('cx', String(px)); point.setAttribute('cy', String(py));
    const title = document.createElement('span');
    title.textContent = labelFor(el, i, n);
    const val = document.createElement('strong');
    val.textContent = (seriesName ? seriesName + ' ' : '') + format(series[i], kind, dec);
    const nodes = [title, val];
    if (compare.length) {
      const c = document.createElement('span');
      const ci = Math.round(i * ((compare.length - 1) / Math.max(1, n - 1)));
      c.textContent = (compareName ? compareName + ' ' : '') + format(compare[ci], kind, dec);
      nodes.push(c);
    }
    tip.replaceChildren(...nodes);
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const left = Math.min(Math.max(px - tw / 2, 0), W - tw);
    const top = Math.max(py - th - 14, 0);
    /** @type {HTMLElement} */ (tip).style.translate = `${left}px ${top}px`;
    el.setAttribute('data-hover', '');
    el.dataset.index = String(i);
  };
  const hide = () => el.removeAttribute('data-hover');
  const idxFromX = (clientX) => {
    const r = el.getBoundingClientRect();
    return Math.round(((clientX - r.left - padL) / (r.width - padL - padR)) * (n - 1));
  };
  el.onpointermove = (e) => show(idxFromX(e.clientX));
  el.onpointerleave = hide;
  el.onblur = hide;
  el.onkeydown = (e) => {
    const cur = el.hasAttribute('data-hover') ? Number(el.dataset.index) : n - 1;
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(cur - step); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(cur + step); }
    else if (e.key === 'Home') { e.preventDefault(); show(0); }
    else if (e.key === 'End') { e.preventDefault(); show(n - 1); }
    else if (e.key === 'Escape') hide();
  };
}

/** Programmatic re-render helper for page modules. */
export function update(el, detail) {
  el.dispatchEvent(new CustomEvent('chart:update', { detail }));
}
