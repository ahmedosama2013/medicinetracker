/* Settings, in both modes.
 *
 * Simple mode gets four items and nothing else: get the list, save a copy,
 * change mode, version. Supporter mode gets the slot times and the hand-off.
 *
 * Reached from the nav, not a hidden gesture. The person who needs the
 * supporter side is a relative visiting occasionally, and nobody will tell
 * them the trick.
 */

import * as store from '../store.js';
import * as backup from '../backup.js';
import * as merge from '../merge.js';
import { S, APP_VERSION } from '../strings.js';
import {
  el, clear, section, toast, confirmDialog, alertDialog, field, pickFile,
} from '../ui.js';
import { timeToMinutes, formatDate } from '../date.js';
import { go, refresh } from '../router.js';
import { uuid } from '../db.js';

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

// ---- export / import ------------------------------------------------------

async function doExport() {
  try {
    const result = await backup.exportToFile();
    if (result.empty) { toast(S.exportEmpty); return; }
    toast(S.exportDone);
    if (result.big) await alertDialog({ title: S.exportDone, body: S.exportBig });
  } catch {
    toast(S.errGeneric);
  }
}

async function doImport(role) {
  // The extension must be listed: iOS Safari greys out .json files when only
  // the MIME type is given, leaving an unselectable filename on screen.
  const file = await pickFile('.json,application/json');
  if (!file) return;

  let result;
  try {
    result = await backup.inspectFile(file);
  } catch {
    await alertDialog({ title: S.errGeneric, body: S.errImportRead });
    return;
  }

  if (!result.ok) {
    const body = result.error === merge.ERR.version ? S.errImportVersion
      : result.error === merge.ERR.slots ? S.errImportSlots
        : S.errImportShape;
    await alertDialog({ title: S.errGeneric, body });
    return;
  }

  const ok = await confirmDialog({
    title: role === 'simple' ? S.importTitleSimple : S.importTitleSupporter,
    body: [
      el('p', { text: S.importCounts(result.counts) }),
      el('p', { text: S.importKeepsHistory }),
    ],
    confirmLabel: S.importAccept,
    cancelLabel: S.importReject,
  });
  if (!ok) return;

  try {
    await backup.applyImport(result.data);
    toast(S.importDone);
    refresh();
  } catch {
    await alertDialog({ title: S.errGeneric, body: S.errImportRead });
  }
}

async function changeMode(current) {
  const next = current === 'simple' ? 'supporter' : 'simple';
  const ok = await confirmDialog({
    title: S.settingsMode,
    body: next === 'simple' ? S.roleSimple : S.roleSupporter,
    confirmLabel: S.confirm,
  });
  if (!ok) return;
  await store.saveSettings({ role: next });
  // Everything downstream of the mode - navigation, route ownership, the type
  // scale - is decided at boot, so reload rather than re-theme in place.
  window.location.replace('#/');
  window.location.reload();
}

// ---- the view -------------------------------------------------------------

export async function settingsView({ app }) {
  const settings = await store.getSettings();
  const role = settings.role;

  clear(app);
  app.appendChild(el('h1.page-title', { text: S.settingsTitle }));

  if (role === 'simple') {
    app.appendChild(section(null, [
      actionRow({
        label: S.settingsImportSimple,
        hint: S.settingsImportSimpleHint,
        buttonLabel: S.importPick,
        primary: true,
        onClick: () => doImport(role),
      }),
      actionRow({
        label: S.settingsExportSimple,
        hint: S.settingsExportSimpleHint,
        buttonLabel: S.save,
        onClick: doExport,
      }),
    ]));
  } else {
    app.appendChild(section(null, [
      actionRow({
        label: S.settingsExportSupporter,
        hint: S.settingsExportSupporterHint,
        buttonLabel: S.save,
        primary: true,
        onClick: doExport,
      }),
      actionRow({
        label: S.settingsImportSupporter,
        hint: S.settingsImportSupporterHint,
        buttonLabel: S.importPick,
        onClick: () => doImport(role),
      }),
      actionRow({
        label: S.settingsSlots,
        hint: S.slotsIntro,
        buttonLabel: S.settingsSlots,
        onClick: () => go('#/slots'),
      }),
    ]));
  }

  // Stated plainly, because the absence of notifications is the one thing
  // about this app that could be mistaken for a fault.
  app.appendChild(el('div.note', [
    el('strong', { text: S.noRemindersTitle }),
    el('p', { text: S.noRemindersBody }),
  ]));

  app.appendChild(section(null, [
    actionRow({
      label: S.settingsMode,
      hint: S.settingsModeNow(role),
      buttonLabel: S.confirm,
      onClick: () => changeMode(role),
    }),
    settingRow({
      label: S.settingsStorage,
      hint: settings.storagePersisted ? S.storagePersisted : S.storageNotPersisted,
    }),
    settings.lastImportAt ? settingRow({
      label: 'Last update received',
      control: el('span.setting-value', {
        text: formatDate(settings.lastImportAt.slice(0, 10), S.monthNames),
      }),
    }) : null,
    settingRow({
      label: S.settingsVersion,
      control: el('span.setting-value', { text: APP_VERSION }),
    }),
  ]));
}

// ---- slot times (supporter) ----------------------------------------------

export async function slotsView({ app }) {
  const settings = await store.getSettings();
  const schedules = await store.getSchedules();
  const slots = [...settings.slots].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  const errors = {};

  const usageCount = slotId => schedules.filter(s => s.slotId === slotId && s.active).length;

  async function persist() {
    await store.saveSettings({ slots });
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

    // Schedules using the slot are deactivated, never deleted: doseLog rows
    // point at them, and history must survive a routine change.
    for (const schedule of schedules.filter(s => s.slotId === slot.id && s.active)) {
      await store.deactivateSchedule(schedule.id);
    }
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
          id: `slot-${uuid().slice(0, 8)}`,
          label: 'New time',
          time: '12:00',
          order: slots.length + 1,
          builtIn: false,
        });
        await persist();
        draw();
      },
    }));

    app.appendChild(el('a.btn.btn-quiet.btn-block', {
      href: '#/settings', text: S.back, style: 'margin-top: 1rem;',
    }));
  }

  draw();
}
