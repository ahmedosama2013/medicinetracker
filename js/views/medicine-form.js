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
import * as supporterSync from '../supporter-sync.js';
import * as photosLib from '../photos.js';
import { S } from '../strings.js';
import { el, clear, loadingState, field, section, toast, busyOverlay } from '../ui.js';
import { todayStr, formatTime } from '../date.js';
import { go } from '../router.js';
import { archiveMedicine } from './medicines.js';

/* A medicine has two photos -- the pill and the packet -- and everything
 * about picking one is identical, so the state is keyed by kind rather than
 * duplicated. `pill` answers "which tablet is this?" on Today; `packet`
 * answers "which box do I reach for?" while filling an organiser.
 *
 * Module-level rather than per-render because the view's cleanup runs after
 * the closure is gone; see releasePreviews below. */
const PHOTO_KINDS = ['pill', 'packet'];
let previewTokens = { pill: null, packet: null };

function releasePreviews() {
  for (const kind of PHOTO_KINDS) {
    if (previewTokens[kind] !== null) photosLib.release(previewTokens[kind]);
    previewTokens[kind] = null;
  }
}

const blankSchedule = slots => ({
  id: null,
  slotId: slots[0]?.id || 'morning',
  time: '',
  frequency: { type: 'daily', interval: 2, daysOfWeek: [], anchorDate: todayStr() },
});

