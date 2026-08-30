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

// ---- overlays -------------------------------------------------------------

const overlayHost = () => document.getElementById('overlay');

let openCount = 0;

function mountOverlay(panel, { onDismiss, dismissible = true, className = '' } = {}) {
  const host = overlayHost();
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
  };

  const dismiss = () => { close(); onDismiss?.(); };

  function onKey(event) {
    if (event.key === 'Escape' && dismissible) { event.preventDefault(); dismiss(); }
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

export function toast(message) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.hidden = false;
  node.classList.add('toast-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.classList.remove('toast-on');
    setTimeout(() => { node.hidden = true; }, 250);
  }, 2600);
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
