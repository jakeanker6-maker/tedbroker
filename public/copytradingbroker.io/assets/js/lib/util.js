// @ts-check
/** Shared helpers for the TED Brokers prototype. No dependencies. */

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Deterministic PRNG so mock data is stable across reloads. */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/**
 * Random-walk series for mock charts.
 * @param {number} n points
 * @param {{seed?: number, drift?: number, vol?: number, start?: number, end?: number}} [o]
 */
export function walk(n, o = {}) {
  const r = rng(o.seed ?? 7);
  const drift = o.drift ?? 0.35;
  const vol = o.vol ?? 1;
  const out = [];
  let v = 100;
  for (let i = 0; i < n; i++) {
    v += (r() - 0.5) * 2 * vol + drift * 0.3;
    out.push(v);
  }
  // Optionally rescale to a start/end range
  if (o.start != null && o.end != null) {
    const a = out[0], b = out[n - 1];
    const k = (o.end - o.start) / ((b - a) || 1);
    return out.map((x) => o.start + (x - a) * k);
  }
  return out;
}

/** Parse "12,13.5,14" or "walk:60,seed=3,drift=.4,start=100,end=140" */
export function parseSeries(str) {
  if (!str) return [];
  if (str.startsWith('walk:')) {
    const [n, ...opts] = str.slice(5).split(',');
    const o = {};
    for (const kv of opts) { const [k, v] = kv.split('='); o[k.trim()] = Number(v); }
    return walk(Number(n), o);
  }
  return str.split(',').map(Number).filter((x) => !Number.isNaN(x));
}

const fmtCache = new Map();
/** @param {number} v @param {string} [kind] currency|number|percent|compact @param {number} [decimals] */
export function format(v, kind = 'number', decimals = 0) {
  const lang = document.documentElement.lang || 'en';
  const key = `${lang}|${kind}|${decimals}`;
  if (!fmtCache.has(key)) {
    /** @type {Intl.NumberFormatOptions} */
    const opts = { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
    if (kind === 'currency') Object.assign(opts, { style: 'currency', currency: 'USD' });
    if (kind === 'compact') Object.assign(opts, { notation: 'compact', maximumFractionDigits: 1, minimumFractionDigits: 0 });
    fmtCache.set(key, new Intl.NumberFormat(lang, opts));
  }
  return fmtCache.get(key).format(v);
}

/** Run cb once when el scrolls into view. */
export function onVisible(el, cb, threshold = 0.25) {
  if (!('IntersectionObserver' in window)) { cb(); return; }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { io.disconnect(); cb(); }
  }, { threshold, rootMargin: '0px 0px -5% 0px' });
  io.observe(el);
}

/** SVG element helper (safe: attributes only, no HTML strings). */
export function svg(tag, attrs = {}, children = []) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}

/** Smooth path through points (Catmull-Rom → cubic Bézier). */
export function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

let uid = 0;
export const nextId = (p = 'id') => `${p}-${++uid}`;

/**
 * Live-region toast. Errors use an assertive region, an error icon and stay longer.
 * @param {string} message
 * @param {{tone?: 'success'|'error'}} [opts]
 */
export function toast(message, opts = {}) {
  const error = opts.tone === 'error';
  const cls = error ? 'toast-region toast-region--alert' : 'toast-region';
  let region = document.querySelector(error ? '.toast-region--alert' : '.toast-region:not(.toast-region--alert)');
  if (!region) {
    region = document.createElement('div');
    region.className = cls;
    region.setAttribute('role', error ? 'alert' : 'status');
    region.setAttribute('aria-live', error ? 'assertive' : 'polite');
    document.body.append(region);
  }
  const t = document.createElement('div');
  t.className = error ? 'toast toast--error' : 'toast';
  const icon = error
    ? svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'aria-hidden': 'true' }, [svg('path', { d: 'M12 8v5M12 16.5h.01' }), svg('circle', { cx: 12, cy: 12, r: 9 })])
    : svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'aria-hidden': 'true' }, [svg('path', { d: 'M5 12.5l4.5 4.5L19 7' })]);
  const span = document.createElement('span');
  span.textContent = error ? `Error: ${message}` : message;
  t.append(icon, span);
  region.append(t);
  setTimeout(() => { t.dataset.leaving = ''; t.addEventListener('animationend', () => t.remove(), { once: true }); }, error ? 8000 : 2600);
}
