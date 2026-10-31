// @ts-check
/**
 * Live data over Server-Sent Events.
 *   prices:  /api/stream/prices?symbols=…&st=…   events: quote, status, error
 *   account: /api/stream/account?st=…           events: balance, order, fill, position, margin_call, notice
 * EventSource cannot send headers, so a short-lived stream token is fetched first
 * (POST /api/stream/token) and the stream is reopened with a fresh token when it drops.
 */
import { api } from '../live/api.js';

/** @typedef {'connecting'|'live'|'reconnecting'|'offline'} StreamState */

async function streamToken() {
  const res = await api('/api/stream/token', { method: 'POST' });
  return res.token;
}

class Stream {
  /**
   * @param {(token: string) => string} url
   * @param {Record<string, (data: any) => void>} handlers
   * @param {(s: StreamState) => void} [onState]
   */
  constructor(url, handlers, onState) {
    this.url = url;
    this.handlers = handlers;
    this.onState = onState || (() => {});
    /** @type {EventSource|null} */ this.es = null;
    this.retry = 1000;
    this.closed = false;
    /** @type {any} */ this.timer = null;
  }

  async open() {
    this.closeSource();
    if (this.closed) return;
    this.onState(this.es ? 'reconnecting' : 'connecting');
    let token;
    try {
      token = await streamToken();
    } catch {
      return this.scheduleRetry();
    }
    if (this.closed) return;
    const es = new EventSource(this.url(token));
    this.es = es;
    es.onopen = () => { this.retry = 1000; this.onState('live'); };
    es.onerror = () => {
      // A closed stream (expired token, server restart) needs a new token; otherwise the
      // browser is already retrying by itself.
      if (es.readyState === EventSource.CLOSED) this.scheduleRetry();
      else if (es.readyState === EventSource.CONNECTING) this.onState('reconnecting');
    };
    for (const [name, fn] of Object.entries(this.handlers)) {
      es.addEventListener(name, (e) => {
        try { fn(JSON.parse(/** @type {MessageEvent} */ (e).data)); } catch (err) { console.error('[stream]', name, err); }
      });
    }
  }

  scheduleRetry() {
    this.closeSource();
    if (this.closed) return;
    this.onState(navigator.onLine === false ? 'offline' : 'reconnecting');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.open(), this.retry);
    this.retry = Math.min(this.retry * 2, 30000);
  }

  closeSource() {
    if (this.es) { this.es.close(); }
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.closeSource();
    this.es = null;
  }
}

/** Price stream whose symbol set can change; resubscribes (debounced) when it does. */
export class PriceStream {
  /** @param {(q: any) => void} onQuote @param {(s: any) => void} onStatus @param {(s: StreamState) => void} onState */
  constructor(onQuote, onStatus, onState) {
    /** @type {Set<string>} */ this.symbols = new Set();
    this.key = '';
    /** @type {Stream|null} */ this.stream = null;
    this.onQuote = onQuote; this.onStatus = onStatus; this.onState = onState;
    /** @type {any} */ this.timer = null;
  }

  /** @param {Iterable<string>} symbols */
  set(symbols) {
    this.symbols = new Set([...symbols].filter(Boolean));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.apply(), 300);
  }

  apply() {
    const key = [...this.symbols].sort().join(',');
    if (key === this.key && this.stream) return;
    this.key = key;
    this.stream?.close();
    if (!key) { this.stream = null; return; }
    this.stream = new Stream(
      (st) => `/api/stream/prices?symbols=${encodeURIComponent(key)}&st=${encodeURIComponent(st)}`,
      { quote: this.onQuote, status: this.onStatus,
        stream_error: (/** @type {any} */ d) => console.warn('[prices]', d.message, d.symbols || '') },
      this.onState,
    );
    this.stream.open();
  }
}

/** @param {Record<string, (data: any) => void>} handlers */
export function accountStream(handlers) {
  const s = new Stream((st) => `/api/stream/account?st=${encodeURIComponent(st)}`, handlers);
  s.open();
  return s;
}
