/* Helper: add or edit a medicine, WITH its schedule, in one form.
 *
 * The medicine and its times are deliberately not two screens. A medicine that
 * exists but is scheduled nowhere appears on no Today screen and in no
 * calendar, and the helper has no way to notice - it is a dead state that
 * looks exactly like success. So: no save without at least one time.
 *
 * Three sections, in the order someone holding a packet works through them:
 * what it is, its photos, when they take it. Choices that are a small closed
 * set (form, how often) are chips rather than dropdowns - a chip shows every
 * option at once, which is what makes "Liquid" discoverable as the thing that
 * keeps a medicine out of the pill box.
 *
 * Every write here goes through supporter.js (code-gated Supabase calls, no
 * local cache) and requires connectivity - unlike the elder's device, this one
 * is never used offline.
 */

import * as store from '../store.js';
import * as supporter from '../supporter.js';
import * as supporterSync from '../supporter-sync.js';
import * as photosLib from '../photos.js';
import { S } from '../strings.js';
import {
  el, mount, screen, clear, loadingState, field, toast, busyOverlay,
  confirmDialog, openSheet, progressBar, supGroup,
} from '../ui.js';
import { todayStr, formatTime } from '../date.js';
import { go } from '../router.js';
import { archiveMedicine } from './medicines.js';

/* A medicine has two photos - the pill and the packet - and everything about
 * picking one is identical, so the state is keyed by kind rather than
 * duplicated. `pill` answers "which tablet is this?" on the slot screen;
 * `packet` answers "which box do I reach for?" while filling an organiser.
 *
 * Module-level rather than per-render because the view's cleanup runs after
 * the closure is gone. */
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

const FREQUENCIES = [
  { type: 'daily', label: () => S.freqDaily },
  { type: 'everyNDays', label: () => S.freqEveryNDays },
  { type: 'weekly', label: () => S.freqWeekly },
];

