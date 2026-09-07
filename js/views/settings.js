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

/* Loaded on use rather than at the top, and only ever down an elder branch.
 *
 * Both of these reach js/supabase.js and therefore the full Supabase client --
 * auth, realtime, storage -- which a supporter device can use none of. Settings
 * is registered as a route at boot like every other view, so a static import
 * here meant every supporter downloaded the whole auth stack to render a screen
 * whose account section they never see. Same reasoning as the js/sync.js import
 * further down, which has worked this way for longer. */
const authLib = () => import('../auth.js');
const pushLib = () => import('../push.js');
import { S, APP_VERSION } from '../strings.js';
import { el, clear, section, toast, confirmDialog, field, applyTheme, loadingState, emptyState } from '../ui.js';
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

// ---- the view -------------------------------------------------------------

/* Three states, not a switch: "match my phone" is the default and has to stay
 * expressible, and a two-position toggle cannot say it. */
const THEMES = [
  { value: 'system', label: () => S.themeSystem },
  { value: 'light', label: () => S.themeLight },
  { value: 'dark', label: () => S.themeDark },
];

/* Shown in both roles, because whoever is holding the tray fills it -- the
 * supporter when they visit, the elder the rest of the time. It writes through
 * a code-gated RPC either way: the elder's device has the household's share
 * code as well as a session, so one function serves both.
 *
 * The chips update optimistically and roll back on failure. A tick that waits
 * on a round trip before moving reads as a tap that did not register, which is
 * the same mistake the dose target made before Phase 2.5's S5.
 */
