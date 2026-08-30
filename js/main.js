/* Boot: open the database, work out which mode this device is in, wire the
 * routes, draw the navigation, hand over to the router. */

import * as store from './store.js';
import * as router from './router.js';
import { S } from './strings.js';
import { el, clear } from './ui.js';

import { welcomeView } from './views/onboarding.js';
import { todayView } from './views/today.js';
import { calendarView } from './views/calendar.js';
import { medicinesView } from './views/medicines.js';
import { medicineFormView } from './views/medicine-form.js';
import { settingsView, slotsView } from './views/settings.js';

const NAV = {
  simple: [
    { path: '#/today', label: S.navToday, icon: 'today' },
    { path: '#/calendar', label: S.navCalendar, icon: 'calendar' },
    { path: '#/settings', label: S.navSettings, icon: 'settings' },
  ],
  supporter: [
    { path: '#/medicines', label: S.navMedicines, icon: 'pill' },
    { path: '#/settings', label: S.navSettings, icon: 'settings' },
  ],
};

function drawNav(mode, activePath) {
  const topbar = document.getElementById('topbar');
  const bottomnav = document.getElementById('bottomnav');
  const items = NAV[mode] || [];

  if (!items.length) {
    topbar.hidden = true;
    bottomnav.hidden = true;
    return;
  }

  const links = items.map(item => el('a.navlink', {
    href: item.path,
    'aria-current': activePath.startsWith(item.path) ? 'page' : null,
    dataset: { icon: item.icon },
  }, [
    el('span.navlink-icon', { 'aria-hidden': 'true' }),
    el('span.navlink-label', { text: item.label }),
  ]));

  // Simple mode gets a bottom bar with big targets; supporter gets top tabs.
  if (mode === 'simple') {
    topbar.hidden = true;
    bottomnav.hidden = false;
    clear(bottomnav);
    bottomnav.appendChild(el('div.nav-inner', links));
  } else {
    bottomnav.hidden = true;
    topbar.hidden = false;
    clear(topbar);
    topbar.appendChild(el('div.topbar-inner', [
      el('span.topbar-brand', { text: S.appName }),
      el('nav.tabs', links),
    ]));
  }
}

function registerRoutes() {
  // `[null]` means: only reachable before a role has been chosen. Without this
  // an old #/welcome in the address bar survives a reload and drops a
  // configured device back onto the onboarding question.
  router.register('#/welcome', { view: welcomeView, modes: [null] });
  router.register('#/today', { view: todayView, modes: ['simple', 'supporter'] });
  router.register('#/calendar', { view: calendarView, modes: ['simple'] });
  router.register('#/medicines', { view: medicinesView, modes: ['supporter'] });
  router.register('#/medicine', { view: medicineFormView, modes: ['supporter'] });
  router.register('#/settings', { view: settingsView, modes: ['simple', 'supporter'] });
  router.register('#/slots', { view: slotsView, modes: ['supporter'] });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Relative path, so the scope is this directory and the app works unchanged
  // at a project-pages sub-path.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Offline support is a bonus, not a requirement. Never block boot.
    });
  });
}

async function boot() {
  registerRoutes();
  registerServiceWorker();

  let settings;
  try {
    settings = await store.getSettings();
  } catch (err) {
    document.getElementById('app').appendChild(el('div.fatal', [
      el('h1', { text: S.errGeneric }),
      el('p', { text: 'This app needs storage, which private browsing can switch off. Try a normal tab.' }),
    ]));
    return;
  }

  const mode = settings.role;
  document.body.classList.add(mode ? `mode-${mode}` : 'mode-none');
  router.setMode(mode);

  router.setRenderHook(path => drawNav(mode, path));

  if (!mode) {
    // No role yet: onboarding owns the screen and nothing else is reachable.
    drawNav(null, '');
    if (router.currentPath() !== '#/welcome') {
      window.location.replace('#/welcome');
    }
  } else if (router.currentPath() === '#/welcome') {
    window.location.replace(router.HOME[mode]);
  }

  await router.start();

  // Ask for durable storage once the app is actually in use. Chrome grants it
  // for installed apps; Safari does not implement it, which is why export
  // exists at all.
  store.requestPersistence().catch(() => {});
}

boot();
