// @ts-check
/**
 * Generative dot-matrix canvas (echoes the logo's dotted "o").
 * <canvas class="dotfield" data-component="dotfield" data-mode="globe|field|network" aria-hidden="true"></canvas>
 * - globe:   rotating dot sphere with glowing trade arcs between financial centres
 * - field:   drifting particles with faint links, parallax to pointer
 * - network: central red node with orbiting teal follower nodes and travelling pulses
 * Pauses off-screen; renders a single static frame under reduced motion.
 */
import { reducedMotion, rng } from '../lib/util.js';

const TEAL = [46, 230, 211];
const RED = [255, 74, 82];
const AMBER = [255, 176, 32];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export function init(canvas) {
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const mode = canvas.dataset.mode || 'field';
  const density = Number(canvas.dataset.density || 1);
  const r = rng(Number(canvas.dataset.seed || 11));
  let W = 0, H = 0, dpr = 1, running = false, raf = 0, t0 = performance.now();
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(2, devicePixelRatio || 1);
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    scene.setup();
    if (!running) scene.frame(0);
  };

  /* ---------------- Globe ---------------- */
  const globe = (() => {
    let pts = [];
    const cities = [
      [40.7, -74], [51.5, -0.1], [25.2, 55.3], [1.35, 103.8], [35.7, 139.7], [-33.9, 18.4], [-23.5, -46.6], [19.1, 72.9], [52.5, 13.4],
    ].map(([lat, lon]) => [lat * Math.PI / 180, lon * Math.PI / 180]);
    const arcs = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 6], [1, 5], [2, 7], [8, 4], [0, 8]].map(([a, b], i) => ({ a, b, offset: i * 0.37 }));
    const toXYZ = (lat, lon) => [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
    return {
      setup() {
        const n = Math.round(900 * density);
        pts = [];
        const g = Math.PI * (3 - Math.sqrt(5));
        for (let i = 0; i < n; i++) {
          const y = 1 - (i / (n - 1)) * 2, rad = Math.sqrt(1 - y * y), th = g * i;
          pts.push([Math.cos(th) * rad, y, Math.sin(th) * rad]);
        }
      },
      frame(t) {
        ctx.clearRect(0, 0, W, H);
        const R = Math.min(W, H) * 0.44;
        const cx = W / 2 + pointer.x * 10, cy = H / 2 + pointer.y * 10;
        const rot = t * 0.00008 + pointer.x * 0.25;
        const tilt = -0.35 + pointer.y * 0.1;
        const cr = Math.cos(rot), sr = Math.sin(rot), ct = Math.cos(tilt), st = Math.sin(tilt);
        const proj = ([x, y, z]) => {
          const x1 = x * cr + z * sr, z1 = -x * sr + z * cr;
          const y1 = y * ct - z1 * st, z2 = y * st + z1 * ct;
          return [cx + x1 * R, cy - y1 * R, z2];
        };
        // halo
        const halo = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 1.25);
        halo.addColorStop(0, rgba(TEAL, 0.07)); halo.addColorStop(1, rgba(TEAL, 0));
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, R * 1.25, 0, Math.PI * 2); ctx.fill();
        for (const p of pts) {
          const [x, y, z] = proj(p);
          if (z < -0.15) continue;
          const a = 0.12 + Math.max(0, z) * 0.55;
          ctx.fillStyle = rgba(TEAL, a);
          ctx.fillRect(x, y, 1.6, 1.6);
        }
        // arcs
        for (const arc of arcs) {
          const A = toXYZ(...cities[arc.a]), B = toXYZ(...cities[arc.b]);
          const seg = 40, prog = ((t * 0.00025 + arc.offset) % 1.6);
          ctx.beginPath();
          let started = false;
          for (let i = 0; i <= seg; i++) {
            const k = i / seg;
            if (k > prog) break;
            const lift = 1 + Math.sin(Math.PI * k) * 0.25;
            let v = [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k];
            const len = Math.hypot(...v) || 1;
            v = v.map((c) => (c / len) * lift);
            const [x, y, z] = proj(v);
            if (z < -0.2) { started = false; continue; }
            if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
          }
          const fade = prog > 1 ? Math.max(0, 1 - (prog - 1) / 0.6) : 1;
          ctx.strokeStyle = rgba(TEAL, 0.75 * fade);
          ctx.lineWidth = 1.4;
          ctx.shadowColor = rgba(TEAL, 0.9); ctx.shadowBlur = 8;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        // cities
        cities.forEach((c, i) => {
          const [x, y, z] = proj(toXYZ(...c));
          if (z < 0) return;
          const pulse = (Math.sin(t * 0.003 + i) + 1) / 2;
          ctx.fillStyle = rgba(RED, 0.25 * pulse); ctx.beginPath(); ctx.arc(x, y, 4 + pulse * 6, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = rgba(RED, 0.95); ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
        });
      },
    };
  })();

  /* ---------------- Field ---------------- */
  const field = (() => {
    let ps = [];
    return {
      setup() {
        const n = Math.round(Math.min(140, (W * H) / 9000) * density);
        ps = Array.from({ length: n }, () => ({ x: r() * W, y: r() * H, vx: (r() - 0.5) * 0.15, vy: (r() - 0.5) * 0.15, z: 0.3 + r() * 0.7, c: r() < 0.08 ? RED : TEAL }));
      },
      frame() {
        ctx.clearRect(0, 0, W, H);
        for (const p of ps) {
          p.x += p.vx; p.y += p.vy;
          if (p.x < -10) p.x = W + 10; if (p.x > W + 10) p.x = -10;
          if (p.y < -10) p.y = H + 10; if (p.y > H + 10) p.y = -10;
        }
        ctx.lineWidth = 1;
        for (let i = 0; i < ps.length; i++) {
          const a = ps[i], ax = a.x + pointer.x * 12 * a.z, ay = a.y + pointer.y * 12 * a.z;
          for (let j = i + 1; j < ps.length; j++) {
            const b = ps[j], bx = b.x + pointer.x * 12 * b.z, by = b.y + pointer.y * 12 * b.z;
            const d = Math.hypot(ax - bx, ay - by);
            if (d < 110) { ctx.strokeStyle = rgba(TEAL, (1 - d / 110) * 0.12); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
          }
          ctx.fillStyle = rgba(a.c, 0.25 + a.z * 0.5);
          ctx.beginPath(); ctx.arc(ax, ay, 0.8 + a.z * 1.2, 0, Math.PI * 2); ctx.fill();
        }
      },
    };
  })();

  /* ---------------- Network ---------------- */
  const network = (() => {
    let nodes = [];
    return {
      setup() {
        const rings = [0.22, 0.34, 0.46];
        nodes = [];
        rings.forEach((rr, ri) => {
          const count = Math.round([8, 14, 22][ri] * density);
          for (let i = 0; i < count; i++) nodes.push({ ring: rr, a: (i / count) * Math.PI * 2 + r(), speed: (0.00006 + r() * 0.00005) * (ri % 2 ? -1 : 1), size: 1.5 + r() * 2, amber: r() < 0.06, phase: r() * 10 });
        });
      },
      frame(t) {
        ctx.clearRect(0, 0, W, H);
        const S = Math.min(W, H);
        const cx = W / 2 + pointer.x * 8, cy = H / 2 + pointer.y * 8;
        for (const rr of [0.22, 0.34, 0.46]) { ctx.strokeStyle = rgba(TEAL, 0.07); ctx.beginPath(); ctx.arc(cx, cy, rr * S, 0, Math.PI * 2); ctx.stroke(); }
        for (const n of nodes) {
          const ang = n.a + t * n.speed;
          const x = cx + Math.cos(ang) * n.ring * S, y = cy + Math.sin(ang) * n.ring * S;
          const pulse = ((t * 0.0004 + n.phase) % 1);
          ctx.strokeStyle = rgba(TEAL, 0.08); ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
          ctx.fillStyle = rgba(TEAL, 0.8 * (1 - pulse));
          ctx.beginPath(); ctx.arc(cx + (x - cx) * pulse, cy + (y - cy) * pulse, 1.3, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = rgba(n.amber ? AMBER : TEAL, 0.9);
          ctx.shadowColor = rgba(n.amber ? AMBER : TEAL, 0.8); ctx.shadowBlur = 6;
          ctx.beginPath(); ctx.arc(x, y, n.size, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        }
        const glow = (Math.sin(t * 0.003) + 1) / 2;
        ctx.fillStyle = rgba(RED, 0.18 + glow * 0.12); ctx.beginPath(); ctx.arc(cx, cy, S * 0.07 + glow * 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgba(RED, 1); ctx.shadowColor = rgba(RED, 0.9); ctx.shadowBlur = 18;
        ctx.beginPath(); ctx.arc(cx, cy, S * 0.025 + 3, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      },
    };
  })();

  const scene = { globe, field, network }[mode] || field;

  const loop = (now) => {
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    scene.frame(now - t0);
    raf = requestAnimationFrame(loop);
  };
  const start = () => { if (running || reducedMotion()) return; running = true; raf = requestAnimationFrame(loop); };
  const stop = () => { running = false; cancelAnimationFrame(raf); };

  new ResizeObserver(resize).observe(canvas);
  resize();
  new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop())).observe(canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  const host = canvas.parentElement || document.body;
  host.addEventListener('pointermove', (e) => {
    const rect = host.getBoundingClientRect();
    pointer.tx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    pointer.ty = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
  }, { passive: true });
  host.addEventListener('pointerleave', () => { pointer.tx = 0; pointer.ty = 0; });
}
