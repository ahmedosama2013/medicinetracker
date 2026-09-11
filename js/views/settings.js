/* Settings, in both modes.
 *
 * Simple mode: account (email, share code, rotate, sign out) and reminders.
 * Supporter mode: which household this device is connected to, and slot times.
 * Both get Appearance and About.
 *
 * Reached from the nav, not a hidden gesture.
 */

import * as store from '../store.js';
import * as supporter from '../supporter.js';

/* Loaded on use rather than at the top.
 *
 * auth.js and push.js reach js/supabase.js and therefore the full Supabase
 * client -- auth, realtime, storage -- which a supporter device can use none
 * of, so those two stay elder-branch-only. Settings is registered as a route
 * at boot like every other view, so a static import here meant every
 * supporter downloaded the whole auth stack to render a screen whose account
 * section they never see. Same reasoning as the js/sync.js import further
 * down, which has worked this way for longer.
 *
 * supporter-push.js is the one exception -- it is reached from the supporter
 * branch on purpose, and imports only js/supporter.js (the code-gated client),
 * never js/supabase.js. */
const authLib = () => import('../auth.js');
const pushLib = () => import('../push.js');
const supporterPushLib = () => import('../supporter-push.js');
import { S, APP_VERSION } from '../strings.js';
import { el, clear, section, toast, confirmDialog, field, applyTheme, loadingState, emptyState, shareCodeRow } from '../ui.js';
import { timeToMinutes } from '../date.js';
import { go, refresh } from '../router.js';

function settingRow({ label, hint, control }) {
  return el('div.setting-row', [
    el('div.setting-main', [
      el('div.setting-label', { text: label }),
      hint ? el('div.setting-hint', { text: hint }) : null,
    ]),
    control || null,
  ]);
}

/* onClick is handed its own button, so an action that takes a round trip can
 * disable it and say it is working. */
function actionRow({ label, hint, buttonLabel, onClick, primary = false }) {
  const button = el(`button.btn${primary ? '.btn-primary' : ''}`, {
    type: 'button', text: buttonLabel,
  });
  button.addEventListener('click', () => onClick(button));

  return el('div.setting-row', { style: 'flex-wrap: wrap;' }, [
    el('div.setting-main', [
      el('div.setting-label', { text: label }),
      hint ? el('div.setting-hint', { text: hint }) : null,
    ]),
    button,
  ]);
}

/** Disable a button and show it working. Returns it to normal on failure. */
function busy(button, label = S.loading) {
  button.disabled = true;
  clear(button);
  button.appendChild(el('span.spinner', { 'aria-hidden': 'true' }));
  button.appendChild(el('span', { text: label }));
}

async function rotateCode(button) {
  const ok = await confirmDialog({
    title: S.settingsRotateCode, body: S.settingsRotateCodeConfirm,
    confirmLabel: S.settingsRotateCode, danger: true,
  });
  if (!ok) return;
  busy(button);
  try {
    const code = await (await authLib()).rotateShareCode();
    await store.saveSettings({ shareCode: code });
    toast(S.settingsRotateCodeDone);
    refresh();
  } catch {
    toast(S.errGeneric);
    refresh();
  }
}

async function signOut() {
  const ok = await confirmDialog({
    title: S.settingsSignOut, body: S.settingsSignOutConfirm, confirmLabel: S.settingsSignOut, danger: true,
  });
  if (!ok) return;
  await (await authLib()).signOut();
  /* Wipe first, then forget who we were. An interrupted sign-out then leaves a
   * device with no role and no data, rather than a new role and the previous
   * household's history still in the calendar. */
  await store.clearHouseholdData().catch(() => {});
  await store.saveSettings({ role: null, householdId: null, shareCode: null });
  window.location.replace('#/welcome');
  window.location.reload();
}

async function disconnect() {
  const ok = await confirmDialog({
    title: S.settingsDisconnect, body: S.settingsDisconnectConfirm, confirmLabel: S.settingsDisconnect, danger: true,
  });
  if (!ok) return;
  await store.clearHouseholdData().catch(() => {});
  await store.saveSettings({ role: null, supporterCode: null, supporterHouseholdName: null });
  window.location.replace('#/welcome');
  window.location.reload();
}

/* Two network calls and a permission prompt, previously with the button live
 * throughout. `null` from isSubscribed means the check itself failed, and
 * turning them on is the useful thing to attempt from there. */