export async function medicineFormView({ app, query, isCurrent = () => true }) {
  const id = query.get('id');
  const groupedIds = query.get('ids')?.split(',').filter(Boolean) || (id ? [id] : []);
  const settings = await store.getSettings();
  const code = settings.supporterCode;

  const shell = body => screen({
    head: el('div.s-formbar', [
      el('a.s-formbar-cancel', { href: '#/medicines', text: S.cancel }),
      el('span.s-formbar-title', { text: id ? S.editMedicine : S.newMedicine }),
      saveButton,
    ]),
    scroll: body,
  });

  let saveButton = el('button.btn-s.btn-primary', { type: 'button', text: S.save });

  /* Something on screen before the network is touched. This view costs a
   * routine fetch plus, for an existing medicine, a signed URL from an edge
   * function that can cold-start - so tapping a row used to sit on the old
   * screen for a second or more with no sign anything had happened. */
  mount(app, shell(loadingState()));

  /* In parallel, not in sequence: the photo is keyed on the id from the URL,
   * so it never needed the routine to come back first. */
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
    if (!isCurrent()) return releasePreviews;
    mount(app, shell(el('div.s-empty', [
      el('p.s-empty-title', { text: S.errGeneric }),
      el('p.s-empty-body', { text: S.pairConnectionError }),
    ])));
    return releasePreviews;
  }
  if (!isCurrent()) return releasePreviews;

  const { slots } = routine;
  const existing = id ? routine.medicines.find(m => m.id === id) : null;
  const existingSchedules = id ? routine.schedules.filter(s => groupedIds.includes(s.medicineId)) : [];

  let selectedReference = existing?.communityReferenceId ? {
    id: existing.communityReferenceId,
    name: existing.communityReferenceName || existing.name,
    strength: existing.communityReferenceStrength || existing.strength,
  } : null;
  let communityUrls = { pill: null, packet: null };
  if (selectedReference) {
    communityUrls = await supporter.communityPhotoUrls(code, selectedReference.id)
      .catch(() => communityUrls);
  }
  if (!isCurrent()) return releasePreviews;

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

  const photo = {
    pill: {
      url: existing?.photoPath ? loadedUrls.pill : (communityUrls.pill || null),
      source: existing?.photoPath ? 'own' : (communityUrls.pill ? 'community' : null),
      blob: null, suggestReplacement: false, dirty: false, uploading: false, failed: false,
    },
    packet: {
      url: existing?.packetPhotoPath ? loadedUrls.packet : (communityUrls.packet || null),
      source: existing?.packetPhotoPath ? 'own' : (communityUrls.packet ? 'community' : null),
      blob: null, suggestReplacement: false, dirty: false, uploading: false, failed: false,
    },
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
  let shareCommunity = true;
  let saving = false;
  let searchResults = [];
  let searchToken = 0;
  let searchTimer = 0;

  // ---- community search ---------------------------------------------------

  function runSearch(value) {
    const mine = ++searchToken;
    clearTimeout(searchTimer);
    if (value.trim().length < 3) { searchResults = []; paintSearch(); return; }
    searchTimer = setTimeout(async () => {
      try {
        const result = await supporter.searchCommunityMedicines(code, value);
        if (mine !== searchToken || !result.references?.length) return;
        // The same name and strength can come back from several households.
        searchResults = [...new Map(result.references.map(ref => [
          `${(ref.name || '').trim().toLowerCase()} ${(ref.strength || '').trim().toLowerCase()}`,
          ref,
        ])).values()];
        paintSearch();
      } catch {
        /* Search is optional; leave the form quiet if it fails. */
      }
    }, 280);
  }

  let searchHost = null;

  function paintSearch() {
    if (!searchHost?.isConnected) return;
    clear(searchHost);
    if (!searchResults.length) return;
    for (const ref of searchResults) {
      searchHost.appendChild(el('button.community-result', {
        type: 'button',
        onclick: () => useReference(ref),
      }, [
        el('span.community-result-main', [
          el('span.community-result-name', {
            text: [ref.name, ref.strength].filter(Boolean).join(' '),
          }),
          el('span.community-result-sub', {
            text: S.communitySearchPhotos((ref.hasPillPhoto ? 1 : 0) + (ref.hasPacketPhoto ? 1 : 0)),
          }),
        ]),
        el('span.community-result-use', { text: S.communityUse }),
      ]));
    }
  }

  async function useReference(ref) {
    selectedReference = ref;
    draft.name = ref.name;
    draft.strength = ref.strength || draft.strength;
    searchResults = [];

    // The same blocking panel the submit button uses: fetching the shared
    // photos is a network round trip, and the button otherwise just sits
    // there with no sign a tap landed.
    const busy = busyOverlay(S.busyLoadingMedicine);
    try {
      communityUrls = await supporter.communityPhotoUrls(code, ref.id)
        .catch(() => ({ pill: null, packet: null }));
    } finally {
      busy.close();
    }

    for (const kind of PHOTO_KINDS) {
      if (!photo[kind].blob && communityUrls[kind]) {
        photo[kind].url = communityUrls[kind];
        photo[kind].source = 'community';
      }
    }
    toast(S.communityFilled);
    draw();
  }

  /* The shared list as a sheet, opened deliberately rather than appearing
   * under the name field: it is something you LOOK AT and choose from, and it
   * must state plainly that searching sends nothing from this phone. */
  function openCommunitySheet() {
    let value = draft.name;
    const results = el('div.community-results');
    const sheet = openSheet({
      title: S.communityTitle,
      padded: true,
      content: [
        el('input', {
          type: 'search',
          value,
          placeholder: S.fieldNamePlaceholder,
          oninput: e => { value = e.target.value; runSheetSearch(value); },
        }),
        el('span.s-card-note', { text: S.communityLookUpHint }),
        results,
        el('div.s-editable', { style: 'display: flex; flex-direction: column; gap: 6px' }, [
          el('span', { text: S.communityExplain, style: 'font-weight: 400; line-height: 1.5' }),
          el('button.btn-s', {
            type: 'button',
            text: S.communityNoThanks,
            style: 'border: none; background: none; color: var(--navy); text-decoration: underline; padding: 0; min-height: 40px; font-size: 13px; align-self: flex-start',
            onclick: () => sheet.close(),
          }),
        ]),
      ],
    });

    let token = 0;
    async function runSheetSearch(query) {
      const mine = ++token;
      clear(results);
      if (query.trim().length < 3) return;
      results.appendChild(loadingState());
      try {
        const result = await supporter.searchCommunityMedicines(code, query);
        if (mine !== token) return;
        clear(results);
        const refs = [...new Map((result.references || []).map(ref => [
          `${(ref.name || '').trim().toLowerCase()} ${(ref.strength || '').trim().toLowerCase()}`,
          ref,
        ])).values()];
        if (!refs.length) {
          results.appendChild(el('p.s-card-note', { text: S.communitySearchFailed }));
          return;
        }
        for (const ref of refs) {
          results.appendChild(el('button.community-result', {
            type: 'button',
            onclick: () => { sheet.close(); useReference(ref); },
          }, [
            el('span.community-result-main', [
              el('span.community-result-name', {
                text: [ref.name, ref.strength].filter(Boolean).join(' '),
              }),
              el('span.community-result-sub', {
                text: S.communitySearchPhotos((ref.hasPillPhoto ? 1 : 0) + (ref.hasPacketPhoto ? 1 : 0)),
              }),
            ]),
            el('span.community-result-use', { text: S.communityUse }),
          ]));
        }
      } catch {
        if (mine !== token) return;
        clear(results);
        results.appendChild(el('p.s-card-note', { text: S.communitySearchFailed }));
      }
    }

    runSheetSearch(value);
    return sheet;
  }

  // ---- photo pickers ------------------------------------------------------

  function photoColumn(kind) {
    const state = photo[kind];

    /* Only this kind's token is released. Releasing both - which a single
     * shared token forced - would revoke the other picker's live preview the
     * moment either one was redrawn. */
    if (previewTokens[kind] !== null) {
      photosLib.release(previewTokens[kind]);
      previewTokens[kind] = null;
    }

    // A live input element, because programmatic .click() on a detached input
    // is unreliable on iOS for camera capture.
    const input = el('input', {
      type: 'file',
      accept: 'image/*',
      hidden: true,
      id: `f-photo-${kind}`,
      onchange: async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        state.uploading = true;
        state.failed = false;
        draw();
        try {
          state.blob = await photosLib.compress(file);
          state.url = null;
          state.source = 'own';
          state.suggestReplacement = false;
          state.dirty = true;
        } catch {
          state.failed = true;
          toast(S.errPhotoFailed);
        }
        state.uploading = false;
        draw();
      },
    });

    let box;
    if (state.uploading) {
      box = el('span.photo-box.photo-box-busy', { text: S.photoUploading });
    } else if (state.failed) {
      box = el('span.photo-box.photo-box-failed', [
        el('span', { text: S.photoFailedTitle }),
        el('span', { text: S.errPhotoFailed, style: 'font-weight: 600; font-size: 11px' }),
      ]);
    } else if (state.blob) {
      const { url, token } = photosLib.objectUrl(state.blob);
      previewTokens[kind] = token;
      box = el('button.photo-box', { type: 'button', onclick: () => input.click() },
        el('img', { src: url, alt: '' }));
    } else if (state.url) {
      box = el('button.photo-box', { type: 'button', onclick: () => input.click() },
        el('img', { src: state.url, alt: '' }));
    } else {
      box = el('button.photo-box.photo-box-empty', {
        type: 'button',
        text: kind === 'packet' ? S.addPacketPhoto : S.takePhoto,
        onclick: () => input.click(),
      });
    }

    const has = state.blob || state.url;
    const caption = el('span.photo-caption');
    caption.appendChild(document.createTextNode(
      kind === 'packet' ? S.fieldPacketPhoto : S.fieldPhoto,
    ));

    if (has && state.blob) {
      caption.appendChild(document.createTextNode(' · '));
      caption.appendChild(el('button.btn-inline', {
        type: 'button',
        text: S.communitySuggestPhoto,
        disabled: state.suggestReplacement,
        onclick: async () => {
          const ok = await confirmDialog({
            title: S.communitySuggestTitle,
            body: S.communitySuggestBody,
            confirmLabel: S.communitySuggestConfirm,
            cancelLabel: S.communitySuggestCancel,
          });
          if (!ok) return;
          state.suggestReplacement = true;
          toast(S.communitySuggestSent);
          draw();
        },
      }));
    }

    if (has) {
      caption.appendChild(document.createTextNode(' · '));
      caption.appendChild(el('button.btn-inline', {
        type: 'button',
        text: S.removePhoto,
        onclick: () => {
          state.blob = null;
          state.url = null;
          state.source = null;
          state.dirty = true;
          draw();
        },
      }));
    }

    return el('div.photo-col', [
      box,
      input,
      caption,
      state.source === 'community'
        ? el('span.field-hint', { text: S.communityUsing })
        : null,
    ]);
  }

  // ---- one schedule -------------------------------------------------------

  function scheduleCard(entry, index) {
    const slot = slots.find(s => s.id === entry.slotId) || slots[0];
    const freq = entry.frequency;
    const hasError = errors[`anchor-${index}`] || errors[`days-${index}`];

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
          'aria-pressed': String(freq.daysOfWeek.includes(dayIndex)),
          text: S.weekdayShort3[dayIndex],
          onclick: () => {
            const at = freq.daysOfWeek.indexOf(dayIndex);
            if (at === -1) freq.daysOfWeek.push(dayIndex);
            else freq.daysOfWeek.splice(at, 1);
            draw();
          },
        }))),
      }));
    }

    return el(`div.sched${hasError ? '.sched-invalid' : ''}`, [
      el('div.sched-head', [
        el('span.sched-num', { text: `${index + 1}` }),
        schedules.length > 1 ? el('button.btn-s.btn-s-xs', {
          type: 'button',
          text: S.removeSchedule,
          onclick: () => { schedules.splice(index, 1); draw(); },
        }) : null,
      ]),

      field({
        label: S.scheduleFrequency,
        control: el('div.chips', FREQUENCIES.map(f => el('button.chip', {
          type: 'button',
          text: f.label(),
          'aria-pressed': String(freq.type === f.type),
          onclick: () => { freq.type = f.type; draw(); },
        }))),
      }),

      el('div.field-inline', [
        field({
          id: `s-slot-${index}`,
          label: S.scheduleSlot,
          control: el('select', {
            id: `s-slot-${index}`,
            onchange: e => { entry.slotId = e.target.value; draw(); },
          }, slots.map(s => el('option', {
            value: s.id, text: `${s.label} (${formatTime(s.time)})`, selected: s.id === entry.slotId,
          }))),
        }),
        field({
          id: `s-time-${index}`,
          label: S.scheduleTime,
          control: el('input', {
            type: 'time',
            id: `s-time-${index}`,
            value: entry.time || '',
            oninput: e => { entry.time = e.target.value; },
            // On commit, not on every keystroke: the hint below depends on
            // whether this differs from the slot.
            onchange: () => draw(),
          }),
        }),
      ]),

      el('p.field-hint', {
        text: entry.time && entry.time !== slot.time
          ? S.scheduleTimeOverride(slot.label, formatTime(slot.time))
          : S.scheduleTimeDefault(formatTime(slot.time)),
      }),

      ...extras,
    ]);
  }

  // ---- rendering ----------------------------------------------------------

  function draw() {
    saveButton = el('button.btn-s.btn-primary', { type: 'button', text: saving ? S.saving : S.save, disabled: saving, onclick: save });

    const errorCount = Object.keys(errors).length;

    const nameInput = el('input', {
      type: 'text', id: 'f-name', value: draft.name,
      placeholder: S.fieldNamePlaceholder,
      class: errors.name ? 'input-invalid' : '',
      autocomplete: 'off',
      oninput: e => {
        draft.name = e.target.value;
        if (selectedReference
          && draft.name.trim().toLowerCase() !== (selectedReference.name || '').trim().toLowerCase()) {
          selectedReference = null;
        }
        runSearch(draft.name);
      },
    });
    searchHost = el('div.community-results');

    mount(app, screen({
      head: el('div.s-formbar', [
        el('a.s-formbar-cancel', { href: '#/medicines', text: S.cancel }),
        el('span.s-formbar-title', { text: existing ? S.editMedicine : S.newMedicine }),
        saveButton,
      ]),
      scroll: el('div.s-form', [

        saving ? el('div.s-editable', { style: 'display: flex; flex-direction: column; gap: 8px' }, [
          el('span', { text: S.saving, style: 'font-weight: 700' }),
          progressBar(),
        ]) : null,

        /* Says how many things need fixing and lists them in one line, so the
         * person knows the size of the job before scrolling to find them. */
        errorCount ? el('div.s-notice.s-notice-bad', { role: 'alert' }, [
          el('span.s-notice-title', { text: S.formErrorsTitle(errorCount) }),
          el('span.s-notice-text', { text: Object.values(errors).join(' · ') }),
        ]) : null,

        supGroup(S.formSectionWhat, [
          field({
            id: 'f-name',
            label: S.fieldName,
            error: errors.name,
            hint: selectedReference ? S.communityUsing : null,
            control: el('div', { style: 'display: flex; flex-direction: column; gap: 6px' }, [
              nameInput,
              searchHost,
            ]),
          }),

          el('div.field-inline', [
            field({
              id: 'f-strength',
              label: S.fieldStrength,
              control: el('input', {
                type: 'text', id: 'f-strength', value: draft.strength,
                placeholder: S.fieldStrengthPlaceholder, autocomplete: 'off',
                oninput: e => {
                  draft.strength = e.target.value;
                  if (selectedReference
                    && draft.strength.trim().toLowerCase() !== (selectedReference.strength || '').trim().toLowerCase()) {
                    selectedReference = null;
                  }
                },
              }),
            }),
            /* A number, not free text. The organiser has to add these up
             * across a week, and "1 tablet" cannot be added to anything. The
             * unit comes from the form below, which is also what lets it be
             * translated. step 0.25 because scored tablets are halved. */
            field({
              id: 'f-doseQty',
              label: S.fieldDosage,
              error: errors.doseQty,
              hint: S.fieldDosageHint,
              control: el('input', {
                type: 'number', id: 'f-doseQty',
                min: '0.25', max: '99', step: '0.25', inputmode: 'decimal',
                value: draft.doseQty,
                class: errors.doseQty ? 'input-invalid' : '',
                oninput: e => { draft.doseQty = e.target.value; },
              }),
            }),
          ]),

          field({
            label: S.fieldForm,
            control: el('div.chips', store.MEDICINE_FORMS.map(f => el('button.chip', {
              type: 'button',
              text: S.forms[f],
              'aria-pressed': String(draft.form === f),
              // The dose's unit is derived from this, so the hint under the
              // number above stops being true the moment it changes.
              onclick: () => { draft.form = f; draw(); },
            }))),
          }),

          field({
            id: 'f-purpose',
            label: S.fieldPurpose,
            hint: S.purposeHint,
            control: el('input', {
              type: 'text', id: 'f-purpose', value: draft.purpose,
              placeholder: S.fieldPurposePlaceholder, autocomplete: 'off',
              oninput: e => { draft.purpose = e.target.value; },
            }),
          }),

          field({
            id: 'f-notes',
            label: S.fieldNotes,
            hint: S.notesHint,
            control: el('textarea', {
              id: 'f-notes',
              placeholder: S.fieldNotesPlaceholder,
              value: draft.notes,
              oninput: e => { draft.notes = e.target.value; },
            }),
          }),
        ]),

        supGroup(S.formSectionPhotos, [
          el('div.photo-grid', [photoColumn('pill'), photoColumn('packet')]),
          el('p.field-hint', { text: S.photoGuidance }),
          el('button.btn-s.btn-nav-outline', {
            type: 'button', text: S.communityLookUp, style: 'min-height: 46px',
            onclick: openCommunitySheet,
          }),
          el('p.field-hint', { text: S.communityLookUpHint }),
          el('label.checkbox-row', [
            el('input', {
              type: 'checkbox',
              checked: shareCommunity,
              onchange: e => { shareCommunity = e.target.checked; },
            }),
            el('span', [
              el('strong', { text: S.communityShareLabel }),
              el('small', { text: S.communityShareHint }),
            ]),
          ]),
        ]),

        supGroup(S.formSectionWhen, [
          errors.schedules ? el('p.field-error', { text: errors.schedules }) : null,
          ...schedules.map((entry, index) => scheduleCard(entry, index)),
          el('button.btn-s.btn-dashed', {
            type: 'button',
            text: S.addSchedule,
            onclick: () => { schedules.push(blankSchedule(slots)); draw(); },
          }),
          el('a.btn-s', {
            href: '#/slots',
            text: S.scheduleTimeAddSlot,
            style: 'border: none; background: none; color: var(--navy); text-decoration: underline; align-self: flex-start; padding: 0; min-height: 40px; font-size: 13px',
          }),
        ]),

        existing ? el('div.form-foot', [
          existing.archived
            ? el('button.btn-s.btn-nav-outline', {
              type: 'button',
              text: S.unarchive,
              onclick: async () => {
                try {
                  await supporter.setArchived(code, existing.id, false);
                  toast(S.restoredToast(existing.name));
                  go('#/medicines');
                } catch { toast(S.errGeneric); }
              },
            })
            : el('button.btn-s.btn-danger-outline', {
              type: 'button',
              text: S.archiveEllipsis,
              onclick: async () => {
                if (await archiveMedicine(code, existing)) go('#/medicines');
              },
            }),
        ]) : null,
      ]),
    }), { keepScroll: true });

    paintSearch();
  }

  // ---- saving -------------------------------------------------------------

  /* The DB's freq_shape constraint requires the columns not used by a given
   * frequency type to be null, and replace_schedules() keys its daysOfWeek
   * handling off the JSON key's presence (not its value) - but the form keeps
   * stale values around when the type is switched, so the fields not
   * applicable to the chosen type are dropped entirely here. */
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

  /* Save does up to four round trips - the medicine, its schedules, a photo
   * through an edge function that can cold start, and a cache refresh - and
   * the button used to look untouched for all of them. Two taps in that window
   * ran save() twice with draft.id still null on the second, which is two
   * medicines with the same name and no way to tell which to remove. */
  async function save() {
    if (saving) return;
    if (!validate()) {
      draw();
      app.querySelector('.input-invalid, .field-error')?.scrollIntoView({ block: 'center' });
      return;
    }

    saving = true;
    draw();
    /* The button alone was not enough. It can be scrolled off a long form
     * entirely, and it left every field editable while their values were
     * already on their way to the server. */
    const busy = busyOverlay(existing ? S.busySavingChanges : S.busyAddingMedicine);

    let saved;
    try {
      // doseQty leaves the form as a number. The draft holds it as a string
      // because that is what an <input> gives back.
      saved = await supporter.saveMedicine(code, {
        ...draft,
        doseQty: Number(draft.doseQty),
        communityReferenceId: selectedReference?.id || null,
        referenceId: selectedReference?.id || null,
      });
      draft.id = saved.id;   // so a retry updates this row instead of inserting a new one
      const payload = schedules.map(s => ({ ...s, frequency: normalizeFrequency(s.frequency) }));
      await supporter.replaceSchedules(code, saved.id, payload);
    } catch {
      busy.close();
      saving = false;
      draw();
      toast(S.errGeneric);
      return;
    }

    /* From here on the medicine IS saved. A photo failure at this point used
     * to be reported as "something went wrong" - which was true of the photo,
     * not of the save, and left the person confused when the medicine showed
     * up on the list anyway. Reported separately so the toast matches what
     * actually happened. */
    let photoFailed = false;
    for (const kind of PHOTO_KINDS) {
      const state = photo[kind];
      if (!state.dirty) continue;
      const hadPrivatePhoto = kind === 'pill'
        ? Boolean(existing?.photoPath)
        : Boolean(existing?.packetPhotoPath);
      if (!state.blob && !hadPrivatePhoto) { state.dirty = false; continue; }
      busy.setMessage(state.blob ? S.busyUploadingPhoto : S.busyRemovingPhoto);
      try {
        if (state.blob) await supporter.uploadPhoto(code, saved.id, state.blob, kind);
        else await supporter.deletePhoto(code, saved.id, kind);
      } catch {
        photoFailed = true;
      }
    }

    if (shareCommunity) {
      try {
        const blobs = {};
        for (const kind of PHOTO_KINDS) if (photo[kind].blob) blobs[kind] = photo[kind].blob;
        const published = await supporter.publishCommunityMedicine(
          code,
          { name: draft.name, strength: draft.strength, referenceId: selectedReference?.id },
          blobs,
        );
        if (published.kind === 'duplicate') toast(S.communityDuplicate);
        else if (published.added?.length) toast(S.communityPhotosAdded(published.added.length));
        if (published.needsReview?.length) {
          for (const kind of published.needsReview) {
            if (photo[kind].blob) {
              await supporter.suggestCommunityPhoto(code, published.reference.id, kind, photo[kind].blob);
            }
          }
          toast(S.communityReviewNeeded);
        }
        if (published.kind === 'created' && !published.added?.length) toast(S.communityAdded);
      } catch {
        toast(S.communitySearchFailed);
      }
    }

    /* The helper's own Today and the photos on their medicine list read the
     * local cache, not the live routine - so without this a medicine they had
     * just added was missing from their own Today, and its freshly uploaded
     * photo showed the fallback tile, for up to a minute. */
    busy.setMessage(S.busyFinishing);
    await supporterSync.refresh(code).catch(() => {});

    busy.close();
    releasePreviews();
    saving = false;
    toast(photoFailed ? S.savedMedicineNoPhoto : S.savedMedicineToast(draft.name));
    go('#/medicines');
  }

  draw();
  return () => { clearTimeout(searchTimer); releasePreviews(); };
}
