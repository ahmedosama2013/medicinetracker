/* What is due on a given day.
 *
 * Pure functions at the top (isDueOn, buildDay) so they can be exercised from
 * the browser console without a database; the async wrappers underneath read
 * from the store.
 *
 * All date handling goes through js/date.js. No UTC, no timestamp arithmetic.
 */

import * as store from './store.js';
import { daysBetween, dayOfWeek, timeToMinutes, isDateStr } from './date.js';

/** Is this schedule due on this date? Pure. */
export function isDueOn(schedule, dateStr) {
  if (!schedule || schedule.active === false) return false;
  const freq = schedule.frequency || {};

  if (freq.type === 'daily') return true;

  if (freq.type === 'everyNDays') {
    // anchorDate is mandatory: without it there is no way to know whether
    // today is an "on" day, so treat a missing anchor as never due rather
    // than silently guessing.
    if (!isDateStr(freq.anchorDate)) return false;
    const interval = Number(freq.interval);
    if (!Number.isFinite(interval) || interval < 1) return false;
    const delta = daysBetween(freq.anchorDate, dateStr);
    if (delta < 0) return false;                 // before it started
    return delta % interval === 0;
  }

  if (freq.type === 'weekly') {
    const days = freq.daysOfWeek;
    if (!Array.isArray(days) || !days.length) return false;
    return days.includes(dayOfWeek(dateStr));
  }

  return false;
}

/** The time a schedule fires: its own override, else its slot's default. */
export function effectiveTime(schedule, slot) {
  return schedule.time || slot?.time || '00:00';
}

/**
 * Group everything due on `dateStr` into slots, sorted by time. Pure.
 * Returns [{ slotId, label, time, medicines: [{ medicineId, name, strength, doseQty, notes, form, purpose }] }]
 */
export function buildDay(dateStr, { medicines, schedules, slots }) {
  const byId = new Map(medicines.map(m => [m.id, m]));
  const slotById = new Map(slots.map(s => [s.id, s]));
  const groups = new Map();   // key: slotId|time

  for (const schedule of schedules) {
    const medicine = byId.get(schedule.medicineId);
    if (!medicine || medicine.archived) continue;
    const slot = slotById.get(schedule.slotId);
    if (!slot) continue;                          // slot was removed
    if (!isDueOn(schedule, dateStr)) continue;

    const time = effectiveTime(schedule, slot);
    const key = `${schedule.slotId}|${time}`;
    if (!groups.has(key)) {
      groups.set(key, {
        slotId: schedule.slotId,
        label: slot.label,
        time,
        // The slot's OWN time, kept separate from any medicine's override --
        // see mergeBySlot for why the difference matters.
        slotTime: slot.time,
        medicines: [],
      });
    }
    const group = groups.get(key);
    if (group.medicines.some(m => m.medicineId === medicine.id)) continue;
    group.medicines.push({
      medicineId: medicine.id,
      name: medicine.name,
      strength: medicine.strength,
      /* Same both-shapes rule as toSnapshot below. A live medicine always has
       * doseQty after migration 0011 -- but a device that has not synced
       * since the app updated still holds pre-migration records in its cache,
       * and dropping the old field here rendered a blank dose for however
       * many seconds that took to heal. */
      ...(medicine.doseQty == null ? { dosage: medicine.dosage } : { doseQty: medicine.doseQty }),
      notes: medicine.notes,
      form: medicine.form,
      purpose: medicine.purpose,
      // Carried per medicine so a row can show its own time when it differs.
      time,
    });
  }

  return [...groups.values()].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
}

/**
 * A medicine given its own time inside a slot produces a second group with the
 * same slotId. Logging is keyed on (date, slotId), so those groups have to be
 * merged back together before they reach the UI, or one Done tap would appear
 * to complete both.
 *
 * The merged group keeps the SLOT's time, not the earliest medicine's. Taking
 * the minimum -- which both this and app.compute_day used to do -- meant that
 * overriding one medicine to 6am relabelled the whole Morning card "6:00 am"
 * for every other medicine in it. Nothing was actually written to the slot,
 * but it read exactly as though the override had moved everything, which is
 * what it was reported as.
 *
 * Each medicine keeps its own time, so an override stays visible on its row
 * rather than disappearing into the group.
 */
