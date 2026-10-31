// @ts-check
/**
 * Trader earnings calculator (traders.html).
 *
 * <form class="traders-calc" data-component="traders-calc">
 *   <input type="range" name="followers|capital|return" …>
 *   <output data-calc="followers|capital|return">   (any number of each; sentence + slider readouts)
 *   <output data-calc="total">                      big count-style numeral
 *   <span data-calc="perf|subs">                     breakdown
 *   <p data-calc="status" role="status">            announced on `change` only
 * </form>
 *
 * Illustrative formula: 15% performance fee on followers' monthly profit + $2 subscription per follower.
 */
import { format, reducedMotion } from '../lib/util.js';

export const PERFORMANCE_FEE = 0.15;
export const SUBSCRIPTION = 2;

/**
 * Pure earnings maths, exported for tests.
 * @param {number} followers @param {number} capital average capital per follower (USD) @param {number} ret monthly return in %
 */
export function earnings(followers, capital, ret) {
  const perf = PERFORMANCE_FEE * followers * capital * (ret / 100);
  const subs = SUBSCRIPTION * followers;
  return { perf, subs, total: perf + subs };
}

const money = (v) => format(Math.round(v), 'currency', 0);
const pct = (v) => format(v, 'number', Number.isInteger(v) ? 0 : 1) + '%';

/** @param {HTMLFormElement} form */
export function init(form) {
  const ctrl = new AbortController();
  const { signal } = ctrl;
  const input = (name) => /** @type {HTMLInputElement|null} */ (form.querySelector(`input[name="${name}"]`));
  const followers = input('followers'), capital = input('capital'), ret = input('return');
  if (!followers || !capital || !ret) return;
  const all = (key) => form.querySelectorAll(`[data-calc="${key}"]`);
  const totalEl = form.querySelector('[data-calc="total"]');
  const status = form.querySelector('[data-calc="status"]');

  let shown = earnings(Number(followers.value), Number(capital.value), Number(ret.value)).total;
  let raf = 0;

  const setText = (key, text) => all(key).forEach((n) => { n.textContent = text; });

  const setFill = (el) => {
    const min = Number(el.min), max = Number(el.max), v = Number(el.value);
    el.style.setProperty('--fill', `${((v - min) / (max - min || 1)) * 100}%`);
  };

  const tweenTotal = (to) => {
    cancelAnimationFrame(raf);
    if (!totalEl) return;
    if (reducedMotion()) { shown = to; totalEl.textContent = money(to); return; }
    const from = shown, t0 = performance.now(), dur = 520;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      shown = from + (to - from) * (1 - Math.pow(1 - p, 4));
      totalEl.textContent = money(shown);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };

  /** @param {boolean} [announce] */
  const render = (announce = false) => {
    const f = Number(followers.value), c = Number(capital.value), r = Number(ret.value);
    const e = earnings(f, c, r);
    const fTxt = format(f), cTxt = money(c), rTxt = pct(r);

    setText('followers', fTxt);
    setText('capital', cTxt);
    setText('return', rTxt);
    setText('perf', money(e.perf));
    setText('subs', money(e.subs));
    followers.setAttribute('aria-valuetext', `${fTxt} followers`);
    capital.setAttribute('aria-valuetext', `${cTxt} per follower`);
    ret.setAttribute('aria-valuetext', `${rTxt} a month`);
    [followers, capital, ret].forEach(setFill);
    tweenTotal(e.total);

    if (announce && status) {
      status.textContent = `${fTxt} followers with ${cTxt} each at ${rTxt} a month: about ${money(e.total)} a month, illustrative.`;
    }
  };

  form.addEventListener('submit', (ev) => ev.preventDefault(), { signal });
  form.addEventListener('input', () => render(), { signal });
  form.addEventListener('change', () => render(true), { signal });

  // Initial paint: no tween, the markup already shows the default result.
  [followers, capital, ret].forEach(setFill);
  render();

  return () => { ctrl.abort(); cancelAnimationFrame(raf); };
}
