// @ts-check
/**
 * Filters the wallet ledger by transaction type when a history tab changes.
 * <section data-component="wallet-history">
 *   <div role="tablist" data-component="tabs"> <button role="tab" data-filter="all|deposit|withdrawal|trade|copy|plan" aria-controls="panel">…
 *   <div role="tabpanel" id="panel"> … <tr data-type="deposit"> … <tr data-history-empty hidden> …
 *   <p data-history-count aria-live="polite"></p>
 * All tabs control one shared panel.
 */
const EMPTY = {
  all: 'No transactions yet',
  deposit: 'No deposits yet',
  withdrawal: 'No withdrawals yet',
  trade: 'No trading activity yet',
  copy: 'No copy trading activity yet',
  plan: 'No plan activity yet',
  payout: 'No plan payouts yet',
};
const NOUN = {
  all: ['transaction', 'transactions'],
  deposit: ['deposit', 'deposits'],
  withdrawal: ['withdrawal', 'withdrawals'],
  trade: ['trading entry', 'trading entries'],
  copy: ['copy trading entry', 'copy trading entries'],
  plan: ['plan entry', 'plan entries'],
  payout: ['plan payout', 'plan payouts'],
};

/** @param {HTMLElement} root */
export function init(root) {
  const ac = new AbortController();
  const rows = /** @type {HTMLTableRowElement[]} */ ([...root.querySelectorAll('tr[data-type]')]);
  const empty = /** @type {HTMLElement|null} */ (root.querySelector('[data-history-empty]'));
  const emptyTitle = empty?.querySelector('[data-history-empty-title]');
  const count = root.querySelector('[data-history-count]');
  const plural = new Intl.PluralRules(document.documentElement.lang || 'en');

  /** @param {string} type */
  const apply = (type) => {
    let n = 0;
    for (const tr of rows) {
      const show = type === 'all' || tr.dataset.type === type;
      tr.hidden = !show;
      if (show) n++;
    }
    if (empty) empty.hidden = n > 0;
    if (emptyTitle) emptyTitle.textContent = EMPTY[type] || EMPTY.all;
    if (count) {
      const [one, many] = NOUN[type] || NOUN.all;
      count.textContent = `${n} ${plural.select(n) === 'one' ? one : many}`;
    }
  };

  root.addEventListener('tabs:change', (/** @type {Event} */ e) => {
    const tab = /** @type {CustomEvent} */ (e).detail?.tab;
    if (!(tab instanceof HTMLElement)) return;
    // Shared panel: tabs.js hides every panel not owned by the last tab it visits, so re-show it.
    const panel = document.getElementById(tab.getAttribute('aria-controls') || '');
    if (panel) { panel.hidden = false; panel.setAttribute('aria-labelledby', tab.id); }
    apply(tab.dataset.filter || 'all');
  }, { signal: ac.signal });

  const current = root.querySelector('[role="tab"][aria-selected="true"]');
  apply(current instanceof HTMLElement ? current.dataset.filter || 'all' : 'all');
  return () => ac.abort();
}
