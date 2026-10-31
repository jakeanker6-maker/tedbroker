// @ts-check
/**
 * News: headlines from the backend news endpoint. Built-in sample headlines
 * (no real link) are labelled "Demo data".
 */
import { api, esc } from './api.js';
import { initBase } from './base.js';
import { busy, emptyState, markDemo, settle } from './shell.js';

const $ = (/** @type {string} */ s, root = document) => root.querySelector(s);
const $$ = (/** @type {string} */ s, root = document) => [...root.querySelectorAll(s)];

const CATEGORY_LABEL = { all: 'All', markets: 'Markets', crypto: 'Crypto', stocks: 'Stocks', forex: 'Forex', commodities: 'Commodities' };

/** @param {unknown} url */
function safeUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
}

/** @param {any} a */
const isSample = (a) => !safeUrl(a.url);

/** @param {unknown} value */
function dateLabel(value) {
  const d = new Date(String(value || ''));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * @param {HTMLElement|null} listSection
 * @param {HTMLElement|null} featuredSection
 * @param {unknown} err
 */
function showFailure(listSection, featuredSection, err) {
  busy(featuredSection, false);
  busy(listSection, false);
  if (listSection) {
    listSection.querySelector(':scope > .live-empty')?.remove();
    const box = document.createElement('div');
    box.className = 'live-empty empty';
    const title = document.createElement('p');
    title.className = 'empty__title';
    title.textContent = 'News could not be loaded';
    const text = document.createElement('p');
    text.textContent = err instanceof Error ? err.message : 'Please try again.';
    const retry = document.createElement('button');
    retry.className = 'btn btn--sm btn--outline';
    retry.type = 'button';
    retry.textContent = 'Try again';
    retry.addEventListener('click', () => location.reload());
    box.append(title, text, retry);
    listSection.append(box);
  }
}

async function boot() {
  const session = await initBase();
  const featuredSection = $('section[aria-labelledby="news-featured-title"]');
  const listSection = $('section[aria-labelledby="news-list-title"]');
  if (session.demo) {
    markDemo(featuredSection, 'Demo preview: sample headlines.');
    markDemo(listSection, 'Demo preview: sample headlines.');
    return;
  }
  busy(featuredSection);
  busy(listSection);

  let res;
  try {
    res = await api('/api/news/articles?category=all');
  } catch (err) {
    showFailure(listSection, featuredSection, err);
    return;
  }
  const articles = Array.isArray(res?.articles) ? res.articles : [];
  if (!articles.length) {
    emptyState(listSection, 'No headlines right now', 'News providers returned nothing. Check back shortly.');
    busy(featuredSection, false);
    busy(listSection, false);
    return;
  }
  const meta = $('[data-news-meta]');
  if (meta) {
    meta.textContent = articles.length
      ? `${articles.length} headline${articles.length === 1 ? '' : 's'}`
      : 'No headlines available right now';
  }

  const counts = { all: articles.length };
  for (const key of Object.keys(CATEGORY_LABEL)) {
    if (key !== 'all') counts[key] = articles.filter((a) => a.category === key).length;
  }
  $$('[data-news-cat]').forEach((btn) => {
    const key = btn.getAttribute('data-news-cat') || 'all';
    const small = btn.querySelector('small');
    if (small) small.textContent = `(${counts[key] ?? 0})`;
  });

  const featured = articles.filter((a) => a.featured);
  const lead = featured[0] || articles[0];
  const featuredBox = $('[data-news-featured]');
  if (featuredBox) {
    featuredBox.innerHTML = lead
      ? articleHtml(lead, true)
      : '<p class="muted">No featured headline right now.</p>';
  }
  busy(featuredSection, false);

  const render = (/** @type {string} */ category) => {
    const list = $('[data-news-list]');
    const status = $('[data-news-status]');
    const shown = articles.filter((a) => category === 'all' || a.category === category);
    $$('[data-news-cat]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-news-cat') === category)));
    if (!list) return;
    if (!shown.length) {
      list.innerHTML = '';
      emptyState(listSection, 'No headlines in this category', 'Try another category.');
      if (status) status.textContent = 'No headlines in this category.';
      return;
    }
    listSection?.querySelector(':scope > .live-empty')?.remove();
    list.innerHTML = shown.map((a) => `<li class="news-item">${articleHtml(a, false)}</li>`).join('');
    if (status) status.textContent = `Showing ${shown.length} headline${shown.length === 1 ? '' : 's'}`;
  };

  $$('[data-news-cat]').forEach((btn) => btn.addEventListener('click', () => render(btn.getAttribute('data-news-cat') || 'all')));
  render('all');
  busy(listSection, false);
}

/**
 * @param {any} a
 * @param {boolean} big
 */
function articleHtml(a, big) {
  const href = safeUrl(a.url);
  const sample = !href;
  const badge = sample
    ? '<span class="demo-badge" data-demo-badge title="Built-in sample headline, not a real news item.">Demo data</span>'
    : '';
  const title = esc(a.title || 'Untitled');
  const titleHtml = href
    ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${title}</a>`
    : `<span>${title}</span>`;
  return `<article class="news-card ${big ? 'news-card--lead' : ''}">
    <p class="news-card__meta"><span class="muted">${esc(String(a.source || 'Unknown source'))}</span> · <span class="muted">${esc(dateLabel(a.publishedAt))}</span> ${badge}</p>
    <h${big ? '3' : '4'} class="news-card__title">${titleHtml}</h${big ? '3' : '4'}>
    ${a.description ? `<p class="news-card__text">${esc(String(a.description).slice(0, 260))}</p>` : ''}
  </article>`;
}

boot().catch((err) => console.error('[news]', err)).finally(() => settle());
