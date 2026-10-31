// @ts-check
/**
 * Filters the referrals ledger by status.
 *
 * <section data-component="ref-filter">
 *   <div role="group" aria-label="Filter referrals">
 *     <button type="button" data-filter="all" aria-pressed="true">All</button>
 *     <button type="button" data-filter="active" aria-pressed="false">Active</button> …
 *   </div>
 *   <table>… <tr data-status="active|pending|inactive">…</tr> … <tr data-ref-empty hidden>…</tr></table>
 *   <p data-ref-status aria-live="polite"></p>
 * </section>
 */
import { format } from '../lib/util.js';

const NAMES = { all: 'referrals', active: 'active referrals', pending: 'pending referrals', inactive: 'inactive referrals' };

export function init(root) {
  const btns = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('button[data-filter]')]);
  const rows = /** @type {HTMLTableRowElement[]} */ ([...root.querySelectorAll('tbody tr[data-status]')]);
  const empty = /** @type {HTMLElement|null} */ (root.querySelector('[data-ref-empty]'));
  const status = root.querySelector('[data-ref-status]');
  const total = rows.length;

  const apply = (filter, announce = true) => {
    let shown = 0;
    for (const r of rows) {
      const on = filter === 'all' || r.dataset.status === filter;
      r.hidden = !on;
      if (on) shown++;
    }
    if (empty) empty.hidden = shown > 0;
    for (const b of btns) b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
    if (status && announce) {
      status.textContent = shown
        ? `Showing ${format(shown, 'number', 0)} of ${format(total, 'number', 0)} recent ${NAMES[filter] || 'referrals'}`
        : `No ${NAMES[filter] || 'referrals'} among your recent sign-ups`;
    }
  };

  root.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-filter]');
    if (!btn || !root.contains(btn)) return;
    apply(btn.getAttribute('data-filter') || 'all');
  });

  const initial = btns.find((b) => b.getAttribute('aria-pressed') === 'true');
  apply(initial?.dataset.filter || 'all', false);
}
