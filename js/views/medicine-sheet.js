/* One medicine, everything known about it, as a bottom sheet.
 *
 * A sheet rather than a screen because this is something you LOOK AT - you
 * come back out of it to the same place. The full-screen photo viewer is one
 * tap deeper: matching a tablet against a blister strip needs the photo as
 * large as the screen allows, and that is the whole reason the photos exist.
 *
 * The marking buttons live in a fixed foot below the scrolling body, so they
 * are reachable without scrolling past the notes - and they are the same
 * actions, in the same words, as the slot detail behind it. A person must
 * never have to learn two vocabularies for the same tap.
 */

import * as store from '../store.js';
import * as photos from '../photos.js';
import { S } from '../strings.js';
import {
  el, append, clear, paintTone, openSheet, openPhotoViewer, doseText, doseTone,
} from '../ui.js';
import { formatTime } from '../date.js';

/** "Morning 8:00 am · Bedtime 9:30 pm", or null when nothing is scheduled. */
async function whenText(medicineId) {
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
        ? ` (${S.freqInterval.toLowerCase()} ${s.frequency.interval} ${S.freqIntervalUnit})`
        : s.frequency?.type === 'weekly'
          ? ` (${(s.frequency.daysOfWeek || []).map(d => S.weekdayShort3[d]).join(', ')})`
          : '';
      return `${slot.label} ${formatTime(s.time || slot.time)}${every}`;
    })
    .filter(Boolean);

  return mine.length ? mine.join(' · ') : null;
}

function fact(label, value) {
  if (!value) return null;
  return el('div.ms-fact', [
    el('span.ms-fact-label', { text: label }),
    el('span.ms-fact-value', { text: value }),
  ]);
}

/**
 * A 140px photo slab. With a photo it opens the full-screen viewer; without
 * one it is a plain dashed block, not a button - a control that opens a
 * full-screen view of nothing is a dead end.
 */
function photoSlab({ url, caption, emptyText, name, strength, altText, packet = false }) {
  if (!url) return el('span.photo-slab-empty', { text: emptyText });
  return el(`button.photo-slab${packet ? '.photo-slab-packet' : ''}`, {
    type: 'button',
    'aria-label': `${caption}: ${S.makeItBigger}`,
    onclick: () => openPhotoViewer({ url, name, strength, altText, caption }),
  }, [
    el('img', { src: url, alt: '' }),
    el('span.photo-slab-tag', { text: caption }),
  ]);
}

/**
 * @param {object} medicine  { medicineId, name, strength, doseQty, notes, form, purpose }
 * @param {string} [url]     object URL for the pill photo, if this device has one
 * @param {string} [slotName] the time of day this dose belongs to
 * @param {string|null} [state] 'taken' | 'skipped' | null
 * @param {Function} [onMark] (status) => void. Absent for read-only days.
 */
export function openMedicineSheet({
  medicine, url, slotName = null, state = null, onMark = null,
}) {
  const title = [medicine.name, medicine.strength].filter(Boolean).join(' ');
  const altText = title;
  const tone = doseTone(state);

  /* The packet photo is loaded here rather than handed in, and that is the
   * point: a list holds a pill photo per medicine because those are the tiles,
   * but a packet photo is only ever looked at inside this sheet. Creating an
   * object URL for every one of them on a screen where most will never be
   * opened is a dozen blobs held live for nothing. The sheet owns its token
   * and releases it on close. */
  const photoRow = el('div.ms-photos', [
    photoSlab({
      url,
      caption: S.pillPhoto,
      emptyText: S.noPhoto,
      name: medicine.name,
      strength: medicine.strength,
      altText,
    }),
    el('span.photo-slab-empty', { text: S.noPacketPhotoYet }),
  ]);
  let packetToken = null;

  const when = el('div');

  const statusStrip = paintTone(
    el('div.ms-status', { text: `${tone.glyph} ${tone.label}` }),
    tone,
  );

  /* Same actions, same words, as the card behind this sheet. Closing on the
   * tap is deliberate: the answer to "did that work?" is the card underneath,
   * already flipped. */
  function actions(sheet) {
    if (!onMark) return null;
    const nodes = [];
    if (state === 'taken') {
      nodes.push(el('button.btn.btn-quiet.btn-lg.btn-block', {
        type: 'button',
        text: S.undoNotTakenLong,
        onclick: () => { sheet.close(); onMark(null); },
      }));
    } else {
      nodes.push(el('button.btn.btn-primary.btn-xl.btn-block', {
        type: 'button',
        text: S.takeThisOne,
        onclick: () => { sheet.close(); onMark('taken'); },
      }));
    }
    if (!state) {
      nodes.push(el('button.btn.btn-quiet.btn-block', {
        type: 'button',
        text: S.notTakingToday,
        onclick: () => { sheet.close(); onMark('skipped'); },
      }));
    } else if (state === 'skipped') {
      nodes.push(el('button.btn.btn-quiet.btn-block', {
        type: 'button',
        text: S.putThisBack,
        onclick: () => { sheet.close(); onMark(null); },
      }));
    }
    return nodes;
  }

  const sheet = openSheet({
    /* The slot name, or the medicine's own name when there is no slot context
     * (a calendar day sheet). The head must never be empty: it carries Close. */
    eyebrow: slotName || medicine.name,
    content: [
      el('div.ms-title', [
        el('span.ms-name', { text: medicine.name }),
        el('span.ms-sub', {
          text: [medicine.strength, doseText(medicine)].filter(Boolean).join(' · '),
        }),
      ]),
      statusStrip,
      photoRow,
      el('div.ms-facts', [
        fact(S.whatItIsFor, medicine.purpose),
        fact(S.notesLabel, medicine.notes),
        when,
        fact(S.formLabel, S.forms[medicine.form] || null),
      ]),
    ],
    foot: onMark ? [] : null,
    onClose: () => {
      if (packetToken !== null) photos.release(packetToken);
      packetToken = null;
    },
  });

  if (onMark) sheet.setFoot(actions(sheet));

  store.getPhotoBlob(medicine.medicineId, 'packet')
    .then(blob => {
      // Opened and closed again while this read was in flight: onClose has
      // already run, so a URL created now would never be revoked.
      if (!blob || !photoRow.isConnected) return;
      const { url: packetUrl, token } = photos.objectUrl(blob);
      packetToken = token;
      photoRow.lastChild.replaceWith(photoSlab({
        url: packetUrl,
        caption: S.packetPhoto,
        emptyText: S.noPacketPhotoYet,
        name: medicine.name,
        strength: medicine.strength,
        altText,
        packet: true,
      }));
    })
    .catch(() => { /* the rest of the sheet is still worth showing */ });

  whenText(medicine.medicineId)
    .then(text => {
      if (!text || !when.isConnected) return;
      clear(when);
      append(when, fact(S.whenLabel, text));
    })
    .catch(() => { /* the rest of the sheet is still worth showing */ });

  return sheet;
}
