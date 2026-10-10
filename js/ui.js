/* DOM helpers, the screen scaffold, and the four overlay primitives: sheet,
 * dialog, toast, photo viewer.
 *
 * No template strings with interpolated data anywhere in the app: everything
 * user-entered goes in through textContent, so a medicine called
 * "<img onerror=...>" is just a medicine with a silly name.
 *
 * Pattern rules from the handoff, enforced here rather than per view:
 *   - Full screens for places you live in.
 *   - Bottom sheets for things you LOOK AT (a medicine, a compartment, the
 *     shared list).
 *   - Centre dialogs ONLY for consequences, with an explicitly named action
 *     ("Remove Morning" / "Keep it") and the destructive button in red.
 *   - Every state-changing tap raises a toast; anything reversible carries
 *     Undo in the toast itself. Undo is never behind a confirm dialog.
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

/* ---- the screen scaffold -------------------------------------------------
 *
 * Every view renders exactly ONE .screen into #app. The shell is a fixed
 * viewport column -- a head that does not move, one scrolling region, an
 * optional foot, and the bottom nav below all of it -- which is what makes the
 * layout behave the same on a 320px phone and a 430px one. A taller screen
 * only gives the scroll region more room, so more slot cards fit before it
 * scrolls. That is the handoff's entire responsive rule; there is never a
 * second column. */

/**
 * screen({ head, body, scroll, foot, supporter })
 *   head       fixed, above the scroll region
 *   scroll     the one scrolling region (use for lists, Settings)
 *   body       a non-scrolling flexible region (use for centred empties)
 *   foot       fixed, below the scroll region and above the nav
 *   supporter  paint this screen in the helper's palette before a role exists
 */
export function screen({ head, body, scroll, foot, supporter = false, className = '' } = {}) {
  const node = el(`div.screen${supporter ? '.screen-sup' : ''}${className ? `.${className}` : ''}`);
  if (head) append(node, el('div.screen-head', head));
  if (scroll) append(node, el('div.screen-scroll', scroll));
  if (body) append(node, el('div.screen-centre', body));
  if (foot) append(node, el('div.screen-foot', foot));
  return node;
}

/**
 * Replace whatever is in #app with one screen, in a single mutation.
 *
 * `keepScroll` carries the scroll position of the outgoing `.screen-scroll`
 * onto the incoming one. Several screens rebuild themselves wholesale on every
 * tap rather than swapping one node -- a chip on the medicine form, a dose row
 * on the helper's Today -- and without this the person is thrown back to the
 * top of a long form for changing "Tablet" to "Capsule". It is opt-in because
 * a genuine navigation must NOT keep it: arriving on a new screen part way
 * down is its own kind of wrong.
 */
export function mount(app, node, { keepScroll = false } = {}) {
  const previous = keepScroll ? app.querySelector('.screen-scroll') : null;
  const top = previous ? previous.scrollTop : 0;
  clear(app);
  app.appendChild(node);
  if (top) {
    const next = node.querySelector('.screen-scroll');
    if (next) next.scrollTop = top;
  }
  return node;
}

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
 * `aria-busy` and the live region matter as much as the spinner: a screen
 * reader gets silence otherwise.
 */
export function loadingState(message = S.loading) {
  return el('div.loading', { role: 'status', 'aria-busy': 'true' }, [
    el('span.spinner', { 'aria-hidden': 'true' }),
    el('span', { text: message }),
  ]);
}

/** An indeterminate progress bar. The only motion in the elder view. */
export function progressBar(className = '') {
  return el(`span.progress${className ? `.${className}` : ''}`, { 'aria-hidden': 'true' }, el('span'));
}

// ---- how much to take -----------------------------------------------------

/**
 * "2 tablets", "½ tablet", "10 ml" -- how much to take, in words.
 *
 * The number lives in `doseQty` and the noun comes from `form`, which is what
 * makes this both countable (the organiser has to add it up) and translatable
 * (the noun is a string, not something a supporter typed).
 *
 * The `dosage` fallback is not dead code. Snapshots frozen before migration
 * 0011 carry the old free-text value and are deliberately never rewritten.
 */
export function doseText(medicine) {
  if (!medicine) return '';
  if (medicine.doseQty == null) return medicine.dosage || '';

  const qty = Number(medicine.doseQty);
  if (!Number.isFinite(qty) || qty <= 0) return '';
  const [one, many] = S.doseUnits[medicine.form] || S.doseUnits.other;
  // Singular at or below one, so a scored tablet reads "half a tablet" rather
  // than the "½ tablets" a naive `=== 1` test produces.
  return `${doseAmount(qty)} ${qty <= 1 ? one : many}`;
}

