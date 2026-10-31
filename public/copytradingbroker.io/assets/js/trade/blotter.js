// @ts-check
/** Positions, open orders, order history and activity tables. */
import { api } from '../live/api.js';
import { toast } from '../lib/util.js';
import { $, SIDE_LABEL, TYPE_LABEL, dateTime, h, isOcc, occName, price, qty as fmtQty, signedPct, signedUsd, tone, usdFmt } from './dom.js';

const ACTIVITY_LABEL = /** @type {Record<string,string>} */ ({
  opening_balance: 'Opening balance', deposit: 'Deposit', withdrawal: 'Withdrawal', withdrawal_hold: 'Withdrawal hold',
  withdrawal_release: 'Hold released', adjustment: 'Adjustment', plan_invest: 'Plan investment', plan_refund: 'Plan refund',
  referral_bonus: 'Referral bonus', trade_buy: 'Buy', trade_sell: 'Sell', exercise: 'Exercise', assignment: 'Assignment',
  dividend: 'Dividend', dividend_owed: 'Dividend owed', borrow_fee: 'Borrow fee', margin_interest: 'Margin interest',
});

/** @param {HTMLElement|null} tbody @param {number} cols @param {string} text */
function empty(tbody, cols, text) {
  tbody?.replaceChildren(h('tr', { class: 'th-empty' }, h('td', { colspan: cols }, text)));
}

const label = (/** @type {string} */ s) => (isOcc(s) ? occName(s) : s);

/**
 * Positions with live repricing between server refreshes.
 * @param {HTMLElement} tbody
 * @param {{onSelect: (symbol: string, assetClass: string) => void, onClose: (p: any) => void}} handlers
 */
