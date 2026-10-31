// @ts-check
/** Company tab: profile, key statistics, earnings dates and news for the current symbol. */
import { api } from '../live/api.js';
import { h, price } from './dom.js';

const big = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const num = (/** @type {unknown} */ v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }));
const pct = (/** @type {unknown} */ v) => (v == null || !Number.isFinite(Number(v)) ? '—' : `${Number(v).toFixed(2)}%`);
const usdBig = (/** @type {unknown} */ v) => (v == null || !Number(v) ? '—' : `$${big.format(Number(v))}`);
const day = (/** @type {string} */ s) => (s ? new Date(`${s}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '—');

/** @param {string} label @param {string} value */
/** Only http(s) links reach the DOM (the API filters too). @param {unknown} u @param {boolean} [httpsOnly] */
const safeUrl = (u, httpsOnly = false) => {
  try { const p = new URL(String(u)); return (p.protocol === 'https:' || (!httpsOnly && p.protocol === 'http:')) ? p.href : null; } catch { return null; }
};

/** @param {string} label @param {string} value */
const fact = (label, value) => h('div', null, h('dt', null, label), h('dd', { class: 'mono' }, value));

/** @param {string} title @param {any} part @param {() => Node[]} body */
function card(title, part, body) {
  const head = h('h3', { class: 'th-label' }, title);
  if (!part || part.available === false) {
    return h('section', { class: 'th-co__card' }, head,
      h('p', { class: 'muted' }, part?.reason || 'Not available right now. Try again in a minute.'));
  }
  return h('section', { class: 'th-co__card' }, head, ...body(), part.source ? h('p', { class: 'fineprint' }, `Source: ${part.source}`) : null);
}

/** @param {HTMLElement} root */
export function companyPanel(root) {
  let seq = 0;
  let shown = '';

  /** @param {string} symbol @param {boolean} [force] */
  async function load(symbol, force = false) {
    if (!force && symbol === shown) return;
    const mine = ++seq;
    shown = symbol;
    root.setAttribute('aria-busy', 'true');
    root.replaceChildren(h('p', { class: 'muted', role: 'status' }, `Loading ${symbol}…`));
    try {
      const c = await api(`/api/market/company/${encodeURIComponent(symbol)}`);
      if (mine !== seq) return;
      render(c);
    } catch (err) {
      if (mine !== seq) return;
      shown = '';
      root.replaceChildren(h('p', { class: 'muted', role: 'alert' }, /** @type {Error} */ (err).message));
    } finally {
      if (mine === seq) root.removeAttribute('aria-busy');
    }
  }

  /** @param {any} c */
  function render(c) {
    const p = c.profile || {};
    const s = c.stats || {};
    const e = c.earnings || {};
    const n = c.news || {};
    const about = card('About', p, () => [
      h('div', { class: 'th-co__id' },
        safeUrl(p.logo, true) ? h('img', { src: safeUrl(p.logo, true), alt: '', width: 40, height: 40, loading: 'lazy', referrerpolicy: 'no-referrer', class: 'th-co__logo' }) : null,
        h('div', null, h('p', { class: 'th-co__name' }, p.name || c.name || c.symbol),
          h('p', { class: 'muted' }, [...new Set([p.sector, p.industry, p.country].filter(Boolean))].join(' · ') || c.asset_class.toUpperCase()))),
      p.description ? h('p', { class: 'th-co__desc' }, p.description) : null,
      h('dl', { class: 'th-co__facts' },
        p.market_cap ? fact('Market cap', usdBig(p.market_cap)) : null,
        p.net_assets ? fact('Net assets', usdBig(p.net_assets)) : null,
        p.expense_ratio != null ? fact('Expense ratio', pct(p.expense_ratio)) : null,
        p.fund_family ? fact('Fund family', p.fund_family) : null,
        p.employees ? fact('Employees', num(p.employees, 0)) : null,
        p.ipo ? fact('Listed since', day(p.ipo)) : null,
        p.exchange ? fact('Exchange', p.exchange) : null),
      safeUrl(p.website) ? h('p', null, h('a', { href: safeUrl(p.website), target: '_blank', rel: 'noopener noreferrer' }, 'Company website', h('span', { class: 'sr-only' }, ' (opens in a new tab)'))) : null,
    ]);
    const stats = card('Key statistics', s, () => [h('dl', { class: 'th-co__facts th-co__facts--grid' },
      fact('P/E (TTM)', num(s.pe_ttm)), fact('EPS (TTM)', s.eps_ttm == null ? '—' : price(s.eps_ttm)),
      fact('52-week high', s.week52_high == null ? '—' : price(s.week52_high)), fact('52-week low', s.week52_low == null ? '—' : price(s.week52_low)),
      fact('Beta', num(s.beta)), fact('Dividend yield', pct(s.dividend_yield)),
      fact('Revenue growth (TTM)', pct(s.revenue_growth_ttm)), fact('EPS growth (TTM)', pct(s.eps_growth_ttm)),
      fact('Net margin (TTM)', pct(s.net_margin_ttm)), fact('Return on equity', pct(s.roe_ttm)),
      fact('Price / book', num(s.price_to_book)), fact('Avg volume (10 days)', s.avg_volume_10d_millions == null ? '—' : `${num(s.avg_volume_10d_millions)}M`))]);
    const earn = card('Earnings', e, () => {
      const nx = e.next;
      const out = [nx
        ? h('p', { class: 'th-co__next' }, h('strong', null, `Next report: ${day(nx.date)}`), nx.time ? ` · ${nx.time}` : '',
          nx.eps_estimate != null ? h('span', { class: 'muted' }, ` · EPS estimate ${price(nx.eps_estimate)}`) : null)
        : h('p', { class: 'muted' }, 'No upcoming earnings date announced.')];
      if (e.recent?.length) {
        out.push(h('div', { class: 'ledger-wrap', tabindex: '0', role: 'region', 'aria-label': 'Recent earnings' },
          h('table', { class: 'ledger th-table' }, h('caption', { class: 'sr-only' }, 'Recent earnings reports'),
            h('thead', null, h('tr', null, ...['Date', 'Quarter', 'EPS est.', 'EPS actual', 'Surprise'].map((t, i) => h('th', { scope: 'col', class: i > 1 ? 'is-num' : null }, t)))),
            h('tbody', null, ...e.recent.map((/** @type {any} */ r) => {
              const surprise = r.eps_actual != null && r.eps_estimate ? (r.eps_actual - r.eps_estimate) / Math.abs(r.eps_estimate) * 100 : null;
              return h('tr', null, h('td', null, day(r.date)), h('td', null, `Q${r.quarter} ${r.year}`),
                h('td', { class: 'is-num' }, r.eps_estimate == null ? '—' : price(r.eps_estimate)),
                h('td', { class: 'is-num' }, r.eps_actual == null ? '—' : price(r.eps_actual)),
                h('td', { class: `is-num ${surprise == null ? '' : surprise >= 0 ? 'gain' : 'loss'}` }, surprise == null ? '—' : `${surprise >= 0 ? '+' : '−'}${Math.abs(surprise).toFixed(1)}%`));
            })))));
      }
      return out;
    });
    const news = card('News', n, () => [n.items?.length
      ? h('ul', { class: 'th-co__news', role: 'list' }, ...n.items.filter((/** @type {any} */ it) => safeUrl(it.url)).map((/** @type {any} */ it) => h('li', null,
        h('a', { href: safeUrl(it.url), target: '_blank', rel: 'noopener noreferrer' }, it.headline, h('span', { class: 'sr-only' }, ' (opens in a new tab)')),
        h('p', { class: 'muted' }, `${it.source || 'News'} · ${new Date(it.published_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`),
        it.summary ? h('p', { class: 'th-co__sum' }, it.summary) : null)))
      : h('p', { class: 'muted' }, 'No news in the last week.')]);
    root.replaceChildren(h('div', { class: 'th-co' }, about, stats, earn, news),
      h('p', { class: 'fineprint' }, 'Company data and news come from Finnhub and Yahoo Finance and can be delayed. Links open the publisher’s site.'));
  }

  return { load, reset: () => { shown = ''; } };
}
