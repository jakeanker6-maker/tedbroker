// @ts-check
/**
 * Prefill a referral-code input from the ?ref= query parameter.
 * <input class="field__input" id="ref" name="referral" data-component="ref-prefill">
 */
export function init(input) {
  if (!(input instanceof HTMLInputElement) || input.value) return;
  const ref = new URLSearchParams(location.search).get('ref');
  if (!ref) return;
  // Keep only safe code characters; value is set as a property, never as markup.
  input.value = ref.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
}
