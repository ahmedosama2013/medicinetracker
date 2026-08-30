/* Hash router.
 *
 * Hash routing rather than paths because GitHub Pages has no redirects file,
 * so a path-based client route 404s on refresh. `#/today` never does.
 *
 * Each route declares which modes may see it. A route the current mode does
 * not own redirects to that mode's home rather than rendering an empty screen.
 */

const routes = new Map();
let currentMode = null;
let onRender = null;
let activeCleanup = null;

export const HOME = { simple: '#/today', supporter: '#/medicines' };

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

async function renderRoute(route, path) {
  if (!route) return;
  const app = document.getElementById('app');

  // Views may return a cleanup function; photo object URLs rely on it.
  if (activeCleanup) {
    try { activeCleanup(); } catch { /* a failed cleanup must not block navigation */ }
    activeCleanup = null;
  }

  onRender?.(path, route);

  const output = await route.view({ app, query: currentQuery(), path });
  if (typeof output === 'function') activeCleanup = output;

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
