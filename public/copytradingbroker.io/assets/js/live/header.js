// @ts-check
/**
 * Dashboard top bar: search, language switcher and notifications.
 * Results and states come from the account's API data. Nothing is simulated.
 */
import { api, date } from './api.js';
import { toast } from '../lib/util.js';
import { setLanguage } from './i18n.js';

const TOKEN_KEY = 'ted_access_token';
const signedIn = () => !!localStorage.getItem(TOKEN_KEY);

const searchForm = /** @type {HTMLFormElement|null} */ (document.querySelector('.topbar form.search'));
const searchInput = /** @type {HTMLInputElement|null} */ (searchForm?.querySelector('input[type="search"]') || null);
const langBtn = /** @type {HTMLButtonElement|null} */ (document.querySelector('.topbar .lang-select'));
const notifBtn = /** @type {HTMLButtonElement|null} */ (document.querySelector('.topbar__actions .icon-btn[aria-label^="Notifications"]'));

/** @param {string} tag @param {string} cls @param {Record<string, string>} [attrs] */
function make(tag, cls, attrs = {}) {
  const el = document.createElement(tag);
  el.className = cls;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** @type {HTMLElement[]} */
const popovers = [];

/** @param {HTMLElement} pop @param {HTMLElement} anchor @param {'left'|'right'} [align] */
function place(pop, anchor, align = 'right') {
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${Math.round(r.bottom + 8)}px`;
  if (align === 'left') {
    pop.style.left = `${Math.max(8, Math.round(r.left))}px`;
    pop.style.right = 'auto';
  } else {
    pop.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`;
    pop.style.left = 'auto';
  }
}

/** @param {HTMLElement} pop */
function closePop(pop) {
  pop.hidden = true;
}

function closeAll(except = null) {
  for (const p of popovers) if (p !== except) closePop(p);
  langBtn?.setAttribute('aria-expanded', 'false');
  notifBtn?.setAttribute('aria-expanded', 'false');
}

document.addEventListener('pointerdown', (e) => {
  const t = /** @type {Node} */ (e.target);
  if (popovers.some((p) => !p.hidden && p.contains(t))) return;
  if (langBtn?.contains(t) || notifBtn?.contains(t) || searchForm?.contains(t)) return;
  closeAll();
});

/* =================================================================== *
 * Search
 * =================================================================== */

/** @typedef {{type: string, label: string, meta: string, href: string}} Result */

/** @type {Result[]|null} */
let index = null;
/** @type {Promise<void>|null} */
let indexLoading = null;

const PAGES = [
  { label: 'Overview', meta: 'Dashboard', href: 'index.html' },
  { label: 'Wallet', meta: 'Balance, deposits and withdrawals', href: 'wallet.html' },
  { label: 'Deposit funds', meta: 'Wallet', href: 'wallet.html#deposit' },
  { label: 'Portfolio', meta: 'Investments and copies', href: 'portfolio.html' },
  { label: 'Copy traders', meta: 'Trader directory', href: 'copy-traders.html' },
  { label: 'Network feed', meta: 'Trader posts and trades', href: 'network.html' },
  { label: 'Robo Advisor', meta: 'Investment plans', href: 'plans.html#robo' },
  { label: 'ETF automation', meta: 'Investment plans', href: 'plans.html#etf' },
  { label: 'DeFi', meta: 'Investment plans', href: 'plans.html#defi' },
  { label: 'Options', meta: 'Investment plans', href: 'plans.html#options' },
  { label: 'Referrals', meta: 'Invite friends and earn', href: 'referrals.html' },
  { label: 'News', meta: 'Market headlines', href: 'news.html' },
  { label: 'Settings', meta: 'Profile, security and language', href: 'settings.html' },
];

