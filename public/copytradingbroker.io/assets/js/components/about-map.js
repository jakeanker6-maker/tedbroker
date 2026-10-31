// @ts-check
/**
 * Dot-matrix world map with pulsing city markers and travelling arcs (About hero).
 *
 * <figure class="about-map" data-component="about-map">
 *   <canvas class="about-map__canvas" aria-hidden="true"></canvas>
 *   <ul class="about-map__cities">
 *     <li class="about-map__city" data-lat="40.71" data-lon="-74.01" data-side="start">New York …</li>
 *   </ul>
 * </figure>
 *
 * - The land mask is a coarse 60×30 equirectangular bitmap (6° of longitude per column,
 *   4.8° of latitude per row, from 84°N to 60°S).
 * - City labels are real HTML (positioned with --x / --y), so they stay crisp and readable.
 * - Pauses off-screen and in background tabs; draws one static frame under reduced motion.
 * - Colours come from the surface tokens (--color-signal, --color-accent).
 */
import { reducedMotion } from '../lib/util.js';

const COLS = 60;
const ROWS = 30;
const LAT_TOP = 84;
const LAT_STEP = 4.8;
const LON_STEP = 6;

/* prettier-ignore */
const LAND = [
  '000000000000000111101111110000000000000000000000000000000000',
  '000000000011111111011111111000001100000000000011100000000000',
  '001111101111111110001111111000000111000011111111111110111111',
  '011111111111111111110111101100001111111111111111111111111111',
  '011111111111110000110010000000111111111111111111111111111111',
  '000000011111110001111000000001011111111111111111111110001100',
  '000000001111111101111000000001111111111111111111111111001000',
  '000000000111111111111100000001111111111111111111111111000000',
  '000000000111111111100000000011111110010111111111111101000000',
  '000000000111111111000000000011001111110111111111111101000000',
  '000000000011111111000000000011111111111111111111111010000000',
  '000000000011110010000000000111111111111111111111110000000000',
  '000000000001110010000000000111111111111111111111111000000000',
  '000000000000111100000000000111111111111100111111001000000000',
  '000000000000001100000000000111111111110000110011001000000000',
  '000000000000000111110000000111111111111000110010000100000000',
  '000000000000000001111100000011111111110000000111110000000000',
  '000000000000000011111110000000011111110000000011011011100000',
  '000000000000000011111111100000011111100000000001100011100000',
  '000000000000000001111111100000001111100000000000000011000000',
  '000000000000000001111111000000001111101000000000001111100000',
  '000000000000000000111111000000001111011000000000011111100000',
  '000000000000000000111110000000001111010000000000011111110000',
  '000000000000000000111100000000001111000000000000011111110000',
  '000000000000000000111100000000000110000000000000011001100010',
  '000000000000000001111000000000000000000000000000000001100011',
  '000000000000000001110000000000000000000000000000000000100110',
  '000000000000000001100000000000000000000000000000000000000100',
  '000000000000000001100000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000000000000000000',
];

/** Arcs between city indexes (in DOM order) with a phase offset. */
const ARCS = [[0, 1, 0], [1, 2, 0.35], [2, 3, 0.7], [0, 2, 1.05], [1, 3, 1.4]];

/** Grid coordinates (fractional column/row) for a lat/lon. */
const toGrid = (lat, lon) => [(lon + 180) / LON_STEP, (LAT_TOP - lat) / LAT_STEP];

/** Cheap deterministic per-cell phase so the shimmer looks organic. */
const phase = (c, r) => ((Math.sin(c * 12.9898 + r * 78.233) * 43758.5453) % 1 + 1) % 1 * Math.PI * 2;