export function positionsTable(tbody, handlers) {
  /** @type {Map<string, {p: any, base: number, cells: Record<string, HTMLElement>}>} */
  const rows = new Map();

  /** @param {any[]} positions @param {any[]} groups */
  function render(positions, groups = []) {
    rows.clear();
    if (!positions.length) { empty(tbody, 8, 'No open positions. Search for a symbol to place your first trade.'); return; }
    const inGroup = new Map();
    for (const g of groups) for (const l of g.legs || []) inGroup.set(l.symbol, g);
    const out = [];
    const done = new Set();
    for (const p of positions) {
      const g = inGroup.get(p.symbol);
      if (g && !done.has(g.group_id)) {
        done.add(g.group_id);
        const legs = positions.filter((x) => (g.legs || []).some((/** @type {any} */ l) => l.symbol === x.symbol));
        // A strategy total is shown only when every leg is priced.
        const mv = legs.every((x) => x.market_value != null) ? legs.reduce((a, x) => a + Number(x.market_value), 0) : null;
        const pnl = legs.every((x) => x.unrealized_pnl != null) ? legs.reduce((a, x) => a + Number(x.unrealized_pnl), 0) : null;
        out.push(h('tr', { class: 'th-group' },
          h('td', null, h('span', { class: 'th-sym' }, `${g.underlying} ${g.strategy.replace(/_/g, ' ')}`), h('span', { class: 'sub' }, `${g.qty} × strategy`)),
          h('td', { class: 'is-num' }, ''), h('td', { class: 'is-num' }, ''), h('td', { class: 'is-num' }, ''),
          h('td', { class: 'is-num' }, usdFmt(mv)), h('td', { class: 'is-num' }, ''),
          h('td', { class: `is-num ${tone(pnl)}` }, signedUsd(pnl)), h('td', null, '')));
        for (const leg of legs) out.push(row(leg, true));
        continue;
      }
      if (!g) out.push(row(p, false));
    }
    tbody.replaceChildren(...out);
  }

  /** @param {any} p @param {boolean} leg */
  function row(p, leg) {
    const cells = {
      last: h('td', { class: 'is-num' }, price(p.mark)),
      mv: h('td', { class: 'is-num' }, usdFmt(p.market_value)),
      day: h('td', { class: `is-num ${tone(p.day_pnl)}` }, p.day_pnl == null ? '—' : signedUsd(p.day_pnl)),
      pnl: h('td', { class: `is-num ${tone(p.unrealized_pnl)}` }, signedUsd(p.unrealized_pnl), h('span', { class: 'sub' }, signedPct(p.unrealized_pnl_percent))),
    };
    rows.set(`${p.symbol}|${p.bucket}`, { p, base: Number(p.mark), cells });
    const short = Number(p.qty) < 0;
    return h('tr', { class: leg ? 'th-leg' : null, dataset: { symbol: p.symbol } },
      h('td', null,
        h('button', { class: 'text-btn th-sym', type: 'button', onclick: () => handlers.onSelect(p.symbol, p.asset_class) }, label(p.symbol)),
        h('span', { class: 'sub' }, `${short ? 'Short · ' : ''}${p.bucket_label || ''}${p.asset_class === 'option' ? '' : ` · ${p.name || ''}`}`)),
      h('td', { class: 'is-num' }, fmtQty(p.qty)),
      h('td', { class: 'is-num' }, price(p.avg_cost)),
      cells.last, cells.mv, cells.day, cells.pnl,
      h('td', null, h('div', { class: 'th-row-actions' },
        h('button', { class: 'text-btn', type: 'button', onclick: () => handlers.onClose(p) }, short ? 'Cover' : 'Close'))));
  }

  /** Reprice from a live quote. @param {any} q */
  function tick(q) {
    for (const [key, r] of rows) {
      if (!key.startsWith(`${q.symbol}|`)) continue;
      const mark = q.asset_class === 'option' ? Number(q.mid) : Number(q.last ?? q.mid);
      if (!Number.isFinite(mark)) continue;
      const mult = Number(r.p.multiplier || 1);
      const qty = Number(r.p.qty);
      const mv = qty * mark * mult;
      const pnl = mv - Number(r.p.cost_basis);
      r.cells.last.textContent = price(mark);
      r.cells.mv.textContent = usdFmt(mv);
      r.cells.pnl.className = `is-num ${tone(pnl)}`;
      r.cells.pnl.firstChild && (r.cells.pnl.firstChild.textContent = signedUsd(pnl));
      if (r.p.day_pnl != null && Number.isFinite(r.base)) {
        const day = Number(r.p.day_pnl) + qty * mult * (mark - r.base);
        r.cells.day.className = `is-num ${tone(day)}`;
        r.cells.day.textContent = signedUsd(day);
      }
    }
  }
  return { render, tick };
}

/** @param {any} o */
function describe(o) {
  if (o.asset_class === 'multileg') {
    return [`${o.symbol} ${String(o.strategy || '').replace(/_/g, ' ')}`,
      (o.legs || []).map((/** @type {any} */ l) => `${SIDE_LABEL[l.side] || l.side} ${l.ratio > 1 ? `${l.ratio}× ` : ''}${label(l.symbol)}`).join(' / ')];
  }
  return [`${SIDE_LABEL[o.side] || o.side} ${label(o.symbol)}`, `${TYPE_LABEL[o.type] || o.type} · ${String(o.tif).toUpperCase()}${o.extended_hours ? ' · Ext' : ''}${o.source && o.source !== 'manual' ? ` · ${o.source}` : ''}`];
}

/** @param {any} o */
function orderPrice(o) {
  if (o.asset_class === 'multileg') return o.net_price ? `${usdFmt(o.net_price)} ${o.price_effect || ''}` : 'Market';
  if (o.type === 'limit') return usdFmt(o.limit_price);
  if (o.type === 'stop') return `Stop ${usdFmt(o.stop_price)}`;
  if (o.type === 'stop_limit') return `${usdFmt(o.stop_price)} / ${usdFmt(o.limit_price)}`;
  if (o.type === 'trailing_stop') return `${o.trail_percent ? `${o.trail_percent}%` : usdFmt(o.trail_amount)} trail${o.stop_price ? ` · ${usdFmt(o.stop_price)}` : ''}`;
  return 'Market';
}

