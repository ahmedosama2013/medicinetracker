/* Typed access to the local IndexedDB cache. The only module that imports db.js.
 *
 * ---------------------------------------------------------------------------
 * THE ONE RULE THAT MATTERS: doseLog is append-only with respect to schedules.
 *
 * Editing, archiving or deleting a medicine, a schedule or a slot must NEVER
 * touch an existing doseLog row. History records what actually happened, not
 * what the current routine says should have happened. If you find yourself
 * regenerating doseLog from schedules, stop.
 *
 * There is exactly one exception, and it lives in `undoSlot` below: an explicit
 * Undo tap deletes the rows for that (date, slotId), including rows written in
 * an earlier session. That is a person correcting a mis-tap, not code rewriting
 * history. Nothing else in the app may delete from this store.
 *
 * On the elder's ("simple") device this is a write-through cache kept fresh by
 * js/sync.js's Supabase Realtime subscription -- see the "cache writers"
 * section below. A supporter device never touches this file for medicines,
 * schedules or slots; see js/supporter.js, which has no local cache at all.
 * ---------------------------------------------------------------------------
 */

import * as db from './db.js';
import { STORES, uuid } from './db.js';
import { nowIso, timeToMinutes } from './date.js';

const SETTINGS_KEY = 'app';

export const DEFAULT_SLOTS = [
  { id: 'morning', label: 'Morning', time: '08:00', order: 1, builtIn: true },
  { id: 'afternoon', label: 'Afternoon', time: '13:00', order: 2, builtIn: true },
  { id: 'evening', label: 'Evening', time: '18:00', order: 3, builtIn: true },
  { id: 'night', label: 'Night', time: '21:00', order: 4, builtIn: true },
];

export const MEDICINE_FORMS = ['tablet', 'capsule', 'liquid', 'drops', 'injection', 'inhaler', 'other'];

// ---- settings ---------------------------------------------------------------
// Also holds this device's local, never-synced state: role, and (simple only)
// householdId/shareCode, or (supporter only) supporterCode/supporterHouseholdName.

export async function getSettings() {
  const row = await db.get(STORES.settings, SETTINGS_KEY);
  if (row) return row;
  const fresh = {
    key: SETTINGS_KEY,
    role: null,
    slots: DEFAULT_SLOTS.map(s => ({ ...s })),
    storagePersisted: false,
    createdAt: nowIso(),
  };
  await db.put(STORES.settings, fresh);
  return fresh;
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch, key: SETTINGS_KEY };
  await db.put(STORES.settings, next);
  return next;
}

export async function getSlots() {
  const { slots } = await getSettings();
  return [...slots].sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
}

// ---- medicines ----------------------------------------------------------------

export const getMedicines = () => db.getAll(STORES.medicines);

export async function getActiveMedicines() {
  const all = await getMedicines();
  return all.filter(m => !m.archived);
}

// ---- photos ---------------------------------------------------------------

export const getPhoto = medicineId => db.get(STORES.photos, medicineId);
export const putPhoto = (medicineId, blob) => db.put(STORES.photos, { medicineId, blob });
export const deletePhoto = medicineId => db.del(STORES.photos, medicineId);

// ---- schedules ------------------------------------------------------------

export const getSchedules = () => db.getAll(STORES.schedules);

export async function getActiveSchedules() {
  const all = await getSchedules();
  return all.filter(s => s.active);
}

// ---- dose log -------------------------------------------------------------

export const getDoseLog = () => db.getAll(STORES.doseLog);
export const getDoseLogForDate = date => db.getAllFromIndex(STORES.doseLog, 'byDate', date);

export async function getDoseLogForSlot(date, slotId) {
  return db.getAllFromIndex(STORES.doseLog, 'byDateSlot', [date, slotId]);
}

/** Marks a whole slot taken: one row per medicine, one tap. Idempotent. */
export async function logSlot(date, slotId, medicineIds) {
  const existing = await getDoseLogForSlot(date, slotId);
  const already = new Set(existing.map(r => r.medicineId));
  const rows = medicineIds
    .filter(id => !already.has(id))
    .map(medicineId => ({
      id: uuid(),
      medicineId,
      slotId,
      date,
      takenAt: nowIso(),
      status: 'taken',
    }));
  await db.putMany(STORES.doseLog, rows);
  return rows;
}

/** The one sanctioned deletion in the app. See the header comment. */
export async function undoSlot(date, slotId) {
  const rows = await getDoseLogForSlot(date, slotId);
  await db.delMany(STORES.doseLog, rows.map(r => r.id));
  return rows.length;
}

// ---- day snapshots --------------------------------------------------------

export const getSnapshot = date => db.get(STORES.daySnapshots, date);
export const getAllSnapshots = () => db.getAll(STORES.daySnapshots);
export const putSnapshot = snapshot => db.put(STORES.daySnapshots, snapshot);
export const putSnapshots = snapshots => db.putMany(STORES.daySnapshots, snapshots);
export const deleteSnapshot = date => db.del(STORES.daySnapshots, date);

// ---- storage --------------------------------------------------------------

/**
 * Ask the browser not to evict our data. Chrome grants this for installed
 * apps; Safari does not implement it. Less critical than it used to be, since
 * Supabase (not this cache) is the source of truth, but still worth asking.
 */
export async function requestPersistence() {
  const settings = await getSettings();
  if (settings.storagePersisted) return true;
  try {
    if (!navigator.storage?.persist) return false;
    const granted = await navigator.storage.persist();
    if (granted) await saveSettings({ storagePersisted: true });
    return granted;
  } catch {
    return false;
  }
}

// ---- cache writers (js/sync.js only) ---------------------------------------
// The elder's device never edits medicines, schedules or slots itself -- that
// has only ever lived in supporter-mode screens, which talk to Supabase
// directly (see js/supporter.js). These exist purely so js/sync.js's Realtime
// mirror never has to import db.js on its own.

export async function replaceMedicinesCache(medicines) {
  await db.clear(STORES.medicines);
  await db.putMany(STORES.medicines, medicines);
}

export async function replaceSchedulesCache(schedules) {
  await db.clear(STORES.schedules);
  await db.putMany(STORES.schedules, schedules);
}

export const putDoseLogRow = row => db.put(STORES.doseLog, row);
export const deleteDoseLogRow = id => db.del(STORES.doseLog, id);

// ---- offline outbox (js/sync.js only) --------------------------------------
// Dose-log writes queued while the elder's device is offline. See js/sync.js.

export const getOutbox = () => db.getAll(STORES.outbox);
export const putOutboxItem = item => db.put(STORES.outbox, item);
export const deleteOutboxItem = id => db.del(STORES.outbox, id);
