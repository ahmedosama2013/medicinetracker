/* DOM helpers plus the three overlay primitives: dialog, sheet, toast.
 *
 * No template strings with interpolated data anywhere in the app: everything
 * user-entered goes in through textContent, so a medicine called
 * "<img onerror=...>" is just a medicine with a silly name.
 */

import { S } from './strings.js';

/**
 * el('button.big', { onclick }, 'Label')
 * el('div', [child, child])
 */
export function el(spec, props, children) {
  const [tag, ...classes] = String(spec).split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');

  if (Array.isArray(props) || typeof props === 'string' || props instanceof Node) {
    children = props;
    props = null;
  }

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = node.className ? `${node.className} ${value}` : value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;          // only ever called with literals
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2), value);
      } else if (key in node && key !== 'list' && key !== 'type' && key !== 'form') {
        node[key] = value;
      } else {
        node.setAttribute(key, value === true ? '' : value);
      }
    }
  }

  append(node, children);
  return node;
}

export function append(node, children) {
  if (children === null || children === undefined || children === false) return node;
  if (Array.isArray(children)) {
    for (const child of children) append(node, child);
    return node;
  }
  node.appendChild(children instanceof Node ? children : document.createTextNode(String(children)));
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export const icon = name => el('span.icon', { 'aria-hidden': 'true', dataset: { icon: name } });

/**
 * Light, dark, or whatever the phone says.
 *
 * css/app.css defines the dark tokens twice: once behind the OS media query,
 * once behind [data-theme="dark"]. This is the only thing that writes that
 * attribute. Removing it entirely rather than setting "system" matters --
 * the media-query block is guarded on :not([data-theme="light"]), so an empty
 * attribute would still be honoured but a stray value would not.
 */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

/**
 * Shown while a screen waits on the network.
 *
 * Supporter screens go through code-gated RPCs and, for photos, an edge
 * function that can cold-start -- so "tapped a row, nothing happened yet" is a
 * real second or more. Without this the app looked frozen and people tapped
 * again. `aria-busy` and the live region matter as much as the spinner: a
 * screen reader gets silence otherwise.
 */
export function loadingState(message = S.loading) {
  return el('div.loading', { role: 'status', 'aria-busy': 'true' }, [
    el('span.spinner', { 'aria-hidden': 'true' }),
    el('span', { text: message }),
  ]);
}

// ---- pill identity --------------------------------------------------------

/* A medicine has exactly one visual identity -- its photo -- and it appears at
 * every size, on every screen, in both roles. See css/app.css section 6.
 *
 * Only two glyphs exist so far: a pill and a droplet. The droplet earns its
 * place because liquids and drops are the things that must NOT go in a weekly
 * organiser, so the distinction is load-bearing later. Per-form glyphs for
 * capsule, inhaler and injection are a later refinement, not a fake one now. */
const FORM_ICON = {
  liquid: 'drop',
  drops: 'drop',
};

/** Stable 0-5 tone for a medicine, so its fallback tile looks the same
 * everywhere. Not an attempt to guess the pill's real colour -- it cannot be
 * known from a name, and anywhere the real colour would matter the UI counts
 * instead. This is only a distinguishable, consistent marker. */
export function tileTone(id) {
  const text = String(id || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash % 6;
}

/**
 * pillTile({ id, url, form, alt, state, community, archived, size })
 *   state     null | 'taken' | 'skipped'
 *   community the photo came from the shared DRAP set, not this household
 *   size      null (44px) | 'sm' (34px) | 'lg' (56px)
 */
export function pillTile({
  id, url, form, alt = '', state = null,
  community = false, archived = false, size = null,
} = {}) {
  const classes = ['ptile'];
  if (size === 'sm') classes.push('ptile-sm');
  if (size === 'lg') classes.push('ptile-lg');
  if (archived) classes.push('ptile-archived');
  else if (!url) classes.push('ptile-empty');

  const node = el(`span.${classes.join('.')}`, {
    // A photo brings its own colour; only the fallback needs a tone.
    dataset: url || archived ? null : { tone: String(tileTone(id)) },
  }, url
    ? el('img', { src: url, alt })
    : icon(archived ? 'box' : FORM_ICON[form] || 'pill'));

  const kind = state === 'taken' || state === 'skipped'
    ? state
    : (community ? 'community' : null);

  if (kind) {
    node.appendChild(el('span.ptile-badge', {
      'aria-hidden': 'true', dataset: { kind },
    }, icon(kind === 'taken' ? 'check' : kind === 'skipped' ? 'minus' : 'people')));
  }

  return node;
}

// ---- overlays -------------------------------------------------------------

const overlayHost = () => document.getElementById('overlay');

let openCount = 0;

/* Everything that can hold focus inside a panel, in document order. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), '
  + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function mountOverlay(panel, { onDismiss, dismissible = true, className = '' } = {}) {
  const host = overlayHost();
  const returnFocusTo = document.activeElement;
  const layer = el(`div.overlay-layer${className ? `.${className}` : ''}`);
  const backdrop = el('div.overlay-backdrop');
  layer.appendChild(backdrop);
  layer.appendChild(panel);
  host.appendChild(layer);
  host.hidden = false;
  openCount += 1;
  document.body.classList.add('overlay-open');

  const close = () => {
    if (!layer.isConnected) return;
    layer.remove();
    openCount = Math.max(0, openCount - 1);
    if (!openCount) {
      host.hidden = true;
      document.body.classList.remove('overlay-open');
    }
    document.removeEventListener('keydown', onKey);

    /* Back where they came from. Without this, closing a sheet dropped focus
     * to the top of the document and a keyboard user had to tab all the way
     * back to the row they were on. The node may be gone -- redrawSlot
     * replaces the slot that opened it -- hence the check. */
    if (returnFocusTo?.isConnected) returnFocusTo.focus?.();
  };

  const dismiss = () => { close(); onDismiss?.(); };

  function onKey(event) {
    /* Only the topmost overlay answers. Every layer adds its own keydown
     * listener to `document`, so without this one Escape dismisses the whole
     * stack at once -- closing a medicine sheet would also close the calendar
     * day sheet underneath it and drop the person back to the month grid. */
    if (host.lastElementChild !== layer) return;

    /* Keep Tab inside the panel. aria-modal tells a screen reader the rest of
     * the page is inert; it does nothing about the tab order, so focus walked
     * straight out into the screen behind -- which for a keyboard or switch
     * user is the difference between a modal and a decoration. */
    if (event.key === 'Tab') {
      const items = [...panel.querySelectorAll(FOCUSABLE)];
      if (!items.length) {
        event.preventDefault();
        panel.focus?.();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const inside = panel.contains(document.activeElement);
      if (event.shiftKey && (!inside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
      return;
    }

    if (event.key !== 'Escape' || !dismissible) return;
    event.preventDefault();
    dismiss();
  }

  if (dismissible) backdrop.addEventListener('click', dismiss);
  document.addEventListener('keydown', onKey);

  // Focus the first control so keyboard and screen-reader users land inside.
  requestAnimationFrame(() => {
    const target = panel.querySelector('[autofocus], button, input, select, textarea, [tabindex]');
    (target || panel).focus?.();
  });

  return close;
}

/**
 * A modal question. Resolves true for the confirm action, false otherwise.
 * `body` may be a string or an array of nodes.
 */
export function confirmDialog({ title, body, confirmLabel = S.confirm, cancelLabel = S.cancel, danger = false }) {
  return new Promise(resolve => {
    let close;
    const finish = value => { close?.(); resolve(value); };

    const panel = el('div.dialog', { role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, [
      title ? el('h2.dialog-title', { text: title }) : null,
      el('div.dialog-body', typeof body === 'string' ? el('p', { text: body }) : body),
      el('div.dialog-actions', [
        el('button.btn.btn-quiet', { type: 'button', text: cancelLabel, onclick: () => finish(false) }),
        el(`button.btn.btn-primary${danger ? '.btn-danger' : ''}`, {
          type: 'button', text: confirmLabel, autofocus: true, onclick: () => finish(true),
        }),
      ]),
    ]);

    close = mountOverlay(panel, { onDismiss: () => resolve(false) });
  });
}

/** A message with a single acknowledge button. */
export function alertDialog({ title, body, closeLabel = S.close }) {
  return new Promise(resolve => {
    let close;
    const panel = el('div.dialog', { role: 'alertdialog', 'aria-modal': 'true', tabindex: '-1' }, [
      title ? el('h2.dialog-title', { text: title }) : null,
      el('div.dialog-body', typeof body === 'string' ? el('p', { text: body }) : body),
      el('div.dialog-actions', [
        el('button.btn.btn-primary', {
          type: 'button', text: closeLabel, autofocus: true,
          onclick: () => { close(); resolve(); },
        }),
      ]),
    ]);
    close = mountOverlay(panel, { onDismiss: resolve });
  });
}

/** A panel sliding up from the bottom. Returns { close, setContent }. */
export function openSheet({ title, content, onClose }) {
  const body = el('div.sheet-body');
  append(body, content);

  const panel = el('div.sheet', { role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, [
    el('div.sheet-head', [
      el('h2.sheet-title', { text: title || '' }),
      el('button.sheet-close', {
        type: 'button', 'aria-label': S.close,
        onclick: () => api.close(),
      }, '×'),
    ]),
    body,
  ]);

  const close = mountOverlay(panel, { onDismiss: onClose, className: 'sheet-layer' });
  const api = {
    close: () => { close(); onClose?.(); },
    setContent: next => { clear(body); append(body, next); },
    body,
  };
  return api;
}

/** Full-screen photo viewer. The reason the app exists, so it gets everything. */
export function openPhotoViewer({ url, name, strength, altText }) {
  const panel = el('div.photoview', { role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, [
    url
      ? el('img.photoview-img', { src: url, alt: altText || name })
      : el('div.photoview-empty', [icon('pill'), el('p', { text: S.noPhoto })]),
    el('div.photoview-caption', [
      el('strong.photoview-name', { text: name }),
      strength ? el('span.photoview-strength', { text: strength }) : null,
    ]),
    el('button.photoview-close', { type: 'button', 'aria-label': S.closePhoto }, '×'),
  ]);

  const close = mountOverlay(panel, { className: 'photoview-layer' });
  panel.addEventListener('click', () => close());
  return close;
}

let toastTimer = null;
let toastHideTimer = null;

/**
 * toast('Saved')
 * toast('Ibuprofen skipped', { actionLabel: 'Undo', onAction })
 *
 * The action exists for the cycling dose target: tapping twice lands on
 * "skipped", which a person can reach without meaning to, so that state has
 * to announce itself and offer the way back. Never used for errors that need
 * a decision -- those are a dialog.
 */
export function toast(message, { actionLabel = null, onAction = null } = {}) {
  const node = document.getElementById('toast');
  clearTimeout(toastTimer);
  clearTimeout(toastHideTimer);
  clear(node);
  node.appendChild(el('span', { text: message }));

  /* The pending hide is tracked, not fired and forgotten. A toast raised
   * inside the 250ms fade-out of the previous one was made visible and then
   * hidden again by that one's timer -- reachable by cycling two doses
   * quickly, which is exactly when a toast matters. */
  const hide = () => {
    node.classList.remove('toast-on');
    clearTimeout(toastHideTimer);
    toastHideTimer = setTimeout(() => { node.hidden = true; }, 250);
  };

  if (actionLabel && onAction) {
    node.appendChild(el('button.toast-action', {
      type: 'button',
      text: actionLabel,
      onclick: () => { clearTimeout(toastTimer); hide(); onAction(); },
    }));
  }

  node.hidden = false;
  node.classList.add('toast-on');
  clearTimeout(toastTimer);
  // Longer with an action: three seconds is not enough to notice an
  // unintended change, read it, and reach the button.
  toastTimer = setTimeout(hide, actionLabel ? 6000 : 2600);
}

// ---- small building blocks ------------------------------------------------

export function field({ label, control, hint, error, id }) {
  return el('div.field', [
    el('label.field-label', { for: id, text: label }),
    control,
    hint ? el('p.field-hint', { text: hint }) : null,
    error ? el('p.field-error', { text: error }) : null,
  ]);
}

export function section(title, children, className = '') {
  return el(`section.card${className ? `.${className}` : ''}`, [
    title ? el('h2.card-title', { text: title }) : null,
    ...(Array.isArray(children) ? children : [children]),
  ]);
}

export function emptyState(title, body) {
  return el('div.empty', [
    el('p.empty-title', { text: title }),
    body ? el('p.empty-body', { text: body }) : null,
  ]);
}

/** A hidden file input, clicked programmatically. Resolves with a File or null. */
export function pickFile(accept) {
  return new Promise(resolve => {
    const input = el('input', { type: 'file', accept, hidden: true });
    document.body.appendChild(input);
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener('change', () => finish(input.files?.[0] || null));
    // Cancelling a file dialog fires nothing reliable on iOS, so a focus
    // return with no file is treated as a cancel.
    window.addEventListener('focus', () => {
      setTimeout(() => { if (!input.files?.length) finish(null); }, 600);
    }, { once: true });
    input.click();
  });
}