const STATUS = /** @type {Record<string,[string,string]>} */ ({
  new: ['New', 'tag--pending'], accepted: ['Working', 'tag--pending'], triggered: ['Triggered', 'tag--pending'],
  partially_filled: ['Partial', 'tag--pending'], filled: ['Filled', 'tag--gain'], canceled: ['Canceled', ''],
  expired: ['Expired', ''], rejected: ['Rejected', 'tag--loss'],
});
/** @param {string} s */
const statusTag = (s) => { const [t, c] = STATUS[s] || [s, '']; return h('span', { class: `tag tag--plain ${c}` }, t); };

/** @param {HTMLElement} tbody @param {() => void} onChange */
export function openOrdersTable(tbody, onChange) {
  let editing = false;
  /** @type {any[]|null} */ let deferred = null;

  /** @param {any[]} orders */
  function render(orders) {
    if (editing) { deferred = orders; return; }     // don't destroy a form the user is typing in
    // remember which row action had focus so a live refresh can restore it
    const ae = /** @type {HTMLElement|null} */ (document.activeElement);
    const inTable = !!ae && tbody.contains(ae);
    const focusedKey = inTable && ae?.dataset.act ? `${ae.closest('tr')?.dataset.id}|${ae.dataset.act}` : '';
    if (!orders.length) { empty(tbody, 6, 'No open orders.'); return; }
    tbody.replaceChildren(...orders.map((o) => {
      const [title, sub] = describe(o);
      const priceCell = h('td', { class: 'is-num' }, orderPrice(o));
      const actions = h('div', { class: 'th-row-actions' });
      const editable = o.source === 'manual' && o.asset_class !== 'multileg' && ['limit', 'stop', 'stop_limit'].includes(o.type) && Number(o.filled_qty) === 0;
      if (editable) actions.append(h('button', { class: 'text-btn', type: 'button', dataset: { act: 'edit' }, 'aria-label': `Edit ${title}`, onclick: (/** @type {Event} */ e) => edit(o, priceCell, /** @type {HTMLElement} */ (e.currentTarget)) }, 'Edit'));
      actions.append(h('button', { class: 'text-btn text-btn--muted', type: 'button', dataset: { act: 'cancel' }, 'aria-label': `Cancel ${title}`, onclick: () => cancel(o) }, 'Cancel'));
      return h('tr', { dataset: { id: o.id } },
        h('td', { class: 'mono muted' }, dateTime(o.created_at)),
        h('td', null, h('strong', null, title), h('span', { class: 'sub' }, sub)),
        h('td', { class: 'is-num' }, o.qty ? `${fmtQty(o.filled_qty)} / ${fmtQty(o.qty)}` : usdFmt(o.notional)),
        priceCell,
        h('td', null, statusTag(o.triggered && o.status !== 'filled' ? 'triggered' : o.status),
          Number(o.buying_power_held) > 0 || Number(o.cash_reserved) > 0
            ? h('span', { class: 'sub' }, `Holds ${usdFmt(Math.max(Number(o.buying_power_held), Number(o.cash_reserved)))}`) : null),
        h('td', null, actions));
    }));
    if (focusedKey) {
      const [id, act] = focusedKey.split('|');
      /** @type {HTMLElement|null} */ (tbody.querySelector(`tr[data-id="${CSS.escape(id)}"] [data-act="${act}"]`))?.focus();
    }
  }

  function finishEdit() {
    editing = false;
    if (deferred) { const d = deferred; deferred = null; render(d); }
  }

  /** @param {any} o */
  async function cancel(o) {
    try {
      await api(`/api/trading/orders/${encodeURIComponent(o.id)}`, { method: 'DELETE' });
      toast('Order canceled');
      onChange();
    } catch (err) { toast(/** @type {Error} */ (err).message, { tone: 'error' }); }
  }

  /** Inline cancel-replace of price and quantity. @param {any} o @param {HTMLElement} cell @param {HTMLElement} opener */
  function edit(o, cell, opener) {
    editing = true;
    const original = [...cell.childNodes];
    const field = o.type === 'stop' ? 'stop_price' : 'limit_price';
    const errId = `edit-err-${o.id}`;
    const input = /** @type {HTMLInputElement} */ (h('input', { class: 'field__input mono', inputmode: 'decimal', value: o[field] || '', 'aria-label': field === 'stop_price' ? 'New stop price' : 'New limit price', 'aria-describedby': errId, size: 8 }));
    const qtyInput = /** @type {HTMLInputElement} */ (h('input', { class: 'field__input mono', inputmode: 'decimal', value: o.qty || '', 'aria-label': 'New quantity', 'aria-describedby': errId, size: 6 }));
    const err = h('p', { class: 'field__error', id: errId, role: 'alert', hidden: true });
    const restore = () => { cell.replaceChildren(...original); opener.isConnected && opener.focus(); finishEdit(); };
    const form = h('form', { class: 'th-row-actions' }, qtyInput, input,
      h('button', { class: 'text-btn', type: 'submit' }, 'Save'),
      h('button', { class: 'text-btn text-btn--muted', type: 'button', onclick: restore }, 'Cancel'), err);
    form.addEventListener('keydown', (e) => { if (/** @type {KeyboardEvent} */ (e).key === 'Escape') { e.preventDefault(); restore(); } });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(`/api/trading/orders/${encodeURIComponent(o.id)}`, { method: 'PATCH', body: JSON.stringify({ [field]: input.value, qty: qtyInput.value }) });
        toast('Order replaced');
        editing = false; deferred = null;
        onChange();
      } catch (e2) {
        err.textContent = /** @type {Error} */ (e2).message;
        err.hidden = false;
        err.style.display = 'flex';
        input.setAttribute('aria-invalid', 'true');
        input.focus();
      }
    });
    cell.replaceChildren(form);
    input.focus();
  }
  return { render };
}

