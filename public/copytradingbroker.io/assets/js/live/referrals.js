// @ts-check
/**
 * Referrals: live referral link, statistics, monthly bonus history and referred users.
 * Rendered only from /api/referrals/* responses. Values the platform does not track
 * (pending deposits) are shown as "Not tracked" instead of invented numbers.
 */
import { api, date, dateTimeAttr, esc, int, money } from './api.js';
import { initBase } from './base.js';
import { busy, markDemo, settle } from './shell.js';
import { h } from '../trade/dom.js';

const $ = (/** @type {string} */ s, root = document) => root.querySelector(s);
const $$ = (/** @type {string} */ s, root = document) => [...root.querySelectorAll(s)];

/** @param {Element|null} el @param {string} text */
function setLive(el, text) {
  if (!(el instanceof HTMLElement)) return;
  el.removeAttribute('data-count');
  el.removeAttribute('data-format');
  el.removeAttribute('data-decimals');
  el.textContent = text;
  el.setAttribute('data-live-value', '');
}

/** @param {string} name */
const initialsOf = (name) => String(name || '?').trim().split(/\s+/).map((p) => p[0] || '').join('').slice(0, 2).toUpperCase();

async function boot() {
  const session = await initBase();
  const sections = {
    hero: $('section[aria-labelledby="ref-title"]'),
    summary: $('section[aria-label="Referral summary"]'),
    how: $('section[aria-labelledby="ref-how-title"]'),
    earn: $('section[aria-labelledby="ref-earn-title"]'),
    list: $('section[aria-labelledby="ref-list-title"]'),
  };

  if (session.demo) {
    markDemo(sections.summary, 'Demo preview: sample referral figures.');
    markDemo(sections.earn, 'Demo preview: sample referral figures.');
    markDemo(sections.list, 'Demo preview: sample referral list.');
    return;
  }

  for (const s of Object.values(sections)) busy(s);

  const [linkRes, statsRes, cfgRes] = await Promise.allSettled([
    api('/api/referrals/my-link'),
    api('/api/referrals/my-statistics'),
    api('/api/referrals/config'),
  ]);
  const link = linkRes.status === 'fulfilled' ? linkRes.value : null;
  const stats = statsRes.status === 'fulfilled' ? statsRes.value : null;
  const cfg = cfgRes.status === 'fulfilled' ? cfgRes.value : null;
  const bonus = Number(cfg?.base_referral_bonus ?? stats?.base_bonus_amount ?? link?.base_bonus ?? 0);
  if (linkRes.status === 'rejected') showLinkError();
  if (statsRes.status === 'rejected') showStatsError(sections);

  /* ---------- hero: link, share, copy ---------- */
  const url = String(link?.referral_link || '');
  if (url) {
    const input = /** @type {HTMLInputElement|null} */ ($('#ref-link'));
    if (input) input.value = url.replace(/^https?:\/\//, '');
    const copy = /** @type {HTMLButtonElement|null} */ ($('.ref-link button[data-copy]'));
    if (copy) { copy.setAttribute('data-copy', url); copy.disabled = false; }
    const shares = $('.ref-share__list');
    if (shares instanceof HTMLElement) shares.hidden = false;
    const placeholder = /DANIEL-48211/;
    const encodedPlaceholder = /https%3A%2F%2Ftedbrokers\.com%2Fr%2FDANIEL-48211/g;
    for (const el of $$('.ref-hero [href], .ref-hero [data-share-url], .ref-hero [data-copy]')) {
      for (const attr of ['href', 'data-share-url', 'data-copy']) {
        const v = el.getAttribute(attr);
        if (!v || !placeholder.test(v)) continue;
        const next = v.replace(encodedPlaceholder, encodeURIComponent(url)).replace(/https:\/\/tedbrokers\.com\/r\/DANIEL-48211/g, url);
        el.setAttribute(attr, next);
      }
    }
  }
  const lead = $('.ref-hero .lead');
  if (lead) lead.textContent = bonus > 0
    ? `You earn a ${money(bonus)} bonus in your wallet for every friend who signs up with your link.`
    : 'Share your link to invite friends to TED Brokers.';
  const step3 = $$('.ref-step__text')[2];
  if (step3) step3.textContent = bonus > 0
    ? `${money(bonus)} is added to your wallet when they sign up with your link.`
    : 'Bonuses are added to your wallet when friends sign up with your link.';
  const title = $('#ref-title');
  if (title) title.textContent = 'Invite friends. Earn a bonus for every referral.';
  const step3Title = $$('.ref-step__title')[2];
  if (step3Title) step3Title.textContent = 'You get the bonus';
  busy(sections.hero, false);

  /* ---------- referred users ---------- */
  if (statsRes.status === 'rejected') { busy(sections.earn, false); busy(sections.list, false); return; }
  const users = Array.isArray(stats?.referred_users) ? stats.referred_users : [];
  const total = Number(stats?.total_referrals ?? users.length);
  const active = Number(stats?.active_referrals ?? users.filter((/** @type {any} */ u) => u.is_active).length);
  const earned = Number(stats?.total_earnings ?? users.reduce((/** @type {number} */ s, /** @type {any} */ u) => s + Number(u.bonus_earned || 0), 0));
  const inactive = Math.max(0, total - active);

  const caption = $('.ref-net__caption');
  if (caption) caption.innerHTML = `<span class="live-dot" aria-hidden="true"></span><span><strong>${int(total)}</strong> invited · <strong>${int(active)}</strong> active</span>`;

  /* ---------- summary strip ---------- */
  const values = $$('section[aria-label="Referral summary"] .stat__value');
  const metas = $$('section[aria-label="Referral summary"] .stat__meta');
  setLive(values[0] || null, int(total));
  setLive(values[1] || null, int(active));
  setLive(values[2] || null, money(earned));
  setLive(values[3] || null, '—');
  if (metas[0]) metas[0].textContent = 'All-time sign-ups';
  if (metas[1]) metas[1].textContent = 'Accounts currently active';
  if (metas[2]) metas[2].textContent = 'Bonuses credited to your wallet';
  if (metas[3]) metas[3].textContent = 'Not tracked by the platform yet';
  busy(sections.summary, false);

  /* ---------- monthly earnings (last 12 months, from referral dates) ---------- */
  renderMonthly(users, sections.earn);
  busy(sections.earn, false);

  /* ---------- referred users table ---------- */
  renderList(users, { total, active, inactive }, sections.list);
  busy(sections.list, false);
}

/** The referral link is required for sharing: without it, no link, copy or share control is offered. */
function showLinkError() {
  const input = /** @type {HTMLInputElement|null} */ ($('#ref-link'));
  if (input) input.value = '';
  const note = $('#ref-link-help');
  if (note) note.textContent = 'Your referral link couldn’t be loaded. Reload the page to try again.';
  const copy = /** @type {HTMLButtonElement|null} */ ($('.ref-link button[data-copy]'));
  if (copy) copy.disabled = true;
}

/** Statistics failed: say so in every block instead of showing zeros. @param {Record<string, HTMLElement|null>} sections */
function showStatsError(sections) {
  for (const el of $$('section[aria-label="Referral summary"] .stat__value')) el.textContent = '—';
  const meta = $$('section[aria-label="Referral summary"] .stat__meta');
  meta.forEach((m) => { m.textContent = 'Couldn’t load'; });
  const caption = $('.ref-net__caption');
  if (caption) caption.lastElementChild && (caption.lastElementChild.textContent = 'Your referrals couldn’t be loaded. Reload the page to try again.');
  const earn = sections.earn?.querySelector('[data-earn-loading]');
  if (earn) earn.textContent = 'Your bonus history couldn’t be loaded.';
  const body = sections.list?.querySelector('tbody');
  if (body) body.replaceChildren(h('tr', null, h('td', { colspan: 6 }, h('div', { class: 'empty', role: 'alert' },
    h('p', { class: 'empty__title' }, 'Your referrals couldn’t be loaded'), h('p', null, 'Reload the page to try again.')))));
}

/**
 * @param {any[]} users
 * @param {HTMLElement|null} section
 */
function renderMonthly(users, section) {
  if (!section) return;
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 11 + i, 1));
  const keyOf = (/** @type {Date} */ d) => `${d.getFullYear()}-${d.getMonth()}`;
  const buckets = new Map(months.map((d) => [keyOf(d), 0]));
  for (const u of users) {
    const d = new Date(String(u.joined_date || ''));
    if (Number.isNaN(d.getTime())) continue;
    const k = keyOf(d);
    if (buckets.has(k)) buckets.set(k, (buckets.get(k) || 0) + Number(u.bonus_earned || 0));
  }
  const values = months.map((d) => Math.round((buckets.get(keyOf(d)) || 0) * 100) / 100);
  const labels = months.map((d) => d.toLocaleString('en-US', { month: 'short' }));
  const sum = values.reduce((a, b) => a + b, 0);

  const small = $('#ref-earn-title small', section);
  if (small) small.textContent = `${months[0].toLocaleString('en-US', { month: 'short' })} ${months[0].getFullYear()} – ${months[11].toLocaleString('en-US', { month: 'short' })} ${months[11].getFullYear()}`;
  const totalEl = $('.ref-total', section);
  if (totalEl) totalEl.textContent = money(sum);
  const period = totalEl?.nextElementSibling;
  if (period) period.textContent = '12 months';

  const wrap = $('.ref-bars-wrap', section);
  const fresh = document.createElement('div');
  fresh.className = 'bars';
  fresh.setAttribute('role', 'img');
  fresh.setAttribute('aria-label', `Monthly referral bonuses over the last 12 months, total ${money(sum)}.`);
  fresh.dataset.format = 'currency';
  fresh.dataset.values = values.join(',');
  fresh.dataset.labels = labels.join(',');
  if (wrap) wrap.replaceChildren(fresh);
  import('../components/bars.js').then((m) => m.init(fresh)).catch(() => {});
}

