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
 * section below.
 *
 * A supporter device caches the same things, filled by js/supporter-sync.js
 * (Realtime cannot reach a device with no session). The difference that
 * matters: on that side the cache is READ-ONLY. Supporter writes never enter
 * the outbox below, because nothing on a supporter device flushes it -- they
 * go out through the code-gated RPCs in js/supporter.js and are mirrored back
 * in afterwards. js/doses.js is the only module that knows which is which.
 * ---------------------------------------------------------------------------
 */

import * as db from './db.js';
import { STORES, uuid } from './db.js';
import { nowIso, timeToMinutes } from './date.js';

const SETTINGS_KEY = 'app';

/* `inBox` is which times of day go in the weekly pill box. Morning and night
 * by default, matching the 7x2 tray most households have -- see
 * supabase/migrations/0012_pill_box_slots.sql for why this is a flag per slot
 * rather than a compartment count. */
export const DEFAULT_SLOTS = [
  { id: 'morning', label: 'Morning', time: '08:00', order: 1, builtIn: true, inBox: true },
  { id: 'afternoon', label: 'Afternoon', time: '13:00', order: 2, builtIn: true, inBox: false },
  { id: 'evening', label: 'Evening', time: '18:00', order: 3, builtIn: true, inBox: false },
  { id: 'night', label: 'Night', time: '21:00', order: 4, builtIn: true, inBox: true },
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

/** The times of day that go in the weekly pill box, in the same order. */
export async function getBoxSlots() {
  return (await getSlots()).filter(s => s.inBox);
}

// ---- medicines ----------------------------------------------------------------

export const getMedicines = () => db.getAll(STORES.medicines);

export async function getActiveMedicines() {
  const all = await getMedicines();
  return all.filter(m => !m.archived);
}

// ---- photos ---------------------------------------------------------------

/* Two photos per medicine, one record.
 *
 * `{ medicineId, blob, packetBlob }` -- the pill photo answers "which tablet
 * is this?" at 44px, the packet photo answers "which box do I reach for?"
 * while filling an organiser. They live on one record rather than in two
 * stores because js/db.js's upgrade() cannot change a keyPath or add an index
 * to an existing store (it only ever creates missing ones), and an IndexedDB
 * record is schemaless, so a second field costs nothing. See
 * docs/phase-3-plan.md, item 23c.
 *
 * Writes are read-modify-write for the same reason: `db.put` replaces the
 * whole record, so saving a packet photo with a bare put would silently erase
 * the pill photo next to it.
 */
const PHOTO_FIELD = { pill: 'blob', packet: 'packetBlob' };

export const getPhoto = medicineId => db.get(STORES.photos, medicineId);

export async function getPhotoBlob(medicineId, kind = 'pill') {
  const row = await db.get(STORES.photos, medicineId);
  return row?.[PHOTO_FIELD[kind] || 'blob'] || null;
}

export async function putPhoto(medicineId, kind, blob) {
  const existing = await db.get(STORES.photos, medicineId);
  return db.put(STORES.photos, {
    ...(existing || {}), medicineId, [PHOTO_FIELD[kind] || 'blob']: blob,
  });
}

export async function deletePhoto(medicineId, kind = null) {
  // No kind means the medicine is going: drop the record and both photos.
  if (!kind) return db.del(STORES.photos, medicineId);

  const existing = await db.get(STORES.photos, medicineId);
  if (!existing) return undefined;
  const next = { ...existing };
  delete next[PHOTO_FIELD[kind] || 'blob'];
  // Nothing left worth a row -- keeping an empty one would make `getPhoto`
  // return a truthy object with no image in it.
  if (!next.blob && !next.packetBlob) return db.del(STORES.photos, medicineId);
  return db.put(STORES.photos, next);
}

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

/**
 * One medicine's state within a slot: 'taken' or 'skipped'.
 *
 * Reuses the existing row when there is one, so cycling a dose through the
 * states keeps a single row with a stable id rather than churning through
 * delete/insert pairs -- see supabase/migrations/0005_skipped_doses.sql for
 * why that matters to the offline outbox.
 */
export async function setDose(date, slotId, medicineId, status) {
  const existing = (await getDoseLogForSlot(date, slotId))
    .find(r => r.medicineId === medicineId);
  const row = existing
    ? { ...existing, status, takenAt: nowIso() }
    : { id: uuid(), medicineId, slotId, date, takenAt: nowIso(), status };
  await db.put(STORES.doseLog, row);
  return row;
}

/** Back to unmarked. A person un-ticking one medicine, same as undoSlot is a
 * person un-ticking a whole slot -- see the header comment's exception. */
export async function clearDose(date, slotId, medicineId) {
  const existing = (await getDoseLogForSlot(date, slotId))
    .find(r => r.medicineId === medicineId);
  if (existing) await db.del(STORES.doseLog, existing.id);
  return existing || null;
}

/**
 * The one sanctioned deletion in the app. See the header comment.
 *
 * This clears skipped rows too. Undo on a slot means "put this slot back to
 * untouched", and leaving skips behind would make the button's effect depend
 * on invisible history -- the person would tap Undo and still see amber.
 *
 * Returns the rows it removed, not a count: js/sync.js needs their ids to
 * recognise the Realtime echo of its own delete.
 */
export async function undoSlot(date, slotId) {
  const rows = await getDoseLogForSlot(date, slotId);
  await db.delMany(STORES.doseLog, rows.map(r => r.id));
  return rows;
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

/* One transaction each, via db.replaceAll -- see the comment there. A clear
 * followed by a separate write leaves a window in which the routine is empty,
 * and a read landing in it renders the elder's cold-start screen. */
export async function replaceMedicinesCache(medicines) {
  await db.replaceAll(STORES.medicines, medicines);
}

export async function replaceSchedulesCache(schedules) {
  await db.replaceAll(STORES.schedules, schedules);
}

export const putDoseLogRow = row => db.put(STORES.doseLog, row);

/* The same write for a whole batch, in ONE transaction. A sync pulls dose rows
 * by the range -- seventy-five days of them on a supporter's first open -- and
 * putDoseLogRow opens a fresh transaction per row, so that arrived as hundreds
 * of them on the boot path. Same rows, same result, one commit. */
export const putDoseLogRows = rows => db.putMany(STORES.doseLog, rows);
export const deleteDoseLogRow = id => db.del(STORES.doseLog, id);

// ---- organiser (local only, never synced) ----------------------------------

/* One in-progress filling, under a fixed key, because there is one physical
 * tray. Starting a different week replaces it rather than accumulating -- a
 * history of when the box was filled is one step from a streak, and this app
 * does not keep those.
 *
 * The plan is STORED, not recomputed on each step. A supporter editing a
 * medicine while someone else is halfway through the tray must not change the
 * grid under their hands, and a plan recomputed per render would do exactly
 * that. Same reasoning as day_snapshots, different lifetime: this one is
 * frozen for a sitting rather than for good.
 */
const ORGANISER_KEY = 'current';

export const getOrganiser = () => db.get(STORES.organiser, ORGANISER_KEY);

export async function startOrganiser(weekStart, plan) {
  const session = { key: ORGANISER_KEY, weekStart, plan, done: [], startedAt: nowIso() };
  await db.put(STORES.organiser, session);
  return session;
}

/** Mark one medicine's step filled, or unfilled. Idempotent either way. */
export async function setOrganiserStepDone(medicineId, done = true) {
  const session = await getOrganiser();
  if (!session) return null;
  const set = new Set(session.done || []);
  if (done) set.add(medicineId);
  else set.delete(medicineId);
  const next = { ...session, done: [...set] };
  await db.put(STORES.organiser, next);
  return next;
}

export const clearOrganiser = () => db.del(STORES.organiser, ORGANISER_KEY);

/**
 * Everything belonging to a household, gone. Settings survive.
 *
 * Sign-out and disconnect used to clear only the role and the credentials.
 * replaceMedicinesCache overwrites medicines on the next sync, but doseLog,
 * daySnapshots and photos are only ever added to -- so signing in as a
 * different account, or pairing to a different household, left the previous
 * one's dose history and pill photos on the device and rendering in the
 * calendar. That is a privacy problem, not a staleness one.
 *
 * The outbox goes too. Anything left in it belongs to a household this device
 * is no longer part of, and the writes would be rejected by RLS anyway.
 */
export async function clearHouseholdData() {
  await Promise.all([
    db.clear(STORES.medicines),
    db.clear(STORES.schedules),
    db.clear(STORES.doseLog),
    db.clear(STORES.daySnapshots),
    db.clear(STORES.photos),
    db.clear(STORES.outbox),
    // A filling in progress belongs to the household being left.
    db.clear(STORES.organiser),
  ]);
}

// ---- offline outbox (js/sync.js only) --------------------------------------
// Dose-log writes queued while the elder's device is offline. See js/sync.js.

export const getOutbox = () => db.getAll(STORES.outbox);
export const putOutboxItem = item => db.put(STORES.outbox, item);
export const deleteOutboxItem = id => db.del(STORES.outbox, id);