/** @param {HTMLElement} tbody */
export function historyTable(tbody) {
  /** @param {any[]} orders */
  return { render(orders) {
    if (!orders.length) { empty(tbody, 6, 'No order history yet.'); return; }
    tbody.replaceChildren(...orders.map((o) => {
      const [title, sub] = describe(o);
      return h('tr', null,
        h('td', { class: 'mono muted' }, dateTime(o.filled_at || o.closed_at || o.created_at)),
        h('td', null, h('strong', null, title), h('span', { class: 'sub' }, sub)),
        h('td', { class: 'is-num' }, o.qty ? `${fmtQty(o.filled_qty)} / ${fmtQty(o.qty)}` : usdFmt(o.notional)),
        h('td', { class: 'is-num' }, o.avg_fill_price ? price(o.avg_fill_price) : '—'),
        h('td', { class: 'is-num' }, usdFmt(o.fees)),
        h('td', null, statusTag(o.status), o.reason ? h('span', { class: 'sub' }, String(o.reason).replace(/_/g, ' ')) : null));
    }));
  } };
}

/** @param {HTMLElement} tbody */
export function activityTable(tbody) {
  /** @param {any[]} items */
  return { render(items) {
    if (!items.length) { empty(tbody, 5, 'No activity yet.'); return; }
    tbody.replaceChildren(...items.map((i) => h('tr', null,
      h('td', { class: 'mono muted' }, dateTime(i.created_at)),
      h('td', null, i.description || ACTIVITY_LABEL[i.type] || i.type),
      h('td', null, h('span', { class: 'tag tag--plain tag--nodot' }, ACTIVITY_LABEL[i.type] || i.type)),
      h('td', { class: `is-num ${tone(i.amount)}` }, signedUsd(i.amount)),
      h('td', { class: 'is-num' }, usdFmt(i.cash_after)))));
  } };
}

export { $ };
