// @ts-check
/**
 * Copy form inside a trader's detail row: allocation validation, live stop-loss label,
 * confirm dialog, success toast.
 *
 * <form class="copy-form" data-component="traders-copy" data-trader="Marcus Chen" data-first="Marcus"
 *       data-min="1000" data-available="6420" data-risk="6" data-dialog="copy-confirm" novalidate>…</form>
 *
 * The confirm <dialog> is shared by every form on the page; [data-confirm="…"] slots are filled with textContent.
 */
import { format, toast } from '../lib/util.js';
import { bindAmountField } from './amount-field.js';

const LEVEL = (r) => (r <= 3 ? 'Low' : r <= 6 ? 'Medium' : 'High');
const stopText = (v) => `Stop copying at −${v}%`;

/** @type {{ trader: string, done: () => void } | null} */
let pending = null;
const wired = new WeakSet();

/** @param {HTMLDialogElement} dlg */
function wireDialog(dlg) {
  if (wired.has(dlg)) return;
  wired.add(dlg);
  const confirm = /** @type {HTMLButtonElement|null} */ (dlg.querySelector('[data-confirm-submit]'));
  let timer = 0;
  confirm?.addEventListener('click', () => {
    if (!pending || confirm.getAttribute('aria-busy') === 'true') return;
    const job = pending;
    confirm.setAttribute('aria-busy', 'true');
    confirm.disabled = true;
    timer = window.setTimeout(() => {
      confirm.removeAttribute('aria-busy');
      confirm.disabled = false;
      pending = null;
      dlg.close();
      job.done();
      toast(`You're now copying ${job.trader}`);
    }, 700);
  });
  dlg.addEventListener('close', () => {
    // Cancelled (Esc / backdrop / Cancel) while the demo request was in flight.
    if (pending) { clearTimeout(timer); pending = null; }
    if (confirm) { confirm.removeAttribute('aria-busy'); confirm.disabled = false; }
  });
}

/** @param {HTMLFormElement} form */
export function init(form) {
  const d = form.dataset;
  const trader = d.trader || 'this trader';
  const first = d.first || trader;
  const min = Number(d.min || 0);
  const available = Number(d.available || 0);
  const risk = Number(d.risk || 0);
  const dlg = document.getElementById(d.dialog || '');
  const field = /** @type {HTMLElement|null} */ (form.querySelector('.field:has(.amount-input)'));
  const range = /** @type {HTMLInputElement|null} */ (form.querySelector('input[type="range"]'));
  const slOut = form.querySelector('[data-sl-out]');
  const status = /** @type {HTMLElement|null} */ (form.querySelector('[data-copy-status]'));
  const label = form.querySelector('[data-copy-label]');
  if (!field || !range || !(dlg instanceof HTMLDialogElement)) return;
  wireDialog(dlg);

  const amount = bindAmountField(field, { min, max: available, minText: `Minimum to copy ${first}` });

  const syncStop = () => {
    const txt = stopText(range.value);
    range.setAttribute('aria-valuetext', txt);
    if (slOut) slOut.textContent = txt;
  };
  range.addEventListener('input', syncStop);
  syncStop();

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const r = amount.validate();
    if (!r.ok) return;
    const set = (key, text) => { const el = dlg.querySelector(`[data-confirm="${key}"]`); if (el) el.textContent = text; };
    set('trader', trader);
    set('amount', format(r.value, 'currency', 2));
    set('stop', stopText(range.value));
    set('risk', `${risk}/10 · ${LEVEL(risk)}`);
    set('after', format(available - r.value, 'currency', 2));
    set('note', `Your allocation will mirror ${first}'s positions in proportion, and copying stops automatically at a ${range.value}% loss. `
      + 'Stops can be exceeded in fast markets, and you can lose some or all of the allocation. Past performance is not indicative of future results.');
    pending = {
      trader,
      done: () => {
        if (status) status.hidden = false;
        if (label) label.textContent = `Update copy of ${first}`;
      },
    };
    dlg.showModal();
  });
}
