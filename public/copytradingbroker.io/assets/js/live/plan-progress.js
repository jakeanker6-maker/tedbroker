// @ts-check
/**
 * Managed-plan progress shared by the Investment plans and Portfolio pages.
 * Source: GET /api/investments/active-plans (investments with status active or matured).
 * Values that are not measured are shown as "—", never as zero.
 */
import { api } from './api.js';

/** Category labels for the plan_category field of an active investment. */
export const CATEGORY_LABEL = /** @type {Record<string, string>} */ ({
  robo: 'Robo Advisor', etf: 'ETF automation', defi: 'DeFi', options: 'Options',
});

const LISTS = ['general_plans', 'etf_plans', 'defi_plans', 'options_plans'];

/** Flattened list of the user's active and matured plan investments. @returns {Promise<any[]>} */
export async function fetchActivePlans() {
  const data = await api('/api/investments/active-plans');
  const seen = new Set();
  /** @type {any[]} */
  const rows = [];
  for (const key of LISTS) {
    const list = Array.isArray(data?.[key]) ? data[key] : [];
    for (const item of list) {
      const id = item?.id == null ? '' : String(item.id);
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      rows.push(item);
    }
  }
  return rows;
}

/** @param {unknown} value */
export function progressValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
}

/** "42%" or "—" when the progress has not been measured. @param {unknown} value */
export function pctText(value) {
  const v = progressValue(value);
  return v === null ? '—' : `${Math.round(v)}%`;
}

/**
 * Progress bar element (role="progressbar"). Returns null when there is no measured value.
 * The width is set through the CSSOM, never from server text.
 * @param {unknown} value progress_percent, 0-100
 * @param {string} label accessible name, e.g. the plan name
 * @returns {HTMLElement|null}
 */
export function progressBar(value, label) {
  const v = progressValue(value);
  if (v === null) return null;
  const rounded = Math.round(v * 10) / 10;
  const bar = document.createElement('span');
  bar.className = 'plan-progress';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', `Progress of ${label}`);
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', String(rounded));
  bar.setAttribute('aria-valuetext', `${Math.round(v)}%`);
  const fill = document.createElement('span');
  fill.className = 'plan-progress__fill';
  fill.style.inlineSize = `${rounded}%`;
  bar.append(fill);
  return bar;
}
