// @ts-check
/**
 * TED AI side panel: live chat with /api/chat/ai. Replies stream in as tokens.
 * Messages are rendered as text only, never as markup.
 */

const TOKEN_KEY = 'ted_access_token';
const HISTORY_LIMIT = 10;
const DEMO = new URLSearchParams(location.search).has('demo');

const panel = /** @type {HTMLDialogElement|null} */ (document.getElementById('ted-ai'));
const log = /** @type {HTMLElement|null} */ (panel?.querySelector('[data-ai-log]') || null);
const form = /** @type {HTMLFormElement|null} */ (panel?.querySelector('[data-ai-form]') || null);
const input = /** @type {HTMLInputElement|null} */ (panel?.querySelector('#ai-q') || null);
const sendBtn = /** @type {HTMLButtonElement|null} */ (form?.querySelector('[type="submit"]') || null);
const status = /** @type {HTMLElement|null} */ (panel?.querySelector('[data-ai-status]') || null);

/** @type {Array<{role: 'user'|'assistant', content: string}>} */
const history = [];
let busy = false;

/** @param {string} who @param {'user'|'bot'} kind */
function addMessage(who, kind) {
  const wrap = document.createElement('div');
  wrap.className = `ai-msg ai-msg--${kind}`;
  const label = document.createElement('span');
  label.className = 'ai-msg__who';
  label.textContent = who;
  const body = document.createElement('p');
  body.className = 'ai-msg__text';
  wrap.append(label, body);
  log?.append(wrap);
  log?.scrollTo({ top: log.scrollHeight });
  return body;
}

/** @param {string} text */
function addUser(text) {
  const body = addMessage('You', 'user');
  body.textContent = text;
}

/** @param {string} text */
function setStatus(text) {
  if (status) status.textContent = text;
}

function hideEmpty() {
  panel?.querySelector('[data-ai-empty]')?.remove();
}

/**
 * Stream one question. Parses newline-delimited JSON: {token}, {error}, {done}.
 * @param {string} question
 */
async function ask(question) {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    addMessage('TED AI', 'bot').textContent = 'Sign in to chat with TED AI.';
    return;
  }
  hideEmpty();
  addUser(question);
  const reply = addMessage('TED AI', 'bot');
  reply.setAttribute('aria-busy', 'true');
  reply.textContent = '…';

  const payload = { message: question, conversation_history: history.slice(-HISTORY_LIMIT) };
  let answer = '';
  let failed = false;
  try {
    const res = await fetch('/api/chat/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem(TOKEN_KEY);
      throw new Error('Your session has expired. Sign in again to continue.');
    }
    if (!res.ok || !res.body) throw new Error(`TED AI is unavailable right now (${res.status}).`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    reply.textContent = '';
    const handle = (/** @type {string} */ line) => {
      if (!line.trim()) return;
      const msg = JSON.parse(line);
      if (msg.token) {
        answer += msg.token;
        reply.textContent = answer;
        log?.scrollTo({ top: log.scrollHeight });
      } else if (msg.error) {
        failed = true;
        reply.textContent = msg.error;
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        handle(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
      if (done) {
        handle(buffer);
        break;
      }
    }
  } catch (err) {
    failed = true;
    reply.textContent = err instanceof Error ? err.message : 'TED AI could not reply.';
  } finally {
    reply.removeAttribute('aria-busy');
  }

  if (!failed && answer) {
    history.push({ role: 'user', content: question }, { role: 'assistant', content: answer });
    while (history.length > HISTORY_LIMIT) history.shift();
  }
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!input || busy) return;
  const question = input.value.trim();
  if (!question) return;
  busy = true;
  if (sendBtn) sendBtn.disabled = true;
  setStatus('');
  input.value = '';
  try {
    await ask(question);
  } finally {
    busy = false;
    if (sendBtn) sendBtn.disabled = false;
    input?.focus();
  }
});

panel?.querySelectorAll('[data-ai-suggest]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!input) return;
    input.value = btn.getAttribute('data-ai-suggest') || '';
    form?.requestSubmit();
  });
});

panel?.addEventListener('close', () => { setStatus(''); });
document.querySelectorAll('[data-dialog-open="ted-ai"]').forEach((btn) => {
  btn.addEventListener('click', () => setTimeout(() => input?.focus(), 250));
});

if (DEMO && !localStorage.getItem(TOKEN_KEY)) {
  setStatus('Sign in to chat with TED AI.');
  if (input) input.disabled = true;
  if (sendBtn) sendBtn.disabled = true;
}
