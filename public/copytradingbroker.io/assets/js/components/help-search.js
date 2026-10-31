// @ts-check
/**
 * Live FAQ filter for the help center.
 *
 * <form role="search" data-component="help-search" data-target="faq-list" action="help.html#faq" method="get">
 *   <input type="search" name="q">
 *   <p role="status" data-search-status></p>
 *   <a href="?q=Minimum+deposit#faq" data-search-term="Minimum deposit">Minimum deposit</a>
 * </form>
 * <div id="faq-list">
 *   <section data-faq-group> … <details data-keywords="…"><summary><span data-q>Question</span></summary>…</details></section>
 *   <div data-search-empty hidden> … <span data-search-empty-query></span> … <button data-search-clear></button></div>
 * </div>
 *
 * - Every word must match (question, answer or data-keywords; case- and accent-insensitive).
 * - Non-matching questions and empty groups get `hidden`; matches are wrapped in <mark> (DOM only, no innerHTML).
 * - The result count is announced in the polite status region (debounced).
 * - Works without JS: the form submits ?q= and popular searches are plain links.
 * - Syncs ?q= in the URL with history.replaceState and reads it on load.
 * - Dispatches `help:filtered` on document ({ query, count }) for the table of contents.
 */
import { reducedMotion } from '../lib/util.js';

const norm = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** @param {HTMLFormElement} form */
export function init(form) {
  const input = form.querySelector('input[type="search"]');
  const target = document.getElementById(form.dataset.target || '');
  if (!(input instanceof HTMLInputElement) || !target) return;
  const status = form.querySelector('[data-search-status]');
  const empty = target.querySelector('[data-search-empty]');
  const emptyQuery = target.querySelector('[data-search-empty-query]');
  const lang = document.documentElement.lang || 'en';
  const plural = new Intl.PluralRules(lang);

  const items = [...target.querySelectorAll('details')].map((el) => {
    const label = el.querySelector('[data-q]');
    const original = label?.textContent || '';
    const hay = norm([el.textContent, el.getAttribute('data-keywords') || ''].join(' '));
    return { el, label, original, hay };
  });
  const groups = [...target.querySelectorAll('[data-faq-group]')];

  const ac = new AbortController();
  const { signal } = ac;
  let announceTimer = 0;
  let urlTimer = 0;

  /** Rebuild the question text with <mark> around matched terms. */
  const highlight = (item, terms) => {
    if (!item.label) return;
    if (!terms.length) { item.label.textContent = item.original; return; }
    const re = new RegExp(`(${terms.map(escapeRe).join('|')})`, 'gi');
    const nodes = item.original.split(re).filter(Boolean).map((part) => {
      // split() with a capture group keeps the matches; filter(Boolean) can shift their
      // indexes, so test each part instead.
      if (terms.some((t) => part.toLowerCase() === t)) {
        const m = document.createElement('mark');
        m.textContent = part;
        return m;
      }
      return document.createTextNode(part);
    });
    item.label.replaceChildren(...nodes);
  };

  const describe = (q, count) => {
    if (!q) return '';
    if (count === 0) return `No results for “${q}”`;
    return `${count} ${plural.select(count) === 'one' ? 'result' : 'results'} for “${q}”`;
  };

  /** @param {{ announceNow?: boolean }} [opts] */
  const apply = (opts = {}) => {
    const q = input.value.trim();
    const terms = norm(q).split(/\s+/).filter(Boolean);
    // Highlighting works on the raw text, so use lower-cased (not accent-stripped) terms there.
    const markTerms = q.toLowerCase().split(/\s+/).filter(Boolean);
    let count = 0;
    for (const item of items) {
      const match = terms.every((t) => item.hay.includes(t));
      item.el.hidden = !match;
      if (match) count++;
      highlight(item, match ? markTerms : []);
    }
    for (const g of groups) {
      if (g instanceof HTMLElement) g.hidden = !g.querySelector('details:not([hidden])');
    }
    if (empty instanceof HTMLElement) empty.hidden = !(terms.length && count === 0);
    if (emptyQuery) emptyQuery.textContent = q;
    target.toggleAttribute('data-filtered', terms.length > 0);

    document.dispatchEvent(new CustomEvent('help:filtered', { detail: { query: q, count } }));

    clearTimeout(announceTimer);
    const say = () => { if (status) status.textContent = describe(q, count); };
    if (opts.announceNow) say(); else announceTimer = window.setTimeout(say, 350);

    clearTimeout(urlTimer);
    urlTimer = window.setTimeout(() => {
      const url = new URL(location.href);
      if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
      history.replaceState(history.state, '', url);
    }, 500);
  };

  const scrollToResults = () => {
    target.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  };

  const setQuery = (value, announceNow = true) => {
    input.value = value;
    apply({ announceNow });
  };

  input.addEventListener('input', () => apply(), { signal });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) { e.preventDefault(); setQuery(''); }
  }, { signal });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    apply({ announceNow: true });
    if (input.value.trim()) scrollToResults();
  }, { signal });

  form.addEventListener('click', (e) => {
    const link = /** @type {HTMLElement} */ (e.target).closest('[data-search-term]');
    if (!link) return;
    e.preventDefault();
    setQuery(link.getAttribute('data-search-term') || '');
    input.focus();
  }, { signal });

  target.addEventListener('click', (e) => {
    if (!/** @type {HTMLElement} */ (e.target).closest('[data-search-clear]')) return;
    setQuery('');
    input.focus();
  }, { signal });

  // Initial query from the URL (no-JS submissions and shared links).
  const initial = new URLSearchParams(location.search).get('q');
  if (initial) setQuery(initial);

  return () => { clearTimeout(announceTimer); clearTimeout(urlTimer); ac.abort(); };
}
