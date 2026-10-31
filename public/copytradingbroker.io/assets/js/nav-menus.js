/* Public header menus (Company, Legal):
 * 1. Only one open at a time (native <details> do not close each other).
 * 2. Always closed on page load, on back/forward restore, and when one of their links is chosen. */
(function () {
  'use strict';
  function closeAll(except) {
    document.querySelectorAll('.site-nav__group > details[open]').forEach(function (d) {
      if (d !== except) d.open = false;
    });
  }
  document.addEventListener('toggle', function (event) {
    var opened = event.target;
    if (!(opened instanceof HTMLDetailsElement) || !opened.open) return;
    if (!opened.closest('.site-nav__group')) return;
    closeAll(opened);
  }, true);
  document.addEventListener('click', function (event) {
    if (event.target.closest && event.target.closest('.site-nav__menu a')) closeAll(null);
  });
  function reset() { closeAll(null); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reset); else reset();
  window.addEventListener('pageshow', reset);
})();
