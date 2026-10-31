// @ts-check
/**
 * Order ticket: action -> quantity (shares or dollars) -> type -> prices -> TIF -> live
 * estimate (server preview) -> Review dialog -> Place. A client_order_id is generated per
 * draft and reused on retry, so a double submit never places two orders.
 */
import { api } from '../live/api.js';
import { toast } from '../lib/util.js';
import { $, $$, SIDE_LABEL, TYPE_LABEL, debounce, h, occName, price, qty as fmtQty, setText, usdFmt } from './dom.js';

/**
 * @typedef {{symbol: string, asset_class: string, name?: string}} Instrument
 * @typedef {{
 *   account: () => any,
 *   positionQty: (symbol: string) => number,
 *   quote: (symbol: string) => any,
 *   onPlaced: (order: any) => void,
 * }} TicketContext
 */

const ERROR_FIELD = /** @type {Record<string,string>} */ ({
  invalid_qty: 'qty', insufficient_position: 'qty', fractional_not_allowed: 'qty', no_position: 'qty',
  locate_failed: 'qty', invalid_price: 'limit', price_collar: 'limit', invalid_stop: 'stop',
});

/** @param {HTMLFormElement} form @param {TicketContext} ctx */
export function createTicket(form, ctx) {
  const el = {
    title: $('[data-t="symbol"]', form), actions: $('[data-actions]', form), unit: $('[data-unit]', form),
    qty: /** @type {HTMLInputElement} */ ($('#t-qty', form)), qtyLabel: $('[data-qty-label]', form), qtyHelp: $('[data-qty-help]', form),
    type: /** @type {HTMLSelectElement} */ ($('#t-type', form)), tif: /** @type {HTMLSelectElement} */ ($('#t-tif', form)),
    limit: /** @type {HTMLInputElement} */ ($('#t-limit', form)), stop: /** @type {HTMLInputElement} */ ($('#t-stop', form)),
    trail: /** @type {HTMLInputElement} */ ($('#t-trail', form)), ext: /** @type {HTMLInputElement} */ ($('[name="extended_hours"]', form)),
    locate: $('[data-locate]', form), error: $('[data-ticket-error]', form), review: /** @type {HTMLButtonElement} */ ($('[data-review]', form)),
    estLabel: $('[data-est-label]', form),
  };
  const dialog = /** @type {HTMLDialogElement} */ (document.getElementById('order-review'));
  const placeBtn = /** @type {HTMLButtonElement} */ ($('[data-place]', dialog));
  // Return focus to the ticket when the review closes without placing (Escape / Edit order).
  dialog.addEventListener('close', () => {
    setTimeout(() => {
      if (!form.contains(document.activeElement) && !document.querySelector('dialog[open]')) {
        const bad = /** @type {HTMLElement|null} */ (form.querySelector('[aria-invalid="true"]'));
        (bad || el.review).focus();
      }
    }, 0);
  });

  /** @type {Instrument|null} */ let inst = null;
  let side = 'buy';
  let unit = 'qty';
  let clientId = crypto.randomUUID();
  /** @type {any} */ let lastPreview = null;
  let previewSeq = 0;
  /** @type {Record<string, any>} */ const locates = {};

  const field = (/** @type {string} */ name) => $(`[data-field="${name}"]`, form);
  const newDraft = () => { clientId = crypto.randomUUID(); };

  function sidesFor() {
    if (!inst) return [];
    const acct = ctx.account() || {};
    const held = ctx.positionQty(inst.symbol);
    const margin = acct.account_type === 'margin';
    if (inst.asset_class === 'option') {
      const out = ['buy_to_open'];
      if (held > 0) out.push('sell_to_close');
      if ((acct.options_level ?? 2) >= 1) out.push('sell_to_open');
      if (held < 0) out.push('buy_to_close');
      return out;
    }
    if (inst.asset_class === 'crypto') return held > 0 ? ['buy', 'sell'] : ['buy'];
    const out = ['buy'];
    if (held > 0) out.push('sell');
    if (margin && held <= 0) out.push('sell_short');
    if (held < 0) out.push('buy_to_cover');
    return out;
  }

  let renderedSides = '';
  /** Rebuild the radios only when the set of allowed actions changes; otherwise update in place
   *  (stream refreshes must not steal keyboard focus). */
  function renderActions() {
    const sides = sidesFor();
    if (!sides.includes(side)) side = sides[0] || 'buy';
    const key = sides.join(',');
    const hadFocus = !!el.actions?.contains(document.activeElement);
    if (key !== renderedSides) {
      renderedSides = key;
      el.actions?.replaceChildren(...sides.map((s) => h('button', {
        class: 'seg__btn', type: 'button', role: 'radio', dataset: { side: s },
        'data-sell': s.startsWith('sell') ? '' : null,
      }, SIDE_LABEL[s] || s)));
    }
    $$('[data-side]', el.actions || form).forEach((b) => {
      const on = b.dataset.side === side;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    if (hadFocus) /** @type {HTMLElement|null} */ ($(`[data-side="${side}"]`, el.actions || form))?.focus();
  }

  function syncFields() {
    if (!inst) return;
    const ac = inst.asset_class;
    const type = el.type.value;
    const dollarsOk = ['stock', 'etf', 'crypto'].includes(ac) && type === 'market' && ['buy', 'sell'].includes(side);
    if (!dollarsOk && unit === 'notional') unit = 'qty';
    if (el.unit) el.unit.hidden = !dollarsOk;
    const unitName = ac === 'option' ? 'Contracts' : ac === 'crypto' ? 'Quantity' : 'Shares';
    $$('[data-value]', el.unit || form).forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.value === unit));
      if (b.dataset.value === 'qty') b.textContent = unitName;
    });
    setText(el.qtyLabel, unit === 'notional' ? 'Amount (USD)' : unitName);
    const lim = type === 'limit' || type === 'stop_limit';
    const stp = type === 'stop' || type === 'stop_limit';
    const trl = type === 'trailing_stop';
    const f1 = field('limit_price'), f2 = field('stop_price'), f3 = field('trail'), fx = field('extended');
    if (f1) f1.hidden = !lim;
    if (f2) f2.hidden = !stp;
    if (f3) f3.hidden = !trl;
    // Time in force: crypto is 24/7 (no Day); stock/option market orders are day orders.
    for (const opt of [...el.tif.options]) {
      opt.hidden = (ac === 'crypto' && opt.value === 'day') || (ac !== 'crypto' && type === 'market' && opt.value === 'gtc');
      opt.disabled = opt.hidden;
    }
    if (el.tif.selectedOptions[0]?.disabled) el.tif.value = ac === 'crypto' ? 'gtc' : 'day';
    if (fx) fx.hidden = !(['stock', 'etf'].includes(ac) && type === 'limit');
    if (fx?.hidden) el.ext.checked = false;
    setText(el.estLabel, side.startsWith('sell') ? 'Est. proceeds' : 'Est. cost');
    const held = ctx.positionQty(inst.symbol);
    setText(el.qtyHelp, held ? `You ${held > 0 ? 'own' : 'are short'} ${fmtQty(Math.abs(held))}` : (ac === 'option' ? '1 contract = 100 shares' : ''));
    if (el.locate) {
      el.locate.hidden = side !== 'sell_short';
      if (side === 'sell_short') loadLocate();
    }
  }

  async function loadLocate() {
    if (!inst || !el.locate) return;
    const sym = inst.symbol;
    try {
      const loc = locates[sym] || (locates[sym] = await api(`/api/trading/locate/${encodeURIComponent(sym)}`));
      if (inst?.symbol !== sym) return;
      el.locate.className = `th-locate tag tag--plain ${loc.shortable ? (loc.easy_to_borrow ? 'tag--gain' : 'tag--pending') : 'tag--loss'}`;
      // Borrow data is simulated (no live locate feed): say so, and do not present share counts as real.
      el.locate.textContent = !loc.shortable ? (loc.reason || 'Not available to short')
        : loc.easy_to_borrow ? 'Easy to borrow (simulated) · no borrow fee'
          : `Hard to borrow (simulated) · ${loc.borrow_rate_apr}% APR estimate`;
      if (loc.ssr) el.locate.textContent += ' · Short-sale restriction in effect';
    } catch { el.locate.hidden = true; }
  }

  function clearErrors() {
    for (const id of ['t-qty-err', 't-limit-err', 't-stop-err', 't-trail-err']) {
      const e = document.getElementById(id);
      if (e) { e.hidden = true; e.textContent = ''; }
    }
    [el.qty, el.limit, el.stop, el.trail].forEach((i) => i?.removeAttribute('aria-invalid'));
    if (el.error) { el.error.hidden = true; el.error.textContent = ''; }
  }

  /** @param {string} message @param {string} [code] */
  function showError(message, code) {
    const f = ERROR_FIELD[code || ''];
    const input = f === 'qty' ? el.qty : f === 'limit' ? (field('limit_price')?.hidden ? el.stop : el.limit) : f === 'stop' ? el.stop : null;
    const box = input ? document.getElementById(`${input.id}-err`) : null;
    if (input && box && !input.closest('[hidden]')) {
      input.setAttribute('aria-invalid', 'true');
      box.textContent = message; box.hidden = false;
    } else if (el.error) {
      el.error.textContent = message; el.error.hidden = false;
    }
  }

  /** Move focus to the visible error (field input or the form-level message). */
  function focusError() {
    const bad = /** @type {HTMLElement|null} */ (form.querySelector('[aria-invalid="true"]'));
    if (bad) { bad.focus(); return; }
    if (el.error && !el.error.hidden) { el.error.tabIndex = -1; el.error.focus(); }
  }

  function body() {
    if (!inst) return null;
    const amount = el.qty.value.replace(/[$,\s]/g, '');
    if (!amount || !(Number(amount) > 0)) return null;
    const type = el.type.value;
    /** @type {Record<string, any>} */
    const b = { client_order_id: clientId, symbol: inst.symbol, asset_class: inst.asset_class, side, type, tif: el.tif.value,
      extended_hours: el.ext.checked };
    b[unit] = amount;
    if (type === 'limit' || type === 'stop_limit') b.limit_price = el.limit.value.replace(/[$,\s]/g, '') || undefined;
    if (type === 'stop' || type === 'stop_limit') b.stop_price = el.stop.value.replace(/[$,\s]/g, '') || undefined;
    if (type === 'trailing_stop') b.trail_percent = el.trail.value.replace(/[%\s]/g, '') || undefined;
    return b;
  }

  function renderEstimate(p) {
    const set = (/** @type {string} */ k, /** @type {string} */ v) => setText($(`[data-est="${k}"]`, form), v);
    if (!p) { ['price', 'total', 'fees', 'bp'].forEach((k) => set(k, '—')); }
    else {
      set('price', price(p.estimated_price));
      set('total', usdFmt(p.estimated_total));
      set('fees', usdFmt(p.estimated_fees));
      set('bp', `${usdFmt(p.buying_power)} → ${usdFmt(p.buying_power_after)}`);
    }
    set('owned', inst ? fmtQty(ctx.positionQty(inst.symbol)) : '—');
  }

  const refreshPreview = debounce(async () => {
    const seq = ++previewSeq;        // any newer cycle (or a submit) invalidates this one
    clearErrors();
    const b = body();
    lastPreview = null;
    if (!b) { renderEstimate(null); return; }
    if ((b.type === 'limit' || b.type === 'stop_limit') && !b.limit_price) { renderEstimate(null); return; }
    if ((b.type === 'stop' || b.type === 'stop_limit') && !b.stop_price) { renderEstimate(null); return; }
    if (b.type === 'trailing_stop' && !b.trail_percent) { renderEstimate(null); return; }
    try {
      const p = await api('/api/trading/orders/preview', { method: 'POST', body: JSON.stringify(b) });
      if (seq !== previewSeq) return;
      lastPreview = p;
      renderEstimate(p);
    } catch (err) {
      if (seq !== previewSeq) return;
      renderEstimate(null);
      showError(/** @type {any} */ (err).message, /** @type {any} */ (err).code);
    }
  }, 350);

  /* ---------- events ---------- */
  el.actions?.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-side]'));
    if (!btn) return;
    side = btn.dataset.side || 'buy';
    newDraft(); renderActions(); syncFields(); refreshPreview();
  });
  el.actions?.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const btns = $$('[data-side]', el.actions || form);
    const i = btns.findIndex((b) => b.dataset.side === side);
    const next = btns[(i + step + btns.length) % btns.length];
    if (!next) return;
    side = next.dataset.side || side;
    newDraft(); renderActions(); syncFields(); refreshPreview();
    /** @type {HTMLElement|null} */ ($(`[data-side="${side}"]`, el.actions || form))?.focus();
  });
  el.unit?.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-value]'));
    if (!btn) return;
    unit = btn.dataset.value || 'qty';
    newDraft(); syncFields(); refreshPreview();
  });
  form.addEventListener('input', () => { newDraft(); refreshPreview(); });
  form.addEventListener('change', () => { newDraft(); syncFields(); refreshPreview(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    ++previewSeq;                    // cancel any in-flight or pending live estimate
    clearErrors();
    const b = body();
    if (!b) { showError('Enter a quantity.', 'invalid_qty'); el.qty.focus(); return; }
    el.review.disabled = true;
    try {
      const p = await api('/api/trading/orders/preview', { method: 'POST', body: JSON.stringify(b) });
      lastPreview = p;
      renderEstimate(p);
      openReview(b, p);
    } catch (err) {
      showError(/** @type {any} */ (err).message, /** @type {any} */ (err).code);
      focusError();
    } finally {
      el.review.disabled = false;
    }
  });

  /** @param {any} b @param {any} p */
  function openReview(b, p) {
    const what = inst?.asset_class === 'option' ? occName(p.symbol) : p.symbol;
    const amount = b.notional ? `${usdFmt(b.notional)} of` : `${fmtQty(b.qty)}${inst?.asset_class === 'option' ? ' contracts' : ''}`;
    const priceTxt = b.type === 'limit' ? ` at $${b.limit_price} limit` : b.type === 'stop' ? ` with a $${b.stop_price} stop`
      : b.type === 'stop_limit' ? ` stop $${b.stop_price} / limit $${b.limit_price}` : b.type === 'trailing_stop' ? ` trailing ${b.trail_percent}%` : ' at market';
    setText($('[data-review-summary]', dialog), `${SIDE_LABEL[b.side]} ${amount} ${what}${priceTxt}`);
    const facts = [
      ['Order type', `${TYPE_LABEL[b.type]} · ${b.tif.toUpperCase()}${b.extended_hours ? ' · Extended hours' : ''}`],
      ['Est. price', price(p.estimated_price)],
      [b.side.startsWith('sell') ? 'Est. proceeds' : 'Est. cost', usdFmt(p.estimated_total)],
      ['Est. fees', usdFmt(p.estimated_fees)],
      ['Cash or buying power held', usdFmt(p.cash_reserved)],
      ['Buying power after', usdFmt(p.buying_power_after)],
      ['Position after', fmtQty(p.position_after)],
      ['Quote', `Bid ${price(p.quote?.bid)} · Ask ${price(p.quote?.ask)}${p.quote?.spread_model === 'synthetic' ? ' (estimated)' : ''}`],
    ];
    $('[data-review-facts]', dialog)?.replaceChildren(...facts.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', { class: 'mono' }, v))));
    $('[data-review-warnings]', dialog)?.replaceChildren(...(p.warnings || []).map((/** @type {string} */ w) => h('li', null, w)));
    placeBtn.disabled = !p.can_place;
    placeBtn.textContent = p.market_open ? 'Place order' : 'Place order (queued)';
    dialog.showModal();
    placeBtn.onclick = () => place(b);
  }

  /** @param {any} b */
  async function place(b) {
    placeBtn.disabled = true;
    placeBtn.setAttribute('aria-busy', 'true');
    try {
      const order = await api('/api/trading/orders', { method: 'POST', body: JSON.stringify(b) });
      dialog.close();
      const verb = order.status === 'filled' ? `Filled at $${price(order.avg_fill_price)}` : order.status === 'canceled' ? 'Canceled (not marketable)' : 'Order placed';
      toast(`${SIDE_LABEL[order.side]} ${order.qty ? fmtQty(order.qty) : usdFmt(order.notional)} ${order.asset_class === 'option' ? occName(order.symbol) : order.symbol}: ${verb}`);
      el.qty.value = '';
      newDraft();
      renderEstimate(null);
      ctx.onPlaced(order);
    } catch (err) {
      dialog.close();
      showError(/** @type {any} */ (err).message, /** @type {any} */ (err).code);
      focusError();
      // keep the same client_order_id: if the order did reach the server, a retry returns it
    } finally {
      placeBtn.disabled = false;
      placeBtn.removeAttribute('aria-busy');
    }
  }

  /* ---------- public API ---------- */
  return {
    /** @param {Instrument} i */
    setInstrument(i) {
      const changed = inst?.symbol !== i.symbol;
      inst = i;
      setText(el.title, i.asset_class === 'option' ? occName(i.symbol) : i.symbol);
      if (changed) { el.qty.value = ''; el.limit.value = ''; el.stop.value = ''; el.trail.value = ''; lastPreview = null; newDraft(); }
      renderActions(); syncFields(); renderEstimate(null); clearErrors();
    },
    /** Re-render actions after positions/account change. */
    refresh() { renderActions(); syncFields(); },
    /** Pre-fill from the options chain or a position row. @param {{side?: string, type?: string, limit?: number|string, qty?: string|number}} o */
    prefill(o) {
      if (o.side && !sidesFor().includes(o.side)) {
        // never silently flip the action (e.g. a Sell at the bid into a Buy)
        renderActions(); syncFields(); clearErrors();
        const why = o.side === 'sell_to_open' ? 'Selling options to open needs options approval level 1 or higher (Settings > Trading account).'
          : o.side.startsWith('sell') ? 'You have no position to sell.' : 'This action is not available for your account.';
        showError(`${SIDE_LABEL[o.side] || o.side}: ${why}`);
        return;
      }
      if (o.side) side = o.side;
      if (o.type) el.type.value = o.type;
      if (o.limit !== undefined) el.limit.value = String(o.limit);
      if (o.qty !== undefined) { unit = 'qty'; el.qty.value = String(o.qty); }
      newDraft(); renderActions(); syncFields(); refreshPreview();
      form.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      el.qty.focus();
    },
    /** @param {'buy'|'sell'} kind */
    focusAction(kind) {
      const sides = sidesFor();
      const pick = kind === 'buy' ? sides.find((s) => s.startsWith('buy')) : sides.find((s) => s.startsWith('sell'));
      if (pick) { side = pick; renderActions(); syncFields(); }
      el.qty.focus();
    },
  };
}
