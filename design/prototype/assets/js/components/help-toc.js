// @ts-check
/**
 * In-page table of contents with scroll-spy.
 *
 * <nav class="help-toc" data-component="help-toc" aria-label="Help topics">
 *   <ul><li><a href="#faq-general">General</a></li>…</ul>
 * </nav>
 *
 * - The link for the section currently in the reading band gets aria-current="true".
 * - Listens for `help:filtered` (from help-search) and hides links whose section is hidden.
 */

/** @param {HTMLElement} nav */
export function init(nav) {
  /** @type {{ link: HTMLAnchorElement, section: HTMLElement }[]} */
  const entries = [];
  for (const a of nav.querySelectorAll('a[href^="#"]')) {
    if (!(a instanceof HTMLAnchorElement)) continue;
    const section = document.getElementById(decodeURIComponent(a.hash.slice(1)));
    if (section) entries.push({ link: a, section });
  }
  if (!entries.length) return;

  const ac = new AbortController();
  const inBand = new Set();

  /** @param {HTMLAnchorElement | undefined} link */
  const setActive = (link) => {
    if (!link) return;
    for (const { link: l } of entries) {
      if (l === link) l.setAttribute('aria-current', 'true');
      else l.removeAttribute('aria-current');
    }
  };

  const pick = () => {
    const current = entries.find(({ section }) => inBand.has(section) && !section.hidden);
    if (current) setActive(current.link);
  };

  // Reading band: from 20% to 45% of the viewport height.
  const io = new IntersectionObserver((records) => {
    for (const r of records) {
      if (r.isIntersecting) inBand.add(r.target); else inBand.delete(r.target);
    }
    pick();
  }, { rootMargin: '-20% 0px -55% 0px' });
  entries.forEach(({ section }) => io.observe(section));

  nav.addEventListener('click', (e) => {
    const a = /** @type {HTMLElement} */ (e.target).closest('a[href^="#"]');
    if (a instanceof HTMLAnchorElement) setActive(a);
  }, { signal: ac.signal });

  // Mirror hidden (filtered-out) sections in the TOC.
  const syncHidden = () => {
    for (const { link, section } of entries) {
      const li = link.closest('li');
      if (li) li.hidden = section.hidden;
    }
    const active = entries.find(({ link }) => link.getAttribute('aria-current') === 'true');
    if (!active || active.section.hidden) setActive(entries.find(({ section }) => !section.hidden)?.link);
  };
  document.addEventListener('help:filtered', syncHidden, { signal: ac.signal });

  setActive(entries[0].link);
  syncHidden(); // help-search may have filtered (?q=) before this module loaded

  return () => { io.disconnect(); ac.abort(); };
}
