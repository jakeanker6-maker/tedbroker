// @ts-check
/**
 * Language switcher for public pages. Renders a select inside any element with
 * data-component="lang-switch". On first visit the language follows the visitor's region
 * (/api/language/detect); an explicit choice is kept in this browser and wins over it.
 */
import { applyRegionLanguage, currentLanguage, setLanguage } from '../live/i18n.js';

/** @param {HTMLElement} el */
export async function init(el) {
  if (el.dataset.langReady) return;
  el.dataset.langReady = 'true';

  const id = 'public-lang-select';
  const label = document.createElement('label');
  label.className = 'sr-only';
  label.htmlFor = id;
  label.textContent = 'Language';

  const select = document.createElement('select');
  select.id = id;
  select.className = 'site-lang__select';
  select.disabled = true;
  select.append(new Option('Loading…', ''));

  el.replaceChildren(label, select);

  let languages = {};
  try {
    const res = await fetch('/api/language/supported', { headers: { Accept: 'application/json' } });
    if (res.ok) languages = (await res.json()).languages || {};
  } catch { /* keep the fallback below */ }
  if (!Object.keys(languages).length) languages = { en: { name: 'English' } };

  // A signed-in visitor's saved account language applies here too, and changes are saved to the account.
  const token = (() => { try { return localStorage.getItem('ted_access_token'); } catch { return null; } })();
  let saved = null;
  if (token) {
    try {
      const res = await fetch('/api/language/preference', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
      if (res.ok) saved = (await res.json()).preferred_language || null;
    } catch { /* fall back to browser state */ }
  }
  if (saved) setLanguage(saved, 'user');
  else await applyRegionLanguage();

  select.replaceChildren(...Object.entries(languages).map(([code, info]) => {
    const name = /** @type {{name?: string}} */ (info).name || code;
    return new Option(name.replace(/\s*\(.*\)$/, ''), code);
  }));
  select.value = currentLanguage();
  select.disabled = false;
  select.addEventListener('change', async () => {
    const code = select.value;
    setLanguage(code, 'user');
    if (token) {
      fetch('/api/language/preference', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: code }),
      }).catch(() => { /* the choice still applies in this browser */ });
    }
  });
  window.addEventListener('ted:language', (e) => {
    const code = /** @type {CustomEvent} */ (e).detail?.code;
    if (code && select.value !== code) select.value = code;
  });
}
