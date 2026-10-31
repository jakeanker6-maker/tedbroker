// @ts-check
/**
 * Bar chart from data. Signed values draw losses downward from a zero baseline.
 * <div class="bars" data-component="bars" data-values="12,30,-8,…" data-labels="Nov,Dec,…" data-format="percent" data-show-values></div>
 * Values are also written into a visually hidden list for screen readers.
 */
import { format } from '../lib/util.js';

export function init(el) {
  const vals = (el.dataset.values || '').split(',').map(Number);
  const labels = (el.dataset.labels || '').split(',');
  const kind = el.dataset.format || 'number';
  const signed = vals.some((v) => v < 0);
  const maxPos = Math.max(0, ...vals), maxNeg = Math.abs(Math.min(0, ...vals));
  const fmt = (v) => kind === 'percent' ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : kind === 'currency' ? format(v, 'currency', 0) : format(v, 'number', 0);

  const frag = document.createDocumentFragment();
  vals.forEach((v, i) => {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.setProperty('--i', String(i));
    bar.title = `${labels[i] || ''} ${fmt(v)}`.trim();
    if (signed) {
      const total = maxPos + maxNeg || 1;
      const up = document.createElement('div');
      up.style.blockSize = `${(maxPos / total) * 100}%`;
      up.style.display = 'flex'; up.style.flexDirection = 'column'; up.style.justifyContent = 'flex-end';
      const down = document.createElement('div');
      down.style.blockSize = `${(maxNeg / total) * 100}%`;
      down.style.borderBlockStart = '1px solid var(--color-border-strong)';
      const fill = document.createElement('div');
      fill.className = 'bar__fill' + (v < 0 ? ' bar__fill--loss' : '');
      fill.style.setProperty('--v', String(v < 0 ? Math.abs(v) / (maxNeg || 1) : v / (maxPos || 1)));
      (v < 0 ? down : up).append(fill);
      bar.append(up, down);
    } else {
      const fill = document.createElement('div');
      fill.className = 'bar__fill';
      fill.style.setProperty('--v', String(v / (maxPos || 1)));
      bar.append(fill);
    }
    if (labels[i]) {
      const lab = document.createElement('div');
      lab.className = 'bar__label';
      lab.textContent = labels[i];
      if (el.hasAttribute('data-show-values')) {
        const val = document.createElement('div');
        val.textContent = fmt(v);
        val.className = v < 0 ? 'loss' : 'gain';
        val.style.marginBlockStart = '4px';
        lab.append(val);
      }
      bar.append(lab);
    }
    frag.append(bar);
  });
  el.setAttribute('aria-hidden', 'true');
  const sr = document.createElement('ul');
  sr.className = 'sr-only';
  vals.forEach((v, i) => { const li = document.createElement('li'); li.textContent = `${labels[i] || i + 1}: ${fmt(v)}`; sr.append(li); });
  el.replaceChildren(frag);
  el.after(sr);
  if (signed) el.classList.add('bars--signed');
}
