// @ts-check
/**
 * APG tabs. Markup:
 * <div class="tabs" role="tablist" data-component="tabs" aria-label="…">
 *   <button class="tabs__tab" role="tab" id="t1" aria-controls="p1" aria-selected="true">…</button> …
 * </div>
 * <div role="tabpanel" id="p1" aria-labelledby="t1" tabindex="0">…</div>
 */
export function init(list) {
  const tabs = /** @type {HTMLElement[]} */ ([...list.querySelectorAll('[role="tab"]')]);
  const select = (tab, focus = true) => {
    const activeId = tab.getAttribute('aria-controls');
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const id = t.getAttribute('aria-controls');
      const panel = document.getElementById(id || '');
      if (panel) panel.hidden = id !== activeId; // panels shared by several tabs stay visible
    }
    if (focus) tab.focus();
    list.dispatchEvent(new CustomEvent('tabs:change', { detail: { tab }, bubbles: true }));
  };
  tabs.forEach((t) => {
    t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1;
    t.addEventListener('click', () => select(t, false));
  });
  list.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    if (i < 0) return;
    const rtl = getComputedStyle(list).direction === 'rtl';
    const next = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];
    if (next) { e.preventDefault(); select(tabs[(i + next + tabs.length) % tabs.length]); }
    else if (e.key === 'Home') { e.preventDefault(); select(tabs[0]); }
    else if (e.key === 'End') { e.preventDefault(); select(tabs[tabs.length - 1]); }
  });
}
