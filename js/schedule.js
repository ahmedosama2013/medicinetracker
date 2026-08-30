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
 * Returns [{ slotId, label, time, medicines: [{ medicineId, name, strength, dosage, notes, form }] }]
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
      groups.set(key, { slotId: schedule.slotId, label: slot.label, time, medicines: [] });
    }
    const group = groups.get(key);
    if (group.medicines.some(m => m.medicineId === medicine.id)) continue;
    group.medicines.push({
      medicineId: medicine.id,
      name: medicine.name,
      strength: medicine.strength,
      dosage: medicine.dosage,
      notes: medicine.notes,
      form: medicine.form,
    });
  }

  return [...groups.values()].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
}

/**
 * A medicine given its own time inside a slot produces a second group with the
 * same slotId. Logging is keyed on (date, slotId), so those groups have to be
 * merged back together before they reach the UI, or one Done tap would appear
 * to complete both.
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
    existing.time = timeToMinutes(group.time) < timeToMinutes(existing.time) ? group.time : existing.time;
  }
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
      medicines: g.medicines.map(m => ({
        medicineId: m.medicineId,
        name: m.name,
        strength: m.strength,
        dosage: m.dosage,
        notes: m.notes || '',
        form: m.form || 'tablet',
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
  // Count only rows still matching something expected, so a dose logged
  // against a medicine later removed from the day cannot push taken > expected.
  const taken = log.filter(r => wanted.has(`${r.slotId}|${r.medicineId}`)).length;
  return { expected, taken };
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
    const rows = logByDate.get(date) || [];
    const taken = rows.filter(r => wanted.has(`${r.slotId}|${r.medicineId}`)).length;
    out.set(date, { expected, taken });
  }
  return out;
}
