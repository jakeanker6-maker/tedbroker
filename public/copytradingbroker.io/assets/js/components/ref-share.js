// @ts-check
/**
 * Native Web Share button. Stays hidden unless navigator.share is available.
 * <button type="button" hidden data-component="ref-share"
 *         data-share-title="…" data-share-text="…" data-share-url="https://…">Share</button>
 */
import { toast } from '../lib/util.js';

export function init(btn) {
  if (!(btn instanceof HTMLButtonElement) || typeof navigator.share !== 'function') return;
  const data = {
    title: btn.dataset.shareTitle || document.title,
    text: btn.dataset.shareText || '',
    url: btn.dataset.shareUrl || location.href,
  };
  if (typeof navigator.canShare === 'function' && !navigator.canShare(data)) return;
  btn.hidden = false;
  let busy = false;
  btn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    try {
      await navigator.share(data);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) toast('Sharing didn’t work. Copy the link instead.');
    } finally {
      busy = false;
    }
  });
}
