// @ts-check
/**
 * Cloudflare Turnstile for public auth forms.
 *
 * mountCaptcha(container) renders the widget into `container` and resolves to a handle:
 *   handle.header()  -> { 'X-Captcha-Token': token } once the user has passed the check, else {}
 *   handle.ready()   -> true when a token is available for the next request
 *   handle.reset()   -> clear the token and reset the widget (tokens are single use)
 *
 * When the server reports the check is disabled (development bypass), the handle is a no-op.
 * The Turnstile script is served by Cloudflare, so it is loaded from there; it cannot be vendored.
 */

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** @type {Promise<void> | null} */
let scriptPromise = null;
/** @type {Promise<{enabled: boolean, site_key: string}> | null} */
let configPromise = null;

/** @returns {Promise<void>} */
function loadScript() {
  // @ts-ignore: turnstile is defined by the Cloudflare script
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error('captcha-script'));
      };
      document.head.append(script);
    });
  }
  return scriptPromise;
}

/** @returns {Promise<{enabled: boolean, site_key: string}>} */
function loadConfig() {
  if (!configPromise) {
    configPromise = fetch('/api/captcha/config', { headers: { Accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('captcha-config'))))
      .catch(() => ({ enabled: true, site_key: '' }));
  }
  return configPromise;
}

/**
 * @param {HTMLElement} container
 * @param {string} message
 */
function showMessage(container, message) {
  container.textContent = message;
  container.setAttribute('role', 'status');
}

/**
 * @param {HTMLElement} container
 */
export async function mountCaptcha(container) {
  const config = await loadConfig();

  if (!config.enabled) {
    return { header: () => /** @type {Record<string,string>} */ ({}), ready: () => true, reset() {} };
  }

  /** @type {string} */
  let token = '';
  /** @type {string | null} */
  let widgetId = null;

  const handle = {
    header: () => /** @type {Record<string,string>} */ (token ? { 'X-Captcha-Token': token } : {}),
    ready: () => Boolean(token),
    reset() {
      token = '';
      // @ts-ignore
      if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
    },
  };

  if (!config.site_key) {
    showMessage(container, 'The security check is not available right now. Please try again later.');
    return handle;
  }

  try {
    await loadScript();
    // @ts-ignore
    widgetId = window.turnstile.render(container, {
      sitekey: config.site_key,
      theme: 'auto',
      callback: (/** @type {string} */ value) => { token = value; },
      'expired-callback': () => { token = ''; },
      'error-callback': () => { token = ''; },
    });
  } catch {
    showMessage(container, 'The security check could not load. Check your connection and reload the page.');
  }
  return handle;
}
