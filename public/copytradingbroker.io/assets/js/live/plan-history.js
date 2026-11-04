// @ts-check
/**
 * Plan value history for the dashboard and portfolio charts.
 * The series is MODELLED: each plan follows the platform's expected-return schedule.
 * It is not market data, so every chart using it says so.
 */
import { api, esc, money } from './api.js';

export const RANGES = ['1W', '1M', '3M', '1Y', 'ALL'];

export const MODELLED_NOTE = 'Modelled plan value: each plan follows its expected-return schedule. It is not market data.';

/** @param {string} iso */
function shortLabel(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** @param {string} range */
export function fetchHistory(range) {
  return api(`/api/investments/history?range=${encodeURIComponent(range)}`);
}

/**
 * Push a history payload into a chart element. Returns false when there is nothing to plot.
 * @param {HTMLElement} chart
 * @param {{has_investments: boolean, points: Array<{date: string, value: number}>}} data
 */
export function renderHistory(chart, data) {
  const points = Array.isArray(data?.points) ? data.points : [];
  if (!data?.has_investments || points.length < 2) return false;
  const values = points.map((p) => p.value.toFixed(2)).join(',');
  const labels = points.map((p) => shortLabel(p.date)).join(',');
  const last = points[points.length - 1];
  chart.setAttribute('aria-label', `Modelled plan value over this period, ending at ${money(last.value)}. Use arrow keys to inspect values.`);
  chart.dispatchEvent(new CustomEvent('chart:update', {
    detail: { series: values, labels, animate: true },
  }));
  return true;
}

/**
 * Build the modelled plan-value block (heading, range buttons, chart, modelled note) inside a
 * section and load its data. Components are initialised here because the block is created
 * after the page's component registry has already run.
 * @param {HTMLElement} section
 * @param {{title: string, defaultRange?: string, headingId?: string, footnote?: string}} opts
 */
export async function mountHistoryChart(section, { title, defaultRange = '1M', headingId = 'plan-chart-title', footnote = '' }) {
  const seriesName = esc(title);
  section.innerHTML = `<div class="block-head">
      <h2 id="${esc(headingId)}">${seriesName} <small>modelled plan value</small></h2>
      <div class="seg" role="group" aria-label="Chart range" data-target="pf-plan-chart">
        ${RANGES.map((r) => `<button class="seg__btn" type="button" aria-pressed="${r === defaultRange}">${r}</button>`).join('')}
      </div>
    </div>
    <div class="chart pf-chart mt-5" id="pf-plan-chart" data-format="currency" data-decimals="2" data-yaxis="4" data-xaxis="6" data-dots data-floor-zero
         role="img" aria-label="Modelled plan value"></div>
    <p class="fineprint demo-note" data-chart-note>${esc(MODELLED_NOTE)}</p>
    ${footnote ? `<p class="fineprint" data-chart-footnote>${esc(footnote)}</p>` : ''}`;
  section.setAttribute('aria-labelledby', headingId);
  const chart = /** @type {HTMLElement} */ (section.querySelector('#pf-plan-chart'));
  const seg = /** @type {HTMLElement} */ (section.querySelector('.seg'));
  const note = /** @type {HTMLElement} */ (section.querySelector('[data-chart-note]'));
  const { init: initChart } = await import('../components/chart.js');
  const { init: initSeg } = await import('../components/seg.js');
  initChart(chart);
  initSeg(seg);

  /** @param {{title: string, text?: string}} message @param {'empty'|'error'} kind */
  const showMessage = (message, kind) => {
    section.querySelector(`[data-chart-${kind}]`)?.remove();
    const box = document.createElement('div');
    box.className = 'empty';
    box.dataset[`chart${kind[0].toUpperCase()}${kind.slice(1)}`] = '';
    if (kind === 'error') box.setAttribute('role', 'alert');
    const heading = document.createElement('p');
    heading.className = 'empty__title';
    heading.textContent = message.title;
    box.append(heading);
    if (message.text) {
      const text = document.createElement('p');
      text.textContent = message.text;
      box.append(text);
    }
    section.append(box);
  };
  const clearMessages = () => section.querySelectorAll('[data-chart-empty], [data-chart-error]').forEach((el) => el.remove());

  /** @param {string} range */
  const load = async (range) => {
    try {
      const data = await fetchHistory(range);
      clearMessages();
      const drawn = renderHistory(chart, data);
      chart.hidden = !drawn;
      note.hidden = !drawn;
      if (!drawn) {
        showMessage(data.has_investments
          ? { title: 'Plan history is still building', text: 'It appears here as the modelled value builds up over this period.' }
          : { title: 'No plan history yet', text: 'Activate a plan to see its modelled value over time.' }, 'empty');
      }
    } catch (err) {
      console.error('[plan-history]', err);
      clearMessages();
      chart.hidden = true;
      note.hidden = true;
      showMessage({ title: 'Plan progress couldn’t be loaded', text: 'Reload the page to try again.' }, 'error');
    }
  };
  seg.addEventListener('seg:change', (e) => {
    const value = /** @type {CustomEvent} */ (e).detail?.value;
    if (value) load(String(value));
  });
  await load(defaultRange);
}
