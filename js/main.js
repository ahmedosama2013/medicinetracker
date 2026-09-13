/* Boot: open the database, work out which mode this device is in, wire the
 * routes, draw the navigation, hand over to the router. */

import * as store from './store.js';
import * as router from './router.js';
import * as supporterSync from './supporter-sync.js';
import { S } from './strings.js';
import { el, clear, applyTheme, confirmDialog, toast } from './ui.js';
import { todayStr, msUntilTomorrow, setTimezone } from './date.js';

import { welcomeView, howItWorksView } from './views/onboarding.js';
import { signInView } from './views/auth.js';
import { pairView } from './views/pairing.js';
import { todayView } from './views/today.js';
import { slotView } from './views/slot.js';
import { calendarView } from './views/calendar.js';
import { dayView } from './views/day.js';
import { medicinesView } from './views/medicines.js';
import { medicineFormView } from './views/medicine-form.js';
import { settingsView, slotsView } from './views/settings.js';
import { organiserView } from './views/organiser.js';

/* The elder's half of the data layer, loaded on the branch that needs it.
 *
 * Both of these reach js/supabase.js, which is the full Supabase client:
 * auth, realtime, storage, postgrest and functions, around 71KB. A supporter
 * device can use two of those five -- it has no session, Realtime respects RLS
 * so it would receive nothing, and photos arrive as signed URLs from an edge
 * function rather than from storage. It talks to Supabase through the ~7KB
 * code-gated client in js/supabase-code.js instead.
 *
 * Static imports here put the whole 71KB on every supporter's critical path,
 * because boot runs before anything knows which role the device is. Gating
 * them on the role that actually calls them is the entire point; keep it that
 * way, and keep the same discipline in js/doses.js and the views.
 *
 * Nothing is lost for the elder: these load during boot either way, just a
 * few milliseconds later and in parallel with the first render. */
const authLib = () => import('./auth.js');
const syncLib = () => import('./sync.js');
const pushLib = () => import('./push.js');

/* Reachable before a role exists. "How it works" is in here because it is
 * read-only -- it creates nothing, so it is safe from either side of the
 * role question. */
const PREAUTH_PATHS = ['#/welcome', '#/signin', '#/pair', '#/how'];

/* ...but only these are wrong to land on once a role IS set. #/how is left
 * out deliberately: reloading the phone while reading it should leave you
 * reading it, not bounce you to Today. */
const PREAUTH_ONLY = ['#/welcome', '#/signin', '#/pair'];

/* One bar, two tab sets, text only.
 *
 * No icons: the handoff's nav is three (or five) plain word pills, because a
 * glyph beside a 17px label costs vertical room in a 64px target and says
 * nothing the word does not. `match` exists because a tab stays current while
 * you are on a screen it owns -- the medicine FORM belongs to Medicines, the
 * day detail belongs to Calendar -- and a bare startsWith() cannot express
 * that ("#/medicine" does not start with "#/medicines").
 *
 * The elder bar is three items and is ALWAYS visible: elders should never be
 * somewhere they cannot leave in one tap. Calendar is deliberately not one of
 * them -- the elder's day is Today, and a month grid of their own adherence is
 * the report card this app never issues. The route stays reachable so an old
 * bookmark still works; it simply is not a place to go looking. */
const NAV = {
  simple: [
    { path: '#/today', label: S.navToday, match: ['#/today', '#/slot'] },
    { path: '#/organiser', label: S.navFillTheBox, match: ['#/organiser'] },
    { path: '#/settings', label: S.navSettings, match: ['#/settings', '#/how'] },
  ],
  supporter: [
    { path: '#/today', label: S.navToday, match: ['#/today'] },
    { path: '#/calendar', label: S.navCalendar, match: ['#/calendar', '#/day'] },
    { path: '#/medicines', label: S.navMedicines, match: ['#/medicines', '#/medicine'] },
    { path: '#/organiser', label: S.navBox, match: ['#/organiser'] },
    { path: '#/settings', label: S.navSettings, match: ['#/settings', '#/slots', '#/how'] },
  ],
};

/* Async and re-read fresh from IndexedDB on every render, rather than
 * threaded through as a parameter: the nav is drawn from router.js's render
 * hook, which fires from wherever a navigation happened -- Settings included,
 * where the toggle below actually lives. Reading the store here rather than
 * passing a value in means a flip in Settings is reflected the next time this
 * runs without main.js's boot() needing to know that Settings just changed
 * something. The read is local and effectively instant, so the nav still
 * paints on the same tick for everyone who never touches this toggle. */
