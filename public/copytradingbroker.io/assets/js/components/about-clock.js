// @ts-check
/**
 * Live local-time readout for an office.
 *
 * <span class="about-clock" data-component="about-clock" data-tz="America/New_York">
 *   <span class="live-dot" aria-hidden="true"></span>
 *   <span>New York</span> <time datetime="09:41" data-clock-time>09:41</time>
 * </span>
 *
 * Updates every 30 s (and when the tab becomes visible again). Not a live region on purpose:
 * announcing the time every 30 s would be noise for screen-reader users.
 */

/** @param {HTMLElement} el */
export function init(el) {
  const out = el.querySelector('[data-clock-time]');
  if (!out) return;
  const timeZone = el.dataset.tz || 'America/New_York';
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  } catch {
    return; // unknown time zone: keep the static fallback text
  }

  const render = () => {
    const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
    const hhmm = `${parts.hour}:${parts.minute}`;
    out.textContent = hhmm;
    out.setAttribute('datetime', hhmm);
  };

  const ac = new AbortController();
  render();
  let timer = setInterval(render, 30_000);
  document.addEventListener('visibilitychange', () => {
    clearInterval(timer);
    if (!document.hidden) { render(); timer = setInterval(render, 30_000); }
  }, { signal: ac.signal });

  return () => { clearInterval(timer); ac.abort(); };
}
