// @ts-check
/**
 * "What could your capital do?" simulator (how-it-works.html).
 *
 * <form class="hiw-sim" data-component="hiw-sim">
 *   <input type="range" name="deposit" …>          deposit slider
 *   <input type="radio" name="risk" value="low|medium|high">
 *   <output data-sim="deposit">  <span data-sim="gain|low|high">
 *   <p data-sim="status" role="status">             announced on `change` only
 *   <div class="chart" data-component="chart" data-sim="chart">
 *   <table data-sim="table">                        gets data-risk="…" to highlight the column
 * </form>
 *
 * The maths is illustrative only: compounding a fixed monthly rate for 12 months.
 */
import { format, reducedMotion } from '../lib/util.js';
import { update } from './chart.js';

/** Monthly return assumptions (fractions). */
export const RISK = {
  low: { lo: 0.01, mid: 0.014, hi: 0.02, label: 'low' },
  medium: { lo: 0.02, mid: 0.026, hi: 0.04, label: 'medium' },
  high: { lo: 0.03, mid: 0.042, hi: 0.07, label: 'high' },
};
const MONTHS = 12;

/**
 * Pure projection, exported for tests.
 * @param {number} deposit
 * @param {keyof typeof RISK} risk
 */
export function project(deposit, risk) {
  const r = RISK[risk] || RISK.medium;
  const curve = (rate) => Array.from({ length: MONTHS + 1 }, (_, m) => Math.round(deposit * (1 + rate) ** m));
  const median = curve(r.mid), low = curve(r.lo), high = curve(r.hi);
  return {
    median, low, high,
    gain: median[MONTHS] - deposit,
    gainLow: low[MONTHS] - deposit,
    gainHigh: high[MONTHS] - deposit,
  };
}

const money = (v) => format(v, 'currency', 0);
const plus = (v) => '+' + money(v);

/** @param {HTMLFormElement} form */
export function init(form) {
  const ctrl = new AbortController();
  const { signal } = ctrl;
  const q = (name) => form.querySelector(`[data-sim="${name}"]`);
  const deposit = /** @type {HTMLInputElement|null} */ (form.querySelector('input[name="deposit"]'));
  if (!deposit) return;
  const chart = /** @type {HTMLElement|null} */ (q('chart'));
  const table = q('table');
  const status = q('status');
  let chartTimer = 0;

  const riskValue = () => {
    const checked = /** @type {HTMLInputElement|null} */ (form.querySelector('input[name="risk"]:checked'));
    return /** @type {keyof typeof RISK} */ (checked?.value in RISK ? checked.value : 'medium');
  };

  const setFill = (input) => {
    const min = Number(input.min), max = Number(input.max), v = Number(input.value);
    input.style.setProperty('--fill', `${((v - min) / (max - min || 1)) * 100}%`);
  };

  const pushChart = (p, d, risk) => {
    if (!chart) return;
    // Keep data-* in sync so a chart that initialises later reads the current state.
    chart.dataset.series = p.median.join(',');
    chart.dataset.bandLow = p.low.join(',');
    chart.dataset.bandHigh = p.high.join(',');
    chart.setAttribute('aria-label',
      `Illustrative 12-month value of a ${money(d)} deposit at ${RISK[risk].label} risk: median ${money(p.median[MONTHS])}, range ${money(p.low[MONTHS])} to ${money(p.high[MONTHS])}.`);
    update(chart, { series: p.median, bandLow: p.low, bandHigh: p.high });
  };

  /** @param {{announce?: boolean, chartNow?: boolean, initial?: boolean}} [opts] */
  const render = (opts = {}) => {
    const d = Number(deposit.value);
    const risk = riskValue();
    const p = project(d, risk);

    setFill(deposit);
    deposit.setAttribute('aria-valuetext', money(d));
    const out = q('deposit');
    if (out) out.textContent = money(d);
    const gain = q('gain'), lo = q('low'), hi = q('high');
    if (gain) gain.textContent = plus(p.gain);
    if (lo) lo.textContent = plus(p.gainLow);
    if (hi) hi.textContent = plus(p.gainHigh);
    table?.setAttribute('data-risk', risk);

    if (opts.announce && status) {
      status.textContent = `${money(d)} at ${RISK[risk].label} risk: 12-month illustrative range ${plus(p.gain)}, from ${plus(p.gainLow)} to ${plus(p.gainHigh)}. Not a forecast.`;
    }

    if (opts.initial) return; // chart already renders the server-provided default series
    clearTimeout(chartTimer);
    // Re-drawing restarts the chart's draw-in animation, so wait until dragging settles.
    if (opts.chartNow || reducedMotion()) pushChart(p, d, risk);
    else chartTimer = window.setTimeout(() => pushChart(p, d, risk), 180);
  };

  form.addEventListener('submit', (e) => e.preventDefault(), { signal });
  form.addEventListener('input', () => render(), { signal });
  form.addEventListener('change', () => render({ announce: true, chartNow: true }), { signal });

  render({ initial: true });
  // If the markup default ever differs from the computed curve, sync once the chart exists.
  if (chart && chart.dataset.series !== project(Number(deposit.value), riskValue()).median.join(',')) {
    render({ chartNow: true });
  }

  return () => { ctrl.abort(); clearTimeout(chartTimer); };
}