async function toggleNotifications(householdId, button) {
  busy(button);
  try {
    const push = await pushLib();
    if (await push.isSubscribed() === true) await push.unsubscribe();
    else await push.subscribe(householdId);
  } catch (err) {
    toast(err.message || S.errGeneric);
  }
  refresh();
}

/* Same shape as toggleNotifications above, but `state` is an object
 * (`{ escalationAfter }`) rather than a bare `true` when on -- `if (state)`
 * still does the right thing for all four of isSubscribed's return values:
 * null and false both fall through to subscribe(), same as the elder path's
 * "unknown means try turning it on" rule. */
async function sendTestNotification(button) {
  busy(button, S.notificationsTesting);
  try {
    await (await pushLib()).testNotification();
    toast(S.notificationsTestSent);
  } catch (err) {
    toast(err.message || S.errGeneric);
  }
  refresh();
}

async function toggleSupporterNotifications(code, button) {
  busy(button);
  try {
    const push = await supporterPushLib();
    const state = await push.isSubscribed(code);
    if (state) await push.unsubscribe(code);
    else await push.subscribe(code, DEFAULT_ESCALATION_AFTER);
  } catch (err) {
    toast(err.message || S.errGeneric);
  }
  refresh();
}

// ---- the view -------------------------------------------------------------

/* Three states, not a switch: "match my phone" is the default and has to stay
 * expressible, and a two-position toggle cannot say it. */
const THEMES = [
  { value: 'system', label: () => S.themeSystem },
  { value: 'light', label: () => S.themeLight },
  { value: 'dark', label: () => S.themeDark },
];

/* Values are the exact text Postgres hands back for these four intervals
 * (confirmed against the live database) -- matching the server's own
 * canonical form means "is this chip currently selected" is a plain string
 * comparison, nothing normalises on the way in or out. */
const DEFAULT_ESCALATION_AFTER = '01:00:00';
const ESCALATION_DELAYS = [
  { value: '00:30:00', label: () => S.escalationDelay30m },
  { value: DEFAULT_ESCALATION_AFTER, label: () => S.escalationDelay1h },
  { value: '02:00:00', label: () => S.escalationDelay2h },
  { value: '03:00:00', label: () => S.escalationDelay3h },
];

/* Only rendered once notifications are on -- picking a delay for a
 * notification that will never arrive is a setting with nothing to control. */
function escalationDelaySection(code, current) {
  const chips = el('div.chips', ESCALATION_DELAYS.map(d => el('button.chip', {
    type: 'button',
    text: d.label(),
    'aria-pressed': String(current === d.value),
    onclick: async () => {
      try {
        const push = await supporterPushLib();
        await push.setEscalation(code, d.value);
        refresh();
      } catch {
        toast(S.errGeneric);
      }
    },
  })));

  return el('div', [
    el('p.setting-hint', { text: S.escalationDelayLabel, style: 'margin-bottom: 0.75rem;' }),
    chips,
  ]);
}


function appearanceSection(current) {
  const chips = el('div.chips', THEMES.map(t => el('button.chip', {
    type: 'button',
    text: t.label(),
    'aria-pressed': String((current || 'system') === t.value),
    onclick: async () => {
      await store.saveSettings({ theme: t.value });
      applyTheme(t.value);
      refresh();
    },
  })));

  return section(S.settingsAppearance, [
    el('p.setting-hint', { text: S.settingsAppearanceHint, style: 'margin-bottom: 0.75rem;' }),
    chips,
  ]);
}