function mergeBySlot(groups) {
  const bySlot = new Map();
  for (const group of groups) {
    const existing = bySlot.get(group.slotId);
    if (!existing) {
      bySlot.set(group.slotId, { ...group, medicines: [...group.medicines] });
      continue;
    }
    for (const medicine of group.medicines) {
      if (!existing.medicines.some(m => m.medicineId === medicine.medicineId)) {
        existing.medicines.push(medicine);
      }
    }
  }

  /* Order and headline by the slot's own time. Snapshots written before this
   * change carry no slotTime, so fall back to the group's -- for those, the
   * old minimum-of-overrides is the only value there is. */
  for (const group of bySlot.values()) group.time = group.slotTime || group.time;
  return [...bySlot.values()].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
}

/** What is due on `dateStr`, computed live from the current routine. */
export async function dueOn(dateStr) {
  const [medicines, schedules, slots] = await Promise.all([
    store.getMedicines(), store.getActiveSchedules(), store.getSlots(),
  ]);
  return mergeBySlot(buildDay(dateStr, { medicines, schedules, slots }));
}

/**
 * What was expected on `dateStr`: the frozen snapshot if one exists, otherwise
 * computed from the current routine. Snapshots are written server-side by a
 * nightly job (see supabase/migrations/0001_init.sql, app.run_daily_freeze)
 * and synced onto this device by js/sync.js, which is what keeps past
 * calendar days honest after the routine changes.
 */
export async function expectedFor(dateStr) {
  const snapshot = await store.getSnapshot(dateStr);
  if (snapshot) return mergeBySlot(snapshot.slots || []);
  return dueOn(dateStr);
}

/** Shape a live day into a storable snapshot. */
export function toSnapshot(dateStr, groups) {
  return {
    date: dateStr,
    slots: groups.map(g => ({
      slotId: g.slotId,
      label: g.label,
      time: g.time,
      slotTime: g.slotTime || g.time,
      medicines: g.medicines.map(m => ({
        medicineId: m.medicineId,
        name: m.name,
        strength: m.strength,
        // `dosage` is carried through when present rather than converted:
        // this shapes snapshots, and a snapshot frozen before migration 0011
        // holds the free text that was true on the day. Rewriting it is the
        // one thing freezing a day exists to prevent. js/ui.js's doseText
        // renders whichever of the two a row happens to have.
        ...(m.doseQty == null ? { dosage: m.dosage } : { doseQty: m.doseQty }),
        notes: m.notes || '',
        form: m.form || 'tablet',
        purpose: m.purpose || '',
        time: m.time || g.time,
      })),
    })),
  };
}

/** { expected, taken } for one date, used by the calendar rings. */
export async function completionFor(dateStr) {
  const [groups, log] = await Promise.all([
    expectedFor(dateStr), store.getDoseLogForDate(dateStr),
  ]);
  const expected = groups.reduce((n, g) => n + g.medicines.length, 0);
  const wanted = new Set(groups.flatMap(g => g.medicines.map(m => `${g.slotId}|${m.medicineId}`)));
  return { expected, ...tally(log, wanted) };
}

/* Counts only rows still matching something expected, so a dose logged against
 * a medicine later removed from the day cannot push the totals past `expected`.
 *
 * Taken and skipped are counted separately because the calendar needs both: a
 * fully-skipped slot is neither complete nor untouched, and collapsing the two
 * would make a day nobody engaged with look identical to one they worked
 * through and decided against. Rows predating migration 0005 carry no status
 * and are all takens. */
function tally(rows, wanted) {
  let taken = 0;
  let skipped = 0;
  for (const row of rows) {
    if (!wanted.has(`${row.slotId}|${row.medicineId}`)) continue;
    if (row.status === 'skipped') skipped += 1;
    else taken += 1;
  }
  return { taken, skipped };
}

/** Completion for a whole month in one pass, so the grid is not N round trips. */
export async function completionForDates(dates) {
  const [medicines, schedules, slots, snapshots, log] = await Promise.all([
    store.getMedicines(), store.getActiveSchedules(), store.getSlots(),
    store.getAllSnapshots(), store.getDoseLog(),
  ]);
  const snapshotByDate = new Map(snapshots.map(s => [s.date, s]));
  const logByDate = new Map();
  for (const row of log) {
    if (!logByDate.has(row.date)) logByDate.set(row.date, []);
    logByDate.get(row.date).push(row);
  }

  const out = new Map();
  for (const date of dates) {
    const snapshot = snapshotByDate.get(date);
    const groups = mergeBySlot(snapshot ? (snapshot.slots || [])
      : buildDay(date, { medicines, schedules, slots }));
    const expected = groups.reduce((n, g) => n + g.medicines.length, 0);
    const wanted = new Set(groups.flatMap(g => g.medicines.map(m => `${g.slotId}|${m.medicineId}`)));
    out.set(date, { expected, ...tally(logByDate.get(date) || [], wanted) });
  }
  return out;
}
