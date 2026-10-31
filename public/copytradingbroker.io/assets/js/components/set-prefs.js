// @ts-check
/**
 * Settings → Preferences: theme radios + notification switches.
 *
 *  - input[name="theme"][value="system|dark|light"] — applies immediately to
 *    document.documentElement.dataset.theme and persists in localStorage 'ted:theme'.
 *    "system" is stored as 'system' and resolved here from prefers-color-scheme.
 *  - input[data-set-notify="Label"] (role="switch") — toast on change.
 * Keeps the top-bar [data-theme-toggle] (aria-pressed) and these radios in sync both ways.
 */
import { toast } from '../lib/util.js';

const KEY = 'ted:theme';
const root = document.documentElement;
const mq = matchMedia('(prefers-color-scheme: light)');

const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } };

export function init(panel) {
  const radios = /** @type {HTMLInputElement[]} */ ([...panel.querySelectorAll('input[name="theme"]')]);
  let applying = false;

  const syncToggle = () => {
    document.querySelectorAll('[data-theme-toggle]').forEach((b) => b.setAttribute('aria-pressed', String(root.dataset.theme === 'light')));
  };
  const apply = (choice) => {
    applying = true;
    root.dataset.theme = choice === 'system' ? (mq.matches ? 'light' : 'dark') : choice;
    syncToggle();
    queueMicrotask(() => { applying = false; });
  };
  const current = () => {
    const v = read();
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'dark'; // the dashboard defaults to dark
  };
  const check = (choice) => radios.forEach((r) => { r.checked = r.value === choice; });

  const initial = current();
  check(initial);
  if (initial === 'system') apply('system');

  panel.addEventListener('change', (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (t.name === 'theme' && t.checked) {
      write(t.value);
      apply(t.value);
      toast(`Theme: ${t.parentElement?.textContent?.trim() || t.value}`);
      return;
    }
    if (t.dataset.setNotify) {
      toast(`${t.dataset.setNotify} notifications ${t.checked ? 'on' : 'off'}`);
    }
  });

  mq.addEventListener('change', () => { if (current() === 'system') apply('system'); });

  // The top-bar toggle writes an explicit light/dark choice; reflect it here.
  new MutationObserver(() => { if (!applying) check(current()); })
    .observe(root, { attributes: true, attributeFilter: ['data-theme'] });
}
