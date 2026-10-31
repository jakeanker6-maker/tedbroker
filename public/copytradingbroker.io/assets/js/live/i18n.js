// @ts-check
/**
 * Language switching for the authenticated app. Matches visible text and
 * selected attributes against English source strings (see i18n-dict.js) and swaps
 * in the chosen language. Data (names, amounts, API content) is left unchanged.
 */
import { DICT, CODES } from './i18n-dict.js';

export const SUPPORTED = ['en', ...CODES];
const STORE = 'ted:lang';
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

/** @param {string} code */
export function setLanguage(code) {
  const next = SUPPORTED.includes(code) ? code : 'en';
  current = next;
  try { localStorage.setItem(STORE, next); } catch { /* storage unavailable */ }
  document.documentElement.lang = next;
  document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
  if (document.body) translateTree(document.body);
  observe();
  window.dispatchEvent(new CustomEvent('ted:language', { detail: { code: next } }));
}

if (typeof document !== 'undefined') {
  let saved = 'en';
  try { saved = localStorage.getItem(STORE) || 'en'; } catch { /* storage unavailable */ }
  setLanguage(saved);
}