export async function medicineFormView({ app, query, isCurrent = () => true }) {
  const id = query.get('id');
  const settings = await store.getSettings();
  const code = settings.supporterCode;

  /* Something on screen before the network is touched. This view costs a
   * routine fetch plus, for an existing medicine, a signed URL from an edge
   * function that can cold-start -- so tapping a row used to sit on the old
   * screen for a second or more with no sign anything had happened, and people
   * tapped again. */
  clear(app);
  app.appendChild(el('h1.page-title', { text: id ? S.editMedicine : S.newMedicine }));
  app.appendChild(loadingState());

  /* In parallel, not in sequence: the photo is keyed on the id from the URL,
   * so it never needed the routine to come back first. That was one avoidable
   * round trip on the slowest screen in the app. */
  let routine;
  let loadedUrls = {};
  try {
    let pillUrl;
    let packetUrl;
    [routine, pillUrl, packetUrl] = await Promise.all([
      supporter.loadRoutine(code),
      id ? supporter.getPhotoUrl(code, id, 'pill').catch(() => null) : Promise.resolve(null),
      id ? supporter.getPhotoUrl(code, id, 'packet').catch(() => null) : Promise.resolve(null),
    ]);
    loadedUrls = { pill: pillUrl, packet: packetUrl };
  } catch {
    if (!isCurrent()) return;
    clear(app);
    app.appendChild(el('p.note', { text: S.pairCodeInvalid }));
    return;
  }
  if (!isCurrent()) return releasePreviews;

  const { slots } = routine;
  const existing = id ? routine.medicines.find(m => m.id === id) : null;
  const existingSchedules = id ? routine.schedules.filter(s => s.medicineId === id) : [];

  // Working copy: nothing is written until Save.
  const draft = {
    id: existing?.id || null,
    name: existing?.name || '',
    strength: existing?.strength || '',
    // A number since migration 0011. Kept as a string in the draft because
    // that is what an <input> holds; parsed once, in validate().
    doseQty: existing?.doseQty == null ? '1' : String(existing.doseQty),
    form: existing?.form || 'tablet',
    purpose: existing?.purpose || '',
    notes: existing?.notes || '',
    archived: existing?.archived || false,
  };

  // Fetched above, alongside the routine. `blob` is a freshly picked,
  // not-yet-saved photo; `dirty` means this kind needs a round trip on save.
  const photo = {
    pill: { url: existing?.photoPath ? loadedUrls.pill : null, blob: null, dirty: false, node: null },
    packet: { url: existing?.packetPhotoPath ? loadedUrls.packet : null, blob: null, dirty: false, node: null },
  };

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

  /* Save does up to four round trips -- the medicine, its schedules, a photo
   * through an edge function that can cold start, and a cache refresh -- and
   * the button used to look untouched for all of them. Two taps in that window
   * ran save() twice with draft.id still null on the second, which is two
   * medicines with the same name, both on Today, and no way to tell which to
   * remove. */
  let saving = false;
  let saveButton = null;

  function setSaveBusy(state) {
    saving = state;
    if (!saveButton) return;
    saveButton.disabled = state;
    clear(saveButton);
    if (state) {
      saveButton.appendChild(el('span.spinner', { 'aria-hidden': 'true' }));
      saveButton.appendChild(el('span', { text: S.saving }));
    } else {
      saveButton.textContent = S.save;
    }
  }

  /* ---- partial redraws ---------------------------------------------------
   *
   * draw() clears the whole form and rebuilds it, and it used to run on every
   * slot change, every frequency change and every weekday tap. Field values
   * survived (they live in `draft`), but focus did not, a long form jumped,
   * and the whole thing read as the page reloading while you were filling it
   * in -- which is how it was reported.
   *
   * So the two things that actually change get swapped in place. draw() is
   * still the right answer for anything structural: adding or removing a
   * schedule renumbers the cards, and a validation pass changes several at
   * once.
   *
   * The node is read BEFORE the replacement is built, because scheduleCard
   * registers what it creates -- ask afterwards and you get the new detached
   * node, and replaceWith quietly does nothing. That exact mistake cost a day
   * in Phase 1 (see js/views/day.js's redrawSlot). */
  const cardNodes = new Map();      // schedule entry -> its live node

  /* Which control the person was using, read BEFORE the swap. Removing a
   * focused element resets document.activeElement to <body> immediately, so
   * asking afterwards always comes back empty -- the restore looked like it
   * worked and never did. */
  function focusedIdWithin(node) {
    return node?.contains(document.activeElement) ? document.activeElement.id : null;
  }

  function swap(previous, next) {
    if (!previous?.isConnected) { draw(); return; }
    const id = focusedIdWithin(previous);
    previous.replaceWith(next);
    if (id) next.querySelector(`#${CSS.escape(id)}`)?.focus();
  }

  function redrawCard(entry) {
    const previous = cardNodes.get(entry);
    swap(previous, scheduleCard(entry));
  }

  function redrawPhoto(kind) {
    const previous = photo[kind].node;
    swap(previous, photoField(kind));
  }

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

  function textFieldWithHint(key, label, placeholder, hint) {
    const input = el('input', {
      type: 'text', id: `f-${key}`, value: draft[key],
      placeholder: placeholder || '', autocomplete: 'off',
      oninput: e => { draft[key] = e.target.value; },
    });
    return field({ id: `f-${key}`, label, control: input, hint });
  }

  function photoField(kind) {
    const state = photo[kind];

    /* Only this kind's token is released. Releasing both -- which a single
     * shared token forced -- would revoke the other picker's live preview the
     * moment either one was redrawn, and the image beside it would go blank
     * with nothing to explain why. */
    if (previewTokens[kind] !== null) {
      photosLib.release(previewTokens[kind]);
      previewTokens[kind] = null;
    }

    let preview;
    if (state.blob) {
      const { url, token } = photosLib.objectUrl(state.blob);
      previewTokens[kind] = token;
      preview = el('span.photo-preview', el('img', { src: url, alt: '' }));
    } else if (state.url) {
      preview = el('span.photo-preview', el('img', { src: state.url, alt: '' }));
    } else {
      preview = el('span.photo-preview', { text: kind === 'packet' ? S.noPacketPhoto : S.noPhoto });
    }

    // A live input element, because programmatic .click() on a detached input
    // is unreliable on iOS for camera capture.
    const input = el('input', {
      type: 'file',
      accept: 'image/*',
      capture: 'environment',
      hidden: true,
      id: `f-photo-${kind}`,
      onchange: async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
          state.blob = await photosLib.compress(file);
          state.url = null;
          state.dirty = true;
          redrawPhoto(kind);
        } catch {
          toast(S.errPhotoFailed);
        }
      },
    });

    const has = state.blob || state.url;
    state.node = field({
      label: kind === 'packet' ? S.fieldPacketPhoto : S.fieldPhoto,
      hint: kind === 'packet' ? S.packetPhotoOptional : S.photoOptional,
      control: el('div.photo-picker', [
        preview,
        input,
        el('div.btn-row', [
          el('button.btn', {
            type: 'button',
            text: has ? S.retakePhoto : S.takePhoto,
            onclick: () => input.click(),
          }),
          has ? el('button.btn.btn-quiet', {
            type: 'button',
            text: S.removePhoto,
            onclick: () => {
              state.blob = null; state.url = null; state.dirty = true; redrawPhoto(kind);
            },
          }) : null,
        ]),
      ]),
    });
    return state.node;
  }

  function scheduleCard(entry) {
    const index = schedules.indexOf(entry);
    const slot = slots.find(s => s.id === entry.slotId) || slots[0];
    const freq = entry.frequency;

    const slotSelect = el('select', {
      id: `s-slot-${index}`,
      onchange: e => { entry.slotId = e.target.value; redrawCard(entry); },
    }, slots.map(s => el('option', {
      value: s.id, text: `${s.label} (${formatTime(s.time)})`, selected: s.id === entry.slotId,
    })));

    const timeInput = el('input', {
      type: 'time',
      id: `s-time-${index}`,
      value: entry.time || '',
      oninput: e => { entry.time = e.target.value; },
      // On commit, not on every keystroke: the hint below and the "add a time
      // of day" link both depend on whether this differs from the slot, and
      // without this they only appeared after some unrelated redraw.
      onchange: () => redrawCard(entry),
    });

    const typeSelect = el('select', {
      id: `s-freq-${index}`,
      onchange: e => { freq.type = e.target.value; redrawCard(entry); },
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
            redrawCard(entry);
          },
        }))),
      }));
    }

    const node = el('div.sched', [
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
        hint: entry.time && entry.time !== slot.time
          ? S.scheduleTimeOverride(slot.label, formatTime(slot.time))
          : S.scheduleTimeDefault(formatTime(slot.time)),
      }),
      /* The way out, offered where the problem is discovered. A medicine at a
       * genuinely different hour wants its own slot, not an override -- but
       * that lives on another screen and nothing here pointed at it. */
      entry.time && entry.time !== slot.time
        ? el('a.btn-link.sched-addslot', { href: '#/slots', text: S.scheduleTimeAddSlot })
        : null,
      field({ id: `s-freq-${index}`, label: S.scheduleFrequency, control: typeSelect }),
      ...extras,
    ]);

    cardNodes.set(entry, node);
    return node;
  }

  function draw() {
    clear(app);
    app.appendChild(el('h1.page-title', { text: existing ? S.editMedicine : S.newMedicine }));

    app.appendChild(section(null, [
      textField('name', S.fieldName, S.fieldNamePlaceholder, { required: true }),
      el('div.field-inline', [
        textField('strength', S.fieldStrength, S.fieldStrengthPlaceholder),
        /* A number, not free text. The organiser has to add these up across a
         * week, and "1 tablet" cannot be added to anything. The unit comes
         * from the form below, which is also what lets it be translated.
         * step 0.25 because scored tablets are halved and quartered. */
        field({
          id: 'f-doseQty',
          label: S.fieldDosage,
          error: errors.doseQty,
          hint: S.fieldDosageHint,
          control: el('input', {
            type: 'number', id: 'f-doseQty',
            min: '0.25', max: '99', step: '0.25',
            inputmode: 'decimal',
            value: draft.doseQty,
            class: errors.doseQty ? 'input-invalid' : '',
            oninput: e => { draft.doseQty = e.target.value; },
          }),
        }),
      ]),
      field({
        id: 'f-form',
        label: S.fieldForm,
        control: el('select', {
          id: 'f-form',
          // The dose's unit is derived from this, so the hint under the
          // number above stops being true the moment it changes.
          onchange: e => { draft.form = e.target.value; },
        }, store.MEDICINE_FORMS.map(f => el('option', {
          value: f, text: S.forms[f], selected: draft.form === f,
        }))),
      }),
      textFieldWithHint('purpose', S.fieldPurpose, S.fieldPurposePlaceholder, S.purposeHint),
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
      photoField('pill'),
      photoField('packet'),
    ]));

    app.appendChild(section(S.schedulesHeading, [
      errors.schedules ? el('p.field-error', { text: errors.schedules }) : null,
      ...schedules.map(entry => scheduleCard(entry)),
      el('button.btn.btn-block', {
        type: 'button',
        text: S.addSchedule,
        onclick: () => { schedules.push(blankSchedule(slots)); draw(); },
      }),
    ]));

    saveButton = el('button.btn.btn-primary', { type: 'button', text: S.save, onclick: save });
    app.appendChild(el('div.form-actions', [
      el('button.btn.btn-quiet', { type: 'button', text: S.cancel, onclick: () => go('#/medicines') }),
      saveButton,
    ]));
    if (saving) setSaveBusy(true);

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

  // The DB's freq_shape constraint requires the columns not used by a given
  // frequency type to be null, and replace_schedules() keys its daysOfWeek
  // handling off the JSON key's presence (not its value) -- but the form
  // keeps stale values around when the user switches types, so the fields
  // not applicable to the chosen type are dropped entirely here, right
  // before it's sent.
  function normalizeFrequency(freq) {
    if (freq.type === 'everyNDays') {
      return { type: 'everyNDays', interval: freq.interval, anchorDate: freq.anchorDate };
    }
    if (freq.type === 'weekly') {
      return { type: 'weekly', daysOfWeek: freq.daysOfWeek };
    }
    return { type: 'daily' };
  }

  function validate() {
    for (const key of Object.keys(errors)) delete errors[key];
    if (!draft.name.trim()) errors.name = S.errNameRequired;
    const qty = Number(draft.doseQty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 99) errors.doseQty = S.errDosageRequired;
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
    if (saving) return;
    if (!validate()) {
      draw();
      app.querySelector('.input-invalid, .field-error')?.scrollIntoView({ block: 'center' });
      return;
    }

    // The medicine record and its schedule are the core save. If either of
    // these throws, nothing usable was written, so the person stays on the
    // form and sees the generic error -- there is nothing to navigate to yet.
    setSaveBusy(true);
    /* The button alone was not enough. It can be scrolled off a long form
     * entirely, and it left every field editable while their values were
     * already on their way to the server. */
    const busy = busyOverlay(existing ? S.busySavingChanges : S.busyAddingMedicine);

    let saved;
    try {
      // doseQty leaves the form as a number. The draft holds it as a string
      // because that is what an <input> gives back, and upsert_medicine casts
      // to numeric -- "1" would survive that cast, but "" would not, and
      // validate() is the only thing standing between the two.
      saved = await supporter.saveMedicine(code, { ...draft, doseQty: Number(draft.doseQty) });
      draft.id = saved.id; // so a retry after a later failure updates this row instead of inserting a new one
      const payload = schedules.map(s => ({ ...s, frequency: normalizeFrequency(s.frequency) }));
      await supporter.replaceSchedules(code, saved.id, payload);
    } catch {
      busy.close();
      setSaveBusy(false);
      toast(S.errGeneric);
      return;
    }

    // From here on the medicine IS saved. A photo failure at this point used
    // to be caught by the same catch block above and reported as "something
    // went wrong" -- which was true of the photo, not of the save, and left
    // the person confused when the medicine showed up on the list anyway
    // despite the error. Reported separately here so the toast matches what
    // actually happened.
    let photoFailed = false;
    for (const kind of PHOTO_KINDS) {
      const state = photo[kind];
      if (!state.dirty) continue;
      busy.setMessage(state.blob ? S.busyUploadingPhoto : S.busyRemovingPhoto);
      try {
        if (state.blob) await supporter.uploadPhoto(code, saved.id, state.blob, kind);
        else await supporter.deletePhoto(code, saved.id, kind);
      } catch {
        /* One flag for both, deliberately. The toast's job is "the medicine
         * saved, a photo did not" -- naming which one would need two more
         * strings to tell the person something they can see for themselves on
         * the page they are about to land on. */
        photoFailed = true;
      }
    }

    /* The supporter's own Today and the photos on their medicine list read the
     * local cache, not the live routine -- so without this a medicine they had
     * just added was missing from their own Today, and its freshly uploaded
     * photo showed the fallback tile, for up to a minute. It costs a round trip
     * on a screen that has already done three, which is why the button is still
     * showing that it is working. */
    busy.setMessage(S.busyFinishing);
    await supporterSync.refresh(code).catch(() => {});

    busy.close();
    releasePreviews();
    setSaveBusy(false);
    toast(photoFailed ? S.savedMedicineNoPhoto : S.savedMedicine);
    go('#/medicines');
  }

  draw();
  return () => releasePreviews();
}
