// @ts-check
/**
 * Authenticated API access for the live dashboard.
 *
 * Token + user are shared with the legacy app: localStorage `ted_access_token` / `ted_user_data`.
 * 401/403 clears the session and returns to /login, matching assets/js/auth.js.
 */

import { requestEnd, requestStart } from './shell.js';

const TOKEN_KEY = 'ted_access_token';
const USER_KEY = 'ted_user_data';
export const API_BASE = window.location.origin;
export const DEMO = new URLSearchParams(location.search).has('demo');

export class ApiError extends Error {
  /** @param {string} message @param {number} status @param {unknown} [detail] */
  constructor(message, status, detail) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

export const getToken = () => localStorage.getItem(TOKEN_KEY);

/** @param {string} token */
export function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** @param {unknown} user */
export function saveUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/** @returns {any|null} */
export function cachedUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

let sessionPromise = null;

/** Fetch /api/auth/me once per page. @param {boolean} [force] */
export function getMe(force = false) {
  if (!sessionPromise || force) {
    sessionPromise = api('/api/auth/me').then((me) => {
      saveUser(me);
      return me;
    });
  }
  return sessionPromise;
}

/**
 * @param {string} path
 * @param {RequestInit & { skipAuth?: boolean }} [options]
 */
export async function api(path, options = {}) {
  requestStart();
  try {
    return await apiRequest(path, options);
  } finally {
    requestEnd();
  }
}

/** @param {string} path @param {RequestInit & { skipAuth?: boolean }} [options] */
async function apiRequest(path, options = {}) {
  const { skipAuth, headers, ...rest } = options;
  /** @type {Record<string, string>} */
  const h = { Accept: 'application/json', ...(headers || {}) };
  if (rest.body && !h['Content-Type']) h['Content-Type'] = 'application/json';
  const token = getToken();
  if (token && !skipAuth) h.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...rest, headers: h });
  } catch (err) {
    throw new ApiError('Network error — check your connection and try again.', 0, err);
  }

  if (response.status === 401 || response.status === 403) {
    clearSession();
    if (!DEMO) {
      const next = encodeURIComponent(location.pathname + location.search);
      setTimeout(() => { location.href = `/login?next=${next}`; }, 400);
    }
    throw new ApiError('Your session has expired. Please sign in again.', response.status);
  }

  const text = await response.text();
  /** @type {any} */
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!response.ok) {
    let detail = data && typeof data === 'object' ? data.detail : data;
    // Trading Hub errors are {code, message}; keep the code for inline field errors.
    const code = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail.code : undefined;
    let message = detail;
    if (Array.isArray(detail)) message = detail.map((d) => d.msg || String(d)).join('. ');
    else if (detail && typeof detail === 'object') message = detail.message || JSON.stringify(detail);
    const err = new ApiError(message || `Request failed (${response.status})`, response.status, detail);
    /** @type {any} */ (err).code = code;
    throw err;
  }
  return data;
}

/* ---------- formatting ---------- */
const moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyFmt0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const dateFmt = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short' });

/** @param {unknown} v @param {boolean} [compact] */
export const money = (v, compact = false) => (compact ? moneyFmt0 : moneyFmt).format(Number(v || 0));
/** @param {unknown} v */
export const int = (v) => intFmt.format(Number(v || 0));
/** @param {unknown} v @param {boolean} [signed] */
export const percent = (v, signed = false) => {
  const n = Number(v || 0);
  return `${signed && n > 0 ? '+' : ''}${n.toFixed(n % 1 ? 2 : 0)}%`;
};
/** @param {unknown} v @param {boolean} [short] */
export const date = (v, short = false) => {
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return '—';
  return (short ? shortDateFmt : dateFmt).format(d);
};
/** @param {unknown} v */
export const dateTimeAttr = (v) => {
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};
/** @param {string} [name] @param {string} [email] */
export function initials(name, email) {
  const source = (name || email || '?').trim();
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}
/** @param {unknown} v */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => /** @type {Record<string,string>} */ ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/**
 * Download a protected file (PDF/CSV) with the Bearer token and save it with `filename`.
 * @param {string} path @param {string} filename
 */
export async function download(path, filename) {
  requestStart();
  try {
    const token = getToken();
    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    } catch (err) {
      throw new ApiError('Network error — check your connection and try again.', 0, err);
    }
    if (res.status === 401 || res.status === 403) {
      clearSession();
      if (!DEMO) {
        const next = encodeURIComponent(location.pathname + location.search);
        setTimeout(() => { location.href = `/login?next=${next}`; }, 400);
      }
      throw new ApiError('Your session has expired. Please sign in again.', res.status);
    }
    if (!res.ok) {
      let msg = `Download failed (${res.status})`;
      try { const d = await res.json(); msg = d.detail?.message || d.detail || msg; } catch { /* not JSON */ }
      throw new ApiError(String(msg), res.status);
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } finally {
    requestEnd();
  }
}