export async function settingsView({ app, isCurrent = () => true }) {
  const settings = await store.getSettings();
  if (!isCurrent()) return;
  const role = settings.role;
  const code = role === 'simple' ? settings.shareCode : settings.supporterCode;

  clear(app);
  app.appendChild(el('h1.page-title', { text: S.settingsTitle }));

  if (role === 'simple') {
    /* Both of these are network calls, and isSubscribed also waits on the
     * service worker. This screen used to sit as a bare heading for as long as
     * they took, and forever if the worker never activated. */
    const pending = loadingState();
    app.appendChild(pending);

    const [auth, push] = await Promise.all([authLib(), pushLib()]);
    const [session, notifState] = await Promise.all([
      auth.getSession().catch(() => null),
      push.isSubscribed().catch(() => null),
    ]);
    if (!isCurrent()) return;
    pending.remove();

    const notifOn = notifState === true;
    const notifUnknown = notifState === null;

    app.appendChild(section(S.settingsAccount, [
      settingRow({
        label: S.settingsSignedInAs,
        control: el('span.setting-value', { text: session?.user?.email || '' }),
      }),
      settingRow({
        label: S.settingsShareCode,
        hint: S.settingsShareCodeHint,
        control: settings.shareCode ? shareCodeRow(settings.shareCode) : null,
      }),
      actionRow({
        label: S.settingsRotateCode,
        hint: S.settingsRotateCodeHint,
        buttonLabel: S.settingsRotateCode,
        onClick: rotateCode,
      }),
      actionRow({ label: S.settingsSignOut, buttonLabel: S.settingsSignOut, onClick: () => signOut() }),
    ]));

    app.appendChild(section(S.settingsNotifications, [
      actionRow({
        label: notifUnknown ? S.notificationsUnknownLabel
          : notifOn ? S.notificationsOnLabel : S.notificationsOffLabel,
        hint: notifUnknown ? S.notificationsUnknownHint : S.notificationsHint,
        buttonLabel: notifOn ? S.notificationsTurnOff : S.notificationsTurnOn,
        primary: !notifOn,
        onClick: button => toggleNotifications(settings.householdId, button),
      }),
      notifOn ? actionRow({
        label: S.notificationsTestLabel,
        hint: S.notificationsTestHint,
        buttonLabel: S.notificationsTestButton,
        onClick: sendTestNotification,
      }) : null,
    ]));
  } else {
    /* Same reasoning as the elder branch above: isSubscribed waits on the
     * service worker and makes a network call, and this screen should not
     * sit as a bare heading for however long that takes. */
    const pending = loadingState();
    app.appendChild(pending);

    const push = await supporterPushLib();
    const notifState = await push.isSubscribed(code).catch(() => null);
    if (!isCurrent()) return;
    pending.remove();

    const notifOn = !!notifState;
    const notifUnknown = notifState === null;
    const currentDelay = (notifOn && notifState.escalationAfter) || DEFAULT_ESCALATION_AFTER;

    app.appendChild(section(S.settingsConnection, [
      settingRow({
        label: S.settingsConnectedTo,
        control: el('span.setting-value', { text: settings.supporterHouseholdName || '' }),
      }),
      actionRow({
        label: S.settingsDisconnect,
        hint: S.settingsDisconnectHint,
        buttonLabel: S.settingsDisconnect,
        onClick: () => disconnect(),
      }),
    ]));

    app.appendChild(section(S.settingsSupporterNotifications, [
      actionRow({
        label: notifUnknown ? S.supporterNotificationsUnknownLabel
          : notifOn ? S.supporterNotificationsOnLabel : S.supporterNotificationsOffLabel,
        hint: notifUnknown ? S.supporterNotificationsUnknownHint : S.supporterNotificationsHint,
        buttonLabel: notifOn ? S.supporterNotificationsTurnOff : S.supporterNotificationsTurnOn,
        primary: !notifOn,
        onClick: button => toggleSupporterNotifications(code, button),
      }),
      notifOn ? escalationDelaySection(code, currentDelay) : null,
    ]));

    /* Its own section rather than buried under Connection: changing what
     * "Morning" means is routine setup, and disconnecting the device is not.
     * They do not belong in the same card. */
    app.appendChild(section(S.settingsSlots, [
      actionRow({
        label: S.settingsSlots,
        hint: S.slotsIntro,
        buttonLabel: S.settingsSlots,
        onClick: () => go('#/slots'),
      }),
    ]));
  }

  app.appendChild(appearanceSection(settings.theme));

  app.appendChild(section(S.settingsAbout, [
    settingRow({
      label: S.settingsVersion,
      control: el('span.setting-value', { text: APP_VERSION }),
    }),
  ]));
}

// ---- slot times (supporter) ----------------------------------------------