/** @param {HTMLElement} root */
export function init(root) {
  const canvas = root.querySelector('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const cities = [...root.querySelectorAll('[data-lat][data-lon]')]
    .filter((el) => el instanceof HTMLElement)
    .map((el) => ({ el: /** @type {HTMLElement} */ (el), grid: toGrid(Number(el.getAttribute('data-lat')), Number(el.getAttribute('data-lon'))), x: 0, y: 0 }));

  const land = [];
  const sea = [];
  LAND.forEach((row, r) => {
    for (let c = 0; c < COLS; c++) (row[c] === '1' ? land : sea).push([c, r, phase(c, r)]);
  });

  const ac = new AbortController();
  const { signal } = ac;
  let W = 0, H = 0, cell = 0, ox = 0, oy = 0;
  let colors = { dot: '#2EE6D3', marker: '#E3262F', faint: '#9AA9BD' };
  let running = false, raf = 0, visible = false;
  const t0 = performance.now();

  const readColors = () => {
    const cs = getComputedStyle(root);
    colors = {
      dot: cs.getPropertyValue('--color-signal').trim() || colors.dot,
      marker: cs.getPropertyValue('--color-accent').trim() || colors.marker,
      faint: cs.getPropertyValue('--color-text-muted').trim() || colors.faint,
    };
  };

  const layout = () => {
    const rect = root.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    W = rect.width; H = rect.height;
    if (!W || !H) return;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cell = Math.min(W / COLS, H / ROWS);
    ox = (W - cell * COLS) / 2;
    oy = (H - cell * ROWS) / 2;
    for (const city of cities) {
      city.x = ox + city.grid[0] * cell;
      city.y = oy + city.grid[1] * cell;
      city.el.style.setProperty('--x', `${((city.x / W) * 100).toFixed(2)}%`);
      city.el.style.setProperty('--y', `${((city.y / H) * 100).toFixed(2)}%`);
    }
    root.setAttribute('data-mapped', '');
    draw(performance.now() - t0, reducedMotion());
  };

  /** Point on a quadratic arc lifted above the straight line between a and b. */
  const arcPoint = (a, b, k) => {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const lift = Math.hypot(b.x - a.x, b.y - a.y) * 0.32;
    const cx = mx, cy = my - lift;
    const u = 1 - k;
    return [u * u * a.x + 2 * u * k * cx + k * k * b.x, u * u * a.y + 2 * u * k * cy + k * k * b.y];
  };

  const strokeArc = (a, b, from, to) => {
    const steps = 48;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const k = from + ((to - from) * i) / steps;
      const [x, y] = arcPoint(a, b, k);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  /** @param {number} t elapsed ms  @param {boolean} still draw the static (reduced-motion) frame */
  const draw = (t, still) => {
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const dot = Math.max(0.9, cell * 0.2);

    // Ocean grid: very faint, square, keeps the "matrix" texture.
    ctx.fillStyle = colors.faint;
    ctx.globalAlpha = 0.09;
    for (const [c, r] of sea) ctx.fillRect(ox + (c + 0.5) * cell - 0.5, oy + (r + 0.5) * cell - 0.5, 1, 1);

    // Land: teal dots with a slow shimmer.
    ctx.fillStyle = colors.dot;
    for (const [c, r, p] of land) {
      ctx.globalAlpha = still ? 0.5 : 0.36 + 0.24 * Math.sin(t * 0.0011 + p);
      ctx.beginPath();
      ctx.arc(ox + (c + 0.5) * cell, oy + (r + 0.5) * cell, dot, 0, Math.PI * 2);
      ctx.fill();
    }

    // Arcs: faint full path, plus a travelling bright segment.
    ctx.lineCap = 'round';
    ctx.strokeStyle = colors.dot;
    for (const [ia, ib, off] of ARCS) {
      const a = cities[ia], b = cities[ib];
      if (!a || !b) continue;
      ctx.lineWidth = 1;
      ctx.globalAlpha = still ? 0.45 : 0.14;
      strokeArc(a, b, 0, 1);
      if (still) continue;
      const p = (t * 0.00022 + off) % 1.6; // 0..1 travel, 1..1.6 rest
      if (p > 1.3) continue;
      const head = Math.min(1, p), tail = Math.max(0, p - 0.4);
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = p > 1 ? Math.max(0, 1 - (p - 1) / 0.3) * 0.9 : 0.9;
      ctx.shadowColor = colors.dot;
      ctx.shadowBlur = 8;
      strokeArc(a, b, tail, head);
      ctx.shadowBlur = 0;
      if (p <= 1) {
        const [hx, hy] = arcPoint(a, b, head);
        ctx.globalAlpha = 1;
        ctx.fillStyle = colors.dot;
        ctx.beginPath(); ctx.arc(hx, hy, 2, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Markers: red core + pulsing ring.
    const core = Math.max(2.5, cell * 0.3);
    cities.forEach((city, i) => {
      ctx.fillStyle = colors.marker;
      const k = still ? 0.35 : (t * 0.0005 + i * 0.27) % 1;
      ctx.globalAlpha = (1 - k) * 0.45;
      ctx.beginPath(); ctx.arc(city.x, city.y, core + k * core * 4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(city.x, city.y, core, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  };

  const loop = (now) => {
    draw(now - t0, false);
    raf = requestAnimationFrame(loop);
  };
  const start = () => {
    if (running || !visible || document.hidden || reducedMotion()) return;
    running = true;
    raf = requestAnimationFrame(loop);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };

  readColors();
  const ro = new ResizeObserver(layout);
  ro.observe(root);
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) start(); else stop();
  });
  io.observe(root);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()), { signal });
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
    if (e.matches) { stop(); draw(0, true); } else start();
  }, { signal });

  /** Teardown (not needed on a static page, but keeps the component disposable). */
  return () => {
    stop();
    ro.disconnect();
    io.disconnect();
    ac.abort();
  };
}
