// @ts-check
/**
 * Accessible combobox (ARIA 1.2 list autocomplete) for a text input and a <ul>.
 * The source decides what to show; this module handles keyboard, ARIA and selection.
 * Option text is set with textContent only.
 */

let uid = 0;

/**
 * @typedef {{ label: string, data?: any }} ComboItem
 * @typedef {{
 *   input: HTMLInputElement,
 *   listbox: HTMLUListElement,
 *   source: (query: string, signal: AbortSignal) => Promise<ComboItem[]>,
 *   onSelect: (item: ComboItem) => void,
 *   minChars?: number,
 *   delay?: number,
 *   openOnFocus?: boolean,
 *   announce?: (message: string) => void,
 * }} ComboOptions
 */

/**
 * @param {ComboOptions} options
 */
export function createCombobox({ input, listbox, source, onSelect, minChars = 0, delay = 0, openOnFocus = false, announce = () => {} }) {
  const id = `cb-${++uid}`;
  if (!listbox.id) listbox.id = `${id}-list`;
  listbox.setAttribute('role', 'listbox');
  listbox.hidden = true;
  // Keep the list out of the mouse/touch focus path: clicks on the scrollbar must not blur the input
  listbox.addEventListener('mousedown', (e) => e.preventDefault());

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-haspopup', 'listbox');
  input.setAttribute('aria-controls', listbox.id);
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('autocomplete', 'off');

  /** @type {ComboItem[]} */
  let items = [];
  let active = -1;
  let timer = 0;
  /** @type {AbortController|null} */
  let controller = null;

  function isOpen() {
    return !listbox.hidden;
  }

  function close() {
    controller?.abort();
    controller = null;
    clearTimeout(timer);
    items = [];
    active = -1;
    listbox.replaceChildren();
    listbox.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  /** @param {number} index */
  function setActive(index) {
    const options = listbox.querySelectorAll('[role="option"]');
    options.forEach((el, i) => el.setAttribute('aria-selected', String(i === index)));
    active = index;
    if (index >= 0) {
      const el = options[index];
      input.setAttribute('aria-activedescendant', el.id);
      el.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  /** @param {ComboItem[]} results */
  function render(results) {
    items = results;
    listbox.replaceChildren();
    results.forEach((item, index) => {
      const li = document.createElement('li');
      li.id = `${listbox.id}-opt-${index}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.className = 'onb-option';
      li.textContent = item.label;
      // mousedown keeps focus in the input; the click is handled here so blur does not race it
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        choose(index);
      });
      listbox.append(li);
    });
    active = -1;
    listbox.hidden = results.length === 0;
    input.setAttribute('aria-expanded', String(results.length > 0));
    input.removeAttribute('aria-activedescendant');
    announce(results.length === 0 ? 'No matches.' : `${results.length} ${results.length === 1 ? 'option' : 'options'}, use arrow keys to browse.`);
  }

  /** @param {number} index */
  function choose(index) {
    const item = items[index];
    if (!item) return;
    close();
    onSelect(item);
  }

  async function run() {
    const query = input.value;
    if (query.trim().length < minChars) {
      close();
      return;
    }
    controller?.abort();
    const current = new AbortController();
    controller = current;
    try {
      const results = await source(query, current.signal);
      if (current.signal.aborted || input.value !== query || document.activeElement !== input) return;
      render(results);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        close();
      }
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(run, delay);
  });

  input.addEventListener('focus', () => {
    if (openOnFocus) run();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !isOpen()) {
      e.preventDefault();
      run();
      return;
    }
    if (!isOpen() || items.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive(active + 1 >= items.length ? 0 : active + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive(active <= 0 ? items.length - 1 : active - 1);
        break;
      case 'Home':
        if (active >= 0) { e.preventDefault(); setActive(0); }
        break;
      case 'End':
        if (active >= 0) { e.preventDefault(); setActive(items.length - 1); }
        break;
      case 'Enter':
        if (active >= 0) {
          e.preventDefault();
          choose(active);
        } else {
          // Nothing highlighted: close the list and let Enter act on the form as usual
          close();
        }
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      default:
        break;
    }
  });

  input.addEventListener('blur', close);

  return { close, run, isOpen };
}
