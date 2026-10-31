// @ts-check
/**
 * Network feed: posts and recent trades stored on trader profiles in the database,
 * merged into one timeline. Likes are saved through the trader posts API.
 */
import { api, esc, int, money } from './api.js';
import { initBase } from './base.js';
import { busy, clearEmpty, emptyState, markDemo, settle } from './shell.js';

const $ = (/** @type {string} */ s, root = document) => root.querySelector(s);
const $$ = (/** @type {string} */ s, root = document) => [...root.querySelectorAll(s)];

/** @param {unknown} value */
function toTime(value) {
  const t = new Date(String(value || '')).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** @param {number} ms */
function relTime(ms) {
  if (!ms) return '';
  const diff = Math.max(0, Date.now() - ms);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  return new Date(ms).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** @param {string} name */
const initialsOf = (name) => String(name || '?').trim().split(/\s+/).map((p) => p[0] || '').join('').slice(0, 2).toUpperCase();

/** @param {unknown} v */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function boot() {
  const session = await initBase();
  const section = $('section[aria-labelledby="feed-title"]');
  const traderSection = $('section[aria-labelledby="traders-side-title"]');
  if (session.demo) {
    markDemo(section, 'Demo preview: sample feed.');
    markDemo(traderSection, 'Demo preview: sample traders.');
    return;
  }
  busy(section);
  busy(traderSection);

  const traders = await api('/api/traders/');
  const list = Array.isArray(traders) ? traders : [];
  const me = session.me;
  const myId = String(me?.id || '');

  /** @type {Array<any>} */
  const items = [];
  for (const t of list) {
    const name = String(t.full_name || 'Trader');
    const spec = String(t.specialization || '');
    for (const p of Array.isArray(t.posts) ? t.posts : []) {
      items.push({
        kind: 'post',
        id: String(p.id || ''),
        trader: name,
        spec,
        content: String(p.content || ''),
        likes: Array.isArray(p.likes) ? p.likes.map(String) : [],
        at: toTime(p.created_at),
      });
    }
    for (const tr of Array.isArray(t.recent_trades) ? t.recent_trades : []) {
      items.push({
        kind: 'trade',
        trader: name,
        spec,
        symbol: String(tr.symbol || ''),
        side: String(tr.side || ''),
        orderType: String(tr.order_type || ''),
        entry: num(tr.entry_price),
        notional: num(tr.notional_value),
        leverage: num(tr.leverage),
        at: toTime(tr.timestamp),
      });
    }
  }
  items.sort((a, b) => b.at - a.at);

  const counts = { all: items.length, post: items.filter((i) => i.kind === 'post').length, trade: items.filter((i) => i.kind === 'trade').length };
  $$('[data-feed-filter]').forEach((btn) => {
    const key = /** @type {keyof typeof counts} */ (btn.getAttribute('data-feed-filter') || 'all');
    const small = btn.querySelector('small');
    if (small) small.textContent = `(${int(counts[key] ?? 0)})`;
  });
  const meta = $('[data-feed-meta]');
  if (meta) meta.textContent = `${int(counts.post)} post${counts.post === 1 ? '' : 's'} · ${int(counts.trade)} recent trade${counts.trade === 1 ? '' : 's'} from ${int(list.length)} trader${list.length === 1 ? '' : 's'}`;

  const feed = $('[data-feed-list]');
  const render = (/** @type {string} */ filter) => {
    if (!feed) return;
    const shown = items.filter((i) => filter === 'all' || i.kind === filter).slice(0, 60);
    $$('[data-feed-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-feed-filter') === filter)));
    if (!shown.length) {
      feed.innerHTML = '';
      emptyState(/** @type {HTMLElement} */ (section), 'Nothing in the feed yet', 'Posts and trades from traders will appear here.');
      return;
    }
    clearEmpty(/** @type {HTMLElement} */ (section));
    feed.innerHTML = shown.map((item) => (item.kind === 'post' ? postHtml(item, myId) : tradeHtml(item))).join('');
  };

  feed?.addEventListener('click', async (event) => {
    const btn = /** @type {HTMLElement} */ (event.target).closest('[data-like]');
    if (!(btn instanceof HTMLButtonElement)) return;
    const id = btn.getAttribute('data-post-id') || '';
    btn.disabled = true;
    try {
      const res = await api(`/api/traders/posts/${encodeURIComponent(id)}/like`, { method: 'POST' });
      const liked = res.action === 'liked';
      btn.setAttribute('aria-pressed', String(liked));
      btn.textContent = `${liked ? 'Liked' : 'Like'} · ${int(res.like_count || 0)}`;
    } catch {
      btn.textContent = 'Could not update';
    } finally {
      btn.disabled = false;
    }
  });

  $$('[data-feed-filter]').forEach((btn) => btn.addEventListener('click', () => render(btn.getAttribute('data-feed-filter') || 'all')));
  render('all');
  busy(section, false);

  /* ---------- traders on the network ---------- */
  const side = $('[data-trader-list]');
  if (side) {
    const top = [...list].sort((a, b) => num(b.copiers) - num(a.copiers)).slice(0, 8);
    side.innerHTML = top.length
      ? top.map((t) => `<li class="feed-trader">
          <span class="avatar">${esc(initialsOf(t.full_name))}</span>
          <div class="feed-trader__body"><strong>${esc(t.full_name || 'Trader')}</strong><span class="muted">${esc(String(t.specialization || '').replace(/\b\w/g, (c) => c.toUpperCase()))} · ${int(t.copiers || 0)} copier${num(t.copiers) === 1 ? '' : 's'}</span></div>
          <span class="delta" data-trend="${num(t.ytd_return) >= 0 ? 'up' : 'down'}">${num(t.ytd_return) >= 0 ? '+' : '−'}${Math.abs(num(t.ytd_return)).toFixed(1)}%</span>
        </li>`).join('')
      : '<li class="muted">No traders are published yet.</li>';
  }
  busy(traderSection, false);
}

