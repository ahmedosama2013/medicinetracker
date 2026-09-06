/* What goes in the weekly pill box, and where.
 *
 * Pure functions, like js/schedule.js and for the same reason: this is the
 * arithmetic behind the most stateful screen in the app, and being able to
 * call it from the browser console with plain arrays is the difference between
 * debugging a calculation and debugging a calculation through three layers of
 * DOM.
 *
 * Computed forward from `schedule.isDueOn`, never from day snapshots. A
 * snapshot is a record of a past day; this looks at the next seven, which have
 * none.
 *
 * Nothing here writes anything, and in particular nothing here touches the
 * dose log. Filling a tray is not taking a medicine, and conflating the two
 * would quietly falsify the calendar -- see docs/ui.md.
 */

import { isDueOn } from './schedule.js';
import { addDays, timeToMinutes } from './date.js';

/* What can physically go in a compartment. `other` is included because it is
 * still a discrete countable thing; the four that are excluded are excluded
 * because you cannot put a spoonful of syrup or a puff of an inhaler in a
 * plastic tray and come back to it on Thursday.
 *
 * This is why js/ui.js's pillTile has a droplet glyph at all -- the
 * tablet/liquid distinction is decorative everywhere else in the app and
 * load-bearing here. */
export const BOX_FORMS = ['tablet', 'capsule', 'other'];

export const goesInBox = form => BOX_FORMS.includes(form || 'tablet');

const round2 = n => Math.round(n * 100) / 100;

/** The seven dates a week covers, starting from `startDate`. */
export function weekDates(startDate) {
  return Array.from({ length: 7 }, (_, i) => addDays(startDate, i));
}

/** The times of day that go in the box, in the order they happen. */
function boxSlotsOf(slots) {
  return slots
    .filter(s => s.inBox)
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
}

/**
 * Plan a week's filling. Pure.
 *
 * @param {string} startDate  "YYYY-MM-DD", the first day of the seven
 * @param {object} routine    { medicines, schedules, slots }
 * @returns {object} see the shape built at the bottom
 *
 * `steps` and `compartments` are the same data pivoted two ways, because the
 * two screens ask opposite questions. Filling asks "where does this medicine
 * go?" -- one row per medicine, so each box is opened exactly once. Checking
 * asks "what should be in this compartment?" -- one cell per compartment,
 * because that is the order your eye moves along a filled tray. Computing both
 * here rather than pivoting in a view keeps the two screens provably
 * consistent: they are literally the same numbers.
 */
