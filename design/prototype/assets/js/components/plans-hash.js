// @ts-check
/**
 * Deep links for a tablist: "#etf" selects the tab with data-hash="etf" on load and on hashchange,
 * and selecting a tab updates the URL (replaceState, no scroll jump). The first tab has no hash.
 * Also keeps the rail's "Investment plans" sub-links' aria-current in step.
 *
 * <div class="tabs" role="tablist" data-component="tabs plans-hash">
 *   <button role="tab" data-hash="robo" …>…</button> <button role="tab" data-hash="etf" …>…</button> …
 * </div>
 * Works alongside tabs.js (which owns clicks and arrow keys); it sets the same ARIA state directly
 * so it does not depend on module load order.
 */

/** @param {HTMLElement} list */
export function init(list) {
  const tabs = /** @type {HTMLElement[]} */ ([...list.querySelectorAll('[role="tab"][data-hash]')]);
  if (!tabs.length) return;
  const page = location.pathname.split('/').pop() || '';
  const railLinks = /** @type {HTMLAnchorElement[]} */ ([...document.querySelectorAll('.rail a[href^="plans.html"]')]);

  const markRail = (tab) => {
    const hash = tab === tabs[0] ? '' : `#${tab.dataset.hash}`;
    for (const a of railLinks) {
      const h = a.getAttribute('href') || '';
      const on = h === `plans.html${hash}`;
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    }
  };

  /** @param {HTMLElement} tab */
  const select = (tab) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls') || '');
      if (panel) panel.hidden = !on;
    }
    markRail(tab);
  };

  const fromHash = () => {
    const key = decodeURIComponent(location.hash.slice(1));
    const tab = tabs.find((t) => t.dataset.hash === key) || (key ? null : tabs[0]);
    if (!tab) return; // unrelated anchors (e.g. #main skip link) leave the tabs alone
    const active = document.activeElement;
    select(tab);
    // A link inside a panel (e.g. Staking → "#defi") just hid itself: keep focus on the new tab.
    if (active instanceof HTMLElement && active !== document.body && active.closest('[role="tabpanel"][hidden]')) tab.focus();
    // Coming from a rail link on this page: close the off-canvas rail on small screens.
    /** @type {HTMLElement|null} */ (document.querySelector('.app[data-rail-open] .rail-scrim'))?.click();
  };

  list.addEventListener('tabs:change', (/** @type {Event} */ e) => {
    const tab = /** @type {CustomEvent} */ (e).detail?.tab;
    if (!tab) return;
    markRail(tab);
    const hash = tab === tabs[0] ? '' : `#${tab.dataset.hash}`;
    if (location.hash !== hash) history.replaceState(null, '', `${page}${location.search}${hash}` || location.pathname);
  });
  addEventListener('hashchange', fromHash);
  if (location.hash) fromHash();
}