function loadIndex() {
  if (indexLoading) return indexLoading;
  indexLoading = (async () => {
    const records = [...PAGES.map((p) => ({ type: 'Page', ...p }))];
    if (!signedIn()) { index = records; return; }
    const [traders, plans, etf, defi, options] = await Promise.allSettled([
      api('/api/traders/'),
      api('/api/plans/'),
      api('/api/etf-plans/'),
      api('/api/defi-plans/'),
      api('/api/options-plans/'),
    ]);
    const val = (/** @type {PromiseSettledResult<any>} */ r) => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []);
    for (const t of val(traders)) {
      records.push({
        type: 'Trader',
        label: String(t.full_name || 'Trader'),
        meta: String(t.specialization || 'Trader'),
        href: `copy-traders.html?q=${encodeURIComponent(String(t.full_name || ''))}`,
      });
    }
    const planGroups = [
      [val(plans), 'robo', 'Robo Advisor'],
      [val(etf), 'etf', 'ETF automation'],
      [val(defi), 'defi', 'DeFi'],
      [val(options), 'options', 'Options'],
    ];
    for (const [list, hash, group] of planGroups) {
      for (const p of /** @type {any[]} */ (list)) {
        records.push({
          type: 'Plan',
          label: String(p.name || 'Plan'),
          meta: String(group),
          href: `plans.html#${hash}`,
        });
      }
    }
    index = records;
  })();
  return indexLoading;
}

/** @param {string} query */
function search(query) {
  const q = query.trim().toLowerCase();
  if (!q || !index) return [];
  return index.filter((r) => `${r.label} ${r.meta} ${r.type}`.toLowerCase().includes(q)).slice(0, 8);
}

/** @type {HTMLElement|null} */
let searchPop = null;
let activeIndex = -1;
/** @type {Result[]} */
let current = [];

function ensureSearchPop() {
  if (searchPop) return searchPop;
  searchPop = make('div', 'header-pop search-pop', { role: 'listbox', id: 'search-results', 'aria-label': 'Search results' });
  searchPop.hidden = true;
  document.body.append(searchPop);
  popovers.push(searchPop);
  return searchPop;
}

/** @param {number} i */
function setActive(i) {
  activeIndex = i;
  const pop = ensureSearchPop();
  const opts = [...pop.querySelectorAll('[role="option"]')];
  opts.forEach((o, idx) => o.setAttribute('aria-selected', String(idx === i)));
  if (searchInput) {
    if (i >= 0 && opts[i]) searchInput.setAttribute('aria-activedescendant', opts[i].id);
    else searchInput.removeAttribute('aria-activedescendant');
  }
}

function renderResults() {
  const pop = ensureSearchPop();
  const query = searchInput?.value || '';
  pop.replaceChildren();
  if (!query.trim()) { closePop(pop); searchInput?.setAttribute('aria-expanded', 'false'); return; }
  current = search(query);
  if (!current.length) {
    pop.append(make('p', 'header-pop__empty', {}));
    pop.lastElementChild && (pop.lastElementChild.textContent = index ? `No matches for “${query}”. Press Enter to search copy traders.` : 'Searching…');
  } else {
    current.forEach((r, i) => {
      const opt = make('a', 'header-pop__item search-item', { role: 'option', id: `search-opt-${i}`, href: r.href, 'aria-selected': 'false' });
      const kind = make('span', 'search-item__kind');
      kind.textContent = r.type;
      const body = make('span', 'search-item__body');
      const title = make('strong', 'search-item__title');
      title.textContent = r.label;
      const meta = make('span', 'search-item__meta');
      meta.textContent = r.meta;
      body.append(title, meta);
      opt.append(kind, body);
      pop.append(opt);
    });
  }
  pop.hidden = false;
  if (searchInput) searchInput.setAttribute('aria-expanded', 'true');
  place(pop, /** @type {HTMLElement} */ (searchForm), 'left');
  pop.style.width = `${Math.min(440, innerWidth - 16)}px`;
  pop.style.left = `${Math.max(8, Math.round((searchForm?.getBoundingClientRect().left || 8)))}px`;
  setActive(-1);
}

if (searchInput && searchForm) {
  searchInput.setAttribute('role', 'combobox');
  searchInput.setAttribute('aria-autocomplete', 'list');
  searchInput.setAttribute('aria-controls', 'search-results');
  searchInput.setAttribute('aria-expanded', 'false');
  let timer = 0;
  searchInput.addEventListener('focus', () => { loadIndex(); });
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      await loadIndex();
      renderResults();
    }, 120);
  });
  searchInput.addEventListener('keydown', (e) => {
    const pop = ensureSearchPop();
    const open = !pop.hidden && current.length > 0;
    if (e.key === 'ArrowDown' && open) { e.preventDefault(); setActive((activeIndex + 1) % current.length); }
    else if (e.key === 'ArrowUp' && open) { e.preventDefault(); setActive(activeIndex <= 0 ? current.length - 1 : activeIndex - 1); }
    else if (e.key === 'Escape') { closePop(pop); searchInput?.setAttribute('aria-expanded', 'false'); searchInput?.removeAttribute('aria-activedescendant'); }
  });
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const query = (searchInput?.value || '').trim();
    if (activeIndex >= 0 && current[activeIndex]) { location.href = current[activeIndex].href; return; }
    if (!query) { searchInput?.focus(); return; }
    location.href = `copy-traders.html?q=${encodeURIComponent(query)}`;
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      searchInput?.focus();
      searchInput?.select();
    }
  });
}