function pillBoxSection(settings, code, organiser) {
  const slots = [...(settings.slots || [])]
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));

  const shape = el('p.setting-hint');
  const redrawShape = () => {
    const n = slots.filter(s => s.inBox).length;
    shape.textContent = n ? S.pillBoxShape(n) : S.pillBoxNone;
  };

  const chips = el('div.chips', slots.map(slot => {
    const chip = el('button.chip', {
      type: 'button',
      text: slot.label,
      'aria-pressed': String(!!slot.inBox),
      onclick: async () => {
        const next = !slot.inBox;
        chip.disabled = true;
        slot.inBox = next;
        chip.setAttribute('aria-pressed', String(next));
        redrawShape();
        try {
          /* Only the elder's device has Realtime, and its own write comes
           * straight back as an event -- which used to re-render this whole
           * screen underneath the finger that had just moved the chip. Mark
           * it first, so the mirror still runs and only the redraw is
           * skipped. Imported dynamically because a supporter device must
           * never load js/sync.js at all (see docs/repo-structure.md). */
          if (settings.role === 'simple') {
            const sync = await import('../sync.js');
            sync.markRoutineWrite(slot.id);
          }
          await supporter.setSlotInBox(code, slot.id, next);
          await store.saveSettings({ slots });
        } catch {
          slot.inBox = !next;
          chip.setAttribute('aria-pressed', String(!next));
          redrawShape();
          toast(S.errGeneric);
        }
        chip.disabled = false;
      },
    });
    return chip;
  }));

  redrawShape();

  /* The way in to organiser mode. It lives here rather than on Today because
   * filling the box is a weekly job at most, and Today's only subject is
   * today -- a card there would be something everyone looks past every day.
   * Under Pill box specifically, next to the setting that decides its shape. */
  const total = organiser?.plan?.steps?.length || 0;
  const remaining = total - (organiser?.done?.length || 0);
  const midSitting = total > 0 && remaining > 0 && remaining < total;

  return section(S.settingsPillBox, [
    el('p.setting-hint', { text: S.pillBoxIntro, style: 'margin-bottom: 0.75rem;' }),
    slots.length ? chips : el('p.setting-hint', { text: S.pillBoxNoSlots }),
    slots.length ? shape : null,
    slots.some(s => s.inBox) ? actionRow({
      label: S.organiserOpen,
      hint: midSitting ? S.organiserResume(remaining) : S.organiserSettingsHint,
      buttonLabel: midSitting ? S.organiserResume(remaining) : S.organiserStart,
      primary: true,
      onClick: () => go('#/organiser'),
    }) : null,
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
  const [settings, organiser] = await Promise.all([
    store.getSettings(), store.getOrganiser(),
  ]);
  if (!isCurrent()) return;
  const role = settings.role;

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
        control: el('span.setting-value.setting-code', { text: settings.shareCode || '' }),
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
    ]));
  } else {
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

  /* Above Appearance and below each role's own sections: it is routine setup
   * about the household, not a preference of this device. */
  const code = role === 'simple' ? settings.shareCode : settings.supporterCode;
  if (code) app.appendChild(pillBoxSection(settings, code, organiser));

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

  /* Something on screen before the network is touched. Every other supporter
   * screen got this in Phase 2; this one was missed, so the previous screen
   * simply stayed put for the whole round trip -- and a failure threw out of
   * the view with nothing to explain it. */
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

  const slots = [...routine.slots].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  const schedules = routine.schedules;
  const errors = {};

  /* Archived medicines keep their schedules -- archiving hides a medicine, it
   * does not rewrite its routine -- so counting active schedules alone told
   * the person that removing a slot would affect medicines that stopped
   * appearing months ago. */
  const liveMedicines = new Set(routine.medicines.filter(m => !m.archived).map(m => m.id));
  const usageCount = slotId => schedules
    .filter(s => s.slotId === slotId && s.active && liveMedicines.has(s.medicineId)).length;

  /* Saving happens on blur and on picking a time -- no Save button -- so it
   * has to say something, or changing a slot time is indistinguishable from
   * changing nothing. Returns false rather than throwing: the callers are
   * event handlers, and a rejection there goes nowhere. */
  async function persist() {
    try {
      await supporter.saveSlots(code, slots);
      toast(S.saved);
      return true;
    } catch {
      toast(S.errGeneric);
      return false;
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

    // Schedules using the slot are deactivated server-side, never deleted:
    // dose_log rows point at them, and history must survive a routine change.
    slots.splice(slots.indexOf(slot), 1);
    if (await persist()) refresh();
    else draw();          // put the removed slot back on screen
  }

  function draw() {
    clear(app);
    app.appendChild(el('h1.page-title', { text: S.slotsTitle }));
    app.appendChild(el('p.page-sub', { text: S.slotsIntro }));

    for (const slot of slots) {
      const used = usageCount(slot.id);
      app.appendChild(section(null, [
        el('div.field-inline', [
          field({
            id: `slot-label-${slot.id}`,
            label: S.slotLabel,
            error: errors[`label-${slot.id}`],
            control: el('input', {
              type: 'text',
              id: `slot-label-${slot.id}`,
              value: slot.label,
              class: errors[`label-${slot.id}`] ? 'input-invalid' : '',
              oninput: e => { slot.label = e.target.value; },
              onchange: async e => {
                if (!e.target.value.trim()) {
                  errors[`label-${slot.id}`] = S.errSlotLabel;
                  draw();
                  return;
                }
                delete errors[`label-${slot.id}`];
                await persist();
              },
            }),
          }),
          field({
            id: `slot-time-${slot.id}`,
            label: S.slotTime,
            control: el('input', {
              type: 'time',
              id: `slot-time-${slot.id}`,
              value: slot.time,
              onchange: async e => {
                if (!e.target.value) return;
                slot.time = e.target.value;
                await persist();
                draw();   // re-sorts: slots are ordered by time
              },
            }),
          }),
        ]),
        el('p.field-hint', {
          text: used
            ? `${used} medicine ${used === 1 ? 'time uses' : 'times use'} this`
            : 'Not used by any medicine',
        }),
        slots.length > 1 ? el('button.btn-link', {
          type: 'button',
          text: S.removeSlot,
          onclick: () => removeSlot(slot),
        }) : null,
      ]));
    }

    app.appendChild(el('button.btn.btn-block', {
      type: 'button',
      text: S.addSlot,
      onclick: async () => {
        slots.push({
          id: null,
          label: 'New time',
          time: '12:00',
          order: slots.length + 1,
          builtIn: false,
        });
        if (await persist()) refresh();   // the server assigns the real id
        else { slots.pop(); draw(); }
      },
    }));

    app.appendChild(el('a.btn.btn-quiet.btn-block', {
      href: '#/settings', text: S.back, style: 'margin-top: 1rem;',
    }));
  }

  draw();
}
