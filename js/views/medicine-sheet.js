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
 * `purpose` and the packet photo landed in Phase 3 (item 23), into the room
 * the layout was already leaving for them.
 */

import * as store from '../store.js';
import * as photos from '../photos.js';
import { S } from '../strings.js';
import { el, clear, append, icon, pillTile, openSheet, openPhotoViewer, doseText } from '../ui.js';
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
 * @param {object} medicine  { medicineId, name, strength, doseQty, notes, form, purpose }
 * @param {string} [url]     object URL for the pill photo, if this device has one
 */
export function openMedicineSheet({ medicine, url }) {
  const altText = `${medicine.name} ${medicine.strength || ''}`.trim();

  /* The packet photo is loaded here rather than handed in, and that is the
   * point: Today holds a pill photo per medicine because those are the tiles,
   * but a packet photo is only ever looked at inside this sheet. Creating an
   * object URL for every one of them on a screen where most will never be
   * opened is a dozen blobs held live for nothing. So this sheet owns its
   * token and releases it on close, which is the same contract every view
   * follows on unmount. */
  const packet = el('div.detail-packet-slot');
  let packetToken = null;

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
      /* Above the facts, not among them: "what is this for?" is the question
       * an elder actually asks about a box a supporter bought, and burying it
       * in a labelled row next to Strength would answer it last. */
      medicine.purpose ? el('p.detail-purpose', { text: medicine.purpose }) : null,
      el('div.detail-facts', [
        fact(S.fieldStrength, medicine.strength),
        fact(S.fieldDosage, doseText(medicine)),
        fact(S.fieldNotes, medicine.notes),
      ]),
      packet,
      when,
    ],
    onClose: () => {
      if (packetToken !== null) photos.release(packetToken);
      packetToken = null;
    },
  });

  store.getPhotoBlob(medicine.medicineId, 'packet')
    .then(blob => {
      // Opened and closed again while this read was in flight: the sheet's
      // onClose has already run, so a URL created now would never be revoked.
      if (!blob || !packet.isConnected) return;
      const { url: packetUrl, token } = photos.objectUrl(blob);
      packetToken = token;
      append(packet, [
        el('h3.detail-heading', { text: S.fieldPacketPhoto }),
        el('button.detail-packet', {
          type: 'button',
          'aria-label': S.seePhotoFull,
          onclick: () => openPhotoViewer({
            url: packetUrl, name: medicine.name, strength: medicine.strength, altText,
          }),
        }, el('img', { src: packetUrl, alt: '' })),
      ]);
    })
    .catch(() => { /* the rest of the sheet is still worth showing */ });

  whenNodes(medicine.medicineId)
    .then(nodes => {
      if (!nodes || !when.isConnected) return;
      clear(when);
      append(when, [el('h3.detail-heading', { text: S.schedulesHeading }), nodes]);
    })
    .catch(() => { /* the rest of the sheet is still worth showing */ });
}