/* =================================================================== *
 * Language
 * =================================================================== */

/** @type {HTMLElement|null} */
let langPop = null;

async function initLanguage() {
  if (!langBtn) return;
  const prefRes = await api('/api/language/preference').catch(() => null);
  const current = String(prefRes?.preferred_language || 'en');
  applyLanguageLabel(current);
  setLanguage(current);
  langBtn.addEventListener('click', async () => {
    if (!langPop) {
      langPop = make('div', 'header-pop lang-pop', { role: 'listbox', 'aria-label': 'Language' });
      langPop.hidden = true;
      document.body.append(langPop);
      popovers.push(langPop);
    }
    const open = !!langPop && !langPop.hidden;
    closeAll();
    if (open) return;
    langBtn.setAttribute('aria-expanded', 'true');
    await renderLanguages(langPop);
    place(langPop, langBtn, 'right');
    langPop.hidden = false;
  });
}

/** @param {string} code */
function applyLanguageLabel(code) {
  if (!langBtn) return;
  langBtn.dataset.lang = code;
  langBtn.firstChild && (langBtn.firstChild.textContent = code.toUpperCase() + ' ');
  langBtn.setAttribute('aria-label', `Language: ${code}`);
}

/** @param {HTMLElement} pop */
async function renderLanguages(pop) {
  pop.replaceChildren(make('p', 'header-pop__empty', {}));
  pop.firstElementChild && (pop.firstElementChild.textContent = 'Loading languages…');
  try {
    const [supported, pref] = await Promise.all([api('/api/language/supported'), api('/api/language/preference')]);
    const languages = /** @type {Record<string, {name: string, flag: string}>} */ (supported?.languages || {});
    const selected = String(pref?.preferred_language || 'en');
    pop.replaceChildren(...Object.entries(languages).map(([code, info]) => {
      const opt = make('button', 'header-pop__item lang-option', { type: 'button', role: 'option', 'aria-selected': String(code === selected), 'data-code': code });
      const flag = make('span', 'lang-option__flag', { 'aria-hidden': 'true' });
      flag.textContent = info.flag || '';
      const name = make('span', 'lang-option__name');
      name.textContent = info.name;
      opt.append(flag, name);
      opt.addEventListener('click', () => chooseLanguage(code, info.name));
      return opt;
    }));
  } catch {
    pop.replaceChildren(make('p', 'header-pop__empty', {}));
    pop.firstElementChild && (pop.firstElementChild.textContent = 'Languages are unavailable right now.');
  }
}

/** @param {string} code @param {string} name */
async function chooseLanguage(code, name) {
  closeAll();
  try {
    await api('/api/language/preference', { method: 'PUT', body: JSON.stringify({ language: code }) });
    setLanguage(code);
    applyLanguageLabel(code);
    toast(`Language set to ${name}`);
  } catch (err) {
    toast(/** @type {Error} */ (err).message || 'Could not save your language.');
  }
}

/* =================================================================== *
 * Notifications
 * =================================================================== */

/** @type {HTMLElement|null} */
let notifPop = null;

function ensureNotifPop() {
  if (notifPop) return notifPop;
  notifPop = make('div', 'header-pop notif-pop', { role: 'dialog', 'aria-label': 'Notifications' });
  notifPop.hidden = true;
  document.body.append(notifPop);
  popovers.push(notifPop);
  return notifPop;
}

/** @param {number} count */
function setUnread(count) {
  if (!notifBtn) return;
  notifBtn.setAttribute('aria-label', count ? `Notifications, ${count} unread` : 'Notifications');
  const dot = notifBtn.querySelector('.icon-btn__dot');
  if (dot instanceof HTMLElement) dot.hidden = count === 0;
}

