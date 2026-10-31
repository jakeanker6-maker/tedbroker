// @ts-check
/**
 * Invest form inside a plan's detail row. Validates the amount against the plan minimum and the
 * available balance, keeps the projection chart, summary and button label in sync, and confirms
 * with a toast.
 *
 * <div class="plan-detail" data-component="plans-invest" data-plan="Growth" data-min="2000"
 *      data-available="6420" data-return="15.2" data-months="6" data-risk="4" data-fee="0.5">
 *   … .chart[data-proj-chart] … <form class="plan-form"> input.amount-input, [data-out=range|fee|cta] </form>
 * </div>
 */
import { format, toast } from '../lib/util.js';
import { update } from './chart.js';
import { bindAmountField } from './amount-field.js';

/**
 * Illustrative projection: compound the annual target weekly; the band widens with √time and risk.
 * Kept in step with the generator that wrote the initial data-series.
 * @param {number} amount @param {number} annualPct @param {number} months @param {number} risk
 */
export function project(amount, annualPct, months, risk) {
  const steps = months * 4;
  const vol = 0.02 + risk * 0.012;
  const series = [], bandLow = [], bandHigh = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (months / 12);
    const mid = amount * Math.pow(1 + annualPct / 100, t);
    const s = vol * Math.sqrt(t);
    series.push(mid); bandLow.push(mid * (1 - s)); bandHigh.push(mid * (1 + s));
  }
  return { series, bandLow, bandHigh };
}

const usd = (v, d = 0) => format(v, 'currency', d);
/** Whole dollars unless the user typed cents. */
const amt = (v) => usd(v, Number.isInteger(v) ? 0 : 2);

/** @param {HTMLElement} root */
export function init(root) {
  const d = root.dataset;
  const plan = d.plan || 'this plan';
  const min = Number(d.min || 0);
  const available = Number(d.available || 0);
  const annual = Number(d.return || 0);
  const months = Number(d.months || 6);
  const risk = Number(d.risk || 5);
  const feePct = Number(d.fee || 0);
  const form = /** @type {HTMLFormElement|null} */ (root.querySelector('.plan-form'));
  const field = /** @type {HTMLElement|null} */ (form?.querySelector('.field:has(.amount-input)'));
  const chart = /** @type {HTMLElement|null} */ (root.querySelector('[data-proj-chart]'));
  if (!form || !field) return;
  const out = (k) => form.querySelector(`[data-out="${k}"]`);
  const btn = /** @type {HTMLButtonElement|null} */ (form.querySelector('[type="submit"]'));

  let last = min;
  let raf = 0;
  let chartTimer = 0;

  const render = (amount) => {
    const p = project(amount, annual, months, risk);
    const lo = p.bandLow[p.bandLow.length - 1], hi = p.bandHigh[p.bandHigh.length - 1], mid = p.series[p.series.length - 1];
    const range = out('range'); if (range) range.textContent = `${usd(lo)} – ${usd(hi)}`;
    const fee = out('fee'); if (fee) fee.textContent = usd((amount * feePct) / 100, 2);
    const cta = out('cta'); if (cta) cta.textContent = `Invest ${amt(amount)}`;
    if (!chart) return;
    chart.setAttribute('aria-label', `Projected value of ${usd(amount)} in ${plan} over ${months} months: median ${usd(mid)}, likely range ${usd(lo)} to ${usd(hi)}. Illustrative, not guaranteed.`);
    // Keep the attributes current in case the chart module has not initialised yet.
    const join = (a) => a.map((v) => v.toFixed(2)).join(',');
    chart.dataset.series = join(p.series);
    chart.dataset.bandLow = join(p.bandLow);
    chart.dataset.bandHigh = join(p.bandHigh);
    // Debounce the redraw a little while typing.
    clearTimeout(chartTimer);
    chartTimer = window.setTimeout(() => {
      update(chart, { series: p.series, bandLow: p.bandLow, bandHigh: p.bandHigh });
      // Same shape at a new scale: skip the draw-in replay, only the axis and values change.
      chart.classList.remove('is-drawing');
    }, 120);
  };

  const amount = bindAmountField(field, {
    min, max: available, minText: `Minimum for ${plan}`,
    onInput: (r) => {
      if (!r.ok || r.value === last) return;
      last = r.value;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => render(r.value));
    },
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (btn?.getAttribute('aria-busy') === 'true') return;
    const r = amount.validate();
    if (!r.ok) return;
    btn?.setAttribute('aria-busy', 'true');
    if (btn) btn.disabled = true;
    setTimeout(() => {
      btn?.removeAttribute('aria-busy');
      if (btn) btn.disabled = false;
      toast(`Invested ${amt(r.value)} in ${plan}`);
    }, 800);
  });
}
