/*
 * Admin: "Trading Hub" tab in the user details modal.
 * Shows the user's trading account (balances, integrity check, positions, orders, copies,
 * ledger) from GET /api/admin/trading/users/{id} and offers "Reset account"
 * (POST /api/admin/trading/users/{id}/reset, confirmed by typing the user's email).
 * Server data is only ever set as text.
 */
(function () {
  'use strict';
  let currentUserId = null;
  let loadSeq = 0;

  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'style') n.style.cssText = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of children) if (c != null && c !== false) n.append(c instanceof Node ? c : String(c));
    return n;
  }
  const usd = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
  const bucketLabel = (b) => (b === 'self' ? 'Self-directed' : String(b || '').startsWith('copy:') ? 'Copy trading'
    : String(b || '').startsWith('basket:') ? 'ETF basket' : (b || '—'));
  const when = (v) => (v ? new Date(v).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

  function table(caption, heads, rows, empty) {
    const t = el('table', { style: 'margin-bottom: 8px; font-size: 13px;' },
      el('caption', { style: 'text-align:left; font-weight:600; color:#2D3748; padding:8px 0;' }, caption),
      el('thead', null, el('tr', null, ...heads.map((x) => el('th', { scope: 'col' }, x)))));
    const body = el('tbody');
    if (!rows.length) body.append(el('tr', null, el('td', { colspan: heads.length, style: 'color:#8b93a7;' }, empty)));
    rows.forEach((r) => body.append(el('tr', null, ...r.map((c) => el('td', null, c)))));
    t.append(body);
    return el('div', { style: 'max-height: 320px; overflow: auto; margin-bottom: 20px;' }, t);
  }

  function stat(label, value, color) {
    return el('div', null,
      el('label', { style: 'display:block; color:#8b93a7; font-size:13px;' }, label),
      el('p', { style: `font-size:20px; font-weight:700; margin:4px 0; color:${color || '#2D3748'};` }, value));
  }

  function render(root, d) {
    const integ = d.integrity;
    const badge = el('span', { class: `badge ${integ.ok ? 'badge-active' : 'badge-rejected'}` },
      integ.ok ? 'Ledger and holds reconcile' : `Integrity problem (difference ${usd(integ.difference)})`);
    const resetBtn = el('button', { class: 'btn btn-secondary', type: 'button', style: 'background:#D32F2F; color:#fff;',
      onclick: () => doReset(d.user) }, 'Reset account');
    if (d.user.is_system) resetBtn.disabled = true;
    root.replaceChildren(
      el('div', { style: 'background:#f7fafc; padding:16px; border-radius:8px; margin-bottom:20px;' },
        el('div', { style: 'display:grid; grid-template-columns:repeat(4,1fr); gap:16px;' },
          stat('Cash', usd(d.balances.cash), '#D32F2F'), stat('Held (reserved)', usd(d.balances.reserved)),
          stat('Available', usd(d.balances.available)), stat('Net funding', usd(d.net_funding))),
        el('p', { style: 'margin:12px 0 0; display:flex; gap:12px; align-items:center; flex-wrap:wrap;' }, badge,
          el('span', { style: 'color:#8b93a7; font-size:13px;' },
            `Holds: orders ${usd(integ.parts.open_orders)} · copies ${usd(integ.parts.copy_allocations)} · withdrawals ${usd(integ.parts.withdrawals)}`),
          d.user.is_system ? el('span', { class: 'badge badge-pending' }, 'Trader bot account') : null)),
      el('div', { style: 'display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:16px; flex-wrap:wrap;' },
        el('p', { style: 'color:#8b93a7; font-size:13px; margin:0; max-width:60ch;' },
          'Reset cancels open orders, stops copies, closes positions and baskets without trading, and sets cash back to net funding '
          + '(deposits, withdrawals, bonuses and plans). Pending withdrawals stay on hold.'),
        resetBtn),
      table('Open positions', ['Symbol', 'Source', 'Qty', 'Avg cost', 'Value'],
        d.positions.map((p) => [p.symbol, p.bucket_label || bucketLabel(p.bucket), p.qty, usd(p.avg_cost), usd(p.market_value)]), 'No open positions.'),
      table('Copy links', ['Trader', 'Status', 'Put in', 'Value', 'Uninvested'],
        d.copy_links.map((l) => [l.trader_name || '—', l.status, usd(l.allocated), usd(l.equity), usd(l.cash)]), 'No copy links.'),
      table(`Orders (latest ${d.orders.length})`, ['Created', 'Symbol', 'Side', 'Type', 'Qty', 'Status', 'Avg fill'],
        d.orders.map((o) => [when(o.created_at), o.symbol, o.side, o.type, o.qty || (o.notional ? usd(o.notional) : '—'), o.status, o.avg_fill_price ? usd(o.avg_fill_price) : '—']),
        'No orders.'),
      table(`Ledger (latest ${d.ledger.length})`, ['Posted', 'Type', 'Description', 'Cash', 'Held', 'Cash after'],
        d.ledger.map((e) => [when(e.created_at), e.type, e.description || '', usd(e.amount), usd(e.reserved_change), usd(e.cash_after)]),
        'No ledger entries.'),
    );
  }

  async function load() {
    const root = document.getElementById('admin-trading-root');
    if (!root || !currentUserId) return;
    const seq = ++loadSeq;
    root.replaceChildren(el('p', { style: 'color:#8b93a7;', role: 'status' }, 'Loading trading account…'));
    try {
      const res = await adminFetch(`/api/admin/trading/users/${encodeURIComponent(currentUserId)}`);
      const data = await res.json();
      if (seq !== loadSeq) return;
      if (!res.ok) throw new Error((data.detail && data.detail.message) || data.detail || 'Could not load the trading account.');
      render(root, data);
    } catch (err) {
      if (seq !== loadSeq) return;
      root.replaceChildren(el('p', { style: 'color:#f44336;', role: 'alert' }, String(err.message || err)));
    }
  }

  async function ask(user) {
    const text = `Reset the trading account of ${user.email}? This cannot be undone. Type the user's email to confirm.`;
    if (window.Swal) {
      const r = await window.Swal.fire({ title: 'Reset account', text, input: 'text', inputPlaceholder: user.email,
        showCancelButton: true, confirmButtonText: 'Reset', confirmButtonColor: '#D32F2F' });
      return r.isConfirmed ? r.value : null;
    }
    return window.prompt(text);
  }

  async function doReset(user) {
    const confirm = await ask(user);
    if (!confirm) return;
    try {
      const res = await adminFetch(`/api/admin/trading/users/${encodeURIComponent(user.id)}/reset`, {
        method: 'POST', body: JSON.stringify({ confirm }) });
      const data = await res.json();
      if (!res.ok) throw new Error((data.detail && data.detail.message) || data.detail || 'Reset failed.');
      const msg = `Canceled ${data.orders_canceled} orders, stopped ${data.copies_stopped} copies, closed ${data.positions_closed} positions. `
        + `Cash is now ${usd(data.balances.cash)} (adjustment ${usd(data.cash_adjustment)}).`;
      if (window.Swal) window.Swal.fire({ icon: data.integrity_ok ? 'success' : 'warning', title: 'Account reset', text: msg });
      else window.alert(msg);
      load();
    } catch (err) {
      if (window.Swal) window.Swal.fire({ icon: 'error', title: 'Reset failed', text: String(err.message || err) });
      else window.alert(String(err.message || err));
    }
  }

  // Hook into the existing modal without changing its code.
  const origView = window.viewUser;
  if (typeof origView === 'function') {
    window.viewUser = function (userId, ...rest) {
      currentUserId = userId;
      loadSeq++;
      const root = document.getElementById('admin-trading-root');
      if (root) root.replaceChildren(el('p', { style: 'color:#8b93a7;' }, 'Open this tab to load the user\u2019s trading account.'));
      return origView.call(this, userId, ...rest);
    };
  }
  const origSwitch = window.switchUserTab;
  if (typeof origSwitch === 'function') {
    window.switchUserTab = function (tab, ...rest) {
      const out = origSwitch.call(this, tab, ...rest);
      if (tab === 'trading') load();
      return out;
    };
  }
}());
