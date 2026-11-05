// @ts-check
/**
 * Shared dashboard boot: session guard, chrome (rail user, live counts, avatar), notifications.
 * Pages call initBase() and then hydrate their own content.
 */
import { DEMO, api, cachedUser, date, getMe, getToken, initials, int } from './api.js';
import { t } from './i18n.js';

let greetingName = '';

/** Greeting in the current language, e.g. "Good evening, Katherine". */
export function renderGreeting() {
  const h1 = document.querySelector('main h1[data-greeting]');
  if (!h1 || !greetingName) return;
  const hour = new Date().getHours();
  const key = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  h1.textContent = `${t(key)}, ${greetingName}`;
}
window.addEventListener('ted:language', renderGreeting);

/**
 * Redirect to /login unless a token exists. In `?demo=1` mode the page keeps its
 * placeholder content instead of redirecting.
 */
export function guard() {
  if (DEMO || getToken()) return true;
  const next = encodeURIComponent(location.pathname + location.search);
  location.replace(`/login?next=${next}`);
  return false;
}

/** @param {unknown} value */
function setText(root, selector, value) {
  const el = root.querySelector(selector);
  if (el) el.textContent = String(value);
}

/**
 * @param {any} me
 * @param {{copies?: number}} [extras]
 */
export function hydrateChrome(me, extras = {}) {
  const name = me.full_name || me.username || me.email || 'Account';
  const first = name.split(/\s+/)[0];
  const ini = initials(name, me.email);

  document.querySelectorAll('.rail__user-name').forEach((el) => { el.textContent = name; });
  document.querySelectorAll('.rail__user .avatar').forEach((el) => { el.textContent = ini; });
  document.querySelectorAll('.rail__user-meta').forEach((el) => {
    el.textContent = me.is_verified ? '● Verified' : '● Pending verification';
    el.hidden = false;
  });
  document.querySelectorAll('[data-user-name]').forEach((el) => { el.textContent = first; });
  document.querySelectorAll('[data-user-email]').forEach((el) => { el.textContent = me.email || ''; });

  if (extras.copies != null) setCopyCount(extras.copies);

  greetingName = first;
  renderGreeting();
  document.querySelectorAll('[data-live-date]').forEach((el) => { el.textContent = date(new Date()); });

  document.documentElement.dataset.live = 'on';
  return { map: new Map(), first }; // small convenience for callers
}

/** Rail badge: number of copied traders (hidden when none, never a placeholder count). @param {number} n */
export function setCopyCount(n) {
  document.querySelectorAll('.rail__aside--live').forEach((el) => {
    el.textContent = `${int(n)} live`;
    el.hidden = !(Number(n) > 0);
  });
}

/** @param {any} me */
export async function hydrateNotifications(me) {
  const buttons = document.querySelectorAll('.topbar__actions .icon-btn[aria-label^="Notifications"]');
  if (!buttons.length) return [];
  try {
    const list = await api('/api/notifications/active');
    const items = Array.isArray(list) ? list : [];
    buttons.forEach((btn) => {
      const dot = btn.querySelector('.icon-btn__dot');
      btn.setAttribute('aria-label', items.length ? `Notifications, ${items.length} unread` : 'Notifications');
      if (dot) dot.hidden = items.length === 0;
    });
    return items;
  } catch {
    return [];
  }
}

/**
 * Boot the shared shell.
 * @param {{copies?: number}} [opts]
 * @returns {Promise<{me: any, demo: boolean}>}
 */
export async function initBase(opts = {}) {
  if (!guard()) return new Promise(() => {});
  if (DEMO && !getToken()) {
    document.documentElement.dataset.demo = 'on';
    return { me: cachedUser() || {}, demo: true };
  }
  const cached = cachedUser();
  if (cached) hydrateChrome(cached, opts);
  const me = await getMe();
  // Dashboard access needs admin approval after KYC. Until then, show the status placeholder.
  // /welcome sends users who have not finished onboarding to /onboarding.
  if (!me?.access_granted && !DEMO) {
    location.replace('/welcome');
    return new Promise(() => {});
  }
  hydrateChrome(me, opts);
  hydrateNotifications(me);
  if (opts.copies == null) {
    // Pages that do not load copies themselves still show the rail badge from the real count.
    api('/api/copy/links').then((r) => setCopyCount((r?.links || []).length)).catch(() => {});
  }
  return { me, demo: DEMO };
}

/** Render a status tag using the design's tag classes. @param {string} status */
export function statusTag(status) {
  const s = String(status || '').toLowerCase();
  const label = s.replace(/_/g, ' ');
  if (['completed', 'settled', 'active', 'executed', 'approved', 'verified', 'copying'].includes(s)) {
    return { cls: 'tag tag--plain tag--gain', label: label.replace(/\b\w/g, (c) => c.toUpperCase()) };
  }
  if (['pending', 'pending_verification', 'processing', 'awaiting_approval'].includes(s)) {
    return { cls: 'tag tag--plain tag--pending', label: label.replace(/\b\w/g, (c) => c.toUpperCase()) };
  }
  if (['rejected', 'failed', 'cancelled'].includes(s)) {
    return { cls: 'tag tag--plain tag--loss', label: label.replace(/\b\w/g, (c) => c.toUpperCase()) };
  }
  return { cls: 'tag tag--plain', label: label.replace(/\b\w/g, (c) => c.toUpperCase()) || '—' };
}

export { setText };
