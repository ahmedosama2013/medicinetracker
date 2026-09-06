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
import { el, icon, pillTile, emptyState, toast } from '../ui.js';
import { formatTime, todayStr, timeToMinutes } from '../date.js';
import { openMedicineSheet } from './medicine-sheet.js';

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

  /* "slotId|medicineId" -> 'taken' | 'skipped'. Absent means unmarked.
   * Rows written before migration 0005 have no status; they are all takens. */
  const stateByKey = new Map(log.map(r => [`${r.slotId}|${r.medicineId}`, r.status || 'taken']));
  const keyOf = (slotId, medicineId) => `${slotId}|${medicineId}`;
  const stateOf = (slotId, medicineId) => stateByKey.get(keyOf(slotId, medicineId)) || null;

  /* The slot whose time has most recently passed, on today only. Purely a
   * label: the order below is still fixed, nothing is hidden and nothing is
   * dimmed. It exists because a fixed order cannot say where in the day you
   * are, which is the one thing it costs the person to work out themselves. */
  let nowSlotId = null;
  if (date === todayStr()) {
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    for (const group of groups) {
      if (timeToMinutes(group.time) <= nowMinutes) nowSlotId = group.slotId;
    }
  }

  const wrap = el('div.day');
  if (lockReason) wrap.appendChild(el('p.note', { text: lockReason }));

  /* Marking a slot done swaps ONLY that slot's node. Re-rendering the whole
   * day would re-read the database, reload every photo and jump the scroll
   * position - it reads as the page refreshing under the person's thumb, which
   * is alarming when you have just pressed something. */
  /** The medicine's photo, or a tinted fallback. See pillTile in js/ui.js. */
  function tileFor(medicine, { state = null, size = null } = {}) {
    return pillTile({
      id: medicine.medicineId,
      url: urlByMedicine.get(medicine.medicineId),
      form: medicine.form,
      state,
      size,
    });
  }

  /* The dose target cycles unmarked -> taken -> skipped -> unmarked. One tap
   * covers the common case and the rest are deliberate. Two taps land on
   * "skipped", which is reachable by accident, so that state is loud -- amber
   * fill, struck-through name -- and raises a toast offering the way back. */
  const NEXT_STATE = { null: 'taken', taken: 'skipped', skipped: null };

  const slotResolved = group =>
    group.medicines.every(m => stateByKey.has(keyOf(group.slotId, m.medicineId)));

  async function cycleDose(group, medicine) {
    const key = keyOf(group.slotId, medicine.medicineId);
    const next = NEXT_STATE[String(stateOf(group.slotId, medicine.medicineId))];
    const wasResolved = slotResolved(group);
    try {
      await sync.setDose(householdId, date, group.slotId, medicine.medicineId, next);
      if (next === null) stateByKey.delete(key); else stateByKey.set(key, next);

      /* Collapse only on the transition into resolved, so marking every
       * medicine one at a time ends up exactly where tapping Done does --
       * two routes to the same state must not leave the slot looking
       * different. Editing inside an already-resolved slot (the person
       * expanded the strip to change something) keeps it open, because
       * collapsing what they just chose to open is the jarring case. */
      const justResolved = !wasResolved && slotResolved(group);
      redrawSlot(group, { expanded: justResolved ? null : true });
      onChange?.();

      if (next === 'skipped') {
        toast(S.skippedToast(medicine.name), {
          actionLabel: S.undo,
          // Back to taken, not to unmarked: reaching skipped by accident means
          // one tap too many, and one tap too many lands you here from taken.
          onAction: async () => {
            try {
              await sync.setDose(householdId, date, group.slotId, medicine.medicineId, 'taken');
              stateByKey.set(key, 'taken');
              redrawSlot(group, { expanded: true });
              onChange?.();
            } catch { toast(S.errGeneric); }
          },
        });
      }
    } catch {
      toast(S.errGeneric);
    }
  }

  function medRow(group, medicine) {
    const state = stateOf(group.slotId, medicine.medicineId);
    const row = el(`div.med${state === 'skipped' ? '.med-skipped' : ''}`);

    row.appendChild(el('button.med-open', {
      type: 'button',
      onclick: () => openMedicineSheet({
        medicine,
        url: urlByMedicine.get(medicine.medicineId),
      }),
    }, [
      tileFor(medicine, { state }),
      // Name and strength share a line, dosage and notes share the next. With
      // five or six medicines in one slot, a four-line card pushes the Done
      // button off the screen.
      el('span.med-main', [
        el('span.med-line', [
          el('span.med-name', { text: medicine.name }),
          medicine.strength ? el('span.med-strength', { text: ` ${medicine.strength}` }) : null,
        ]),
        el('span.med-line.med-sub', [
          state === 'skipped'
            ? el('span.med-skip-note', { text: S.skipped })
            : (medicine.dosage ? el('span.med-dosage', { text: medicine.dosage }) : null),
          medicine.notes ? el('span.med-notes', { text: medicine.notes }) : null,
        ]),
      ]),
    ]));

    if (editable) {
      // The label says what the NEXT tap does, because the control cycles and
      // a screen reader cannot see where it currently sits.
      const label = state === 'taken' ? S.doseTaken(medicine.name)
        : state === 'skipped' ? S.doseSkipped(medicine.name)
          : S.doseNotYet(medicine.name);
      row.appendChild(el('button.dose', {
        type: 'button',
        dataset: { state: state || 'none' },
        'aria-label': label,
        onclick: () => cycleDose(group, medicine),
      }, state === 'taken' ? icon('check') : state === 'skipped' ? icon('minus') : null));
    }

    return row;
  }

  /**
   * @param {object} group
   * @param {boolean|null} expanded  null = collapse iff complete. A completed
   *   slot collapses to a strip of photos rather than six full rows, which is
   *   what buys the space for the rest of the day. Collapsing is driven by
   *   state, never by the clock, and the strip stays tappable so the photos
   *   are never locked away behind having marked the slot done.
   */
  /* The live node per slot, so a state change can swap exactly one of them. */
  const nodeBySlot = new Map();

  function redrawSlot(group, opts) {
    // Read the current node BEFORE building: buildSlot registers the node it
    // creates, so asking afterwards hands back the new detached one and
    // replaceWith quietly becomes a no-op.
    const previous = nodeBySlot.get(group.slotId);
    const next = buildSlot(group, opts);
    previous.replaceWith(next);
    return next;
  }

  function buildSlot(group, { expanded = null } = {}) {
    /* Three states per medicine give three per slot. "Resolved" means every
     * medicine has been dealt with one way or the other, which is what drives
     * collapsing and the Undo button. "All taken" is the narrower claim, and
     * only it earns the green treatment -- a slot with a skip in it has been
     * handled, but saying "All taken" there would be a lie. */
    const states = group.medicines.map(m => stateOf(group.slotId, m.medicineId));
    const resolved = states.every(Boolean);
    const allTaken = resolved && states.every(s => s === 'taken');
    const showRows = expanded === null ? !resolved : expanded;

    const slotNode = el(`div.slot${allTaken ? '.slot-done' : resolved ? '.slot-marked' : ''}`);
    nodeBySlot.set(group.slotId, slotNode);

    slotNode.appendChild(el('div.slot-head', [
      el('span.slot-name', { text: group.label }),
      el('span.slot-time', { text: formatTime(group.time) }),
      allTaken
        ? el('span.slot-tag', [icon('check'), el('span', { text: S.allTaken })])
        : resolved
          ? el('span.slot-tag', [el('span', { text: S.allMarked })])
          : (group.slotId === nowSlotId ? el('span.slot-now', { text: S.nowLabel }) : null),
    ]));

    if (showRows) {
      slotNode.appendChild(el('div.slot-body',
        group.medicines.map(medicine => medRow(group, medicine))));
    } else {
      slotNode.appendChild(el('button.slot-collapsed', {
        type: 'button',
        'aria-expanded': 'false',
        'aria-label': S.showMedicines,
        onclick: () => redrawSlot(group, { expanded: true }),
      }, [
        // No per-tile state badges here: the tiles overlap, so each badge
        // would be hidden by the next tile along. The slot tag above already
        // says whether this was all taken or merely all marked, and the strip
        // expands if the person wants it medicine by medicine.
        el('span.ptile-stack', group.medicines.map(m => tileFor(m, { size: 'sm' }))),
        el('span.slot-count', { text: S.medicineCount(group.medicines.length) }),
        el('span.row-chev', { 'aria-hidden': 'true', text: '›' }),
      ]));
    }

    if (editable) {
      const action = el('div.slot-foot');
      const button = el(`button.btn.btn-block.btn-lg.${resolved ? 'btn-quiet' : 'btn-primary'}`, {
        type: 'button',
        text: resolved ? S.undo : S.done,
        onclick: async () => {
          button.disabled = true;
          const hadFocus = document.activeElement === button;
          try {
            if (resolved) {
              await sync.undoSlot(householdId, date, group.slotId);
              for (const m of group.medicines) stateByKey.delete(keyOf(group.slotId, m.medicineId));
            } else {
              /* Marks only what is still unmarked. store.logSlot filters out
               * medicines that already have a row, so a deliberate skip
               * survives a subsequent Done -- the person said something about
               * that medicine and this button must not overrule it. */
              await sync.logSlot(householdId, date, group.slotId, group.medicines.map(m => m.medicineId));
              for (const m of group.medicines) {
                const key = keyOf(group.slotId, m.medicineId);
                if (!stateByKey.has(key)) stateByKey.set(key, 'taken');
              }
            }
            const next = redrawSlot(group);
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
    } else if (resolved) {
      slotNode.appendChild(el('div.slot-foot',
        el('span.slot-tick', [icon('check'), allTaken ? S.allTaken : S.allMarked])));
    }

    return slotNode;
  }

  /* Fixed chronological order: morning at the top, night at the bottom, all
   * day long. Nothing here *moves* because of the clock -- the "Now" label
   * above is the only thing that reads it, and it only labels. */
  for (const group of groups) wrap.appendChild(buildSlot(group));

  return { node: wrap, cleanup };
}
