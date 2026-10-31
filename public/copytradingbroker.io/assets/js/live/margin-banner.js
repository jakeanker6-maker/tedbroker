// @ts-check
/**
 * Margin-call band on every dashboard page (the Trading Hub renders its own).
 * Shows the amount, the deadline and a link to deposit. Silent when there is no call.
 */
import { api } from './api.js';

export async function showMarginCallBand() {
  if (document.querySelector('[data-margin-call]')) return; // trade.html handles it
  const main = document.getElementById('main');
  if (!main || !localStorage.getItem('ted_access_token')) return;
  let calls = [];
  try {
    calls = (await api('/api/trading/margin-calls')).margin_calls || [];
  } catch { return; }
  if (!calls.length) return;
  const c = calls[0];
  const due = new Date(c.due_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  const amount = Number(c.amount).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const band = document.createElement('div');
  band.className = 'margin-callband';
  band.setAttribute('role', 'alert');
  const strong = document.createElement('strong');
  strong.textContent = `${c.type === 'fed' ? 'Fed (Reg T) call' : 'Margin call'}: ${amount} due ${due} ET. `;
  const link = document.createElement('a');
  link.href = 'wallet.html#deposit';
  link.textContent = 'Deposit funds';
  const trade = document.createElement('a');
  trade.href = 'trade.html';
  trade.textContent = 'Review positions';
  band.append(strong, 'Positions may be liquidated if the call is not met. ', link, ' · ', trade);
  main.prepend(band);
}
