/* Supporter: add or edit a medicine, WITH its schedule, in one form.
 *
 * The medicine and its times are deliberately not two screens. A medicine that
 * exists but is scheduled nowhere appears on no Today screen and in no
 * calendar, and the supporter has no way to notice - it is a dead state that
 * looks exactly like success. So: no save without at least one time.
 *
 * Every write here goes through supporter.js (code-gated Supabase calls, no
 * local cache) and requires connectivity -- unlike the elder's device, this
 * one is never used offline.
 */

import * as store from '../store.js';
import * as supporter from '../supporter.js';
import * as photosLib from '../photos.js';
import { S } from '../strings.js';
import { el, clear, field, section, toast } from '../ui.js';
import { todayStr, formatTime } from '../date.js';
import { go } from '../router.js';
import { archiveMedicine } from './medicines.js';

let previewToken = null;

function releasePreview() {
  if (previewToken !== null) {
    photosLib.release(previewToken);
    previewToken = null;
  }
}

const blankSchedule = slots => ({
  id: null,
  slotId: slots[0]?.id || 'morning',
  time: '',
  frequency: { type: 'daily', interval: 2, daysOfWeek: [], anchorDate: todayStr() },
});

export async function medicineFormView({ app, query }) {
  const id = query.get('id');
  const settings = await store.getSettings();
  const code = settings.supporterCode;

  let routine;
  try {
    routine = await supporter.loadRoutine(code);
  } catch {
    clear(app);
    app.appendChild(el('p.note', { text: S.pairCodeInvalid }));
    return;
  }

  const { slots } = routine;
  const existing = id ? routine.medicines.find(m => m.id === id) : null;
  const existingSchedules = id ? routine.schedules.filter(s => s.medicineId === id) : [];

  // Working copy: nothing is written until Save.
  const draft = {
    id: existing?.id || null,
    name: existing?.name || '',
    strength: existing?.strength || '',
    dosage: existing?.dosage || '',
    form: existing?.form || 'tablet',
    notes: existing?.notes || '',
    archived: existing?.archived || false,
  };

  let photoUrl = null;
  if (existing?.photoPath) {
    photoUrl = await supporter.getPhotoUrl(code, existing.id).catch(() => null);
  }
  let photoBlob = null;      // a freshly picked, not-yet-saved photo
  let photoDirty = false;

  const schedules = existingSchedules.filter(s => s.active).map(s => ({
    id: s.id,
    slotId: s.slotId,
    time: s.time || '',
    frequency: {
      type: s.frequency?.type || 'daily',
      interval: s.frequency?.interval || 2,
      daysOfWeek: s.frequency?.daysOfWeek || [],
      anchorDate: s.frequency?.anchorDate || todayStr(),
    },
  }));
  if (!schedules.length) schedules.push(blankSchedule(slots));

  const errors = {};

  // ---- rendering ---------------------------------------------------------

  function textField(key, label, placeholder, { required = false } = {}) {
    const input = el('input', {
      type: 'text',
      id: `f-${key}`,
      value: draft[key],
      placeholder: placeholder || '',
      class: errors[key] ? 'input-invalid' : '',
      autocomplete: 'off',
      oninput: e => { draft[key] = e.target.value; },
    });
    return field({
      id: `f-${key}`, label, control: input, error: errors[key],
      hint: required ? null : null,
    });
  }

  function photoField() {
    releasePreview();
    let preview;
    if (photoBlob) {
      const { url, token } = photosLib.objectUrl(photoBlob);
      previewToken = token;
      preview = el('span.photo-preview', el('img', { src: url, alt: '' }));
    } else if (photoUrl) {
      preview = el('span.photo-preview', el('img', { src: photoUrl, alt: '' }));
    } else {
      preview = el('span.photo-preview', { text: S.noPhoto });
    }

    // A live input element, because programmatic .click() on a detached input
    // is unreliable on iOS for camera capture.
    const input = el('input', {
      type: 'file',
      accept: 'image/*',
      capture: 'environment',
      hidden: true,
      id: 'f-photo',
      onchange: async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          photoBlob = await photosLib.compress(file);
          photoUrl = null;
          photoDirty = true;
          draw();
        } catch {
          toast(S.errPhotoFailed);
        }
      },
    });

    return field({
      label: S.fieldPhoto,
      hint: S.photoOptional,
      control: el('div.photo-picker', [
        preview,
        input,
        el('div.btn-row', [
          el('button.btn', {
            type: 'button',
            text: (photoBlob || photoUrl) ? S.retakePhoto : S.takePhoto,
            onclick: () => input.click(),
          }),
          (photoBlob || photoUrl) ? el('button.btn.btn-quiet', {
            type: 'button',
            text: S.removePhoto,
            onclick: () => { photoBlob = null; photoUrl = null; photoDirty = true; draw(); },
          }) : null,
        ]),
      ]),
    });
  }

  function scheduleCard(entry, index) {
    const slot = slots.find(s => s.id === entry.slotId) || slots[0];
    const freq = entry.frequency;

    const slotSelect = el('select', {
      id: `s-slot-${index}`,
      onchange: e => { entry.slotId = e.target.value; draw(); },
    }, slots.map(s => el('option', {
      value: s.id, text: `${s.label} (${formatTime(s.time)})`, selected: s.id === entry.slotId,
    })));

    const timeInput = el('input', {
      type: 'time',
      id: `s-time-${index}`,
      value: entry.time || '',
      oninput: e => { entry.time = e.target.value; },
    });

    const typeSelect = el('select', {
      id: `s-freq-${index}`,
      onchange: e => { freq.type = e.target.value; draw(); },
    }, [
      el('option', { value: 'daily', text: S.freqDaily, selected: freq.type === 'daily' }),
      el('option', { value: 'everyNDays', text: S.freqEveryNDays, selected: freq.type === 'everyNDays' }),
      el('option', { value: 'weekly', text: S.freqWeekly, selected: freq.type === 'weekly' }),
    ]);

    const extras = [];
    if (freq.type === 'everyNDays') {
      extras.push(el('div.field-inline', [
        field({
          id: `s-int-${index}`,
          label: `${S.freqInterval} … ${S.freqIntervalUnit}`,
          control: el('input', {
            type: 'number', min: '2', max: '90', id: `s-int-${index}`,
            value: String(freq.interval || 2),
            oninput: e => { freq.interval = Number(e.target.value); },
          }),
        }),
        field({
          id: `s-anchor-${index}`,
          label: S.freqAnchor,
          error: errors[`anchor-${index}`],
          // Mandatory: without a date to count from there is no way to know
          // whether today is an "on" day.
          control: el('input', {
            type: 'date', id: `s-anchor-${index}`,
            value: freq.anchorDate || todayStr(),
            class: errors[`anchor-${index}`] ? 'input-invalid' : '',
            oninput: e => { freq.anchorDate = e.target.value; },
          }),
        }),
      ]));
    }
    if (freq.type === 'weekly') {
      extras.push(field({
        label: S.freqDaysOfWeek,
        error: errors[`days-${index}`],
        control: el('div.chips', S.weekdayNames.map((name, dayIndex) => el('button.chip', {
          type: 'button',
          'aria-pressed': freq.daysOfWeek.includes(dayIndex) ? 'true' : 'false',
          text: name.slice(0, 3),
          onclick: () => {
            const at = freq.daysOfWeek.indexOf(dayIndex);
            if (at === -1) freq.daysOfWeek.push(dayIndex);
            else freq.daysOfWeek.splice(at, 1);
            draw();
          },
        }))),
      }));
    }

    return el('div.sched', [
      el('div.sched-head', [
        el('span.sched-num', { text: `${index + 1}` }),
        schedules.length > 1 ? el('button.btn-link', {
          type: 'button',
          text: S.removeSchedule,
          onclick: () => { schedules.splice(index, 1); draw(); },
        }) : null,
      ]),
      field({ id: `s-slot-${index}`, label: S.scheduleSlot, control: slotSelect }),
      field({
        id: `s-time-${index}`,
        label: S.scheduleTime,
        control: timeInput,
        hint: entry.time ? null : S.scheduleTimeDefault(formatTime(slot.time)),
      }),
      field({ id: `s-freq-${index}`, label: S.scheduleFrequency, control: typeSelect }),
      ...extras,
    ]);
  }

  function draw() {
    clear(app);
    app.appendChild(el('h1.page-title', { text: existing ? S.editMedicine : S.newMedicine }));

    app.appendChild(section(null, [
      textField('name', S.fieldName, S.fieldNamePlaceholder, { required: true }),
      el('div.field-inline', [
        textField('strength', S.fieldStrength, S.fieldStrengthPlaceholder),
        textField('dosage', S.fieldDosage, S.fieldDosagePlaceholder),
      ]),
      field({
        id: 'f-form',
        label: S.fieldForm,
        control: el('select', {
          id: 'f-form',
          onchange: e => { draft.form = e.target.value; },
        }, store.MEDICINE_FORMS.map(f => el('option', {
          value: f, text: S.forms[f], selected: draft.form === f,
        }))),
      }),
      field({
        id: 'f-notes',
        label: S.fieldNotes,
        control: el('textarea', {
          id: 'f-notes',
          placeholder: S.fieldNotesPlaceholder,
          value: draft.notes,
          oninput: e => { draft.notes = e.target.value; },
        }),
      }),
      photoField(),
    ]));

    app.appendChild(section(S.schedulesHeading, [
      errors.schedules ? el('p.field-error', { text: errors.schedules }) : null,
      ...schedules.map(scheduleCard),
      el('button.btn.btn-block', {
        type: 'button',
        text: S.addSchedule,
        onclick: () => { schedules.push(blankSchedule(slots)); draw(); },
      }),
    ]));

    app.appendChild(el('div.form-actions', [
      el('button.btn.btn-quiet', { type: 'button', text: S.cancel, onclick: () => go('#/medicines') }),
      el('button.btn.btn-primary', { type: 'button', text: S.save, onclick: save }),
    ]));

    if (existing && !existing.archived) {
      app.appendChild(el('button.btn.btn-quiet.btn-block', {
        type: 'button',
        text: S.archive,
        style: 'margin-top: 1rem; color: var(--danger); border-color: var(--danger);',
        onclick: async () => {
          if (await archiveMedicine(code, existing)) go('#/medicines');
        },
      }));
    }
    if (existing?.archived) {
      app.appendChild(el('button.btn.btn-block', {
        type: 'button',
        text: S.unarchive,
        style: 'margin-top: 1rem;',
        onclick: async () => {
          await supporter.setArchived(code, existing.id, false);
          go('#/medicines');
        },
      }));
    }
  }

  // ---- saving ------------------------------------------------------------

  function validate() {
    for (const key of Object.keys(errors)) delete errors[key];
    if (!draft.name.trim()) errors.name = S.errNameRequired;
    if (!draft.dosage.trim()) errors.dosage = S.errDosageRequired;
    if (!schedules.length) errors.schedules = S.errNoSchedule;

    schedules.forEach((entry, index) => {
      if (entry.frequency.type === 'everyNDays' && !entry.frequency.anchorDate) {
        errors[`anchor-${index}`] = S.errAnchorRequired;
      }
      if (entry.frequency.type === 'weekly' && !entry.frequency.daysOfWeek.length) {
        errors[`days-${index}`] = S.errDaysRequired;
      }
    });
    return !Object.keys(errors).length;
  }

  async function save() {
    if (!validate()) {
      draw();
      app.querySelector('.input-invalid, .field-error')?.scrollIntoView({ block: 'center' });
      return;
    }

    let saved;
    try {
      saved = await supporter.saveMedicine(code, draft);
      await supporter.replaceSchedules(code, saved.id, schedules);

      if (photoDirty) {
        if (photoBlob) await supporter.uploadPhoto(code, saved.id, photoBlob);
        else await supporter.deletePhoto(code, saved.id);
      }
    } catch {
      toast(S.errGeneric);
      return;
    }

    releasePreview();
    toast(S.savedMedicine);
    go('#/medicines');
  }

  draw();
  return () => releasePreview();
}
