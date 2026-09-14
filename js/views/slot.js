/* E2 - one time of day, for the person taking the medicines.
 *
 * Reached only from "See the pills" on a Today card. Today already marks the
 * whole slot in one tap; this screen exists for the other question - "is this
 * the right tablet?" - so the photo comes first and every medicine gets its
 * own button.
 *
 * One deliberate departure from the prototype: its medicine cards are
 * `flex: 1 1 0`, dividing the screen between however many there are. That is
 * lovely with two and clips with five, and clipping a dose is not a trade this
 * screen gets to make. Cards are natural height in the one scrolling region
 * instead, which looks identical for the two- and three-medicine cases that
 * cover almost every household, and simply scrolls beyond that.
 */

import * as store from '../store.js';
import * as photos from '../photos.js';
import { S } from '../strings.js';
import {
  el, mount, screen, paintTone, pillTile, doseTone, doseText, toast,
} from '../ui.js';
import { loadDay, describeSlot, doseKey } from '../day-model.js';
import { doses, settled } from '../marking.js';
import { todayStr, formatLong, isAfter } from '../date.js';
import { go } from '../router.js';
import { openMedicineSheet } from './medicine-sheet.js';

/* `?date=` lets this screen open on a day other than today -- the elder's
 * "See yesterday" sheet on Today links here rather than inventing its own,
 * separate per-medicine screen. Absent, it is today, exactly as before.
 *
 * Editability follows the same rule js/views/day.js already uses for the
 * helper's calendar: within the household's correction window (today, or a
 * past day not yet behind settings.lockedThrough) it can still be marked;
 * before that line it is a record, readable and openable, not changeable. */