/** Just the number: "2", "½", "1½". */
export function doseAmount(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return '';
  const whole = Math.floor(n);
  const fraction = S.doseFractions[Number((n - whole).toFixed(2))];
  if (!fraction) return String(Number(n.toFixed(2)));
  return whole ? `${whole}${fraction}` : fraction;
}

// ---- pill identity --------------------------------------------------------

/* Recognising the physical pill is the reason this app exists, so the photo is
 * the medicine's one visual identity and it appears at every size in both
 * roles. Where a household has no photo yet the tile is a hatch placeholder
 * labelled "pill photo" -- honest about a missing asset rather than pretending
 * with a generic icon, and a visible job for the helper to do.
 *
 * Only two glyphs exist so far: a pill and a droplet. The droplet earns its
 * place because liquids and drops are the things that must NOT go in a weekly
 * organiser -- which is exactly what js/organiser.js's BOX_FORMS keys off. */
const FORM_ICON = {
  liquid: 'drop',
  drops: 'drop',
};

/**
 * pillTile({ id, url, form, alt, state, community, archived, size })
 *   state  null | 'taken' | 'skipped'
 *   size   null (78px, E2) | 'lg' (96px) | 'md' (52px) | 'sm' (44px) | 'xs' (36px)
 */
export function pillTile({
  id, url, form, alt = '', state = null,
  community = false, archived = false, size = null, label = true,
} = {}) {
  const classes = ['ptile'];
  if (size) classes.push(`ptile-${size}`);

  const node = el(`span.${classes.join('.')}`, {}, url
    ? el('img', { src: url, alt })
    : (archived || !label
      ? icon(archived ? 'box' : FORM_ICON[form] || 'pill')
      : el('span', { html: 'pill<br>photo' })));

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

// ---- state tones ----------------------------------------------------------

/* Colour + shape + word, never colour alone. Every consumer sets --state-fg
 * (and --state-bg where there is a fill) on the node, and every child reads
 * it, so one tone drives the border, the band, the ring and the status text.
 *
 * Red is used ONLY for overdue and destructive. "Not taking today" is a
 * recorded outcome and is styled neutral grey -- never red, never a failure. */

export const TONE = {
  wait: { cls: 'state-wait', fg: 'var(--ink-3)', bg: 'var(--e-sunk)', glyph: '○' },
  late: { cls: 'state-late', fg: 'var(--red)', bg: 'var(--red-tint)', glyph: '!' },
  done: { cls: 'state-done', fg: 'var(--green)', bg: 'var(--green-tint)', glyph: '✓' },
  skip: { cls: 'state-skip', fg: 'var(--neutral)', bg: 'var(--neutral-tint)', glyph: '-' },
  none: { cls: 'state-none', fg: 'var(--s-muted)', bg: 'var(--card)', glyph: '' },
};

/** Per-dose tone: taken, not taking today, or not marked yet. */
export function doseTone(state) {
  if (state === 'taken') return { ...TONE.done, label: S.stateTakenLabel };
  if (state === 'skipped') return { ...TONE.skip, label: S.stateSkippedLabel };
  return { ...TONE.wait, label: S.stateUnmarkedLabel };
}

/** Paint a tone onto a node. Returns the node, so it chains. */
export function paintTone(node, tone) {
  node.style.setProperty('--state-fg', tone.fg);
  node.style.setProperty('--state-bg', tone.bg);
  return node;
}

/** A 24px ringed glyph in the state colour. */
export function stateRing(tone, className = 'state-ring') {
  return paintTone(el(`span.${className}`, { 'aria-hidden': 'true', text: tone.glyph }), tone);
}

// ---- overlays -------------------------------------------------------------

const overlayHost = () => document.getElementById('overlay');

let openCount = 0;

/* Every live overlay's own close function, newest last.
 *
 * Navigating away has to take the overlays with it. Without this, opening a
 * medicine sheet and then following a link inside it -- or being moved by the
 * router's midnight check -- left the sheet sitting on top of a screen it knew
 * nothing about, with a Close button that returned to a card no longer there.
 * Tracked as closers rather than by emptying the host, so each layer also
 * detaches its own keydown listener and restores focus. */
const liveOverlays = new Set();

/** Dismiss every open overlay. Called by the router on a real path change. */
export function closeOverlays() {
  for (const close of [...liveOverlays].reverse()) {
    try { close(); } catch { /* a failed close must not block navigation */ }
  }
  liveOverlays.clear();
}

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
    liveOverlays.delete(close);
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
     * back to the row they were on. The node may be gone -- a redraw replaces
     * the card that opened it -- hence the check. */
    if (returnFocusTo?.isConnected) returnFocusTo.focus?.();
  };

  const dismiss = () => { close(); onDismiss?.(); };

  function onKey(event) {
    /* Only the topmost overlay answers. Every layer adds its own keydown
     * listener to `document`, so without this one Escape dismisses the whole
     * stack at once. */
    if (host.lastElementChild !== layer) return;

    /* Keep Tab inside the panel. aria-modal tells a screen reader the rest of
     * the page is inert; it does nothing about the tab order. */
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
  liveOverlays.add(close);

  // Focus the first control so keyboard and screen-reader users land inside.
  requestAnimationFrame(() => {
    const target = panel.querySelector('[autofocus], button, input, select, textarea, [tabindex]');
    (target || panel).focus?.();
  });

  return close;
}

