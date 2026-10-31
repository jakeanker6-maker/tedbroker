// @ts-check
/**
 * Risk vs expected-return map for investment plans. Reads its data from the plan ledger
 * (the ledger stays the accessible source of truth):
 *
 * <div class="plans-map" data-component="plans-map" data-ledger="robo-ledger"></div>
 * <table id="robo-ledger"> <tbody class="plan" data-name data-min data-return data-risk data-subs [data-short] [data-map-label="below"]>
 *   <tr>… <button data-expand aria-controls="plan-x"> …</tr> <tr class="ledger__detail" id="plan-x"> …
 * </tbody> … </table>
 *
 * Each plan becomes a real <button> (focusable, Enter/Space) positioned with --x / --y / --s.
 * Hover / focus shows a crosshair + tooltip and highlights the ledger row (and vice versa);
 * activating a dot expands that plan's row through the shared data-expand mechanism.
 */
import { format, reducedMotion, svg } from '../lib/util.js';

const SVGNS_ATTRS = { viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' };

/** @param {HTMLElement} root */
export function init(root) {
  const ledger = document.getElementById(root.dataset.ledger || '');
  if (!ledger) return;
  const groups = /** @type {HTMLElement[]} */ ([...ledger.querySelectorAll('tbody.plan')]);
  if (!groups.length) return;

  const plans = groups.map((g) => ({
    g,
    row: /** @type {HTMLElement} */ (g.querySelector('tr')),
    expander: /** @type {HTMLButtonElement|null} */ (g.querySelector('[data-expand]')),
    name: g.dataset.name || '',
    min: Number(g.dataset.min || 0),
    ret: Number(g.dataset.return || 0),
    risk: Number(g.dataset.risk || 1),
    subs: Number(g.dataset.subs || 0),
    short: g.hasAttribute('data-short'),
    below: g.dataset.mapLabel === 'below',
  }));

  const yMax = Math.ceil((Math.max(...plans.map((p) => p.ret)) * 1.1) / 10) * 10;
  const maxSubs = Math.max(...plans.map((p) => p.subs)) || 1;
  const xPct = (risk) => ((risk - 0.5) / 10) * 100;
  const yPct = (ret) => (ret / yMax) * 100;

  /* ---------- static layers: grid, frontier, ticks ---------- */
  const plot = document.createElement('div');
  plot.className = 'plans-map__plot';

  const lines = [];
  for (let v = 0; v <= yMax; v += 10) {
    const y = 100 - yPct(v);
    lines.push(svg('line', { x1: 0, x2: 100, y1: y, y2: y, class: 'plans-map__gridline', 'vector-effect': 'non-scaling-stroke' }));
  }
  const byRisk = [...plans].sort((a, b) => a.risk - b.risk);
  const d = byRisk.map((p, i) => `${i ? 'L' : 'M'}${xPct(p.risk).toFixed(2)},${(100 - yPct(p.ret)).toFixed(2)}`).join(' ');
  lines.push(svg('path', { d, class: 'plans-map__frontier', 'vector-effect': 'non-scaling-stroke' }));
  plot.append(svg('svg', { ...SVGNS_ATTRS, class: 'plans-map__grid' }, lines));

  const ticks = document.createElement('div');
  ticks.className = 'plans-map__ticks';
  ticks.setAttribute('aria-hidden', 'true');
  for (let v = 0; v <= yMax; v += 10) {
    const t = document.createElement('span');
    t.className = 'plans-map__ytick';
    t.style.setProperty('--y', String(yPct(v)));
    t.textContent = `${v}%`;
    ticks.append(t);
  }
  for (let r = 1; r <= 10; r++) {
    const t = document.createElement('span');
    t.className = 'plans-map__xtick';
    t.style.setProperty('--x', String(xPct(r)));
    t.textContent = String(r);
    ticks.append(t);
  }
  plot.append(ticks);

  const cross = document.createElement('div');
  cross.className = 'plans-map__cross';
  cross.setAttribute('aria-hidden', 'true');
  const tip = document.createElement('div');
  tip.className = 'plans-map__tip';
  tip.setAttribute('aria-hidden', 'true');

  /* ---------- dots ---------- */
  const list = document.createElement('ul');
  list.className = 'plans-map__dots';
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', 'Plans by risk and expected return');

  const summary = (p) => `${p.name} · ${format(p.min, 'currency', 0)} min · ${p.ret.toFixed(1)}% target · ${format(p.subs, 'number', 0)} subscribers`;

  const dots = plans.map((p, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'plans-map__dot';
    const x = xPct(p.risk), y = yPct(p.ret);
    b.style.setProperty('--x', x.toFixed(2));
    b.style.setProperty('--y', y.toFixed(2));
    b.style.setProperty('--s', (0.55 + Math.sqrt(p.subs / maxSubs) * 0.95).toFixed(3)); // rem
    b.dataset.level = p.risk >= 7 ? 'high' : 'normal';
    b.dataset.align = x > 78 ? 'end' : x < 22 ? 'start' : 'center';
    if (p.below) b.dataset.label = 'below';
    const action = p.short ? 'Show plan in the list.' : 'Show plan details.';
    b.setAttribute('aria-label', `${p.name} ${p.ret.toFixed(1)}%: risk ${p.risk} of 10, ${format(p.min, 'currency', 0)} minimum, ${format(p.subs, 'number', 0)} subscribers. ${action}`);
    const label = document.createElement('span');
    label.className = 'plans-map__label';
    label.setAttribute('aria-hidden', 'true');
    label.textContent = `${p.name} ${p.ret.toFixed(1)}%`;
    b.append(label);
    li.append(b);
    list.append(li);
    b.dataset.i = String(i);
    return b;
  });

  plot.append(cross, list, tip);
  const axisY = document.createElement('p');
  axisY.className = 'plans-map__axis plans-map__axis--y';
  axisY.setAttribute('aria-hidden', 'true');
  axisY.textContent = 'Expected annual return';
  const axisX = document.createElement('p');
  axisX.className = 'plans-map__axis plans-map__axis--x';
  axisX.setAttribute('aria-hidden', 'true');
  axisX.textContent = 'Risk score 1–10 →';
  root.append(axisY, plot, axisX);

  /* ---------- state ---------- */
  let active = -1;
  const activate = (i) => {
    if (i === active) return;
    active = i;
    plans.forEach((p, j) => p.g.toggleAttribute('data-highlight', j === i));
    dots.forEach((b, j) => b.toggleAttribute('data-active', j === i));
    if (i < 0) { root.removeAttribute('data-active'); return; }
    const b = dots[i];
    cross.style.setProperty('--x', b.style.getPropertyValue('--x'));
    cross.style.setProperty('--y', b.style.getPropertyValue('--y'));
    tip.style.setProperty('--x', b.style.getPropertyValue('--x'));
    tip.style.setProperty('--y', b.style.getPropertyValue('--y'));
    tip.dataset.align = b.dataset.align || 'center';
    tip.dataset.place = Number(b.style.getPropertyValue('--y')) > 70 ? 'below' : 'above';
    tip.textContent = summary(plans[i]);
    root.setAttribute('data-active', '');
  };
  const clear = () => {
    // keep the tooltip on a focused dot when the pointer leaves
    const f = document.activeElement;
    const fi = f instanceof HTMLElement && dots.includes(/** @type {HTMLButtonElement} */ (f)) ? Number(f.dataset.i) : -1;
    activate(fi);
  };

  const syncOpen = () => plans.forEach((p, i) => {
    if (!p.expander) return;
    const open = p.expander.getAttribute('aria-expanded') === 'true';
    dots[i].toggleAttribute('data-open', open);
  });
  syncOpen();
  new MutationObserver(syncOpen).observe(ledger, { subtree: true, attributes: true, attributeFilter: ['aria-expanded'] });

  list.addEventListener('pointerover', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('.plans-map__dot');
    if (b instanceof HTMLElement) activate(Number(b.dataset.i));
  });
  list.addEventListener('pointerleave', clear);
  list.addEventListener('focusin', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('.plans-map__dot');
    if (b instanceof HTMLElement) activate(Number(b.dataset.i));
  });
  list.addEventListener('focusout', () => requestAnimationFrame(clear));
  list.addEventListener('keydown', (e) => { if (e.key === 'Escape' && active >= 0) activate(-1); });

  list.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement} */ (e.target).closest('.plans-map__dot');
    if (!(b instanceof HTMLElement)) return;
    const p = plans[Number(b.dataset.i)];
    if (p.expander && p.expander.getAttribute('aria-expanded') !== 'true') p.expander.click();
    p.g.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
    // Keyboard activation (detail 0): continue from the row's action instead of the map.
    if (/** @type {MouseEvent} */ (e).detail === 0) {
      const next = p.expander || /** @type {HTMLElement|null} */ (p.row.querySelector('a, button'));
      next?.focus({ preventScroll: true });
    }
  });

  // Ledger → map: hovering a plan row lights up its dot.
  plans.forEach((p, i) => {
    p.row.addEventListener('pointerenter', () => activate(i));
    p.row.addEventListener('pointerleave', clear);
  });
}
