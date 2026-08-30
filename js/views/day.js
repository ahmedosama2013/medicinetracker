/* One day's medicines, grouped by slot.
 *
 * Shared by the Today screen and the calendar's day sheet, so a past day is
 * corrected with exactly the same controls the patient already knows.
 *
 * Returns { node, cleanup }. The caller must call cleanup() on unmount: photo
 * object URLs are revoked there.
 */

import * as store from '../store.js';
import * as sync from '../sync.js';
import * as schedule from '../schedule.js';
import * as photos from '../photos.js';
import { S } from '../strings.js';
import { el, icon, openPhotoViewer, emptyState, toast } from '../ui.js';
import { formatTime } from '../date.js';

/**
 * @param {string} date          "YYYY-MM-DD"
 * @param {boolean} editable     false for future days and locked days
 * @param {string} [lockReason]  shown when not editable
 * @param {Function} [onChange]  notified after a Done/Undo write. A notification
 *                               only: the slot has already updated itself, so a
 *                               caller must not re-render this day in response.
 */
export async function renderDay({ date, editable = true, lockReason = null, onChange = null }) {
  const [groups, log, settings] = await Promise.all([
    schedule.expectedFor(date),
    store.getDoseLogForDate(date),
    store.getSettings(),
  ]);
  const householdId = settings.householdId;

  const tokens = [];
  const cleanup = () => photos.releaseAll(tokens.splice(0));

  if (!groups.length) {
    return { node: emptyState(S.dayNothing), cleanup };
  }

  // Photos, fetched once for every medicine appearing today.
  const medicineIds = [...new Set(groups.flatMap(g => g.medicines.map(m => m.medicineId)))];
  const photoRows = await Promise.all(medicineIds.map(id => store.getPhoto(id).catch(() => null)));
  const urlByMedicine = new Map();
  photoRows.forEach((row, i) => {
    if (!row?.blob) return;
    const { url, token } = photos.objectUrl(row.blob);
    tokens.push(token);
    urlByMedicine.set(medicineIds[i], url);
  });

  const takenKeys = new Set(log.map(r => `${r.slotId}|${r.medicineId}`));

  const wrap = el('div.day');
  if (lockReason) wrap.appendChild(el('p.note', { text: lockReason }));

  /* Marking a slot done swaps ONLY that slot's node. Re-rendering the whole
   * day would re-read the database, reload every photo and jump the scroll
   * position - it reads as the page refreshing under the person's thumb, which
   * is alarming when you have just pressed something. */
  function buildSlot(group) {
    const complete = group.medicines.every(m => takenKeys.has(`${group.slotId}|${m.medicineId}`));

    const slotNode = el(`div.slot${complete ? '.slot-done' : ''}`);

    slotNode.appendChild(el('div.slot-head', [
      el('span.slot-name', { text: group.label }),
      el('span.slot-time', { text: formatTime(group.time) }),
      complete ? el('span.slot-tag', { text: S.allTaken }) : null,
    ]));

    const body = el('div.slot-body');
    for (const medicine of group.medicines) {
      const url = urlByMedicine.get(medicine.medicineId);
      body.appendChild(el('button.med', {
        type: 'button',
        onclick: () => openPhotoViewer({
          url,
          name: medicine.name,
          strength: medicine.strength,
          altText: `${medicine.name} ${medicine.strength || ''}`.trim(),
        }),
      }, [
        el('span.med-thumb', url
          ? el('img', { src: url, alt: '' })
          : icon('pill')),
        // Name and strength share a line, dosage and notes share the next.
        // With five or six medicines in one slot, a four-line card pushes the
        // Done button off the screen.
        el('span.med-main', [
          el('span.med-line', [
            el('span.med-name', { text: medicine.name }),
            medicine.strength ? el('span.med-strength', { text: ` ${medicine.strength}` }) : null,
          ]),
          el('span.med-line.med-sub', [
            medicine.dosage ? el('span.med-dosage', { text: medicine.dosage }) : null,
            medicine.notes ? el('span.med-notes', { text: medicine.notes }) : null,
          ]),
        ]),
      ]));
    }
    slotNode.appendChild(body);

    if (editable) {
      const action = el('div.slot-foot');
      const button = el(`button.btn.btn-block.btn-lg.${complete ? 'btn-quiet' : 'btn-primary'}`, {
        type: 'button',
        text: complete ? S.undo : S.done,
        onclick: async () => {
          button.disabled = true;
          const hadFocus = document.activeElement === button;
          try {
            if (complete) {
              await sync.undoSlot(householdId, date, group.slotId);
              for (const m of group.medicines) takenKeys.delete(`${group.slotId}|${m.medicineId}`);
            } else {
              await sync.logSlot(householdId, date, group.slotId, group.medicines.map(m => m.medicineId));
              for (const m of group.medicines) takenKeys.add(`${group.slotId}|${m.medicineId}`);
            }
            const next = buildSlot(group);
            slotNode.replaceWith(next);
            // Keyboard and screen-reader users were standing on the old button.
            if (hadFocus) next.querySelector('.slot-foot .btn')?.focus();
            onChange?.();
          } catch {
            button.disabled = false;
            toast(S.errGeneric);
          }
        },
      });
      action.appendChild(button);
      slotNode.appendChild(action);
    } else if (complete) {
      slotNode.appendChild(el('div.slot-foot', el('span.slot-tick', [icon('today'), S.allTaken])));
    }

    return slotNode;
  }

  /* Fixed chronological order: morning at the top, night at the bottom, all
   * day long. Nothing here reacts to the clock. */
  for (const group of groups) wrap.appendChild(buildSlot(group));

  return { node: wrap, cleanup };
}