/**
 * A modal question, spent only where a tap has consequences outside the phone:
 * rotating the code, signing out, disconnecting, archiving, removing a time of
 * day, sharing a photo. Dose marking never uses one -- it is instant with Undo
 * in the toast.
 *
 * `confirmLabel` must NAME the action ("Remove Morning", "Sign out"), and
 * `cancelLabel` must name the alternative ("Keep it", "Stay signed in"). The
 * two buttons are stacked, not side by side, because a named action is long
 * and truncating it is exactly what a confirm dialog must not do.
 */
export function confirmDialog({
  title, body, confirmLabel = S.confirm, cancelLabel = S.cancel, danger = false,
}) {
  return new Promise(resolve => {
    let close;
    const finish = value => { close?.(); resolve(value); };

    const panel = el('div.dialog', { role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, [
      title ? el('h2.dialog-title', { text: title }) : null,
      el('div.dialog-body', typeof body === 'string' ? el('p', { text: body }) : body),
      el('div.dialog-actions', [
        el(`button.dialog-confirm${danger ? '.dialog-confirm-danger' : ''}`, {
          type: 'button', text: confirmLabel, autofocus: true, onclick: () => finish(true),
        }),
        el('button.dialog-cancel', {
          type: 'button', text: cancelLabel, onclick: () => finish(false),
        }),
      ]),
    ]);

    close = mountOverlay(panel, { onDismiss: () => resolve(false), className: 'dialog-layer' });
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
        el('button.dialog-confirm', {
          type: 'button', text: closeLabel, autofocus: true,
          onclick: () => { close(); resolve(); },
        }),
      ]),
    ]);
    close = mountOverlay(panel, { onDismiss: resolve, className: 'dialog-layer' });
  });
}

/**
 * A panel rising from the bottom. Returns { close, setContent, body, setFoot }.
 *
 * `eyebrow` is the small label above the title (the slot name on a medicine
 * sheet). `foot` is a fixed action block below the scrolling body -- the
 * medicine sheet's take/undo buttons live there so they are always reachable
 * without scrolling to the bottom of the notes.
 */
export function openSheet({
  title, eyebrow = null, content, foot = null, onClose,
  panelClassName = '', layerClassName = '', padded = false,
}) {
  const body = el(padded ? 'div.sheet-pad' : 'div.sheet-body');
  append(body, content);

  const footNode = el('div.sheet-foot');
  if (foot) append(footNode, foot);

  const panel = el(`div.sheet${panelClassName ? `.${panelClassName}` : ''}`, {
    role: 'dialog', 'aria-modal': 'true', tabindex: '-1',
  }, [
    title || eyebrow ? el('div.sheet-head', [
      eyebrow ? el('span.sheet-eyebrow', { text: eyebrow }) : null,
      title ? el('h2.sheet-title', { text: title }) : null,
      el('button.sheet-close', {
        type: 'button', text: S.close, onclick: () => api.close(),
      }),
    ]) : null,
    body,
    foot ? footNode : null,
  ]);

  const close = mountOverlay(panel, {
    onDismiss: onClose,
    className: `sheet-layer${layerClassName ? ` ${layerClassName}` : ''}`,
  });

  const api = {
    close: () => { close(); onClose?.(); },
    setContent: next => { clear(body); append(body, next); },
    setFoot: next => { clear(footNode); append(footNode, next); },
    body,
  };
  return api;
}

