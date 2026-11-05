// @ts-check
/**
 * Placeholder page for signed-in users whose dashboard access is not approved yet.
 * The markup is static. This script only:
 *  - sends signed-out visitors to sign in, and approved or not-yet-onboarded users to their real page
 *  - reveals feature rows as they scroll into view (animations are CSS-driven)
 */
import { getToken } from './live/api.js';
import { resolvePostAuthPath } from './live/gate.js';

const status = /** @type {HTMLElement|null} */ (document.getElementById('welcome-status'));

/** @param {string} text */
function showStatus(text) {
  if (!status) return;
  status.textContent = text;
}

/** Reveal each feature row once, when it first enters the viewport. */
function wireReveal() {
  const rows = [...document.querySelectorAll('[data-reveal]')];
  if (!('IntersectionObserver' in window)) {
    rows.forEach((row) => row.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      io.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.15 });
  rows.forEach((row) => io.observe(row));
}

async function init() {
  wireReveal();

  if (!getToken()) {
    location.replace(`/login?next=${encodeURIComponent('/welcome')}`);
    return;
  }

  const target = await resolvePostAuthPath();
  if (target === '/app/' || target === '/onboarding') {
    location.replace(target);
    return;
  }
  if (target === null && !getToken()) {
    location.replace(`/login?next=${encodeURIComponent('/welcome')}`);
    return;
  }
  if (target === null) {
    showStatus('We could not confirm your account status. Refresh the page to try again.');
  }
}

init().catch(() => showStatus('We could not confirm your account status. Refresh the page to try again.'));
