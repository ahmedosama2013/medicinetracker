/* Boot: open the database, work out which mode this device is in, wire the
 * routes, draw the navigation, hand over to the router. */

import * as store from './store.js';
import * as router from './router.js';
import * as auth from './auth.js';
import * as sync from './sync.js';
import * as supporterSync from './supporter-sync.js';
import { S } from './strings.js';
import { el, clear, applyTheme } from './ui.js';
import { todayStr, msUntilTomorrow, setTimezone } from './date.js';

import { welcomeView } from './views/onboarding.js';
import { signInView } from './views/auth.js';
import { pairView } from './views/pairing.js';
import { todayView } from './views/today.js';
import { calendarView } from './views/calendar.js';
import { medicinesView } from './views/medicines.js';
import { medicineFormView } from './views/medicine-form.js';
import { settingsView, slotsView } from './views/settings.js';
import { organiserView } from './views/organiser.js';

const PREAUTH_PATHS = ['#/welcome', '#/signin', '#/pair'];

/* One bar, two tab sets. v2 gave the supporter sticky top tabs and the patient
 * a bottom bar -- two navigation models to learn and maintain, and the reason
 * the supporter had no room for a Calendar tab. */
const NAV = {
  simple: [
    { path: '#/today', label: S.navToday, icon: 'today' },
    { path: '#/calendar', label: S.navCalendar, icon: 'calendar' },
    { path: '#/settings', label: S.navSettings, icon: 'settings' },
  ],
  supporter: [
    { path: '#/today', label: S.navToday, icon: 'today' },
    { path: '#/calendar', label: S.navCalendar, icon: 'calendar' },
    { path: '#/medicines', label: S.navMedicines, icon: 'pill' },
    { path: '#/settings', label: S.navSettings, icon: 'settings' },
  ],
};

function drawNav(mode, activePath) {
  const bottomnav = document.getElementById('bottomnav');
  const items = NAV[mode] || [];

  if (!items.length) {
    bottomnav.hidden = true;
    return;
  }

  bottomnav.hidden = false;
  clear(bottomnav);
  bottomnav.appendChild(el('div.nav-inner', items.map(item => el('a.navlink', {
    href: item.path,
    'aria-current': activePath.startsWith(item.path) ? 'page' : null,
    dataset: { icon: item.icon },
  }, [
    el('span.navlink-icon', { 'aria-hidden': 'true' }),
    el('span.navlink-label', { text: item.label }),
  ]))));
}

function registerRoutes() {
  // `[null]` means: only reachable before a role has been chosen. Without this
  // an old #/welcome in the address bar survives a reload and drops a
  // configured device back onto the onboarding question.
  router.register('#/welcome', { view: welcomeView, modes: [null] });
  router.register('#/signin', { view: signInView, modes: [null] });
  router.register('#/pair', { view: pairView, modes: [null] });
  router.register('#/today', { view: todayView, modes: ['simple', 'supporter'] });
  router.register('#/calendar', { view: calendarView, modes: ['simple', 'supporter'] });
  router.register('#/medicines', { view: medicinesView, modes: ['supporter'] });
  router.register('#/medicine', { view: medicineFormView, modes: ['supporter'] });
  /* Both roles: whoever is holding the tray fills it. Reached from a card on
   * Today rather than a tab -- it is an occasional job, not a fifth place to
   * look every day. */
  router.register('#/organiser', { view: organiserView, modes: ['simple', 'supporter'] });
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

/** Runs once, after a Google redirect lands back on the app with a session
 * but no local role yet: create the household on first sign-in, or resume
 * the one this account already owns (a reinstall, or a second browser). */
async function completeSimpleSignIn(session) {
  let household = await auth.getMyHousehold();
  if (!household) {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const displayName = session.user.email?.split('@')[0] || 'My household';
    await auth.createHousehold(displayName, timezone);
    household = await auth.getMyHousehold();
  }
  await store.saveSettings({ role: 'simple', householdId: household.id, shareCode: household.share_code });
}

/* Today has to actually mean today.
 *
 * Every screen worked out the date once, when it was first drawn, and nothing
 * ever revisited it. An installed PWA left on the Today screen overnight --
 * which is the normal case, not an edge one -- showed yesterday in the morning,
 * and every dose marked went to yesterday's local_date.
 *
 * That is worse than a wrong heading. Once the nightly freeze has advanced
 * locked_through past that date the write is rejected, the outbox cannot tell a
 * rejection from being offline, and it retries forever: the person sees a tick
 * that never syncs and has no way to find out why.
 *
 * Both triggers are needed. The timer covers a phone left awake; the visibility
 * check covers one that was asleep, where timers are throttled or never ran. */
function watchTheDate() {
  let day = todayStr();
  let timer = null;

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(check, msUntilTomorrow());
  };

  function check() {
    const now = todayStr();
    if (now !== day) {
      day = now;
      router.refresh();
    }
    schedule();
  }

  schedule();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.addEventListener('focus', check);
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

  if (!settings.role) {
    // Returning from the Google OAuth redirect: no local role yet, but a
    // session may now exist. Never blocks boot on a slow/offline network --
    // a failure here just leaves onboarding showing, same as before sign-in.
    const session = await auth.getSession().catch(() => null);
    if (session) {
      await completeSimpleSignIn(session).catch(() => {});
      settings = await store.getSettings();
    }
  }

  /* Before the first render, so an explicit dark choice never flashes light.
   * Absent or 'system' leaves the OS preference in charge, which is the
   * default and stays the default. */
  applyTheme(settings.theme);

  const mode = settings.role;
  /* Before the first render, and before anything asks what day it is. Both
   * devices run on the household's clock -- see js/date.js. */
  setTimezone(settings.timezone);
  document.body.classList.add(mode ? `mode-${mode}` : 'mode-none');
  router.setMode(mode);

  router.setRenderHook(path => drawNav(mode, path));

  if (!mode) {
    // No role yet: onboarding owns the screen and nothing else is reachable.
    drawNav(null, '');
    if (!PREAUTH_PATHS.includes(router.currentPath())) {
      window.location.replace('#/welcome');
    }
  } else if (PREAUTH_PATHS.includes(router.currentPath())) {
    window.location.replace(router.HOME[mode]);
  }

  /* The supporter's cache is filled before the first render, not after: their
   * Today and Calendar read the same IndexedDB stores the elder's do, and
   * those are empty on a fresh supporter install. Rendering first would show
   * "No medicines yet" for a second on every cold start. Failure is not fatal
   * -- the views fall back to whatever the last session cached. */
  if (mode === 'supporter' && settings.supporterCode) {
    await supporterSync.hydrate(settings.supporterCode).catch(() => {});
  }

  await router.start();

  watchTheDate();

  if (mode === 'simple' && settings.householdId) {
    sync.startRealtime(settings.householdId);
  }

  /* No Realtime for a supporter: it respects RLS and a supporter has no
   * session, so it would match no rows and deliver nothing. Polling instead,
   * and the screens say when they last refreshed rather than implying live. */
  if (mode === 'supporter' && settings.supporterCode) {
    supporterSync.startPolling(settings.supporterCode, () => router.refresh());
  }

  // Ask for durable storage once the app is actually in use. Chrome grants it
  // for installed apps; Safari does not implement it, which is why export
  // exists at all.
  store.requestPersistence().catch(() => {});
}

boot();