/** Full-screen photo viewer. The reason the app exists, so it gets everything. */
export function openPhotoViewer({ url, name, strength, altText, caption = null }) {
  const label = [name, strength].filter(Boolean).join(' ');
  const panel = el('div.photoview', { role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, [
    el('div.photoview-bar', [
      el('span.photoview-label', { text: label }),
      el('button.photoview-close', {
        type: 'button', text: S.closePhoto, onclick: () => close(),
      }),
    ]),
    el('div.photoview-stage', url
      ? el('img.photoview-img', { src: url, alt: altText || label })
      : el('div.photoview-empty', { text: S.noPhoto })),
    caption ? el('p.photoview-caption', { text: caption }) : null,
  ]);

  const close = mountOverlay(panel, { className: 'photoview-layer' });
  return close;
}

/**
 * A blocking "working on it" panel, for something too slow to leave
 * unexplained. Deliberately not dismissible and deliberately in the way.
 *
 * Returns { setMessage, close }. The caller MUST close it on every path.
 */
export function busyOverlay(message) {
  const text = el('p.busy-text', { text: message, 'aria-live': 'polite' });

  const panel = el('div.busy', {
    role: 'alertdialog', 'aria-modal': 'true', 'aria-busy': 'true', tabindex: '-1',
  }, [
    el('span.spinner.spinner-lg', { 'aria-hidden': 'true' }),
    text,
    el('p.busy-hint', { text: S.busyHint }),
  ]);

  const close = mountOverlay(panel, { dismissible: false, className: 'busy-layer' });
  return {
    setMessage: next => { text.textContent = next; },
    close,
  };
}

let toastTimer = null;

/**
 * toast('Something went wrong.')
 *
 * The only transient UI in the app, and deliberately rare: a state change a
 * person can already see (a button flipped, a row changed colour) does not
 * also need a toast to say so. Reserved for what the screen cannot already
 * show -- a failure, or a reminder actually being sent.
 */
export function toast(message) {
  const node = document.getElementById('toast');
  clearTimeout(toastTimer);
  clear(node);
  node.appendChild(el('span', { text: message }));
  node.hidden = false;
  toastTimer = setTimeout(() => { node.hidden = true; }, 3200);
}

// ---- small building blocks ------------------------------------------------

export function field({ label, control, hint, error, id }) {
  return el('div.field', [
    label ? el('label.field-label', { for: id, text: label }) : null,
    control,
    hint ? el('p.field-hint', { text: hint }) : null,
    error ? el('p.field-error', { text: error }) : null,
  ]);
}

/** A labelled section in the elder's Settings: 15px/800 uppercase + a card. */
/**
 * Two big custom "radio" cards asking whether the household uses a physical
 * pill organizer box. Not a pair of <input type="radio">: the whole card is
 * the tap target, which a native radio's few-millimetre dot is not, and the
 * dot inside each card only mimics one -- it carries no real radio semantics,
 * `aria-pressed` on the button does that work instead.
 *
 * Shared by the sign-in screen and both roles' Settings; `dense` trims it to
 * the supporter's tighter density without changing the elder's markup.
 */
export function organizerChoice(value, onSelect, { dense = false } = {}) {
  return yesNoChoice(value, onSelect, {
    yes: [S.organizerYes, S.organizerYesHint],
    no: [S.organizerNo, S.organizerNoHint],
    dense,
  });
}

/** Whether the household gets the nightly summary (0029). Same cards as
 * organizerChoice, so both household-wide yes/no settings look alike. */
export function nightlySummaryChoice(value, onSelect, { dense = false } = {}) {
  return yesNoChoice(value, onSelect, {
    yes: [S.nightlyOn, S.nightlyOnHint],
    no: [S.nightlyOff, S.nightlyOffHint],
    dense,
  });
}

/* The cards themselves. `value` is treated as true unless it is exactly
 * false, which is also how both settings default. */
function yesNoChoice(value, onSelect, { yes, no, dense }) {
  const option = (optValue, [label, hint]) => {
    const selected = (value !== false) === optValue;
    return el(`button.organizer-option${dense ? '.organizer-option-dense' : ''}`, {
      type: 'button',
      'aria-pressed': String(selected),
      onclick: () => onSelect(optValue),
    }, [
      el('span.organizer-option-dot', { 'aria-hidden': 'true' }),
      el('span.organizer-option-text', [
        el('span.organizer-option-label', { text: label }),
        el('span.organizer-option-hint', { text: hint }),
      ]),
    ]);
  };

  return el('div.organizer-choice', [option(true, yes), option(false, no)]);
}

export function settingsGroup(label, children) {
  return el('div.sgroup', [
    label ? el('span.slabel', { text: label }) : null,
    ...(Array.isArray(children) ? children : [children]),
  ]);
}

/** A supporter-density section: 12px/800 uppercase + a card. */
export function supGroup(label, children) {
  return el('div.sgroup', [
    label ? el('span.s-legend', { text: label }) : null,
    ...(Array.isArray(children) ? children : [children]),
  ]);
}

export function emptyState(title, body, action = null) {
  return el('div.s-empty', [
    el('p.s-empty-title', { text: title }),
    body ? el('p.s-empty-body', { text: body }) : null,
    action,
  ]);
}

// ---- the share code: copy and send ---------------------------------------

/** Copies the share code. */
export async function copyCode(code) {
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    toast(S.codeCopied);
  } catch {
    toast(S.errGeneric);
  }
}

