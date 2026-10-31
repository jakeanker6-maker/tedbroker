// @ts-check
/**
 * Shared amount validation for underline money fields (used by traders-copy and plans-invest).
 * Not a data-component on its own; import { bindAmountField }.
 *
 * <div class="field">
 *   … <input class="field__input" name="amount" type="number" aria-describedby="… err-id">
 *   <p class="field__error" id="err-id"><svg/><span data-error-msg></span><a data-error-funds hidden>Add funds →</a></p>
 * </div>
 *
 * Error kinds: "range" (empty / below minimum, loss colour) and "funds" (over available, pending colour + Add funds link).
 */
import { format } from '../lib/util.js';

/**
 * @param {HTMLElement} field  the .field wrapper
 * @param {{ min: number, max: number, minText: string, signal?: AbortSignal, onInput?: (r: AmountResult) => void }} o
 */
export function bindAmountField(field, o) {
  const input = /** @type {HTMLInputElement} */ (field.querySelector('input'));
  const msg = field.querySelector('[data-error-msg]');
  const funds = /** @type {HTMLElement|null} */ (field.querySelector('[data-error-funds]'));
  let touched = false;

  /** @returns {AmountResult} */
  const check = () => {
    const raw = input.value.trim().replace(/[\s,$]/g, '');
    const value = raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(value) || value <= 0) return { ok: false, value, kind: 'range', text: 'Enter an amount' };
    if (value < o.min) return { ok: false, value, kind: 'range', text: `${o.minText} is ${format(o.min, 'currency', 0)}` };
    if (value > o.max) return { ok: false, value, kind: 'funds', text: 'Insufficient balance —' };
    return { ok: true, value, kind: '', text: '' };
  };

  /** @param {AmountResult} r @param {boolean} show */
  const render = (r, show) => {
    const visible = show && !r.ok;
    input.setAttribute('aria-invalid', String(visible));
    if (visible) field.dataset.error = r.kind; else delete field.dataset.error;
    if (msg) msg.textContent = visible ? r.text : '';
    if (funds) funds.hidden = !(visible && r.kind === 'funds');
  };

  const opts = o.signal ? { signal: o.signal } : {};
  input.addEventListener('input', () => {
    const r = check();
    // Over-balance is useful immediately; "too low" waits until the user has left the field once.
    render(r, touched || r.kind === 'funds');
    o.onInput?.(r);
  }, opts);
  input.addEventListener('blur', () => { touched = true; render(check(), true); }, opts);

  return {
    input,
    /** Validate and show the error. Focuses the input when invalid. */
    validate() {
      touched = true;
      const r = check();
      render(r, true);
      if (!r.ok) input.focus();
      return r;
    },
    peek: check,
  };
}

/** @typedef {{ ok: boolean, value: number, kind: string, text: string }} AmountResult */
