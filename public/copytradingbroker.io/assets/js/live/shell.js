// @ts-check
/**
 * Shared loading + data-source UI for the authenticated app.
 *  - Top progress bar, driven by in-flight API requests (requestStart/requestEnd).
 *  - Skeleton helpers: regions carry aria-busy="true" while loading (see live.css).
 *  - Demo marking: content that is not backed by the database is labelled "Demo data".
 */

const BAR_ID = 'live-progress';
let pending = 0;
/** @type {HTMLElement|null} */
let bar = null;
let hideTimer = 0;

function ensureBar() {
  if (bar) return bar;
  if (!document.body) return null;
  bar = document.createElement('div');
  bar.id = BAR_ID;
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Loading data');
  bar.setAttribute('aria-valuetext', 'Loading');
  bar.hidden = true;
  document.body.prepend(bar);
  return bar;
}

function renderBar() {
  const el = ensureBar();
  if (!el) return;
  clearTimeout(hideTimer);
  if (pending > 0) {
    el.hidden = false;
    el.dataset.state = 'active';
    el.removeAttribute('aria-hidden');
  } else {
    el.dataset.state = 'done';
    hideTimer = window.setTimeout(() => {
      if (pending === 0) {
        el.hidden = true;
        el.dataset.state = 'idle';
      }
    }, 320);
  }
}

export function requestStart() {
  pending += 1;
  renderBar();
}

export function requestEnd() {
  pending = Math.max(0, pending - 1);
  renderBar();
}

/** Mark a region busy (skeleton shown) or ready. @param {Element|null} el @param {boolean} [on] */
export function busy(el, on = true) {
  if (!(el instanceof HTMLElement)) return;
  el.setAttribute('data-skeleton', '');
  el.setAttribute('aria-busy', on ? 'true' : 'false');
}

/**
 * Fill a table body with skeleton rows.
 * @param {HTMLTableSectionElement|null} tbody
 * @param {number} cols
 * @param {number} [rows]
 */
export function skeletonRows(tbody, cols, rows = 4) {
  if (!tbody) return;
  const widths = ['70%', '45%', '60%', '35%', '55%', '40%'];
  tbody.innerHTML = Array.from({ length: rows }, (_, r) => `<tr class="sk-row" aria-hidden="true">${
    Array.from({ length: cols }, (_c, c) => `<td><span class="skeleton sk-bar" style="inline-size:${widths[(r + c) % widths.length]}"></span></td>`).join('')
  }</tr>`).join('');
  tbody.setAttribute('aria-busy', 'true');
}

/**
 * Mark a region as demo (not from the database) by adding a visible badge
 * to its heading. Idempotent.
 * @param {Element|null} region
 * @param {string} [note]
 */
export function markDemo(region, note = 'This content is sample data and is not stored in the database.') {
  if (!(region instanceof HTMLElement)) return;
  region.dataset.dataSource = 'demo';
  if (region.querySelector(':scope > .block-head [data-demo-badge], :scope > header [data-demo-badge], :scope > h2 [data-demo-badge], :scope > [data-demo-badge]')) return;
  const badge = document.createElement('span');
  badge.className = 'demo-badge';
  badge.dataset.demoBadge = '';
  badge.title = note;
  badge.textContent = 'Demo data';
  const heading = region.querySelector(':scope > .block-head > h2, :scope > .block-head > h3, :scope > h2, :scope > h3, :scope > header h2') || region.querySelector('h2, h3');
  if (heading) heading.after(badge);
  else region.prepend(badge);
}

/** Remove demo badges from a region once real data is shown. @param {Element|null} region */
export function markLive(region) {
  if (!(region instanceof HTMLElement)) return;
  region.dataset.dataSource = 'live';
  region.querySelectorAll('[data-demo-badge]').forEach((el) => el.remove());
}

/**
 * Render an empty state inside a region (real data, but none exists yet).
 * @param {HTMLElement|null} region
 * @param {string} title
 * @param {string} [text]
 */
export function emptyState(region, title, text = '') {
  if (!(region instanceof HTMLElement)) return;
  const existing = region.querySelector(':scope > .live-empty');
  const node = existing || document.createElement('div');
  node.className = 'live-empty empty';
  node.innerHTML = `<p class="empty__title"></p>${text ? '<p></p>' : ''}`;
  const [t, p] = node.querySelectorAll('p');
  if (t) t.textContent = title;
  if (p) p.textContent = text;
  if (!existing) region.append(node);
}

/** Clear a previously rendered empty state. @param {HTMLElement|null} region */
export function clearEmpty(region) {
  region?.querySelectorAll(':scope > .live-empty').forEach((el) => el.remove());
}

/** Clear every remaining skeleton once a page has finished loading (success or failure). @param {ParentNode} [root] */
export function settle(root = document) {
  root.querySelectorAll('[data-skeleton][aria-busy="true"]').forEach((el) => el.setAttribute('aria-busy', 'false'));
  root.querySelectorAll('tbody[aria-busy="true"]').forEach((el) => el.removeAttribute('aria-busy'));
}
