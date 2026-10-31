// @ts-check
/**
 * Portfolio range select → re-renders the performance chart (chart:update) and its text legend.
 *
 * <select data-component="pf-range" data-target="pf-chart">
 *   <option value="1m">Last month</option> … <option value="12m" selected>Last 12 months</option> …
 * </select>
 * Legend values: [data-pf-legend="portfolio|benchmark"] (a .delta whose data-trend is kept in sync).
 * Chart aria-label is rewritten from the range so the image stays described.
 */
import { format, walk } from '../lib/util.js';

const END = 48216.4;       // current portfolio value
const BENCH_END = 44960;   // S&P 500, rebased to the portfolio's starting value

/** @type {Record<string, {n:number,start:string,stepDays:number,label:Intl.DateTimeFormatOptions,from:number,benchFrom:number,seed:number,benchSeed:number,text:string}>} */
const RANGES = {
  '1m':  { n: 31, start: '2026-09-27', stepDays: 1, label: { day: 'numeric', month: 'short' }, from: 46980, benchFrom: 44380, seed: 4, benchSeed: 9, text: 'the last month' },
  '3m':  { n: 46, start: '2026-07-29', stepDays: 2, label: { day: 'numeric', month: 'short' }, from: 44100, benchFrom: 43050, seed: 17, benchSeed: 23, text: 'the last 3 months' },
  '12m': { n: 53, start: '2025-10-27', stepDays: 7, label: { month: 'short', year: '2-digit' }, from: 40000, benchFrom: 40000, seed: 33, benchSeed: 41, text: 'the last 12 months' },
  'all': { n: 53, start: '2025-10-28', stepDays: 7, label: { month: 'short', year: '2-digit' }, from: 40000, benchFrom: 40000, seed: 33, benchSeed: 41, text: 'all time (since 28 Oct 2025)' },
};

/** Per-point x labels. Commas are stripped because the chart splits data-labels on ",". */
function labels(cfg) {
  const lang = document.documentElement.lang || 'en';
  const fmt = new Intl.DateTimeFormat(lang, cfg.label);
  const d0 = new Date(cfg.start + 'T12:00:00');
  return Array.from({ length: cfg.n }, (_, i) => {
    const d = new Date(d0);
    d.setDate(d.getDate() + i * cfg.stepDays);
    return fmt.format(d).replace(/,/g, '');
  }).join(',');
}

const pct = (a, b) => ((b - a) / a) * 100;
const signed = (v) => `${v >= 0 ? '+' : '−'}${format(Math.abs(v), 'number', 1)}%`;

export function init(select) {
  if (!(select instanceof HTMLSelectElement)) return;
  const chart = document.getElementById(select.dataset.target || '');
  if (!chart) return;
  const legend = {
    portfolio: document.querySelector('[data-pf-legend="portfolio"]'),
    benchmark: document.querySelector('[data-pf-legend="benchmark"]'),
  };

  const setLegend = (el, v) => {
    if (!el) return;
    el.textContent = signed(v);
    el.setAttribute('data-trend', v >= 0 ? 'up' : 'down');
  };

  select.addEventListener('change', () => {
    const cfg = RANGES[select.value];
    if (!cfg) return;
    const series = walk(cfg.n, { seed: cfg.seed, drift: 0.5, start: cfg.from, end: END });
    const compare = walk(cfg.n, { seed: cfg.benchSeed, drift: 0.3, vol: 0.7, start: cfg.benchFrom, end: BENCH_END });
    chart.dispatchEvent(new CustomEvent('chart:update', { detail: { series, compare, labels: labels(cfg) } }));
    const p = pct(cfg.from, END), b = pct(cfg.benchFrom, BENCH_END);
    setLegend(legend.portfolio, p);
    setLegend(legend.benchmark, b);
    chart.setAttribute('aria-label',
      `Portfolio value over ${cfg.text}, from ${format(cfg.from, 'currency', 2)} to ${format(END, 'currency', 2)} (${signed(p)}), ` +
      `compared with the S&P 500 rebased to the same start (${signed(b)}). Use arrow keys to inspect values.`);
  });
}
