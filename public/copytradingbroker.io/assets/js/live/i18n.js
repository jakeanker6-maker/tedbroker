// @ts-check
/**
 * Language switching for the authenticated app. Matches visible text and
 * selected attributes against English source strings (see i18n-dict.js) and swaps
 * in the chosen language. Data (names, amounts, API content) is left unchanged.
 */
import { DICT, CODES } from './i18n-dict.js';

export const SUPPORTED = ['en', ...CODES];
const STORE = 'ted:lang';
const SOURCE_STORE = 'ted:lang-source';
const REGION_STORE = 'ted:lang-region';
const ATTRS = ['placeholder', 'aria-label', 'title'];
const ATTR_SELECTOR = ATTRS.map((a) => `[${a}]`).join(',');
const SKIP = 'script,style,[data-i18n-skip]';

let current = 'en';
let observing = false;

/** @type {WeakMap<Text, {orig: string, written: string}>} */
const textState = new WeakMap();
/** @type {WeakMap<Element, Map<string, {orig: string, written: string}>>} */
const attrState = new WeakMap();

/** @param {string} key */
export function t(key) {
  if (current === 'en') return key;
  const row = DICT[key];
  const translated = row ? row[CODES.indexOf(current)] : '';
  return translated || key;
}

export function currentLanguage() {
  return current;
}

/** @param {string} orig */
function translate(orig) {
  const key = orig.trim();
  if (!key || current === 'en') return orig;
  const tr = t(key);
  return tr === key ? orig : orig.replace(key, () => tr);
}

/** @param {Text} node */
function translateTextNode(node) {
  if (node.parentElement?.closest(SKIP)) return;
  let st = textState.get(node);
  if (!st || node.nodeValue !== st.written) st = { orig: node.nodeValue ?? '', written: '' };
  const out = translate(st.orig);
  st.written = out;
  textState.set(node, st);
  if (node.nodeValue !== out) node.nodeValue = out;
}

/** @param {Element} el */
function translateElement(el) {
  if (el.closest(SKIP)) return;
  for (const attr of ATTRS) {
    if (!el.hasAttribute(attr)) continue;
    let map = attrState.get(el);
    if (!map) {
      map = new Map();
      attrState.set(el, map);
    }
    const cur = el.getAttribute(attr) ?? '';
    let st = map.get(attr);
    if (!st || cur !== st.written) st = { orig: cur, written: '' };
    const out = translate(st.orig);
    st.written = out;
    map.set(attr, st);
    if (cur !== out) el.setAttribute(attr, out);
  }
}

/** @param {Node} root */
function translateTree(root) {
  if (root instanceof Text) return translateTextNode(root);
  if (!(root instanceof Element)) return;
  translateElement(root);
  root.querySelectorAll(ATTR_SELECTOR).forEach((el) => translateElement(el));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  /** @type {Text[]} */
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(/** @type {Text} */ (n));
  nodes.forEach(translateTextNode);
}

function observe() {
  if (observing || !document.body) return;
  observing = true;
  const observer = new MutationObserver((records) => {
    if (current === 'en') return;
    for (const r of records) {
      if (r.type === 'childList') r.addedNodes.forEach((n) => translateTree(n));
      else if (r.type === 'characterData') translateTextNode(/** @type {Text} */ (r.target));
      else if (r.type === 'attributes') translateElement(/** @type {Element} */ (r.target));
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
}

/**
 * @param {string} code
 * @param {'user'|'region'} [source] 'user' = the visitor chose it (sticky); 'region' = detected from location.
 */
export function setLanguage(code, source = 'user') {
  const next = SUPPORTED.includes(code) ? code : 'en';
  current = next;
  try {
    localStorage.setItem(STORE, next);
    localStorage.setItem(SOURCE_STORE, source);
  } catch { /* storage unavailable */ }
  document.documentElement.lang = next;
  document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
  if (document.body) translateTree(document.body);
  observe();
  window.dispatchEvent(new CustomEvent('ted:language', { detail: { code: next, source } }));
}

/** The language chosen by the visitor (never a region guess), or null. */
export function userChosenLanguage() {
  try {
    if (localStorage.getItem(SOURCE_STORE) !== 'user') return null;
    const code = localStorage.getItem(STORE);
    return code && SUPPORTED.includes(code) ? code : null;
  } catch { return null; }
}

/**
 * Language from the visitor's region (/api/language/detect), cached in the browser.
 * Returns 'en' when the lookup fails so the page always has a language.
 * @returns {Promise<string>}
 */
export async function detectRegionLanguage() {
  try {
    const cached = localStorage.getItem(REGION_STORE);
    if (cached && SUPPORTED.includes(cached)) return cached;
  } catch { /* storage unavailable */ }
  try {
    const res = await fetch('/api/language/detect', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const code = SUPPORTED.includes(data.detected_language) ? data.detected_language : 'en';
    try { localStorage.setItem(REGION_STORE, code); } catch { /* storage unavailable */ }
    return code;
  } catch {
    return 'en';
  }
}

/**
 * Apply the language for a visitor who has not chosen one: their region's language.
 * An explicit choice (see userChosenLanguage) always wins over this.
 * @returns {Promise<string>}
 */
export async function applyRegionLanguage() {
  const chosen = userChosenLanguage();
  if (chosen) { setLanguage(chosen, 'user'); return chosen; }
  const code = await detectRegionLanguage();
  setLanguage(code, 'region');
  return code;
}

if (typeof document !== 'undefined') {
  // Restore what was saved last time; keep its source so a region guess is not treated as a choice.
  let saved = null;
  let source = 'region';
  try {
    saved = localStorage.getItem(STORE);
    source = localStorage.getItem(SOURCE_STORE) === 'user' ? 'user' : 'region';
  } catch { /* storage unavailable */ }
  setLanguage(saved && SUPPORTED.includes(saved) ? saved : 'en', source);
}
