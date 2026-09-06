/* One medicine, everything known about it.
 *
 * Replaces the bare photo-on-black that tapping a row used to open. That view
 * answered exactly one question -- "which pill is this?" -- and the app was
 * silent on the one an elder actually asks next, which is "what is it for?".
 *
 * The full-screen viewer is still here, one tap deeper: matching a tablet
 * against a blister strip needs the photo as large as the screen allows, and
 * that is the whole reason the photos exist (docs/flow.md, Flow 4). So the
 * sheet is the detail and the photo inside it is the door to the big version.
 *
 * `purpose` and the packet photo are Phase 4; the layout leaves room for both
 * rather than being rearranged around them later.
 */

import * as store from '../store.js';
import { S } from '../strings.js';
import { el, clear, append, icon, pillTile, openSheet, openPhotoViewer } from '../ui.js';
import { formatTime } from '../date.js';

/** "Morning 8:00 am · Night 9:00 pm", or null when nothing is scheduled. */
async function whenNodes(medicineId) {
  const [schedules, slots] = await Promise.all([
    store.getActiveSchedules(), store.getSlots(),
  ]);
  const slotById = new Map(slots.map(s => [s.id, s]));

  const mine = schedules
    .filter(s => s.medicineId === medicineId)
    .map(s => {
      const slot = slotById.get(s.slotId);
      if (!slot) return null;                       // slot was removed
      const every = s.frequency?.type === 'everyNDays'
        ? ` · ${S.freqInterval.toLowerCase()} ${s.frequency.interval} ${S.freqIntervalUnit}`
        : s.frequency?.type === 'weekly'
          ? ` · ${(s.frequency.daysOfWeek || []).map(d => S.weekdayNames[d].slice(0, 3)).join(', ')}`
          : '';
      return { label: slot.label, time: s.time || slot.time, every };
    })
    .filter(Boolean);

  if (!mine.length) return null;

  return el('div.detail-times', mine.map(m => el('div.detail-time', [
    el('span.detail-time-label', { text: m.label }),
    el('span.detail-time-at', { text: formatTime(m.time) }),
    m.every ? el('span.detail-time-every', { text: m.every }) : null,
  ])));
}

function fact(label, value) {
  if (!value) return null;
  return el('div.detail-fact', [
    el('span.detail-fact-label', { text: label }),
    el('span.detail-fact-value', { text: value }),
  ]);
}

/**
 * @param {object} medicine  { medicineId, name, strength, dosage, notes, form }
 * @param {string} [url]     object URL for the photo, if this device has one
 */
export function openMedicineSheet({ medicine, url }) {
  const altText = `${medicine.name} ${medicine.strength || ''}`.trim();

  /* With no photo this is a plain block, not a button: a control that opens a
   * full-screen view of nothing is a dead end, and a square of empty space
   * would push the actual information -- dosage, notes, times -- below the
   * fold on a small phone. */
  const photo = url
    ? el('button.detail-photo', {
      type: 'button',
      'aria-label': S.seePhotoFull,
      onclick: () => openPhotoViewer({
        url, name: medicine.name, strength: medicine.strength, altText,
      }),
    }, el('img', { src: url, alt: altText }))
    : el('div.detail-photo.detail-photo-none', el('span.detail-photo-empty', [
      pillTile({ id: medicine.medicineId, form: medicine.form, size: 'lg' }),
      el('span', { text: S.noPhoto }),
    ]));

  // Filled in once schedules load. The sheet opens on the same frame as the
  // tap; waiting on a database read before showing anything would make a row
  // feel unresponsive.
  const when = el('div.detail-when');

  openSheet({
    title: medicine.name,
    content: [
      photo,
      url ? el('p.detail-hint', { text: S.seePhotoFull }) : null,
      el('div.detail-facts', [
        fact(S.fieldStrength, medicine.strength),
        fact(S.fieldDosage, medicine.dosage),
        fact(S.fieldNotes, medicine.notes),
      ]),
      when,
    ],
  });

  whenNodes(medicine.medicineId)
    .then(nodes => {
      if (!nodes || !when.isConnected) return;
      clear(when);
      append(when, [el('h3.detail-heading', { text: S.schedulesHeading }), nodes]);
    })
    .catch(() => { /* the rest of the sheet is still worth showing */ });
}