export async function slotsView({ app, isCurrent = () => true }) {
  const settings = await store.getSettings();
  const code = settings.supporterCode;

  clear(app);
  app.appendChild(el('h1.page-title', { text: S.slotsTitle }));
  const pending = loadingState();
  app.appendChild(pending);

  let routine;
  try {
    routine = await supporter.loadRoutine(code);
  } catch {
    if (!isCurrent()) return;
    clear(app);
    app.appendChild(el('h1.page-title', { text: S.slotsTitle }));
    app.appendChild(emptyState(S.errGeneric, S.pairCodeInvalid));
    app.appendChild(el('a.btn.btn-quiet.btn-block', { href: '#/settings', text: S.back }));
    return;
  }
  if (!isCurrent()) return;

  // This is a draft. Changing inputs never writes or reorders the page beneath
  // the finger; the one Save action below makes the consequence explicit.
  const slots = [...routine.slots]
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time))
    .map(slot => ({ ...slot, draftKey: slot.id }));
  const schedules = routine.schedules;
  const errors = {};
  let saving = false;

  const liveMedicines = new Set(routine.medicines.filter(m => !m.archived).map(m => m.id));
  const usageCount = slotId => schedules
    .filter(s => s.slotId === slotId && s.active && liveMedicines.has(s.medicineId)).length;

  async function saveSlots(button) {
    if (saving) return;
    for (const key of Object.keys(errors)) delete errors[key];
    for (const slot of slots) {
      if (!slot.label.trim()) errors[`label-${slot.draftKey}`] = S.errSlotLabel;
    }
    if (Object.keys(errors).length) {
      draw();
      app.querySelector('.input-invalid')?.focus();
      return;
    }

    saving = true;
    busy(button, S.saving);
    try {
      await supporter.saveSlots(code, slots.map(({ draftKey, ...slot }) => slot));
      toast(S.saved);
      refresh();
    } catch {
      saving = false;
      toast(S.errGeneric);
      draw();
    }
  }

  async function removeSlot(slot) {
    const used = usageCount(slot.id);
    const ok = await confirmDialog({
      title: S.removeSlot,
      body: S.slotRemoveConfirm(slot.label, used),
      confirmLabel: S.removeSlot,
      danger: true,
    });
    if (!ok) return;
    slots.splice(slots.indexOf(slot), 1);
    draw();
  }

  function draw() {
    clear(app);
    app.appendChild(el('h1.page-title', { text: S.slotsTitle }));
    app.appendChild(el('p.page-sub', { text: S.slotsIntro }));
    app.appendChild(el('p.setting-hint.slots-save-hint', { text: S.slotsSaveHint }));

    for (const slot of slots) {
      const used = usageCount(slot.id);
      app.appendChild(section(null, [
        el('div.field-inline', [
          field({
            id: `slot-label-${slot.draftKey}`,
            label: S.slotLabel,
            error: errors[`label-${slot.draftKey}`],
            control: el('input', {
              type: 'text', id: `slot-label-${slot.draftKey}`, value: slot.label,
              class: errors[`label-${slot.draftKey}`] ? 'input-invalid' : '',
              oninput: e => { slot.label = e.target.value; delete errors[`label-${slot.draftKey}`]; },
            }),
          }),
          field({
            id: `slot-time-${slot.draftKey}`,
            label: S.slotTime,
            control: el('input', {
              type: 'time', id: `slot-time-${slot.draftKey}`, value: slot.time,
              oninput: e => { slot.time = e.target.value; },
            }),
          }),
        ]),
        el('p.field-hint', {
          text: used
            ? `Used by ${used} medicine ${used === 1 ? 'schedule' : 'schedules'}`
            : 'Not used by any medicine schedules',
        }),
        slots.length > 1 ? el('button.btn-link', {
          type: 'button', text: S.removeSlot, onclick: () => removeSlot(slot),
        }) : null,
      ]));
    }

    app.appendChild(el('button.btn.btn-block', {
      type: 'button', text: S.addSlot,
      onclick: () => {
        slots.push({ id: null, draftKey: `new-${Date.now()}`, label: 'New time', time: '12:00', order: slots.length + 1, builtIn: false });
        draw();
      },
    }));

    const saveButton = el('button.btn.btn-primary.btn-block', {
      type: 'button', text: S.saveSlots, onclick: () => saveSlots(saveButton),
    });
    app.appendChild(saveButton);
    app.appendChild(el('a.btn.btn-quiet.btn-block', { href: '#/settings', text: S.back, style: 'margin-top: 1rem;' }));
  }

  draw();
}
