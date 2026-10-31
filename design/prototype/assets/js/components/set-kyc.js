// @ts-check
/**
 * Settings → Verification: ID document upload with type/size validation and drag-and-drop.
 *
 * <form data-component="set-kyc" data-max-mb="5">
 *   <div class="field" data-set-file-field>
 *     <label class="set-drop" data-set-drop for="kyc-file">… <span data-set-file-name></span>
 *       <input class="sr-only" type="file" id="kyc-file" accept="image/*,application/pdf,.pdf" aria-describedby="… kyc-file-error"></label>
 *     <p class="field__error" id="kyc-file-error"><svg…/><span data-set-file-error></span></p>
 *   </div>
 *   <button type="submit">Submit for review</button>
 * </form>
 * [data-set-kyc-status] (anywhere in the document) is updated to "In review" after submitting.
 */
import { format, toast } from '../lib/util.js';

export function init(form) {
  if (!(form instanceof HTMLFormElement)) return;
  const input = /** @type {HTMLInputElement|null} */ (form.querySelector('input[type="file"]'));
  const field = /** @type {HTMLElement|null} */ (form.querySelector('[data-set-file-field]'));
  const drop = /** @type {HTMLElement|null} */ (form.querySelector('[data-set-drop]'));
  const nameEl = form.querySelector('[data-set-file-name]');
  const errEl = form.querySelector('[data-set-file-error]');
  const submit = /** @type {HTMLButtonElement|null} */ (form.querySelector('[type="submit"]'));
  if (!input || !field) return;
  const maxBytes = Number(form.dataset.maxMb || 5) * 1024 * 1024;

  const setError = (msg) => {
    if (errEl) errEl.textContent = msg;
    if (msg) { field.dataset.invalid = 'true'; input.setAttribute('aria-invalid', 'true'); }
    else { delete field.dataset.invalid; input.removeAttribute('aria-invalid'); }
  };

  const validate = () => {
    const file = input.files?.[0];
    if (nameEl) nameEl.textContent = file ? `${file.name} · ${format(file.size / 1048576, 'number', 1)} MB` : '';
    let msg = '';
    if (!file) msg = 'Choose a photo or PDF of your ID document.';
    else if (!(file.type.startsWith('image/') || file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
      msg = 'This file type isn’t supported. Upload an image (JPG, PNG, HEIC) or a PDF.';
    } else if (file.size > maxBytes) {
      msg = `This file is ${format(file.size / 1048576, 'number', 1)} MB. The maximum size is ${format(maxBytes / 1048576, 'number', 0)} MB.`;
    }
    setError(msg);
    return !msg;
  };

  input.addEventListener('change', validate);

  if (drop) {
    const off = () => drop.removeAttribute('data-drag');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.setAttribute('data-drag', ''); });
    drop.addEventListener('dragleave', off);
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      off();
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      try { input.files = files; } catch { return; }
      validate();
    });
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (submit?.disabled) return;
    if (!validate()) { input.focus(); return; }
    submit?.setAttribute('aria-busy', 'true');
    if (submit) submit.disabled = true;
    setTimeout(() => {
      submit?.removeAttribute('aria-busy');
      if (submit) submit.textContent = 'Submitted';
      input.disabled = true;
      document.querySelectorAll('[data-set-kyc-status]').forEach((el) => {
        el.className = 'tag tag--plain tag--pending';
        el.textContent = 'In review';
      });
      toast('ID document submitted for review');
    }, 900);
  });
}
