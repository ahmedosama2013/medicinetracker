/* Settings, in both dialects.
 *
 * The elder's is the ONLY elder screen that scrolls by design, and it holds
 * exactly four things - account and code, reminders, how it looks, about -
 * plus the two ways out at the bottom. No medicine administration: a role
 * switcher or a medicine list here is a trap for the person taking the pills,
 * one wrong tap from an admin app.
 *
 * "Change role" survives as a small underlined link at the very bottom, below
 * sign-out, rather than as a settings row. It is an escape hatch, not a
 * setting.
 *
 * The helper's is the same architecture at their density, and adds the things
 * only they can change: the connection, their own alerts, and the household's
 * times of day.
 */

import * as store from '../store.js';
import * as supporter from '../supporter.js';

/* Loaded on use rather than at the top.
 *
 * auth.js and push.js reach js/supabase.js and therefore the full Supabase
 * client -- auth, realtime, storage -- which a supporter device can use none
 * of. Settings is registered as a route at boot like every other view, so a
 * static import here meant every supporter downloaded the whole auth stack to
 * render a screen whose account section they never see.
 *
 * supporter-push.js is the one exception: it is reached from the supporter
 * branch on purpose and imports only the code-gated client. */
const authLib = () => import('../auth.js');
const pushLib = () => import('../push.js');
const supporterPushLib = () => import('../supporter-push.js');

import { S, APP_VERSION, firstNameOf } from '../strings.js';
import {
  el, mount, screen, clear, toast, confirmDialog, field, applyTheme,
  loadingState, codeCard, paintTone, TONE, settingsGroup, supGroup, organizerChoice,
} from '../ui.js';
import { timeToMinutes } from '../date.js';
import { go } from '../router.js';

/* Three states, not a switch: "match system" is the default and has to stay
 * expressible, and a two-position toggle cannot say it. */
const THEMES = [
  { value: 'system', label: () => S.themeSystem },
  { value: 'light', label: () => S.themeLight },
  { value: 'dark', label: () => S.themeDark },
];

/* Values are the exact text Postgres hands back for these four intervals, so
 * "is this chip selected" is a plain string comparison. */
const DEFAULT_ESCALATION_AFTER = '01:00:00';
const ESCALATION_DELAYS = [
  { value: '00:30:00', label: () => S.escalationDelay30m },
  { value: DEFAULT_ESCALATION_AFTER, label: () => S.escalationDelay1h },
  { value: '02:00:00', label: () => S.escalationDelay2h },
  { value: '03:00:00', label: () => S.escalationDelay3h },
];

/** Disable a button and show it working. */
function busy(button, label = S.loading) {
  button.disabled = true;
  clear(button);
  button.appendChild(el('span.spinner', { 'aria-hidden': 'true' }));
  button.appendChild(el('span', { text: label }));
}

/** Undo busy(): back to enabled, plain text. */
function unbusy(button, label) {
  button.disabled = false;
  clear(button);
  button.appendChild(el('span', { text: label }));
}

// ---- destructive actions --------------------------------------------------

/* Every one of these names its consequence and names its action. The confirm
 * button says what will happen ("Make a new code", "Sign out"); the cancel
 * button says the alternative ("Keep this code", "Stay signed in"). Never
 * "OK / Cancel". */

