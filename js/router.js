/* Hash router.
 *
 * Hash routing rather than paths because GitHub Pages has no redirects file,
 * so a path-based client route 404s on refresh. `#/today` never does.
 *
 * Each route declares which modes may see it. A route the current mode does
 * not own redirects to that mode's home rather than rendering an empty screen.
 */

import { S } from './strings.js';
import { el, clear, emptyState } from './ui.js';

const routes = new Map();
let currentMode = null;
let onRender = null;
let activeCleanup = null;

/* Every render gets a number. A render whose number is no longer the current
 * one has been superseded and must not touch the DOM.
 *
 * Without this, two overlapping renders append two copies of the same screen.
 * Every view is shaped `clear(app)` -> `await` -> `appendChild`, so: A clears,
 * A yields, B clears, B yields, A appends its day, B appends its day. Both
 * copies are live and identical, which is exactly how it was reported -- "many
 * routine slots with the same slots and medicines, and a refresh fixes it".
 * A reload fixes it because a reload runs exactly one render.
 *
 * Overlap was not rare. Realtime called refresh() once per dose_log change, so
 * marking a five-medicine slot produced five of them; a supporter save fires
 * three table events at once; and the supporter's poll refreshes on a timer
 * with no idea whether a render is already in flight.
 *
 * Views receive `isCurrent` and check it after each await, because the append
 * that does the damage happens inside the view, not here. */
let generation = 0;

/* Both roles land on Today. The supporter's used to be Medicines, because
 * that was the only screen they had; now that they can see the day, opening on
 * "did they take it?" rather than on a config list matches why they open the
 * app at all. */
export const HOME = { simple: '#/today', supporter: '#/today' };

export function register(path, { view, modes, title }) {
  routes.set(path, { view, modes, title });
}

export function setMode(mode) {
  currentMode = mode;
}

export function setRenderHook(fn) {
  onRender = fn;
}

export function currentPath() {
  const hash = window.location.hash || '';
  return hash.startsWith('#/') ? hash.split('?')[0] : '';
}

export function currentQuery() {
  const hash = window.location.hash || '';
  const q = hash.indexOf('?');
  return new URLSearchParams(q === -1 ? '' : hash.slice(q + 1));
}

export function go(path, { replace = false } = {}) {
  if (replace) window.location.replace(path);
  else window.location.hash = path.startsWith('#') ? path.slice(1) : path;
}

export function home() {
  return HOME[currentMode] || '#/welcome';
}

async function render() {
  const path = currentPath();
  const route = routes.get(path);

  if (!route) {
    go(home(), { replace: true });
    if (!currentPath()) await renderRoute(routes.get(home()), home());
    return;
  }

  if (route.modes && !route.modes.includes(currentMode)) {
    go(home(), { replace: true });
    return;
  }

  await renderRoute(route, path);
}

function runCleanup() {
  if (!activeCleanup) return;
  try { activeCleanup(); } catch { /* a failed cleanup must not block navigation */ }
  activeCleanup = null;
}

async function renderRoute(route, path) {
  if (!route) return;
  const app = document.getElementById('app');

  const mine = generation + 1;
  generation = mine;
  const isCurrent = () => generation === mine;

  // Views may return a cleanup function; photo object URLs rely on it.
  runCleanup();

  onRender?.(path, route);

  let output;
  try {
    output = await route.view({ app, query: currentQuery(), path, isCurrent });
  } catch {
    /* A view that throws used to reject into nothing: the person was left on
     * the previous screen with a console message and no explanation. This is
     * the backstop, not a substitute for a view handling its own failure. */
    if (isCurrent()) {
      clear(app);
      app.appendChild(emptyState(S.errGeneric, S.errRetry));
    }
    return;
  }

  if (typeof output === 'function') {
    /* A superseded render still has to clean up. Its nodes are gone from the
     * DOM but its object URLs are not, and the render that replaced it could
     * not have released them -- when it started, this one had not yet returned
     * anything to release. */
    if (!isCurrent()) {
      try { output(); } catch { /* nothing left to protect */ }
      return;
    }
    activeCleanup = output;
  }

  if (!isCurrent()) return;

  // Reset scroll on navigation, but not when a view re-renders itself in place.
  if (app.dataset.path !== path) {
    window.scrollTo(0, 0);
    app.dataset.path = path;
  }
}

/** Re-run the current view, after data changes. */
export function refresh() {
  const path = currentPath();
  const app = document.getElementById('app');
  app.dataset.path = path;                 // keep scroll position
  return renderRoute(routes.get(path), path);
}

export function start() {
  window.addEventListener('hashchange', () => { render(); });
  return render();
}