async function drawNav(mode, activePath) {
  const bottomnav = document.getElementById('bottomnav');
  const settings = await store.getSettings();
  const items = (NAV[mode] || []).filter(item => item.path !== '#/organiser' || settings.usesOrganizer !== false);

  if (!items.length) {
    bottomnav.hidden = true;
    return;
  }

  bottomnav.hidden = false;
  clear(bottomnav);
  bottomnav.appendChild(el('div.nav-inner', items.map(item => el('a.navlink', {
    href: item.path,
    'aria-current': item.match.includes(activePath) ? 'page' : null,
    text: item.label,
  }))));
}

function registerRoutes() {
  // `[null]` means: only reachable before a role has been chosen. Without this
  // an old #/welcome in the address bar survives a reload and drops a
  // configured device back onto the onboarding question.
  router.register('#/welcome', { view: welcomeView, modes: [null] });
  router.register('#/signin', { view: signInView, modes: [null] });
  router.register('#/pair', { view: pairView, modes: [null] });
  /* Read-only, creates no data, and therefore safe to open from anywhere --
   * which is why it is a route with no mode restriction rather than a sheet
   * bolted onto Welcome. Both Settings screens link to it. */
  router.register('#/how', { view: howItWorksView, modes: [null, 'simple', 'supporter'] });
  router.register('#/today', { view: todayView, modes: ['simple', 'supporter'] });
  /* E2. Reached from "See the pills" on a Today card, never from the nav:
   * marking a whole slot is one tap from Today and this is the second,
   * optional path for when someone wants to check a pill against its photo. */
  router.register('#/slot', { view: slotView, modes: ['simple'] });
  router.register('#/calendar', { view: calendarView, modes: ['simple', 'supporter'] });
  /* One day in detail. A screen rather than a sheet over the month grid: it is
   * somewhere you stay, reading and correcting, not somewhere you peek. */
  router.register('#/day', { view: dayView, modes: ['simple', 'supporter'] });
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
 * the one this account already owns (a reinstall, or a second browser).
 * Returns whether a household was actually created here -- a reinstall
 * resuming an existing one already went through reminders setup once, on
 * whichever device did this the first time. */
async function completeSimpleSignIn(session) {
  const auth = await authLib();
  let household = await auth.getMyHousehold();
  const isNew = !household;
  if (isNew) {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    /* The full name (first + last), not just the first -- the household's
     * displayName is the one place it is stored. Every screen that greets the
     * elder by name derives the first name from this at render time instead. */
    const displayName = auth.fullNameFromSession(session)
      || session.user.email?.split('@')[0] || 'My household';
    /* Answered on the sign-in screen itself, before this ever ran (see
     * js/views/auth.js) -- and already sitting in local settings because that
     * screen saves it the moment it is tapped, redirect and all. Carried into
     * the household at the moment it is created; there is nowhere to carry it
     * to before that. */
    const { usesOrganizer } = await store.getSettings();
    await auth.createHousehold(displayName, timezone, usesOrganizer !== false);
    household = await auth.getMyHousehold();
  }
  await store.saveSettings({
    role: 'simple', householdId: household.id, shareCode: household.share_code,
    /* A reinstall resuming an existing household defers to what the household
     * already has, not to whatever this fresh device's default happens to be. */
    usesOrganizer: household.uses_organizer !== false,
  });
  return isNew;
}

/* Same dialog and wording as the manual toggle in Settings -- declining here
 * is exactly as final as declining there, and the person can still turn
 * reminders on later from the same place. */
async function promptReminders(householdId) {
  const ok = await confirmDialog({
    title: S.remindersAllowTitle,
    body: S.remindersAllowBody,
    confirmLabel: S.remindersAllowConfirm,
    cancelLabel: S.remindersNotNow,
  });
  if (!ok) return;
  try {
    await (await pushLib()).subscribe(householdId);
  } catch (err) {
    toast(err.message || S.errGeneric);
  }
}

/* Self-heals a household name saved before this was captured correctly, or
 * from a session whose Google metadata was momentarily empty. A no-op on
 * every normal boot once the stored name is already right, so this is cheap
 * to run unconditionally rather than trying to remember whether it is needed. */
async function healHouseholdName(session, householdId) {
  const auth = await authLib();
  const fullName = auth.fullNameFromSession(session);
  if (!fullName) return;
  const household = await auth.getMyHousehold();
  if (!household || household.display_name === fullName) return;
  await auth.updateHouseholdDisplayName(householdId, fullName);
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

  /* The role is local convenience state, not proof of authentication. A long
   * unused session can disappear while IndexedDB still remembers this device
   * as a simple user; rendering that as an authenticated household exposed a
   * stale share code and a misleading empty Today screen. Route to sign-in
   * before the first render, but keep local data untouched: it may contain an
   * offline outbox the same person should resume after authenticating. */
  let needsSignIn = false;
  if (settings.role === 'simple') {
    const session = await authLib().then(auth => auth.getSession()).catch(() => null);
    needsSignIn = !session;
    if (session && settings.householdId) {
      healHouseholdName(session, settings.householdId).catch(() => {});
    }
  }

  let justCreatedHousehold = false;
  if (!settings.role) {
    // Returning from the Google OAuth redirect: no local role yet, but a
    // session may now exist. Never blocks boot on a slow/offline network --
    // a failure here just leaves onboarding showing, same as before sign-in.
    const session = await authLib().then(auth => auth.getSession()).catch(() => null);
    if (session) {
      justCreatedHousehold = await completeSimpleSignIn(session).catch(() => false);
      settings = await store.getSettings();
    }
  }

  /* Before the first render, so an explicit dark choice never flashes light.
   * Absent or 'system' leaves the OS preference in charge, which is the
   * default and stays the default. */
  applyTheme(settings.theme);

  const mode = needsSignIn ? null : settings.role;

  /* Started here, awaited much later (below, and in js/doses.js).
   *
   * js/sync.js is the elder's biggest download by far -- it reaches the full
   * Supabase client -- and index.html cannot preload it, because the same HTML
   * is served to supporters who must not fetch it at all. Kicking it off the
   * moment the role is known gets it moving in parallel with the first render
   * instead of after it, which is roughly where a static import used to have
   * it, without putting it back on every device's critical path. */
  const elderData = mode === 'simple' ? syncLib() : null;
  elderData?.catch(() => {});
  /* Before the first render, and before anything asks what day it is. Both
   * devices run on the household's clock -- see js/date.js. */
  setTimezone(settings.timezone);
  document.body.classList.add(mode ? `mode-${mode}` : 'mode-none');
  router.setMode(mode);

  router.setRenderHook(path => drawNav(mode, path));

  if (!mode) {
    // No role yet: onboarding owns the screen and nothing else is reachable.
    drawNav(null, '');
    if (needsSignIn) {
      window.location.replace('#/signin');
    } else if (!PREAUTH_PATHS.includes(router.currentPath())) {
      window.location.replace('#/welcome');
    }
  } else if (PREAUTH_ONLY.includes(router.currentPath())) {
    window.location.replace(router.HOME[mode]);
  }

  /* The supporter's cache is filled before the first render, not after: their
   * Today and Calendar read the same IndexedDB stores the elder's do, and
   * those are empty on a fresh supporter install. Rendering first would show
   * "No medicines yet" for a second on every cold start. Failure is not fatal
   * -- the views fall back to whatever the last session cached. */
  if (mode === 'supporter' && settings.supporterCode) {
    await supporterSync.hydrate(settings.supporterCode, {
      // Photos are fetched after this resolves, so the first paint does not
      // wait on them. This lands them on screen when they arrive rather than
      // at the next poll, up to a minute later.
      onPhotos: () => router.refresh(),
    }).catch(() => {});
  }

  await router.start();

  watchTheDate();

  if (mode === 'simple' && settings.householdId) {
    elderData.then(sync => sync.startRealtime(settings.householdId)).catch(() => {});
  }

  /* Reminders are the whole point of the app, so a brand new elder household
   * is asked once, right here, instead of leaving it to be found later in
   * Settings. After the first render so the dialog has Today underneath it,
   * not a blank screen, and never for a reinstall resuming an existing
   * household -- that one already went through this on its first device. */
  if (justCreatedHousehold) promptReminders(settings.householdId).catch(() => {});

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
