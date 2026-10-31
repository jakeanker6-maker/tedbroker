// @ts-check
/** Pull-quote carousel. Slides are <figure data-slide>; nav buttons are generated.
 *  Auto-advances every 7s unless reduced motion, hover or focus. */
import { reducedMotion } from '../lib/util.js';

export function init(el) {
  const slides = /** @type {HTMLElement[]} */ ([...el.querySelectorAll('[data-slide]')]);
  if (slides.length < 2) return;
  const nav = document.createElement('div');
  nav.className = 'quote-nav';
  nav.setAttribute('role', 'group');
  nav.setAttribute('aria-label', 'Choose testimonial');
  let current = 0, timer = 0;
  const btns = slides.map((_, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', `Testimonial ${i + 1} of ${slides.length}`);
    b.addEventListener('click', () => { go(i); restart(); });
    nav.append(b);
    return b;
  });
  const go = (i) => {
    current = i;
    slides.forEach((s, j) => { s.hidden = j !== i; });
    btns.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
  };
  const restart = () => {
    clearInterval(timer);
    if (!reducedMotion()) timer = window.setInterval(() => go((current + 1) % slides.length), 7000);
  };
  el.append(nav);
  el.addEventListener('pointerenter', () => clearInterval(timer));
  el.addEventListener('pointerleave', restart);
  el.addEventListener('focusin', () => clearInterval(timer));
  go(0);
  restart();
}