export function planWeek(startDate, { medicines = [], schedules = [], slots = [] } = {}) {
  const dates = weekDates(startDate);
  const boxSlots = boxSlotsOf(slots);
  const boxSlotIds = new Set(boxSlots.map(s => s.id));
  const slotById = new Map(slots.map(s => [s.id, s]));
  const byId = new Map(medicines.filter(m => !m.archived).map(m => [m.id, m]));

  /* medicineId -> { inBox: Set(slotId), outOfBox: Set(slotId) }, for slots this
   * medicine is actually due on at some point this week. A medicine due only
   * on days outside the week is not this week's problem and must not appear. */
  const due = new Map();
  const dueOnDay = new Map();          // `${medicineId}|${slotId}|${date}` -> true

  for (const sched of schedules) {
    const medicine = byId.get(sched.medicineId);
    if (!medicine) continue;                       // archived, or gone
    if (!slotById.has(sched.slotId)) continue;     // slot was removed

    for (const date of dates) {
      if (!isDueOn(sched, date)) continue;
      dueOnDay.set(`${medicine.id}|${sched.slotId}|${date}`, true);

      if (!due.has(medicine.id)) due.set(medicine.id, { inBox: new Set(), outOfBox: new Set() });
      const bucket = due.get(medicine.id);
      if (boxSlotIds.has(sched.slotId)) bucket.inBox.add(sched.slotId);
      else bucket.outOfBox.add(sched.slotId);
    }
  }

  // ---- steps: one per medicine that has anything to put in the box --------

  const steps = [];
  for (const [medicineId, buckets] of due) {
    const medicine = byId.get(medicineId);
    if (!goesInBox(medicine.form) || !buckets.inBox.size) continue;

    let total = 0;
    const qty = Number(medicine.doseQty) || 1;
    const grid = boxSlots.map(slot => ({
      slotId: slot.id,
      label: slot.label,
      time: slot.time,
      days: dates.map(date => {
        /* Three states, not two. A cell that is not due is a different thing
         * from a cell that is due and not yet filled, and rendering both as
         * empty makes a weekly medicine's five blank days read as work still
         * outstanding. The view draws `due: false` as a dash. */
        const isDue = dueOnDay.has(`${medicineId}|${slot.id}|${date}`);
        if (isDue) total += qty;
        return { date, due: isDue, qty: isDue ? qty : 0 };
      }),
    }));

    steps.push({
      medicineId,
      name: medicine.name,
      strength: medicine.strength || '',
      form: medicine.form || 'tablet',
      purpose: medicine.purpose || '',
      doseQty: qty,
      grid,
      /* Rounded because this is added up and then read aloud against a
       * physical pile of tablets. dose_qty is numeric(4,2), so a tenth is a
       * legal value, and seven of them accumulate to 0.7000000000000001 in
       * binary -- a total no one can count out. Quarters and halves are exact
       * and unaffected. */
      total: round2(total),
    });
  }

  // Alphabetical, because the order has to be stable across a sitting that may
  // be interrupted, and no other ordering means anything here -- these are
  // boxes on a table, not a sequence of events.
  steps.sort((a, b) => a.name.localeCompare(b.name));

  // ---- compartments: the same numbers, pivoted for checking ---------------

  const stepById = new Map(steps.map(s => [s.medicineId, s]));
  const compartments = boxSlots.map(slot => ({
    slotId: slot.id,
    label: slot.label,
    time: slot.time,
    days: dates.map(date => {
      const items = [];
      let total = 0;
      for (const step of steps) {
        const cell = step.grid.find(r => r.slotId === slot.id)
          ?.days.find(d => d.date === date);
        if (!cell?.due) continue;
        items.push({
          medicineId: step.medicineId, name: step.name,
          form: step.form, qty: cell.qty,
        });
        total += cell.qty;
      }
      return { date, items, total: round2(total) };
    }),
  }));

  // ---- out of the box, with the reason -----------------------------------

  /* Two different reasons, and they need different words on screen. A syrup is
   * out because you cannot put it in a tray at all; a tablet whose slot is
   * unticked is out because of how this household's box is shaped, and that is
   * a setting the person can change. Collapsing them into "not in the box"
   * would make the second look like a fact about the medicine. */
  const outOfBox = [];
  for (const [medicineId, buckets] of due) {
    const medicine = byId.get(medicineId);
    const labelsFor = ids => [...ids]
      .map(id => slotById.get(id))
      .filter(Boolean)
      .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time))
      .map(s => s.label);

    if (!goesInBox(medicine.form)) {
      outOfBox.push({
        medicineId, name: medicine.name, strength: medicine.strength || '',
        form: medicine.form, doseQty: Number(medicine.doseQty) || 1,
        reason: 'form',
        slotLabels: labelsFor([...buckets.inBox, ...buckets.outOfBox]),
      });
      continue;
    }
    /* A boxable medicine can be in BOTH lists at once, and that is correct:
     * one due morning and afternoon, with only morning in the box, gets boxed
     * for the morning and taken from the packet at lunchtime. Suppressing
     * either half would lose a dose. */
    if (buckets.outOfBox.size) {
      outOfBox.push({
        medicineId, name: medicine.name, strength: medicine.strength || '',
        form: medicine.form, doseQty: Number(medicine.doseQty) || 1,
        reason: 'slot',
        slotLabels: labelsFor(buckets.outOfBox),
      });
    }
  }
  outOfBox.sort((a, b) => a.name.localeCompare(b.name));

  return { startDate, dates, boxSlots, steps, compartments, outOfBox, stepById };
}
