/* Settings, in both modes.
 *
 * Simple mode: account (email, share code, rotate, sign out) and
 * notifications. Supporter mode: which household this device is connected
 * to, slot times, and a way to disconnect.
 *
 * Reached from the nav, not a hidden gesture.
 */

import * as store from '../store.js';
import * as auth from '../auth.js';
import * as supporter from '../supporter.js';
import * as pushLib from '../push.js';
import { S, APP_VERSION } from '../strings.js';
import { el, clear, section, toast, confirmDialog, field } from '../ui.js';
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

function actionRow({ label, hint, buttonLabel, onClick, primary = false }) {
  return el('div.setting-row', { style: 'flex-wrap: wrap;' }, [
    el('div.setting-main', [
      el('div.setting-label', { text: label }),
      hint ? el('div.setting-hint', { text: hint }) : null,
    ]),
    el(`button.btn${primary ? '.btn-primary' : ''}`, {
      type: 'button', text: buttonLabel, onclick: onClick,
    }),
  ]);
}

async function rotateCode() {
  const ok = await confirmDialog({
    title: S.settingsRotateCode, body: S.settingsRotateCodeConfirm,
    confirmLabel: S.settingsRotateCode, danger: true,
  });
  if (!ok) return;
  try {
    const code = await auth.rotateShareCode();
    await store.saveSettings({ shareCode: code });
    toast(S.settingsRotateCodeDone);
    refresh();
  } catch {
    toast(S.errGeneric);
  }
}

async function signOut() {
  const ok = await confirmDialog({
    title: S.settingsSignOut, body: S.settingsSignOutConfirm, confirmLabel: S.settingsSignOut, danger: true,
  });
  if (!ok) return;
  await auth.signOut();
  await store.saveSettings({ role: null, householdId: null, shareCode: null });
  window.location.replace('#/welcome');
  window.location.reload();
}

async function disconnect() {
  const ok = await confirmDialog({
    title: S.settingsDisconnect, body: S.settingsDisconnectConfirm, confirmLabel: S.settingsDisconnect, danger: true,
  });
  if (!ok) return;
  await store.saveSettings({ role: null, supporterCode: null, supporterHouseholdName: null });
  window.location.replace('#/welcome');
  window.location.reload();
}

async function toggleNotifications(householdId) {
  try {
    if (await pushLib.isSubscribed()) await pushLib.unsubscribe();
    else await pushLib.subscribe(householdId);
  } catch (err) {
    toast(err.message || S.errGeneric);
  }
  refresh();
}

// ---- the view -------------------------------------------------------------

export async function settingsView({ app }) {
  const settings = await store.getSettings();
  const role = settings.role;

  clear(app);
  app.appendChild(el('h1.page-title', { text: S.settingsTitle }));

  if (role === 'simple') {
    const session = await auth.getSession().catch(() => null);
    const notifOn = await pushLib.isSubscribed().catch(() => false);

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
      actionRow({ label: S.settingsSignOut, buttonLabel: S.settingsSignOut, onClick: signOut }),
    ]));

    app.appendChild(section(S.settingsNotifications, [
      actionRow({
        label: notifOn ? S.notificationsOnLabel : S.notificationsOffLabel,
        hint: S.notificationsHint,
        buttonLabel: notifOn ? S.notificationsTurnOff : S.notificationsTurnOn,
        primary: !notifOn,
        onClick: () => toggleNotifications(settings.householdId),
      }),
    ]));
  } else {
    app.appendChild(section(S.settingsConnection, [
      settingRow({
        label: S.settingsConnectedTo,
        control: el('span.setting-value', { text: settings.supporterHouseholdName || '' }),
      }),
      actionRow({
        label: S.settingsSlots,
        hint: S.slotsIntro,
        buttonLabel: S.settingsSlots,
        onClick: () => go('#/slots'),
      }),
      actionRow({
        label: S.settingsDisconnect,
        hint: S.settingsDisconnectHint,
        buttonLabel: S.settingsDisconnect,
        onClick: disconnect,
      }),
    ]));
  }

  app.appendChild(section(null, [
    settingRow({
      label: S.settingsVersion,
      control: el('span.setting-value', { text: APP_VERSION }),
    }),
  ]));
}

// ---- slot times (supporter) ----------------------------------------------

export async function slotsView({ app }) {
  const settings = await store.getSettings();
  const code = settings.supporterCode;
  const routine = await supporter.loadRoutine(code);
  const slots = [...routine.slots].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  const schedules = routine.schedules;
  const errors = {};

  const usageCount = slotId => schedules.filter(s => s.slotId === slotId && s.active).length;

  async function persist() {
    await supporter.saveSlots(code, slots);
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
    await persist();
    refresh();
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
                draw();
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
        await persist();
        refresh();     // server has now assigned a real id -- reload to pick it up
      },
    }));

    app.appendChild(el('a.btn.btn-quiet.btn-block', {
      href: '#/settings', text: S.back, style: 'margin-top: 1rem;',
    }));
  }

  draw();
}
