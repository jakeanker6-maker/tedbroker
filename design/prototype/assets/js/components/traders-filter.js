// @ts-check
/**
 * Client-side filter / sort / search for the trader ledger.
 *
 * <section data-component="traders-filter">
 *   <form class="filterbar"> .spec buttons[aria-pressed][value], select[name=risk|win|sort], input[name=q] </form>
 *   <p role="status" data-filter-count></p>
 *   <table> <tbody class="trader" data-name data-spec data-risk data-win data-return data-copiers data-dd>
 *             <tr>…</tr><tr class="ledger__detail">…</tr>      ← one tbody per trader keeps the detail row attached
 *           </tbody>…
 *           <tbody data-filter-empty hidden>…<button data-filter-reset></tbody>
 *   </table>
 * </section>
 * Reads ?q= on load so the top-bar search ("copy-traders.html?q=…") lands pre-filtered.
 */

const RISK = { any: [1, 10], low: [1, 3], med: [4, 6], high: [7, 10] };
const SORT = {
  return: (a, b) => num(b, 'return') - num(a, 'return'),
  win: (a, b) => num(b, 'win') - num(a, 'win'),
  copiers: (a, b) => num(b, 'copiers') - num(a, 'copiers'),
  dd: (a, b) => num(a, 'dd') - num(b, 'dd'),
};
/** @param {HTMLElement} el @param {string} key */
const num = (el, key) => Number(el.dataset[key] || 0);
const norm = (s) => s.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** @param {HTMLElement} root */
export function init(root) {
  const form = /** @type {HTMLFormElement|null} */ (root.querySelector('.filterbar'));
  const table = root.querySelector('table');
  const empty = /** @type {HTMLElement|null} */ (root.querySelector('[data-filter-empty]'));
  const count = root.querySelector('[data-filter-count]');
  if (!form || !table) return;
  const rows = /** @type {HTMLElement[]} */ ([...table.querySelectorAll('tbody.trader')]);
  const specBtns = /** @type {HTMLButtonElement[]} */ ([...form.querySelectorAll('.spec [aria-pressed]')]);
  const els = /** @type {HTMLFormControlsCollection & Record<string, HTMLInputElement|HTMLSelectElement>} */ (form.elements);
  // Searchable text per row, computed once.
  const haystack = new Map(rows.map((r) => [r, norm(r.querySelector('tr')?.textContent || '')]));

  const q = new URLSearchParams(location.search).get('q');
  if (q) els.q.value = q;

  let lastCount = '';
  const apply = () => {
    const spec = specBtns.find((b) => b.getAttribute('aria-pressed') === 'true')?.value || 'all';
    const [rMin, rMax] = RISK[els.risk.value] || RISK.any;
    const minWin = Number(els.win.value || 0);
    const terms = norm(els.q.value.trim()).split(/\s+/).filter(Boolean);
    const sort = SORT[els.sort.value] || SORT.return;

    let shown = 0;
    for (const r of rows) {
      const risk = num(r, 'risk');
      const text = haystack.get(r) || '';
      const match = (spec === 'all' || r.dataset.spec === spec)
        && risk >= rMin && risk <= rMax
        && num(r, 'win') >= minWin
        && terms.every((t) => text.includes(t));
      r.hidden = !match;
      if (match) shown++;
    }
    // Re-order whole row groups (trader row + its detail row move together).
    const sorted = [...rows].sort(sort);
    if (sorted.some((r, i) => table.tBodies[i] !== r)) table.append(...sorted, ...(empty ? [empty] : []));
    if (empty) empty.hidden = shown > 0;

    const text = `Showing ${shown} of ${rows.length}`;
    if (count && text !== lastCount) { count.textContent = text; lastCount = text; }
  };

  let t = 0;
  form.addEventListener('input', (e) => {
    if (e.target === els.q) { clearTimeout(t); t = window.setTimeout(apply, 150); } else apply();
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(t); apply(); });
  form.querySelector('.spec')?.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button[aria-pressed]');
    if (!btn) return;
    specBtns.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    apply();
  });
  root.addEventListener('click', (e) => {
    if (!(/** @type {HTMLElement} */ (e.target).closest('[data-filter-reset]'))) return;
    form.reset();
    specBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === 0)));
    apply();
    specBtns[0]?.focus();
  });

  apply();
}
