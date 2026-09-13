/* What a day looks like, derived once and read by every screen that shows it.
 *
 * The handoff is explicit that this belongs in a selector rather than in a
 * view: "the medicines due in it today, how many are marked, whether it is
 * past due, the resulting state tone, the status string, the medicine-name
 * summary string, and the take-button label". Four screens need exactly that
 * set — the elder's Today, the elder's slot detail, the helper's Today and the
 * helper's day detail — and they must never disagree about it, because the
 * same household is looking at two of them at once.
 *
 * Pure apart from loadDay(), which is the one read from the store.
 */

import * as store from './store.js';
import * as schedule from './schedule.js';
import { S } from './strings.js';
import { TONE } from './ui.js';
import { formatTime, timeToMinutes, nowMinutes, todayStr } from './date.js';

export const doseKey = (slotId, medicineId) => `${slotId}|${medicineId}`;

/**
 * Everything one day needs: what was expected, and what has been marked.
 *
 * `expectedFor` returns the frozen snapshot when there is one, so a past day
 * keeps showing what was actually due at the time rather than what the routine
 * says today.
 */
export async function loadDay(date) {
  const [groups, log] = await Promise.all([
    schedule.expectedFor(date),
    store.getDoseLogForDate(date),
  ]);

  /* Rows written before migration 0005 have no status; they are all takens. */
  const states = new Map(log.map(r => [doseKey(r.slotId, r.medicineId), r.status || 'taken']));

  /* Who recorded each row. Only ever surfaced on the elder's own screen: on
   * the helper's it would be telling them what they already know, and the
   * point of the attribution is that the person taking the medicines is never
   * surprised by a mark they did not make. */
  const loggedBy = new Map(log.map(r => [doseKey(r.slotId, r.medicineId), r.loggedBy || null]));

  return { groups, states, loggedBy };
}

/**
 * Describe one slot. `states` is the live Map from loadDay, mutated optimistically
 * by the views, so calling this again after a tap gives the new answer with no
 * round trip.
 *
 * @param {object} group   one entry from schedule.expectedFor
 * @param {Map} states     doseKey -> 'taken' | 'skipped'
 * @param {string} date    the day being described; lateness only applies today
 */
export function describeSlot(group, states, date) {
  const medicines = group.medicines.map(m => ({
    ...m,
    state: states.get(doseKey(group.slotId, m.medicineId)) || null,
  }));

  const total = medicines.length;
  const marked = medicines.filter(m => m.state).length;
  const skipped = medicines.filter(m => m.state === 'skipped').length;

  /* "Resolved" means every medicine was dealt with one way or the other, which
   * is what drives the done tone and the Undo label. "All taken" is the
   * narrower claim, and only it gets the plain "All taken" wording — a slot
   * with something left out has been handled, but saying "All taken" there
   * would be a lie. */
  const resolved = total > 0 && marked === total;
  const allTaken = resolved && skipped === 0;

  /* Past due, and only ever on today. A slot on a past calendar day is not
   * "late", it is simply history, and painting last Tuesday red would be
   * scoring the person. */
  const late = date === todayStr()
    && !resolved
    && timeToMinutes(group.time) <= nowMinutes();

  /* A day strictly before today. Distinct from `late`: a slot on a day that
   * has already happened and was never marked is not "still to come" --
   * that phrase is only true of a slot later THIS day, or of a future day the
   * calendar paged forward to. Getting this wrong is exactly the bug it
   * looks like: a past, empty slot claiming to be in the future. */
  const isPast = date < todayStr();

  const key = marked === 0 ? 'open' : (resolved ? 'done' : 'part');

  const tone = resolved ? TONE.done : (late ? TONE.late : TONE.wait);

  const statusText = resolved
    ? (skipped ? S.statusAllDealtWith(skipped) : S.statusAllTaken)
    : (marked > 0
      ? S.statusPartial(marked, total)
      : (late ? S.statusNotTakenYet : (isPast ? S.statusNotMarked : S.statusStillToCome)));

  return {
    id: group.slotId,
    name: group.label,
    time: formatTime(group.time),
    rawTime: group.time,
    group,
    medicines,
    total,
    marked,
    skipped,
    resolved,
    allTaken,
    late,
    isPast,
    key,
    tone,
    statusText,
    countText: S.slotCount(total),
    /* Never wraps, never clips mid-word: two names join with "and", three or
     * more become "{first} and N more". The CSS ellipsis behind this is the
     * second line of defence, not the mechanism. */
    medNames: S.medNamesSummary(medicines.map(m => m.name)),
    takeLabel: total === 1 ? S.takeThis : S.takeThese,
    undoLabel: total === 1 ? S.undoThis : S.undoThese,
  };
}

/** Every slot of a day, in the order they happen. */
export function describeDay({ groups, states }, date) {
  return groups.map(group => describeSlot(group, states, date));
}

/** True when every slot of the day has been dealt with. */
export const dayResolved = cards => cards.length > 0 && cards.every(c => c.resolved);
