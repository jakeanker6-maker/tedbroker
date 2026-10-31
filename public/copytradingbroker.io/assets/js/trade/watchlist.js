// @ts-check
/** Symbol search (ARIA combobox) and the watchlist rail. */
import { api } from '../live/api.js';
import { toast } from '../lib/util.js';
import { $, $$, h, price, signedPct, tone } from './dom.js';

/**
 * @param {HTMLElement} root  [data-symbol-search]
 * @param {(r: {symbol: string, asset_class: string, name: string}) => void} onPick
 */
export function symbolSearch(root, onPick) {
  const input = /** @type {HTMLInputElement} */ ($('input', root));
  const list = /** @type {HTMLElement} */ ($('[role="listbox"]', root));
  /** @type {any[]} */ let results = [];
  let active = -1;
  let seq = 0;
  let shownFor = '';
  /** @type {Promise<void>|null} */ let inflight = null;
  /** @type {any} */ let timer = null;

  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; };
  const highlight = (/** @type {number} */ i) => {
    active = i;
    $$('[role="option"]', list).forEach((o, j) => o.setAttribute('aria-selected', String(j === i)));
    const opt = list.children[i];
    if (opt && i >= 0) { input.setAttribute('aria-activedescendant', opt.id); opt.scrollIntoView({ block: 'nearest' }); }
  };
  const pick = (/** @type {number} */ i) => {
    const r = results[i];
    if (!r) return;
    close();
    input.value = '';
    shownFor = '';
    onPick(r);
  };

  /** Run the search for the current text; only the latest request may render. */
  function run() {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { close(); results = []; shownFor = ''; return Promise.resolve(); }
    const mine = ++seq;
    inflight = (async () => {
      let res = [];
      try { res = (await api(`/api/market/search?q=${encodeURIComponent(q)}&limit=12`)).results || []; } catch { res = []; }
      if (mine !== seq) return;
      results = res;
      shownFor = q;
      list.replaceChildren(...results.map((r, i) => h('li', {
        class: 'th-search__opt', role: 'option', id: `th-opt-${i}`, 'aria-selected': 'false',
        onmousedown: (/** @type {Event} */ e) => { e.preventDefault(); pick(i); },
      }, h('b', null, r.symbol), h('span', null, r.name), h('small', null, r.asset_class))));
      if (!results.length) list.replaceChildren(h('li', { class: 'th-search__opt', role: 'option', 'aria-disabled': 'true', id: 'th-opt-none' }, h('span', null, 'No matching symbols')));
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      highlight(results.length ? 0 : -1);
    })();
    return inflight;
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 150); });
  input.addEventListener('keydown', async (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (list.hidden) { await run(); return; }
      highlight(Math.min(results.length - 1, active + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlight(Math.max(0, active - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shownFor !== input.value.trim()) await run();   // never pick results of an older query
      pick(active < 0 ? 0 : active);
    } else if (e.key === 'Escape') {
      if (!list.hidden) close();
      else input.value = '';
    }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyF') { e.preventDefault(); input.focus(); input.select(); }
  });
}

/**
 * @param {{select: HTMLSelectElement, list: HTMLElement, toggle: HTMLButtonElement}} el
 * @param {{onSelect: (symbol: string) => void, onSymbols: (s: string[]) => void, current: () => string}} ctx
 */
export function watchlist(el, ctx) {
  /** @type {any[]} */ let lists = [];
  let activeId = '';
  /** @type {Map<string, {px: HTMLElement, chg: HTMLElement, nm: HTMLElement}>} */ const cells = new Map();

  const active = () => lists.find((w) => w.id === activeId) || lists[0];

  async function load() {
    try {
      const res = await api('/api/trading/watchlists');
      lists = res.watchlists || [];
      activeId = activeId || lists[0]?.id || '';
      el.select.replaceChildren(...lists.map((w) => h('option', { value: w.id }, w.name)));
      el.select.value = activeId;
      render();
    } catch (err) { console.error('[watchlist]', err); }
  }

  function render() {
    const w = active();
    cells.clear();
    const symbols = w?.symbols || [];
    el.list.replaceChildren(...symbols.map((/** @type {string} */ s) => {
      const px = h('span', { class: 'th-watch__px' }, '—');
      const chg = h('span', { class: 'th-watch__chg' }, '');
      const nm = h('span', { class: 'th-watch__name' }, '');
      cells.set(s, { px, chg, nm });
      return h('li', { class: 'th-watch__item', dataset: { symbol: s } },
        h('a', { href: `?symbol=${encodeURIComponent(s)}`, 'aria-current': s === ctx.current() ? 'true' : null,
          onclick: (/** @type {Event} */ e) => { e.preventDefault(); ctx.onSelect(s); } },
          h('span', { class: 'th-watch__sym' }, s), px, nm, chg));
    }));
    syncToggle();
    ctx.onSymbols(symbols);
  }

  function syncToggle() {
    const inList = (active()?.symbols || []).includes(ctx.current());
    el.toggle.setAttribute('aria-pressed', String(inList));
    el.toggle.textContent = inList ? 'Remove from list' : 'Add to watchlist';
  }

  el.select.addEventListener('change', () => { activeId = el.select.value; render(); });
  el.toggle.addEventListener('click', async () => {
    const w = active();
    const sym = ctx.current();
    if (!w || !sym) return;
    const inList = w.symbols.includes(sym);
    try {
      const res = inList
        ? await api(`/api/trading/watchlists/${encodeURIComponent(w.id)}/symbols/${encodeURIComponent(sym)}`, { method: 'DELETE' })
        : await api(`/api/trading/watchlists/${encodeURIComponent(w.id)}/symbols`, { method: 'POST', body: JSON.stringify({ symbol: sym }) });
      Object.assign(w, res);
      render();
      toast(inList ? `${sym} removed from ${w.name}` : `${sym} added to ${w.name}`);
    } catch (err) { toast(/** @type {Error} */ (err).message, { tone: 'error' }); }
  });

  return {
    load,
    /** @param {any} q */
    tick(q) {
      const c = cells.get(q.symbol);
      if (!c) return;
      c.px.textContent = price(q.last);
      const cp = Number(q.change_percent);
      c.chg.textContent = q.change_percent == null ? '' : `${cp > 0 ? '▲ ' : cp < 0 ? '▼ ' : ''}${signedPct(cp)}`;
      c.chg.className = `th-watch__chg ${tone(q.change_percent)}`;
      if (q.name && !c.nm.textContent) c.nm.textContent = q.name;
    },
    markCurrent() {
      $$('.th-watch__item', el.list).forEach((li) => {
        const a = li.querySelector('a');
        if (!a) return;
        if (li.dataset.symbol === ctx.current()) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      });
      syncToggle();
    },
  };
}
