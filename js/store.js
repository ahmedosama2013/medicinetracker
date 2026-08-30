/* Typed access to the six object stores. The only module that imports db.js.
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
 * ---------------------------------------------------------------------------
 */

import * as db from './db.js';
import { STORES, uuid } from './db.js';
import { nowIso, timeToMinutes } from './date.js';

export { uuid };

const SETTINGS_KEY = 'app';

export const DEFAULT_SLOTS = [
  { id: 'morning', label: 'Morning', time: '08:00', order: 1, builtIn: true },
  { id: 'afternoon', label: 'Afternoon', time: '13:00', order: 2, builtIn: true },
  { id: 'evening', label: 'Evening', time: '18:00', order: 3, builtIn: true },
  { id: 'night', label: 'Night', time: '21:00', order: 4, builtIn: true },
];

export const MEDICINE_FORMS = ['tablet', 'capsule', 'liquid', 'drops', 'injection', 'inhaler', 'other'];

// ---- settings -------------------------------------------------------------

export async function getSettings() {
  const row = await db.get(STORES.settings, SETTINGS_KEY);
  if (row) return row;
  const fresh = {
    key: SETTINGS_KEY,
    role: null,
    slots: DEFAULT_SLOTS.map(s => ({ ...s })),
    lockedThrough: null,
    lastImportAt: null,
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

// ---- medicines ------------------------------------------------------------

export const getMedicines = () => db.getAll(STORES.medicines);
export const getMedicine = id => db.get(STORES.medicines, id);

export async function getActiveMedicines() {
  const all = await getMedicines();
  return all.filter(m => !m.archived);
}

export async function saveMedicine(medicine) {
  const row = {
    id: medicine.id || uuid(),
    name: medicine.name.trim(),
    strength: (medicine.strength || '').trim(),
    dosage: (medicine.dosage || '').trim(),
    form: MEDICINE_FORMS.includes(medicine.form) ? medicine.form : 'tablet',
    notes: (medicine.notes || '').trim(),
    archived: !!medicine.archived,
    createdAt: medicine.createdAt || nowIso(),
  };
  await db.put(STORES.medicines, row);
  return row;
}

/** Soft delete only. Never removes the medicine or its dose rows. */
export async function setArchived(medicineId, archived) {
  const medicine = await getMedicine(medicineId);
  if (!medicine) return null;
  return saveMedicine({ ...medicine, archived });
}

// ---- photos ---------------------------------------------------------------

export const getPhoto = medicineId => db.get(STORES.photos, medicineId);
export const getAllPhotos = () => db.getAll(STORES.photos);
export const putPhoto = (medicineId, blob) => db.put(STORES.photos, { medicineId, blob });
export const deletePhoto = medicineId => db.del(STORES.photos, medicineId);

// ---- schedules ------------------------------------------------------------

export const getSchedules = () => db.getAll(STORES.schedules);
export const getSchedulesForMedicine = medicineId =>
  db.getAllFromIndex(STORES.schedules, 'byMedicine', medicineId);

export async function getActiveSchedules() {
  const all = await getSchedules();
  return all.filter(s => s.active);
}

export async function saveSchedule(schedule) {
  const freq = schedule.frequency || { type: 'daily' };
  const row = {
    id: schedule.id || uuid(),
    medicineId: schedule.medicineId,
    slotId: schedule.slotId,
    time: schedule.time || null,
    frequency: {
      type: freq.type,
      interval: freq.type === 'everyNDays' ? Math.max(2, Number(freq.interval) || 2) : null,
      daysOfWeek: freq.type === 'weekly' ? [...(freq.daysOfWeek || [])].sort() : null,
      anchorDate: freq.type === 'everyNDays' ? freq.anchorDate : null,
    },
    active: schedule.active !== false,
    createdAt: schedule.createdAt || nowIso(),
  };
  await db.put(STORES.schedules, row);
  return row;
}

/** Deactivates rather than deletes, so dose rows keep a resolvable schedule. */
export async function deactivateSchedule(scheduleId) {
  const all = await getSchedules();
  const found = all.find(s => s.id === scheduleId);
  if (!found) return null;
  return saveSchedule({ ...found, active: false });
}

/** Replaces the full schedule set for one medicine, in a single transaction. */
export async function replaceSchedulesForMedicine(medicineId, schedules) {
  const existing = await getSchedulesForMedicine(medicineId);
  const keep = new Set(schedules.filter(s => s.id).map(s => s.id));
  const rows = schedules.map(s => ({
    id: s.id || uuid(),
    medicineId,
    slotId: s.slotId,
    time: s.time || null,
    frequency: {
      type: s.frequency.type,
      interval: s.frequency.type === 'everyNDays' ? Math.max(2, Number(s.frequency.interval) || 2) : null,
      daysOfWeek: s.frequency.type === 'weekly' ? [...(s.frequency.daysOfWeek || [])].sort() : null,
      anchorDate: s.frequency.type === 'everyNDays' ? s.frequency.anchorDate : null,
    },
    active: true,
    createdAt: s.createdAt || nowIso(),
  }));
  // Removed rows are deactivated, not deleted: doseLog rows point at them.
  const retired = existing.filter(s => !keep.has(s.id) && s.active)
    .map(s => ({ ...s, active: false }));
  await db.putMany(STORES.schedules, [...rows, ...retired]);
  return rows;
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

// ---- import ---------------------------------------------------------------

/**
 * Apply a merge plan in ONE transaction, so a failure part-way cannot leave a
 * half-merged database. Takes the plan from js/merge.js plus the snapshots the
 * import is freezing and the photos it is bringing.
 *
 * Note what is absent: no deletes. doseLog rows are only added, schedules the
 * file dropped arrive already flipped to active:false, and medicines are
 * archived rather than removed.
 */
export async function applyImport({ plan, snapshots = [], photos = [], settingsPatch = {} }) {
  const settings = await getSettings();
  const names = [
    STORES.medicines, STORES.schedules, STORES.doseLog,
    STORES.daySnapshots, STORES.photos, STORES.settings,
  ];

  await db.transaction(names, 'readwrite', tx => {
    const medicines = tx.objectStore(STORES.medicines);
    for (const row of plan.medicines) medicines.put(row);

    const schedules = tx.objectStore(STORES.schedules);
    for (const row of plan.schedules) schedules.put(row);

    const doseLog = tx.objectStore(STORES.doseLog);
    for (const row of plan.doseLog) doseLog.put(row);

    const daySnapshots = tx.objectStore(STORES.daySnapshots);
    for (const row of snapshots) daySnapshots.put(row);       // frozen days
    for (const row of plan.snapshots) daySnapshots.put(row);  // from the file

    const photoStore = tx.objectStore(STORES.photos);
    for (const row of photos) photoStore.put(row);

    tx.objectStore(STORES.settings).put({
      ...settings,
      slots: plan.slots.length ? plan.slots : settings.slots,
      lockedThrough: plan.lockedThrough,
      ...settingsPatch,
      key: SETTINGS_KEY,
      role: settings.role,        // never imported: this is a property of the device
    });
  });
}

// ---- storage --------------------------------------------------------------

/**
 * Ask the browser not to evict our data. Chrome grants this for installed
 * apps; Safari does not implement it, which is exactly why export exists.
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

export async function storageEstimate() {
  try {
    if (!navigator.storage?.estimate) return null;
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}
