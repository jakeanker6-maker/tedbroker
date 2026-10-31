// @ts-check
/**
 * Active copies: Pause/Resume and Stop (with confirm dialog).
 *
 * <div data-component="pf-actions" data-stop-dialog="pf-stop-dialog">
 *   <table>… <tr data-trader="Elena Vasquez" data-state="copying">
 *     <span data-pf-status class="tag …">Copying</span>
 *     <button data-pf-action="toggle"><span data-label>Pause</span><span class="sr-only"> copying Elena Vasquez</span></button>
 *     <button data-pf-action="stop">…</button>
 *   </tr> …</table>
 * </div>
 * Optional counters: [data-pf-copies-count] (text replaced with the number of copies still running or paused).
 * Dialog: [data-pf-stop-name] receives the trader name; [data-pf-stop-confirm] confirms.
 */
import { format, toast } from '../lib/util.js';

const STATUS = {
  copying: { text: 'Copying', cls: 'tag tag--plain tag--gain', action: 'Pause' },
  paused: { text: 'Paused', cls: 'tag tag--plain tag--pending', action: 'Resume' },
};

export function init(root) {
  const dlg = document.getElementById(root.dataset.stopDialog || '');
  const region = root.querySelector('[role="region"]') || root;
  /** @type {HTMLTableRowElement|null} */
  let pending = null;

  const setState = (row, state) => {
    const s = STATUS[state];
    row.dataset.state = state;
    const tag = row.querySelector('[data-pf-status]');
    if (tag) { tag.className = s.cls; tag.textContent = s.text; }
    const label = row.querySelector('[data-pf-action="toggle"] [data-label]');
    if (label) label.textContent = s.action;
  };

  const updateCounts = () => {
    const n = root.querySelectorAll('tr[data-trader]:not([data-state="stopped"])').length;
    document.querySelectorAll('[data-pf-copies-count]').forEach((el) => { el.textContent = format(n, 'number', 0); });
  };

  root.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-pf-action]');
    if (!btn || !root.contains(btn)) return;
    const row = /** @type {HTMLTableRowElement|null} */ (btn.closest('tr[data-trader]'));
    if (!row) return;
    const name = row.dataset.trader || '';

    if (btn.dataset.pfAction === 'toggle') {
      const next = row.dataset.state === 'paused' ? 'copying' : 'paused';
      setState(row, next);
      toast(next === 'paused' ? `Paused copying ${name}. New trades won't be mirrored.` : `Resumed copying ${name}`);
      return;
    }
    if (btn.dataset.pfAction === 'stop' && dlg instanceof HTMLDialogElement) {
      pending = row;
      dlg.querySelectorAll('[data-pf-stop-name]').forEach((el) => { el.textContent = name; });
      dlg.showModal();
    }
  });

  dlg?.querySelector('[data-pf-stop-confirm]')?.addEventListener('click', () => {
    if (!pending || !(dlg instanceof HTMLDialogElement)) return;
    const row = pending;
    pending = null;
    const name = row.dataset.trader || '';
    row.dataset.state = 'stopped';
    const tag = row.querySelector('[data-pf-status]');
    if (tag) { tag.className = 'tag tag--plain'; tag.textContent = 'Stopped'; }
    const actions = row.querySelector('[data-pf-actions]');
    actions?.replaceChildren();
    dlg.close();
    /** @type {HTMLElement} */ (region).focus();
    updateCounts();
    toast(`Stopped copying ${name}`);
  });
  dlg?.addEventListener('close', () => { pending = null; });
}
