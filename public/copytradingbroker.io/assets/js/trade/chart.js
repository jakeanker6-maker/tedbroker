// @ts-check
/**
 * Thin wrapper over TradingView Lightweight Charts (vendored, Apache-2.0, attribution kept).
 * Colors come from the CSS tokens so both themes work; times are shown in New York time.
 */

/** @returns {any} */
const LWC = () => /** @type {any} */ (window).LightweightCharts;

/** Wait for the deferred vendor script. */
export async function ready() {
  for (let i = 0; i < 100 && !LWC(); i++) await new Promise((r) => setTimeout(r, 30));
  if (!LWC()) throw new Error('Chart library failed to load');
}

/** @param {HTMLElement} el */
function colors(el) {
  const cs = getComputedStyle(el);
  const v = (/** @type {string} */ n, /** @type {string} */ f) => cs.getPropertyValue(n).trim() || f;
  return {
    line: v('--chart-line', '#2EE6D3'), grid: v('--chart-grid', 'rgba(255,255,255,.06)'),
    text: v('--color-text-muted', '#9AA9BD'), gain: v('--color-gain', '#2EE6D3'), loss: v('--color-loss', '#FF6B70'),
    border: v('--color-border', '#22344D'), fontFamily: v('--font-mono', 'monospace'),
  };
}

const nyTime = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
const nyDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
const nyFull = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

/** @param {string} hex @param {number} a */
function alpha(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${a})`;
}

/** Re-read token colors when the theme toggle changes html[data-theme]. @param {() => void} fn */
function onThemeChange(fn) {
  new MutationObserver(() => requestAnimationFrame(fn)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}

export class PriceChart {
  /** @param {HTMLElement} el */
  constructor(el) {
    this.el = el;
    const c = colors(el);
    this.c = c;
    this.chart = LWC().createChart(el, {
      autoSize: true,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: c.text, fontFamily: c.fontFamily, fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: c.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false,
        tickMarkFormatter: (/** @type {number} */ t, /** @type {number} */ type) => (type >= 3 ? nyTime : nyDay).format(new Date(t * 1000)) },
      localization: { timeFormatter: (/** @type {number} */ t) => `${nyFull.format(new Date(t * 1000))} ET`,
        priceFormatter: (/** @type {number} */ p) => p.toLocaleString('en-US', { minimumFractionDigits: p >= 1 ? 2 : 4, maximumFractionDigits: p >= 1 ? 2 : 6 }) },
      crosshair: { mode: 0 },
      handleScroll: true, handleScale: true,
    });
    /** @type {any} */ this.series = null;
    this.style = 'area';
    onThemeChange(() => {
      this.c = colors(el);
      this.chart.applyOptions({ layout: { textColor: this.c.text }, grid: { horzLines: { color: this.c.grid } } });
      this.render();
    });
    /** @type {any[]} */ this.bars = [];
    this.interval = 300;
    this.intraday = true;
  }

  /** @param {'area'|'candle'} style */
  setStyle(style) {
    this.style = style;
    this.render();
  }

  render() {
    if (this.series) this.chart.removeSeries(this.series);
    const c = this.c;
    if (this.style === 'candle') {
      this.series = this.chart.addCandlestickSeries({ upColor: c.gain, downColor: c.loss, borderVisible: false, wickUpColor: c.gain, wickDownColor: c.loss });
      this.series.setData(this.bars);
    } else {
      this.series = this.chart.addAreaSeries({ lineColor: c.line, topColor: alpha(c.line, 0.28), bottomColor: alpha(c.line, 0), lineWidth: 2, priceLineVisible: true });
      this.series.setData(this.bars.map((b) => ({ time: b.time, value: b.close })));
    }
    this.chart.timeScale().fitContent();
  }

  /** @param {{t:number,o:number,h:number,l:number,c:number}[]} candles @param {number} intervalSeconds */
  setData(candles, intervalSeconds) {
    this.interval = intervalSeconds || 300;
    this.intraday = this.interval < 86400;
    const seen = new Set();
    this.bars = candles.filter((k) => (seen.has(k.t) ? false : (seen.add(k.t), true)))
      .map((k) => ({ time: k.t, open: k.o, high: k.h, low: k.l, close: k.c }));
    this.render();
  }

  /** Apply a live trade to the last bar (or open a new intraday bar). @param {number} price @param {number} ts */
  tick(price, ts) {
    if (!this.series || !this.bars.length || !Number.isFinite(price)) return;
    const last = this.bars[this.bars.length - 1];
    let bar = last;
    if (this.intraday && ts >= last.time + this.interval) {
      const steps = Math.floor((ts - last.time) / this.interval);
      bar = { time: last.time + steps * this.interval, open: price, high: price, low: price, close: price };
      this.bars.push(bar);
    } else {
      bar.close = price; bar.high = Math.max(bar.high, price); bar.low = Math.min(bar.low, price);
    }
    this.series.update(this.style === 'candle' ? bar : { time: bar.time, value: bar.close });
  }

  destroy() { this.chart.remove(); }
}

/** P/L-at-expiry line with a zero line, for the strategy builder. */
export class PayoffChart {
  /** @param {HTMLElement} el */
  constructor(el) {
    const c = colors(el);
    this.c = c;
    this.chart = LWC().createChart(el, {
      autoSize: true,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: c.text, fontFamily: c.fontFamily, fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: c.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, tickMarkFormatter: (/** @type {number} */ t) => `$${(t / 100).toFixed(0)}` },
      localization: { timeFormatter: (/** @type {number} */ t) => `At $${(t / 100).toFixed(2)}`,
        priceFormatter: (/** @type {number} */ p) => `${p < 0 ? '−' : ''}$${Math.abs(p).toFixed(0)}` },
      handleScroll: false, handleScale: false,
    });
    this.series = this.chart.addBaselineSeries({ baseValue: { type: 'price', price: 0 }, lineWidth: 2 });
    const paint = () => {
      const k = colors(el);
      this.chart.applyOptions({ layout: { textColor: k.text }, grid: { horzLines: { color: k.grid } } });
      this.series.applyOptions({ topLineColor: k.gain, topFillColor1: alpha(k.gain, 0.25), topFillColor2: alpha(k.gain, 0.02),
        bottomLineColor: k.loss, bottomFillColor1: alpha(k.loss, 0.02), bottomFillColor2: alpha(k.loss, 0.25) });
    };
    paint();
    onThemeChange(paint);
  }

  /** The x axis is the underlying price (encoded as cents so it is a valid, increasing "time"). @param {{price:number,pnl:string}[]} points */
  setData(points) {
    const seen = new Set();
    const data = points.map((p) => ({ time: Math.round(p.price * 100), value: Number(p.pnl) }))
      .filter((p) => (seen.has(p.time) ? false : (seen.add(p.time), true)))
      .sort((a, b) => a.time - b.time);
    this.series.setData(data);
    this.chart.timeScale().fitContent();
  }

  destroy() { this.chart.remove(); }
}
