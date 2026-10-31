// @ts-check
/** Show/hide password. <button type="button" class="icon-btn" data-component="password" aria-controls="pw" aria-pressed="false" aria-label="Show password">…</button>
 *  Optional strength meter: add data-meter="meterId" to the <input>. */
export function init(btn) {
  const input = /** @type {HTMLInputElement|null} */ (document.getElementById(btn.getAttribute('aria-controls') || ''));
  if (!input) return;
  btn.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(show));
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  });

  const meter = document.getElementById(input.dataset.meter || '');
  if (!meter) return;
  const label = document.getElementById(meter.dataset.label || '');
  const update = () => {
    const v = input.value;
    let score = 0;
    if (v.length >= 8) score++;
    if (v.length >= 12) score++;
    if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
    if (/\d/.test(v) && /[^A-Za-z0-9]/.test(v)) score++;
    meter.querySelectorAll('span').forEach((s, i) => s.classList.toggle('is-on', i < score));
    const level = ['weak', 'weak', 'fair', 'good', 'strong'][score];
    meter.dataset.level = level;
    if (label) label.textContent = v ? { weak: 'Weak', fair: 'Fair', good: 'Good', strong: 'Strong' }[level] : '';
  };
  input.addEventListener('input', update);
  update();
}