/**
 * @param {any[]} users
 * @param {{total: number, active: number, inactive: number}} counts
 * @param {HTMLElement|null} section
 */
function renderList(users, counts, section) {
  if (!section) return;
  const tbody = section.querySelector('tbody');
  const emptyRow = /** @type {HTMLElement|null} */ (section.querySelector('[data-ref-empty]'));
  if (!tbody) return;

  tbody.querySelectorAll('tr[data-status]').forEach((r) => r.remove());
  const rows = users.map((u) => {
    const name = String(u.full_name && u.full_name !== 'Unknown' ? u.full_name : u.username || 'Member');
    const isActive = !!u.is_active;
    const joined = u.joined_date ? new Date(String(u.joined_date)) : null;
    const joinedIso = joined && !Number.isNaN(joined.getTime()) ? dateTimeAttr(joined) : '';
    const earned = Number(u.bonus_earned || 0);
    return `<tr data-status="${isActive ? 'active' : 'inactive'}">
      <td><div class="person"><span class="avatar">${esc(initialsOf(name))}</span><span class="person__name">${esc(name)}</span></div></td>
      <td class="opt-sm mono muted nowrap"><time datetime="${esc(joinedIso)}">${esc(joined ? date(joined) : '—')}</time></td>
      <td><span class="tag tag--plain ${isActive ? 'tag--gain' : ''}">${isActive ? 'Active' : 'Inactive'}</span></td>
      <td class="is-num opt muted" title="Not tracked by the platform yet">—</td>
      <td class="is-num ${earned > 0 ? 'gain' : 'muted'}">${esc(money(earned))}</td>
    </tr>`;
  });
  if (emptyRow) emptyRow.before(...toNodes(rows));
  else tbody.append(...toNodes(rows));

  const emptyText = emptyRow?.querySelector('p:not(.empty__title)');
  const emptyTitle = emptyRow?.querySelector('.empty__title');
  if (!counts.total && emptyTitle && emptyText) {
    emptyTitle.textContent = 'No referrals yet';
    emptyText.textContent = 'Share your link to invite your first friend.';
  }

  const tabs = $$('button[data-filter]', section);
  const countFor = { all: counts.total, active: counts.active, pending: 0, inactive: counts.inactive };
  for (const tab of tabs) {
    const small = tab.querySelector('small');
    const key = /** @type {keyof typeof countFor} */ (tab.getAttribute('data-filter') || 'all');
    if (small) small.textContent = `(${int(countFor[key] ?? 0)})`;
  }

  // Initialise the status filter only after the rows exist, so it indexes live data.
  import('../components/ref-filter.js').then((m) => m.init(section)).catch(() => {});
}

/** @param {string[]} htmlRows */
function toNodes(htmlRows) {
  const tpl = document.createElement('template');
  tpl.innerHTML = htmlRows.join('');
  return [...tpl.content.children];
}

boot().catch((err) => console.error('[referrals]', err)).finally(() => settle());