/** @param {any} item */
function notifItem(item) {
  const li = make('li', 'notif-item');
  const head = make('div', 'notif-item__head');
  const title = make('strong', 'notif-item__title');
  title.textContent = String(item.title || 'Notification');
  const time = make('time', 'notif-item__time');
  const when = new Date(String(item.created_at || ''));
  if (!Number.isNaN(when.getTime())) {
    time.dateTime = when.toISOString();
    time.textContent = date(when);
  }
  head.append(title, time);
  const body = make('p', 'notif-item__body');
  body.textContent = String(item.message || '');
  const dismiss = make('button', 'text-btn notif-item__dismiss', { type: 'button' });
  dismiss.textContent = 'Dismiss';
  dismiss.setAttribute('aria-label', `Dismiss: ${String(item.title || 'notification')}`);
  dismiss.addEventListener('click', async () => {
    dismiss.disabled = true;
    try {
      await api(`/api/notifications/${encodeURIComponent(String(item.id))}/dismiss`, { method: 'PUT' });
      li.remove();
      refreshNotifList();
    } catch (err) {
      dismiss.disabled = false;
      toast(/** @type {Error} */ (err).message || 'Could not dismiss this notification.');
    }
  });
  li.append(head, body, dismiss);
  return li;
}

function refreshNotifList() {
  const pop = ensureNotifPop();
  const list = pop.querySelector('.notif-list');
  const remaining = list ? list.querySelectorAll('.notif-item').length : 0;
  setUnread(remaining);
  if (remaining === 0 && list) {
    list.replaceWith(emptyNotif());
  }
}

function emptyNotif() {
  const p = make('p', 'header-pop__empty notif-empty', {});
  p.textContent = 'You’re all caught up.';
  return p;
}

async function openNotifications() {
  const pop = ensureNotifPop();
  closeAll();
  notifBtn?.setAttribute('aria-expanded', 'true');
  pop.replaceChildren();
  const heading = make('div', 'notif-pop__head');
  const h = make('h2', 'notif-pop__title', { tabindex: '-1' });
  h.textContent = 'Notifications';
  heading.append(h);
  pop.append(heading, make('p', 'header-pop__empty', {}));
  (pop.lastElementChild || pop).textContent = 'Loading…';
  place(pop, /** @type {HTMLElement} */ (notifBtn), 'right');
  pop.hidden = false;
  h.focus();
  try {
    const items = await api('/api/notifications/active');
    const list = Array.isArray(items) ? items : [];
    pop.lastElementChild?.remove();
    if (!list.length) {
      pop.append(emptyNotif());
    } else {
      const ul = make('ul', 'notif-list', { role: 'list' });
      ul.append(...list.map(notifItem));
      pop.append(ul);
    }
    setUnread(list.length);
  } catch (err) {
    pop.lastElementChild?.remove();
    const p = make('p', 'header-pop__empty', {});
    p.textContent = /** @type {Error} */ (err).message || 'Notifications could not be loaded.';
    pop.append(p);
  }
}

function initNotifications() {
  if (!notifBtn) return;
  notifBtn.addEventListener('click', () => {
    const pop = ensureNotifPop();
    if (!pop.hidden) { closeAll(); return; }
    openNotifications();
  });
}

/* =================================================================== *
 * Shared
 * =================================================================== */

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const open = popovers.find((p) => !p.hidden);
    if (open) { closeAll(); (notifBtn && open === notifPop ? notifBtn : langBtn && open === langPop ? langBtn : searchInput)?.focus(); }
  }
});

window.addEventListener('resize', () => closeAll());

if (signedIn()) {
  initLanguage().catch(() => {});
  initNotifications();
  const prefetch = () => { loadIndex().catch(() => {}); };
  if ('requestIdleCallback' in window) requestIdleCallback(prefetch); else setTimeout(prefetch, 800);
} else {
  applyLanguageLabel(localStorage.getItem('ted:lang') || 'en');
  if (langBtn) { langBtn.disabled = true; langBtn.title = 'Sign in to change your language.'; }
  if (notifBtn) { notifBtn.disabled = true; notifBtn.title = 'Sign in to see notifications.'; }
}


// Margin-call band (Trading Hub accounts on margin).
import('./margin-banner.js').then((m) => m.showMarginCallBand()).catch(() => {});
