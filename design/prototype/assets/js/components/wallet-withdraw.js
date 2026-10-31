// @ts-check
/**
 * Withdrawal request dialog (demo mode).
 * <dialog id="withdraw"><form data-component="wallet-withdraw" data-available="6420" novalidate>
 *   #wd-amount, radios name="destination" (bank|crypto), [data-wd-address] wrapper with #wd-address, #wd-code (6 digits)
 * Resets when the dialog closes.
 */
import { format, toast } from '../lib/util.js';
import { clearError, setError } from './auth-form.js';
import { parseAmount } from './wallet-deposit.js';

const MIN = 10;

/** @param {HTMLFormElement} form */
export function init(form) {
  const dialog = form.closest('dialog');
  if (!(form instanceof HTMLFormElement) || !(dialog instanceof HTMLDialogElement)) return;
  const ac = new AbortController();
  const { signal } = ac;
  const available = Number(form.dataset.available || 0);
  const amount = /** @type {HTMLInputElement} */ (form.querySelector('#wd-amount'));
  const addressWrap = /** @type {HTMLElement|null} */ (form.querySelector('[data-wd-address]'));
  const address = /** @type {HTMLInputElement|null} */ (form.querySelector('#wd-address'));
  const code = /** @type {HTMLInputElement} */ (form.querySelector('#wd-code'));
  const submit = /** @type {HTMLButtonElement} */ (form.querySelector('[type="submit"]'));

  const destination = () => /** @type {HTMLInputElement|null} */ (form.querySelector('input[name="destination"]:checked'))?.value || 'bank';

  const renderDestination = () => {
    const crypto = destination() === 'crypto';
    if (addressWrap) addressWrap.hidden = !crypto;
    if (address) { address.required = crypto; if (!crypto) clearError(address); }
  };

  const amountMsg = () => {
    const v = parseAmount(amount.value);
    if (!Number.isFinite(v) || v <= 0) return 'Enter an amount to withdraw.';
    if (v < MIN) return `The minimum withdrawal is ${format(MIN, 'currency', 0)}.`;
    if (v > available) return `Exceeds your available balance of ${format(available, 'currency', 2)}`;
    return '';
  };

  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t instanceof Element && t.getAttribute('aria-invalid') === 'true') clearError(t);
    if (t === code) code.value = code.value.replace(/\D/g, '').slice(0, 6);
  }, { signal });

  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.name === 'destination') renderDestination();
  }, { signal });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (submit.getAttribute('aria-busy') === 'true') return;
    /** @type {[HTMLInputElement, string][]} */
    const checks = [
      [amount, amountMsg()],
      ...(address && address.required ? /** @type {[HTMLInputElement, string][]} */ ([[address, address.value.trim().length >= 26 ? '' : 'Enter the full wallet address you want to receive funds at.']]) : []),
      [code, /^\d{6}$/.test(code.value) ? '' : 'Enter the 6-digit code from your authenticator app.'],
    ];
    let first = null;
    for (const [el, msg] of checks) {
      if (msg) { setError(el, msg); first ??= el; } else clearError(el);
    }
    if (first) { first.focus(); return; }
    submit.setAttribute('aria-busy', 'true');
    submit.disabled = true;
    setTimeout(() => {
      toast('Withdrawal requested — usually processed within 24 hours');
      dialog.close();
    }, 700);
  }, { signal });

  dialog.addEventListener('close', () => {
    form.reset();
    submit.removeAttribute('aria-busy');
    submit.disabled = false;
    form.querySelectorAll('[aria-invalid="true"]').forEach(clearError);
    renderDestination();
  }, { signal });

  renderDestination();
  return () => ac.abort();
}