/* Copies the code AND opens WhatsApp's own compose screen with it already
 * written into the message -- belt and braces for whichever of the two the
 * person actually uses to get it to their helper. wa.me with no phone number
 * opens WhatsApp's contact picker rather than a specific chat, which is the
 * right target here: neither caller knows who the helper is. */
export async function shareCodeOnWhatsapp(code) {
  if (!code) return;
  await copyCode(code);
  window.open(`https://wa.me/?text=${encodeURIComponent(S.shareCodeMessage(code))}`, '_blank');
}

/** A fixed literal, never interpolated -- the one thing the `html` prop is for. */
/** Google's own four-colour "G" mark, for the "Continue with Google" button --
 * a plain green circle read as a generic letter badge rather than as the
 * brand the person is being asked to trust with their account. */
export function googleMark() {
  return el('span.google-mark', {
    'aria-hidden': 'true',
    html: '<svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.55 10.78l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
  });
}

export function whatsappIcon() {
  return el('span.whatsapp-icon', {
    html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm5.83 14.02c-.24.68-1.4 1.32-1.93 1.4-.5.08-1.11.11-1.79-.11-.41-.13-.94-.3-1.62-.6-2.85-1.23-4.71-4.08-4.85-4.27-.14-.19-1.16-1.54-1.16-2.94 0-1.4.73-2.09.99-2.37.26-.28.57-.35.76-.35.19 0 .38 0 .55.01.18.01.41-.07.64.49.24.58.81 2 .88 2.14.07.14.12.31.02.5-.1.19-.15.31-.29.48-.14.17-.3.38-.43.51-.14.14-.29.29-.12.57.17.28.75 1.24 1.61 2 1.11.99 2.04 1.3 2.32 1.44.28.14.44.12.6-.07.16-.19.68-.79.86-1.06.18-.28.36-.23.6-.14.24.09 1.55.73 1.82.87.27.14.45.21.51.32.06.11.06.65-.18 1.33z"/></svg>',
  });
}

/**
 * The "Send it" sheet: WhatsApp, a text message, or just the code.
 *
 * A sheet rather than the OS share panel because two of the three targets are
 * specific apps we can open directly, and the third is the clipboard -- naming
 * them is clearer to read out over a phone call than "Share…".
 */
export function openShareSheet(code) {
  const sheet = openSheet({
    padded: true,
    content: [
      el('span.ms-name', { text: S.shareSheetTitle, style: 'font-size: 21px' }),
      el('button.share-row', {
        type: 'button',
        onclick: () => { sheet.close(); shareCodeOnWhatsapp(code); },
      }, [whatsappIcon(), el('span', { text: S.shareWhatsapp })]),
      el('a.share-row', {
        href: `sms:?&body=${encodeURIComponent(S.shareCodeMessage(code))}`,
        onclick: () => sheet.close(),
      }, [el('span', { text: S.shareTextMessage })]),
      el('button.share-row', {
        type: 'button',
        onclick: () => { sheet.close(); copyCode(code); },
      }, [el('span', { text: S.shareCopyCode })]),
      el('button.btn.btn-quiet', {
        type: 'button', text: S.cancel, onclick: () => sheet.close(),
      }),
    ],
  });
  return sheet;
}

/**
 * The code itself, at the size it is read out over a phone call, with Copy and
 * Send it beneath. Shared by Today's cold start (38px) and Settings (34px).
 */
export function codeCard(code, { size = 'lg', label = S.settingsCodeForHelper, extra = null } = {}) {
  return el('div.code-card', [
    el('span.code-card-label', { text: label }),
    el(`button.code-value${size === 'sm' ? '.code-value-sm' : ''}`, {
      type: 'button', text: code, 'aria-label': S.copyCode, onclick: () => copyCode(code),
    }),
    el('div.code-actions', [
      el('button.btn.btn-green-outline', {
        type: 'button', text: S.copyCode, onclick: () => copyCode(code),
      }),
      el('button.btn.btn-primary', {
        type: 'button', text: S.sendCode, onclick: () => openShareSheet(code),
      }),
    ]),
    extra,
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
