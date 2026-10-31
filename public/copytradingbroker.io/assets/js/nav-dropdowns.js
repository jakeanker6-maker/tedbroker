/* Header menus: only one dropdown open at a time.
 * Bootstrap (plugins.js) dispatches show.bs.dropdown on the toggle before opening it;
 * close every other open toggle at that point. */
(function () {
  'use strict';
  document.addEventListener('show.bs.dropdown', function (event) {
    var opening = event.target;
    document.querySelectorAll('[data-bs-toggle="dropdown"][aria-expanded="true"]').forEach(function (toggle) {
      if (toggle === opening || !window.bootstrap || !bootstrap.Dropdown) return;
      bootstrap.Dropdown.getOrCreateInstance(toggle).hide();
    });
  });
})();