/**
 * @param {any} p
 * @param {string} myId
 */
function postHtml(p, myId) {
  const liked = p.likes.includes(myId);
  return `<li class="feed-item" data-kind="post">
    <div class="feed-item__head"><span class="avatar">${esc(initialsOf(p.trader))}</span>
      <div><strong>${esc(p.trader)}</strong><span class="muted"> · ${esc(p.spec.replace(/\b\w/g, (c) => c.toUpperCase()))} · ${esc(relTime(p.at))}</span></div></div>
    <p class="feed-item__body">${esc(p.content)}</p>
    <div class="feed-item__foot">
      <button class="text-btn" type="button" data-like data-post-id="${esc(p.id)}" aria-pressed="${liked}">${liked ? 'Liked' : 'Like'} · ${int(p.likes.length)}</button>
    </div>
  </li>`;
}

/** @param {any} t */
function tradeHtml(t) {
  const long = t.side.toLowerCase() === 'long';
  return `<li class="feed-item feed-item--trade" data-kind="trade">
    <div class="feed-item__head"><span class="avatar">${esc(initialsOf(t.trader))}</span>
      <div><strong>${esc(t.trader)}</strong><span class="muted"> · ${esc(relTime(t.at))}</span></div></div>
    <p class="feed-item__body">Opened a <span class="${long ? 'gain' : 'loss'}">${esc(t.side.toUpperCase() || 'TRADE')}</span> on <strong>${esc(t.symbol || '—')}</strong>${t.orderType ? ` <span class="muted">· ${esc(t.orderType)}</span>` : ''}</p>
    <dl class="feed-item__facts">
      <div><dt>Entry</dt><dd>${esc(t.entry ? t.entry.toLocaleString('en-US') : '—')}</dd></div>
      <div><dt>Size</dt><dd>${esc(t.notional ? money(t.notional, true) : '—')}</dd></div>
      <div><dt>Leverage</dt><dd>${esc(t.leverage ? `${t.leverage}×` : '—')}</dd></div>
    </dl>
  </li>`;
}

boot().catch((err) => console.error('[network]', err)).finally(() => settle());
