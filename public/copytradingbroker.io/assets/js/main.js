// @ts-check
import { format, onVisible, reducedMotion, toast } from './lib/util.js';

const root = document.documentElement;

/* ---------- Component registry: data-component="chart donut" → ./components/chart.js … ---------- */
function initComponents(scope = document) {
  for (const el of scope.querySelectorAll('[data-component]')) {
    if (el instanceof HTMLElement && el.dataset.ready) continue;
    for (const name of (el.getAttribute('data-component') || '').split(/\s+/).filter(Boolean)) {
      if (!/^[a-z][a-z0-9-]*$/.test(name)) continue;
      import(`./components/${name}.js`)
        .then((m) => m.init?.(el))
        .catch((err) => console.error(`[component:${name}]`, err));
    }
    if (el instanceof HTMLElement) el.dataset.ready = 'true';
  }
}

/* ---------- Reveal on scroll ---------- */
function initReveal() {
  const targets = document.querySelectorAll('[data-reveal], .num-row, .bars');
  if (!('IntersectionObserver' in window) || reducedMotion()) {
    targets.forEach((t) => t.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
  }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
  targets.forEach((t) => io.observe(t));
}

/* ---------- Mobile app promo: play the entry animation once the section is visible ---------- */
function initAppPromo() {
  document.querySelectorAll('[data-app-promo], [data-illustration]').forEach((el) => {
    onVisible(el, () => {
      el.classList.add('is-in');
      // start the SMIL motion paths (dots travelling along the connectors)
      el.querySelectorAll('animateMotion').forEach((a) => a.beginElement?.());
    }, 0.3);
  });
}

/* ---------- Count-up numerals: <span data-count="48216.40" data-format="currency" data-decimals="2"> ---------- */
function initCountUp() {
  for (const el of document.querySelectorAll('[data-count]')) {
    if (!(el instanceof HTMLElement)) continue;
    const target = Number(el.dataset.count);
    const kind = el.dataset.format || 'number';
    const dec = Number(el.dataset.decimals || 0);
    const pre = el.dataset.prefix || '';
    const suf = el.dataset.suffix || '';
    const render = (v) => { el.textContent = pre + format(v, kind, dec) + suf; };
    // Live values written by page modules take precedence over the static placeholder target.
    if (reducedMotion()) { if (!el.hasAttribute('data-live-value')) render(target); continue; }
    onVisible(el, () => {
      if (el.hasAttribute('data-live-value')) return;
      const t0 = performance.now(), dur = Number(el.dataset.duration || 1400);
      const tick = (t) => {
        if (el.hasAttribute('data-live-value')) return;
        const p = Math.min(1, (t - t0) / dur);
        render(target * (1 - Math.pow(1 - p, 4)));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, 0.4);
  }
}

/* ---------- Header: scrolled state + mobile nav ---------- */
function initHeader() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const onScroll = () => header.toggleAttribute('data-scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  const toggle = header.querySelector('[data-nav-toggle]');
  const setOpen = (open) => {
    header.toggleAttribute('data-nav-open', open);
    toggle?.setAttribute('aria-expanded', String(open));
  };
  toggle?.addEventListener('click', () => setOpen(!header.hasAttribute('data-nav-open')));
  header.querySelectorAll('.site-nav a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && header.hasAttribute('data-nav-open')) { setOpen(false); /** @type {HTMLElement} */ (toggle)?.focus(); } });
}

/* ---------- Desktop rail collapse (icons only), remembered per browser ---------- */
const RAIL_KEY = 'ted:rail-collapsed';
function initRailCollapse() {
  const app = document.querySelector('.app');
  const btn = document.querySelector('[data-rail-collapse]');
  if (!app || !btn) return;
  const apply = (/** @type {boolean} */ collapsed) => {
    app.toggleAttribute('data-rail-collapsed', collapsed);
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.setAttribute('aria-label', collapsed ? 'Expand menu' : 'Collapse menu');
    btn.setAttribute('title', collapsed ? 'Expand menu' : 'Collapse menu');
  };
  let saved = false;
  try { saved = localStorage.getItem(RAIL_KEY) === '1'; } catch { /* storage unavailable */ }
  apply(saved);
  btn.addEventListener('click', () => {
    const next = !app.hasAttribute('data-rail-collapsed');
    apply(next);
    try { localStorage.setItem(RAIL_KEY, next ? '1' : '0'); } catch { /* storage unavailable */ }
  });
}

/* ---------- App rail (mobile off-canvas) ---------- */
function initRail() {
  const app = document.querySelector('.app');
  if (!app) return;
  // Several controls open the rail: the top-bar menu button and the bottom bar's "More".
  const toggles = [...app.querySelectorAll('[data-rail-toggle]')];
  const setOpen = (open) => {
    app.toggleAttribute('data-rail-open', open);
    toggles.forEach((t) => t.setAttribute('aria-expanded', String(open)));
    if (open) /** @type {HTMLElement|null} */ (app.querySelector('.rail a'))?.focus();
  };
  toggles.forEach((t) => t.addEventListener('click', () => setOpen(!app.hasAttribute('data-rail-open'))));
  app.querySelector('.rail-scrim')?.addEventListener('click', () => setOpen(false));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && app.hasAttribute('data-rail-open')) { setOpen(false); /** @type {HTMLElement|null} */ (toggles[0] || null)?.focus(); } });
}

/* ---------- Delegated actions: dialogs, theme, copy, expandable rows, demo forms ---------- */
function initActions() {
  document.addEventListener('click', (e) => {
    const t = /** @type {HTMLElement} */ (e.target);

    const opener = t.closest('[data-dialog-open]');
    if (opener) {
      const dlg = document.getElementById(opener.getAttribute('data-dialog-open') || '');
      if (dlg instanceof HTMLDialogElement) { e.preventDefault(); dlg.showModal(); }
      return;
    }
    const closer = t.closest('[data-dialog-close]');
    if (closer) { closer.closest('dialog')?.close(); return; }
    if (t instanceof HTMLDialogElement && t.open) { // click on backdrop
      const r = t.getBoundingClientRect();
      const ev = /** @type {MouseEvent} */ (e);
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) t.close();
      return;
    }

    const themeBtn = t.closest('[data-theme-toggle]');
    if (themeBtn) {
      const next = root.dataset.theme === 'light' ? 'dark' : 'light';
      root.dataset.theme = next;
      themeBtn.setAttribute('aria-pressed', String(next === 'light'));
      try { localStorage.setItem('ted:theme', next); } catch { /* private mode */ }
      return;
    }

    const copyBtn = t.closest('[data-copy]');
    if (copyBtn) {
      const value = copyBtn.getAttribute('data-copy') || '';
      navigator.clipboard?.writeText(value).then(
        () => toast(copyBtn.getAttribute('data-copy-message') || 'Copied to clipboard'),
        () => toast('Copy failed — select and copy manually'),
      );
      return;
    }

    const expander = t.closest('[data-expand]');
    if (expander) {
      const target = document.getElementById(expander.getAttribute('aria-controls') || '');
      if (!target) return;
      const open = expander.getAttribute('aria-expanded') !== 'true';
      // close siblings in the same group
      const group = expander.getAttribute('data-expand');
      if (open && group) {
        document.querySelectorAll(`[data-expand="${group}"][aria-expanded="true"]`).forEach((other) => {
          if (other === expander) return;
          other.setAttribute('aria-expanded', 'false');
          const o = document.getElementById(other.getAttribute('aria-controls') || '');
          if (o) o.hidden = true;
          other.closest('tr')?.removeAttribute('data-expanded');
          swapLabel(other, false);
        });
      }
      expander.setAttribute('aria-expanded', String(open));
      target.hidden = !open;
      const tr = expander.closest('tr');
      if (open) tr?.setAttribute('data-expanded', 'true'); else tr?.removeAttribute('data-expanded');
      swapLabel(expander, open);
      if (open) initComponents(target);
    }
  });

  document.addEventListener('submit', (e) => {
    const form = /** @type {HTMLFormElement} */ (e.target);
    if (!form.matches('[data-demo-form]')) return;
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const btn = form.querySelector('[type="submit"]');
    btn?.setAttribute('aria-busy', 'true');
    btn?.setAttribute('disabled', '');
    setTimeout(() => {
      btn?.removeAttribute('aria-busy');
      btn?.removeAttribute('disabled');
      toast(form.getAttribute('data-demo-form') || 'Done.');
      if (!form.hasAttribute('data-keep')) form.reset();
      form.closest('dialog')?.close();
    }, 900);
  });

  // reflect theme button state on load
  document.querySelectorAll('[data-theme-toggle]').forEach((b) => b.setAttribute('aria-pressed', String(root.dataset.theme === 'light')));
}

function swapLabel(btn, open) {
  const label = btn.querySelector('[data-label]') || btn;
  const txt = open ? btn.getAttribute('data-label-open') : btn.getAttribute('data-label-closed');
  if (txt && label) label.textContent = txt;
}

addEventListener('error', (e) => console.error('[ted]', e.message));
addEventListener('unhandledrejection', (e) => console.error('[ted]', e.reason));

initHeader();
initRail();
initRailCollapse();
initActions();
initReveal();
initAppPromo();
initCountUp();
initComponents();

export { initComponents };
