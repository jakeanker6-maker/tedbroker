// @ts-check
/**
 * Segmented toggle group (aria-pressed). Optionally drives a chart.
 * <div class="seg" role="group" aria-label="Range" data-component="seg" data-target="chartId">
 *   <button class="seg__btn" aria-pressed="false" data-series="walk:24,seed=2" data-start="2026-10-26" data-step="1">1D</button> …
 * </div>
 * Emits `seg:change` (bubbles) with detail {button, value}.
 */
export function init(group) {
  const btns = /** @type {HTMLButtonElement[]} */ ([...group.querySelectorAll('button')]);
  group.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button');
    if (!btn || !group.contains(btn)) return;
    btns.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    group.dispatchEvent(new CustomEvent('seg:change', { detail: { button: btn, value: btn.value || btn.textContent?.trim() }, bubbles: true }));
    const target = document.getElementById(group.dataset.target || '');
    if (target && btn.dataset.series) {
      target.dispatchEvent(new CustomEvent('chart:update', {
        detail: { series: btn.dataset.series, compare: btn.dataset.compare, start: btn.dataset.start, step: btn.dataset.step, labels: btn.dataset.labels },
      }));
    }
  });
}
