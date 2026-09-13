/* One day in detail: its slots, its medicines, and whether it can still be
 * corrected.
 *
 * A screen rather than a sheet. The calendar is a place you navigate, and a
 * day opened from it is somewhere you stay for a while — reading what
 * happened, opening a medicine, correcting a mark. A sheet over a month grid
 * made all three feel like a peek.
 *
 * Three mutually exclusive framings, and the screen says which one applies
 * before showing anything:
 *   - editable: within the correction window. "You can still correct this day."
 *   - locked:   past the household's freeze line. Readable forever, not
 *               changeable — and it says so, rather than showing dead buttons.
 *   - future:   not happened yet. You can see what is planned, nothing more.
 *
 * Correcting a mark opens the same medicine sheet the rest of the app uses,
 * with the same words on the same buttons. There is no second vocabulary for
 * fixing yesterday.
 */

import * as store from '../store.js';
import * as photos from '../photos.js';
import { S, firstNameOf } from '../strings.js';
import {
  el, mount, screen, paintTone, pillTile, doseTone, doseText, toast,
} from '../ui.js';
import { loadDay, describeDay, doseKey } from '../day-model.js';
import { doses, mayMark } from '../marking.js';
import { todayStr, formatLong, isAfter, parse } from '../date.js';
import { openMedicineSheet } from './medicine-sheet.js';

export async function dayView({ app, query, isCurrent = () => true }) {
  const date = query?.get('date') || todayStr();
  const settings = await store.getSettings();
  if (!isCurrent()) return;

  const today = todayStr();
  const locked = settings.lockedThrough;
  const isFuture = isAfter(date, today);
  const isLocked = !isFuture && locked && !isAfter(date, locked);
  const editable = !isFuture && !isLocked;

  const tokens = [];
  const cleanup = () => photos.releaseAll(tokens.splice(0));

  const day = await loadDay(date);
  if (!isCurrent()) return cleanup;

  const medicineIds = [...new Set(day.groups.flatMap(g => g.medicines.map(m => m.medicineId)))];
  const photoRows = await Promise.all(medicineIds.map(id => store.getPhoto(id).catch(() => null)));
  if (!isCurrent()) return cleanup;
  const urlFor = new Map();
  photoRows.forEach((row, i) => {
    if (!row?.blob) return;
    const { url, token } = photos.objectUrl(row.blob);
    tokens.push(token);
    urlFor.set(medicineIds[i], url);
  });

  function restore(snapshot) {
    day.states.clear();
    for (const [k, v] of snapshot) day.states.set(k, v);
  }

  async function setDose(card, medicine, status) {
    if (status && !await mayMark(settings, {
      householdName: firstNameOf(settings.supporterHouseholdName),
    })) return;

    const key = doseKey(card.id, medicine.medicineId);
    const before = new Map(day.states);
    if (status) day.states.set(key, status); else day.states.delete(key);
    draw();

    try {
      await doses.setDose(settings, date, card.id, medicine.medicineId, status);
    } catch {
      restore(before);
      draw();
      toast(S.errGeneric);
    }
  }

  function framing() {
    if (isLocked) {
      return el('div.s-lock', [
        el('span.s-lock-glyph', { 'aria-hidden': 'true', text: '▣' }),
        el('span.s-lock-text', { text: S.lockedBody }),
      ]);
    }
    if (isFuture) return el('div.s-future', { text: S.futureBody });
    return el('div.s-editable', { text: S.editableBody });
  }

  function medRow(card, medicine) {
    const tone = doseTone(medicine.state);
    const row = paintTone(el('div.s-medrow'), tone);

    row.appendChild(el('button.s-medrow-open', {
      type: 'button',
      onclick: () => openMedicineSheet({
        medicine,
        url: urlFor.get(medicine.medicineId),
        slotName: card.name,
        state: medicine.state,
        onMark: editable
          ? status => setDose(card, medicine, status)
          : null,
      }),
    }, [
      pillTile({
        id: medicine.medicineId,
        url: urlFor.get(medicine.medicineId),
        form: medicine.form,
        size: 'xs',
        label: false,
      }),
      el('span.s-medrow-main', [
        el('span.s-medrow-name', {
          text: [medicine.name, medicine.strength].filter(Boolean).join(' '),
        }),
        el('span.s-medrow-state', {
          text: [`${tone.glyph} ${tone.label}`, doseText(medicine)].filter(Boolean).join(' · '),
        }),
      ]),
    ]));

    if (editable) {
      row.appendChild(el('button.btn-s.btn-s-xs.btn-nav-outline', {
        type: 'button',
        text: S.dayChange,
        onclick: () => openMedicineSheet({
          medicine,
          url: urlFor.get(medicine.medicineId),
          slotName: card.name,
          state: medicine.state,
          onMark: status => setDose(card, medicine, status),
        }),
      }));
    }

    return row;
  }

  function slotCard(card) {
    const node = el('div.s-daycard');
    const head = paintTone(el('div.s-daycard-head'), card.tone);
    head.appendChild(el('span.s-daycard-ring', { 'aria-hidden': 'true', text: card.tone.glyph }));
    head.appendChild(el('span.s-daycard-name', { text: `${card.name} · ${card.time}` }));
    head.appendChild(el('span.s-daycard-status', { text: card.statusText }));
    node.appendChild(head);
    for (const m of card.medicines) node.appendChild(medRow(card, m));
    return node;
  }

  function draw() {
    const cards = describeDay(day, date);
    const { y, m } = parse(date);

    mount(app, screen({
      head: el('div.s-day-head', [
        el('a.s-day-back', { href: '#/calendar' }, `‹ ${S.monthNames[m - 1]} ${y}`),
        el('span.s-day-title', { text: formatLong(date, S.monthNames, S.weekdayNames) }),
      ]),
      scroll: el('div.s-list', [
        framing(),
        cards.length
          ? null
          : el('div.s-card', [
            el('span.s-card-title', { text: S.dayNothing }),
            el('span.s-card-note', { text: S.dayNothingBody }),
          ]),
        ...cards.map(slotCard),
      ]),
    }), { keepScroll: true });
  }

  draw();
  return cleanup;
}