export async function slotView({ app, query, isCurrent = () => true }) {
  const date = query?.get('date') || todayStr();
  const slotId = query?.get('id') || '';
  const settings = await store.getSettings();
  if (!isCurrent()) return;

  const today = todayStr();
  const isFuture = isAfter(date, today);
  const isLocked = !isFuture && settings.lockedThrough && !isAfter(date, settings.lockedThrough);
  const editable = !isFuture && !isLocked;

  const tokens = [];
  const cleanup = () => photos.releaseAll(tokens.splice(0));

  const day = await loadDay(date);
  if (!isCurrent()) return cleanup;

  const group = day.groups.find(g => g.slotId === slotId) || day.groups[0];
  if (!group) {
    // Nothing due in any slot - a stale link, or the routine changed. Back to
    // Today rather than a blank screen with a back button.
    go('#/today', { replace: true });
    return cleanup;
  }

  // One photo per medicine in this slot, and only this slot.
  const urlFor = new Map();
  const rows = await Promise.all(group.medicines.map(m => store.getPhoto(m.medicineId).catch(() => null)));
  if (!isCurrent()) return cleanup;
  rows.forEach((row, i) => {
    if (!row?.blob) return;
    const { url, token } = photos.objectUrl(row.blob);
    tokens.push(token);
    urlFor.set(group.medicines[i].medicineId, url);
  });

  // ---- writes -------------------------------------------------------------

  function restore(snapshot) {
    day.states.clear();
    for (const [k, v] of snapshot) day.states.set(k, v);
  }

  async function setDose(medicine, status) {
    const key = doseKey(group.slotId, medicine.medicineId);
    const before = new Map(day.states);
    if (status) day.states.set(key, status); else day.states.delete(key);
    draw();

    try {
      await doses.setDose(settings, date, group.slotId, medicine.medicineId, status);
    } catch {
      restore(before);
      draw();
      toast(S.errGeneric);
    }
  }

  async function markAll(card) {
    const before = new Map(day.states);
    for (const m of card.medicines) {
      if (!m.state) day.states.set(doseKey(card.id, m.medicineId), 'taken');
    }
    draw();
    try {
      await settled(card.medicines.map(m => doseKey(card.id, m.medicineId)));
      await doses.logSlot(settings, date, card.id, card.medicines.map(m => m.medicineId));
    } catch {
      restore(before);
      draw();
      toast(S.errGeneric);
      return;
    }
  }

  async function undoAll(card) {
    const before = new Map(day.states);
    for (const m of card.medicines) day.states.delete(doseKey(card.id, m.medicineId));
    draw();
    try {
      await settled(card.medicines.map(m => doseKey(card.id, m.medicineId)));
      await doses.undoSlot(settings, date, card.id);
    } catch {
      restore(before);
      draw();
      toast(S.errGeneric);
      return;
    }
  }

  // ---- one medicine -------------------------------------------------------

  const markedByHelper = medicine =>
    medicine.state && day.loggedBy.get(doseKey(group.slotId, medicine.medicineId)) === 'supporter';

  function medCard(card, medicine) {
    const tone = doseTone(medicine.state);
    const node = paintTone(el('div.med-card'), tone);

    const title = [medicine.name, medicine.strength].filter(Boolean).join(' ');
    const line = [doseText(medicine), medicine.purpose].filter(Boolean).join(' · ');

    /* The whole row is the target, not just the photo: it is 78px tall and the
     * thing a person points at is the pill, not a chevron. */
    node.appendChild(el('button.med-open', {
      type: 'button',
      onclick: () => openMedicineSheet({
        medicine,
        url: urlFor.get(medicine.medicineId),
        slotName: card.name,
        state: medicine.state,
        onMark: editable ? status => setDose(medicine, status) : null,
      }),
    }, [
      pillTile({
        id: medicine.medicineId,
        url: urlFor.get(medicine.medicineId),
        form: medicine.form,
        alt: title,
      }),
      el('span.med-main', [
        el('span.med-name', { text: title }),
        line ? el('span.med-sub', { text: line }) : null,
        /* Who marked it. Only ever shown on the elder's own screen, and only
         * when it was not them: the point of the attribution is that the
         * person taking the medicines is never surprised by a tick they did
         * not make. */
        el('span.med-state', {
          text: markedByHelper(medicine)
            ? `${tone.glyph} ${tone.label} · ${S.markedByHelper}`
            : `${tone.glyph} ${tone.label}`,
        }),
        el('span.med-more', { text: S.biggerPicture }),
      ]),
    ]));

    /* A locked or future day is a record, not a form: js/views/day.js hides
     * these same controls for the same reason rather than showing a button
     * that would just fail or need explaining. Opening the medicine (above)
     * still works either way -- reading it back is never restricted. */
    if (!editable) return node;

    if (medicine.state === 'taken') {
      node.appendChild(el('button.med-clear', {
        type: 'button',
        text: S.undoNotTaken,
        onclick: () => setDose(medicine, null),
      }));
    } else {
      node.appendChild(el('button.med-take', {
        type: 'button',
        text: S.takeThisOne,
        onclick: () => setDose(medicine, 'taken'),
      }));
    }

    /* "Leave this one out today", never "Skip" - and it is always reversible
     * with "Put it back on the list", in the same place. */
    if (!medicine.state) {
      node.appendChild(el('button.med-textaction', {
        type: 'button',
        text: S.leaveOutToday,
        onclick: () => setDose(medicine, 'skipped'),
      }));
    } else if (medicine.state === 'skipped') {
      node.appendChild(el('button.med-textaction', {
        type: 'button',
        text: S.putBackOnList,
        onclick: () => setDose(medicine, null),
      }));
    }

    return node;
  }

  // ---- draw ---------------------------------------------------------------

  function draw() {
    const card = describeSlot(group, day.states, date);

    mount(app, screen({
      head: el('div.eslot-head', [
        el('a.eslot-back', { href: '#/today' }, [
          el('span', { 'aria-hidden': 'true', text: '‹' }),
          el('span', { text: S.backToToday }),
        ]),
        el('span.eslot-title', [
          // Today never shows its own date here -- it says so everywhere
          // else on that screen. A day reached via ?date= does, so it is
          // never ambiguous which day's medicines these buttons would change.
          date !== today
            ? el('span.eslot-date', { text: formatLong(date, S.monthNames, S.weekdayNames) })
            : null,
          el('span.eslot-name', { text: card.name }),
          el('span.eslot-time', { text: card.time }),
        ]),
      ]),
      scroll: el('div.eslot-list', card.medicines.map(m => medCard(card, m))),
      foot: el('div.eslot-foot', editable ? [
        card.resolved
          ? el('button.eslot-all.eslot-all-undo', {
            type: 'button',
            text: S.undoAllOfSlot(card.undoLabel, card.name),
            onclick: () => undoAll(card),
          })
          : el('button.eslot-all', {
            type: 'button',
            text: S.markAllOfSlot(card.takeLabel, card.name),
            onclick: () => markAll(card),
          }),
      ] : [
        el('p.scard-note', { text: isFuture ? S.futureBody : S.lockedBody }),
      ]),
    }), { keepScroll: true });
  }

  draw();
  return cleanup;
}