async function signOut() {
  const ok = await confirmDialog({
    title: S.signOutTitle,
    body: S.signOutBody,
    confirmLabel: S.signOutConfirm,
    cancelLabel: S.signOutCancel,
    danger: true,
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

async function disconnect(name) {
  const ok = await confirmDialog({
    title: S.settingsDisconnectTitle(name),
    body: S.settingsDisconnectBody,
    confirmLabel: S.settingsDisconnectConfirm,
    cancelLabel: S.settingsDisconnectCancel,
    danger: true,
  });
  if (!ok) return;
  await store.clearHouseholdData().catch(() => {});
  await store.saveSettings({ role: null, supporterCode: null, supporterHouseholdName: null });
  window.location.replace('#/welcome');
  window.location.reload();
}

// ---- the elder's Settings -------------------------------------------------

export async function settingsView({ app, isCurrent = () => true }) {
  const settings = await store.getSettings();
  if (!isCurrent()) return;
  if (settings.role === 'supporter') return supporterSettings({ app, isCurrent, settings });
  return elderSettings({ app, isCurrent, settings });
}

/* Shared by both dialects' Settings, same as supporter.setSlotInBox above it:
 * the elder's device holds the household's own share code, so it reaches the
 * same code-gated write a supporter does, and there is one handler instead of
 * an elder-only and a supporter-only twin. Optimistic, with a revert on
 * failure -- the same shape as the box-times toggle in organiser.js. */
async function selectUsesOrganizer(settings, value, draw) {
  const code = settings.role === 'supporter' ? settings.supporterCode : settings.shareCode;
  const previous = settings.usesOrganizer !== false;
  if (previous === value) return;
  settings.usesOrganizer = value;
  draw();
  try {
    if (settings.role !== 'supporter') {
      /* The elder's own write comes back as a Realtime UPDATE on this same
       * household row a moment later. Without this, that echo re-ran
       * Settings from a blank loadingState() right after the tap -- see the
       * matching comment in js/sync.js. */
      const sync = await import('../sync.js');
      sync.markRoutineWrite(settings.householdId);
    }
    await supporter.setUsesOrganizer(code, value);
    await store.saveSettings({ usesOrganizer: value });

    /* The tab bar is only ever drawn once per navigation, from js/main.js's
     * render hook -- it does not repaint itself just because this screen
     * changed something underneath it. Rather than leave the "Fill the
     * Organizer" tab wrong until whichever screen the person happens to open
     * next, ask for the one thing that is guaranteed to catch it up. */
    const shouldRefresh = await confirmDialog({
      title: S.organizerRefreshTitle,
      body: S.organizerRefreshBody,
      confirmLabel: S.organizerRefreshConfirm,
      cancelLabel: S.organizerRefreshLater,
    });
    if (shouldRefresh) window.location.reload();
  } catch {
    settings.usesOrganizer = previous;
    toast(S.errGeneric);
    draw();
  }
}

function themeList(current, onSelect) {
  return el('div.scard.scard-flush', THEMES.map(t => {
    const selected = (current || 'system') === t.value;
    return el('button.theme-row', {
      type: 'button',
      'aria-pressed': String(selected),
      onclick: () => onSelect(t.value),
    }, [
      el('span.theme-glyph', { 'aria-hidden': 'true', text: selected ? '✓' : '' }),
      el('span', { text: t.label() }),
    ]);
  }));
}

async function elderSettings({ app, isCurrent, settings }) {
  mount(app, screen({
    head: el('div.title-bar', [el('h1.page-title', { text: S.settingsTitle })]),
    scroll: loadingState(),
  }));

  /* Both are network calls, and isSubscribed also waits on the service worker.
   * This screen used to sit as a bare heading for as long as they took, and
   * forever if the worker never activated. */
  const [auth, push] = await Promise.all([authLib(), pushLib()]);
  const [session, notifState] = await Promise.all([
    auth.getSession().catch(() => null),
    push.isSubscribed().catch(() => null),
  ]);
  if (!isCurrent()) return;

  const blocked = typeof Notification !== 'undefined' && Notification.permission === 'denied';
  /* Mutable: the three actions below update this and redraw locally rather
   * than re-running this whole function, which would flash back to
   * loadingState() and re-fetch the session and push state for no reason. */
  let remState = blocked ? 'blocked' : (notifState === true ? 'on' : notifState === false ? 'off' : 'unknown');

  const email = session?.user?.email || '';
  const displayName = auth.fullNameFromSession(session) || (email ? email.split('@')[0] : '');

  /* Turning them ON goes through a dialog first, because the very next thing
   * the person sees is the browser's own permission prompt - and an
   * unexplained system prompt is the single easiest thing in the app to
   * dismiss by accident, after which reminders cannot be asked for again.
   * Turning them OFF is immediate: it has no consequence outside the phone. */
  async function toggleReminders(button) {
    if (remState === 'on') {
      busy(button);
      try {
        await (await pushLib()).unsubscribe();
        remState = 'off';
      } catch (err) {
        toast(err.message || S.errGeneric);
      }
      draw();
      return;
    }

    const ok = await confirmDialog({
      title: S.remindersAllowTitle,
      body: S.remindersAllowBody,
      confirmLabel: S.remindersAllowConfirm,
      cancelLabel: S.remindersNotNow,
    });
    if (!ok) return;
    busy(button);
    try {
      await (await pushLib()).subscribe(settings.householdId);
      remState = 'on';
    } catch (err) {
      toast(err.message || S.errGeneric);
    }
    draw();
  }

  async function sendTestReminder(button) {
    busy(button, S.loading);
    try {
      await (await pushLib()).testNotification();
      toast(S.remindersTestSent);
    } catch {
      toast(S.remindersTestFailed);
    }
    unbusy(button, S.remindersTest);
  }

  async function rotateCode(button) {
    const ok = await confirmDialog({
      title: S.rotateTitle,
      body: S.rotateBody(settings.shareCode),
      confirmLabel: S.rotateConfirm,
      cancelLabel: S.rotateCancel,
      danger: true,
    });
    if (!ok) return;
    busy(button);
    try {
      const code = await (await authLib()).rotateShareCode();
      await store.saveSettings({ shareCode: code });
      settings.shareCode = code;
    } catch {
      toast(S.errGeneric);
    }
    draw();
  }

  function draw() {
    const remTone = remState === 'on' ? TONE.done
      : remState === 'off' ? TONE.wait
        : { ...TONE.wait, fg: 'var(--amber-ink)', bg: 'var(--amber-tint)', glyph: '!' };
    const remGlyph = remState === 'on' ? '✓' : remState === 'off' ? '○' : '!';
    const remStatus = remState === 'on' ? S.remindersOn
      : remState === 'off' ? S.remindersOff : S.remindersBlocked;
    const remNote = remState === 'on' ? S.remindersOnNote
      : remState === 'off' ? S.remindersOffNote : S.remindersBlockedNote;

    const remToggle = el(`button.btn.${remState === 'on' ? 'btn-quiet' : 'btn-primary'}.btn-block`, {
      type: 'button',
      text: remState === 'on' ? S.remindersTurnOff : S.remindersTurnOn,
      style: 'min-height: 58px',
    });
    remToggle.addEventListener('click', () => toggleReminders(remToggle));

    const remTest = el('button.btn.btn-green-outline.btn-block', {
      type: 'button', text: S.remindersTest, style: 'min-height: 52px; font-size: 17px',
    });
    remTest.addEventListener('click', () => sendTestReminder(remTest));

    const rotateBtn = el('button.btn-dashed-amber', { type: 'button', text: S.settingsMakeNewCode });
    rotateBtn.addEventListener('click', () => rotateCode(rotateBtn));

    mount(app, screen({
      head: el('div.title-bar', [el('h1.page-title', { text: S.settingsTitle })]),
      scroll: el('div.settings-scroll', [

        settingsGroup(S.settingsYourAccount, [
          el('div.scard', { style: 'gap: 6px' }, [
            displayName ? el('span.account-name', { text: displayName }) : null,
            el('span.account-email', { text: email }),
          ]),
          settings.shareCode
            ? codeCard(settings.shareCode, { size: 'sm', extra: rotateBtn })
            : null,
        ]),

        settingsGroup(S.settingsRemindersSection, [
          el('div.scard', [
            paintTone(el('div.status-pill', [
              el('span.status-pill-ring', { 'aria-hidden': 'true', text: remGlyph }),
              el('span.status-pill-text', { text: remStatus }),
            ]), remTone),
            el('span.scard-note', { text: remNote }),
            remState === 'blocked' ? null : remToggle,
            remState === 'on' ? remTest : null,
          ]),
        ]),

        settingsGroup(S.settingsOrganizerSection, [
          el('p.scard-note', { text: S.organizerQuestionNote }),
          organizerChoice(settings.usesOrganizer, value => selectUsesOrganizer(settings, value, draw)),
        ]),

        settingsGroup(S.settingsHowItLooks, themeList(settings.theme, async value => {
          await store.saveSettings({ theme: value });
          settings.theme = value;
          applyTheme(value);
          draw();
        })),

        settingsGroup(S.settingsAboutSection, [
          el('div.scard', { style: 'gap: 8px' }, [
            el('span.about-line', { text: S.aboutBuild(APP_VERSION) }),
            el('span.about-body', { text: S.aboutDisclaimer }),
            el('a.btn-link', {
              href: '#/how?from=%23%2Fsettings',
              text: S.howItWorks,
              style: 'align-self: flex-start; min-height: 48px; padding: 0',
            }),
          ]),
        ]),

        el('button.signout-btn', { type: 'button', text: S.settingsSignOutAction, onclick: signOut }),
      ]),
    }));
  }

  draw();
}

// ---- the helper's Settings ------------------------------------------------

async function supporterSettings({ app, isCurrent, settings }) {
  const code = settings.supporterCode;
  const name = firstNameOf(settings.supporterHouseholdName);

  mount(app, screen({
    head: el('div.s-head', [el('h1.s-title', { text: S.settingsTitle })]),
    scroll: loadingState(),
  }));

  const push = await supporterPushLib();
  const notifState = await push.isSubscribed(code).catch(() => null);
  if (!isCurrent()) return;

  let notifOn = !!notifState;
  const notifUnknown = notifState === null;
  let currentDelay = (notifOn && notifState.escalationAfter) || DEFAULT_ESCALATION_AFTER;

  const [slots] = await Promise.all([store.getSlots().catch(() => [])]);
  if (!isCurrent()) return;

  async function toggleAlerts(button) {
    busy(button);
    try {
      if (notifOn) await push.unsubscribe(code);
      else await push.subscribe(code, DEFAULT_ESCALATION_AFTER);
      notifOn = !notifOn;
      if (notifOn) currentDelay = DEFAULT_ESCALATION_AFTER;
    } catch (err) {
      toast(err.message || S.errGeneric);
    }
    draw();
  }

  async function setEscalation(value) {
    try {
      await push.setEscalation(code, value);
      currentDelay = value;
    } catch {
      toast(S.errGeneric);
    }
    draw();
  }

  function draw() {
    const alertsBtn = el('button.btn-s.btn-nav-outline', {
      type: 'button',
      text: S.supporterNotificationsChange,
      style: 'border-radius: 999px; min-height: 40px; padding: 8px 14px; font-size: 13px',
    });
    alertsBtn.addEventListener('click', () => toggleAlerts(alertsBtn));

    mount(app, screen({
      head: el('div.s-head', [el('h1.s-title', { text: S.settingsTitle })]),
      scroll: el('div.s-settings', [

        supGroup(S.settingsConnection, [
          el('div.s-card', [
            el('span.s-card-title', { text: S.settingsConnectedTo(name) }),
            el('span.s-card-note', { text: S.settingsConnectedWith(code || '') }),
            el('button.btn-s.btn-danger-outline', {
              type: 'button', text: S.settingsDisconnect, onclick: () => disconnect(name),
            }),
          ]),
        ]),

        supGroup(S.settingsYourAlerts, [
          el('div.s-card', { style: 'gap: 12px' }, [
            el('div.s-row', [
              el('span.s-row-main', [
                el('span.s-row-label', { text: S.supporterNotificationsLabel }),
                el('span.s-row-hint', {
                  text: notifUnknown ? S.supporterNotificationsUnknown : S.supporterNotificationsHint,
                }),
              ]),
              alertsBtn,
            ]),
            el('span.s-row-hint', {
              text: `${notifOn ? S.supporterNotificationsOn : S.supporterNotificationsOff}`,
              style: 'font-weight: 700',
            }),
            /* Only offered once the alerts are on: picking a delay for a
             * notification that will never arrive is a setting with nothing to
             * control. */
            notifOn ? el('span.field-label', { text: S.escalationDelayLabel }) : null,
            notifOn ? el('div.chips', ESCALATION_DELAYS.map(d => el('button.chip', {
              type: 'button',
              text: d.label(),
              'aria-pressed': String(currentDelay === d.value),
              onclick: () => setEscalation(d.value),
            }))) : null,
          ]),
        ]),

        supGroup(S.settingsHousehold, [
          el('a.s-linkrow', { href: '#/slots' }, [
            el('span.s-row-main', [
              el('span.s-row-label', { text: S.slotsTitle }),
              el('span.s-row-hint', {
                text: slots.map(s => s.label).join(', ') || S.slotsIntro,
              }),
            ]),
            el('span.s-linkrow-chev', { 'aria-hidden': 'true', text: '›' }),
          ]),
        ]),

        supGroup(S.settingsOrganizerSection, [
          el('p.s-card-note', { text: S.organizerQuestionNote }),
          organizerChoice(settings.usesOrganizer, value => selectUsesOrganizer(settings, value, draw), { dense: true }),
        ]),

        supGroup(S.settingsAppearance, [
          el('div.s-card.s-card-flush', el('div.s-themebar', THEMES.map(t => el('button.theme-seg', {
            type: 'button',
            text: t.label(),
            'aria-pressed': String((settings.theme || 'system') === t.value),
            onclick: async () => {
              await store.saveSettings({ theme: t.value });
              settings.theme = t.value;
              applyTheme(t.value);
              draw();
            },
          })))),
        ]),

        supGroup(S.settingsAboutSection, [
          el('div.s-card', { style: 'gap: 6px' }, [
            el('span.s-card-note', { text: S.aboutBuild(APP_VERSION) }),
            el('span.s-card-note', { text: S.aboutDisclaimerSupporter }),
            el('a.btn-s', {
              href: '#/how?from=%23%2Fsettings',
              text: S.howItWorks,
              style: 'border: none; background: none; color: var(--navy); text-decoration: underline; align-self: flex-start; padding: 0; min-height: 40px; font-size: 13px',
            }),
          ]),
        ]),
      ]),
    }));
  }

  draw();
}

// ---- times of day (supporter) --------------------------------------------

/* These are the words the person taking the medicines reads on their Today
 * screen, and the compartments of the physical pill box. Removing one names
 * how many medicine schedules use it, because that is the consequence and it
 * is invisible from this screen otherwise.
 */
export async function slotsView({ app, isCurrent = () => true }) {
  const settings = await store.getSettings();
  const code = settings.supporterCode;

  const shell = body => screen({
    head: el('div.s-formbar', [
      el('a.s-formbar-cancel', { href: '#/settings', text: S.back }),
      el('span.s-formbar-title', { text: S.slotsTitle }),
      saveButton,
    ]),
    scroll: body,
  });

  let saveButton = el('button.btn-s.btn-primary', { type: 'button', text: S.save });

  mount(app, shell(loadingState()));

  let routine;
  try {
    routine = await supporter.loadRoutine(code);
  } catch {
    if (!isCurrent()) return;
    mount(app, shell(el('div.s-empty', [
      el('p.s-empty-title', { text: S.errGeneric }),
      el('p.s-empty-body', { text: S.pairConnectionError }),
    ])));
    return;
  }
  if (!isCurrent()) return;

  // A draft. Changing an input never writes or reorders the page beneath the
  // finger; the one Save action makes the consequence explicit.
  const slots = [...routine.slots]
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time))
    .map(slot => ({ ...slot, draftKey: slot.id }));
  const schedules = routine.schedules;
  const errors = {};
  let saving = false;

  const liveMedicines = new Set(routine.medicines.filter(m => !m.archived).map(m => m.id));
  const usageCount = slotId => schedules
    .filter(s => s.slotId === slotId && s.active && liveMedicines.has(s.medicineId)).length;

  async function save() {
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
    busy(saveButton, S.saving);
    try {
      await supporter.saveSlots(code, slots.map(({ draftKey, ...slot }) => slot));
      toast(S.slotsSavedToast);
      go('#/settings');
    } catch {
      saving = false;
      toast(S.errGeneric);
      draw();
    }
  }

  /* Names the consequence and names the action: "3 medicine schedules use
   * Morning…" with "Remove Morning" / "Keep it". Never "Are you sure?". */
  async function removeSlot(slot) {
    if (slots.length === 1) { toast(S.slotKeepOne); return; }
    const used = usageCount(slot.id);
    const ok = await confirmDialog({
      title: S.slotRemoveTitle(slot.label),
      body: S.slotRemoveBody(slot.label, used),
      confirmLabel: S.slotRemoveConfirm(slot.label),
      cancelLabel: S.keepIt,
      danger: true,
    });
    if (!ok) return;
    slots.splice(slots.indexOf(slot), 1);
    toast(S.slotRemovedToast(slot.label));
    draw();
  }

  function draw() {
    saveButton = el('button.btn-s.btn-primary', { type: 'button', text: S.save, onclick: save });

    mount(app, screen({
      head: el('div.s-formbar', [
        el('a.s-formbar-cancel', { href: '#/settings', text: S.back }),
        el('span.s-formbar-title', { text: S.slotsTitle }),
        saveButton,
      ]),
      scroll: el('div.s-form', [
        el('p.s-card-note', { text: S.slotsIntro }),

        ...slots.map(slot => el('div.s-timerow', [
          el('div.field-inline', [
            el('div.field', { style: 'flex: 1.2' }, [
              el('label.field-label', { for: `slot-label-${slot.draftKey}`, text: S.slotLabel }),
              el('input', {
                type: 'text',
                id: `slot-label-${slot.draftKey}`,
                value: slot.label,
                class: errors[`label-${slot.draftKey}`] ? 'input-invalid' : '',
                style: 'font-weight: 600',
                oninput: e => {
                  slot.label = e.target.value;
                  delete errors[`label-${slot.draftKey}`];
                },
              }),
              errors[`label-${slot.draftKey}`]
                ? el('p.field-error', { text: errors[`label-${slot.draftKey}`] })
                : null,
            ]),
            field({
              id: `slot-time-${slot.draftKey}`,
              label: S.slotTime,
              control: el('input', {
                type: 'time',
                id: `slot-time-${slot.draftKey}`,
                value: slot.time,
                oninput: e => { slot.time = e.target.value; },
              }),
            }),
          ]),
          el('div.s-timerow-foot', [
            el('span.s-timerow-uses', { text: S.slotUses(usageCount(slot.id)) }),
            el('button.btn-s.btn-s-xs.btn-danger-outline', {
              type: 'button', text: S.removeSlot, onclick: () => removeSlot(slot),
            }),
          ]),
        ])),

        el('button.btn-s.btn-dashed', {
          type: 'button',
          text: S.addSlot,
          style: 'min-height: 48px',
          onclick: () => {
            slots.push({
              id: null,
              draftKey: `new-${slots.length}-${slots.reduce((a, s) => a + s.label.length, 0)}`,
              label: 'New time',
              time: '12:00',
              order: slots.length + 1,
              builtIn: false,
            });
            toast(S.slotAddedToast);
            draw();
          },
        }),
        el('span.s-archived-note', { text: S.slotKeepOne }),
      ]),
    }), { keepScroll: true });
  }

  draw();
}
