/* Export and import. The device migration path, the backup, and the only way
 * medicines get from the supporter's phone to the elder's.
 *
 * There is no zip: one JSON file with photos base64'd inline sends fine over
 * WhatsApp or email at roughly 1-2 MB for fifteen medicines, and a single file
 * is one less thing to explain over the phone.
 */

import * as store from './store.js';
import * as merge from './merge.js';
import * as photos from './photos.js';
import * as scheduleLib from './schedule.js';
import { todayStr, addDays, isAfter, nowIso } from './date.js';

const BIG_FILE_BYTES = 8 * 1024 * 1024;

/* Freezing more than a year of days on one import would mean thousands of
 * snapshot rows for days nobody will look at. A year back is already far
 * beyond the point where anyone corrects a dose. */
const MAX_LOCK_DAYS = 400;

// ---- export ---------------------------------------------------------------

export async function buildExport() {
  const [settings, medicines, schedules, doseLog, snapshots, photoRows] = await Promise.all([
    store.getSettings(), store.getMedicines(), store.getSchedules(),
    store.getDoseLog(), store.getAllSnapshots(), store.getAllPhotos(),
  ]);

  const encoded = [];
  for (const row of photoRows) {
    if (!row?.blob) continue;
    try {
      encoded.push({ medicineId: row.medicineId, dataUrl: await photos.blobToDataUrl(row.blob) });
    } catch {
      // A single unreadable photo must not cost the person their whole backup.
    }
  }

  const isSimple = settings.role === 'simple';

  return {
    schemaVersion: merge.SCHEMA_VERSION,
    exportedAt: nowIso(),
    slots: settings.slots,
    medicines,
    schedules,
    // A supporter device has no history to send; the elder's own backup needs
    // all three of these or a restore silently loses its frozen days.
    doseLog: isSimple ? doseLog : [],
    daySnapshots: isSimple ? snapshots : [],
    lockedThrough: isSimple ? settings.lockedThrough : null,
    photos: encoded,
  };
}

export function exportFilename(role, date = todayStr()) {
  // Two names, deliberately. On any day the elder both receives a list and
  // saves their own copy, one shared name leaves two indistinguishable files
  // in the Files app.
  return role === 'simple'
    ? `medtrack-mycopy-${date}.json`
    : `medtrack-medicines-${date}.json`;
}

/** Builds the file and triggers a normal download. Returns its size in bytes. */
export async function exportToFile() {
  const settings = await store.getSettings();
  const payload = await buildExport();
  if (!payload.medicines.length) return { empty: true, bytes: 0 };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = exportFilename(settings.role);
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download on some iOS versions.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);

  return { empty: false, bytes: blob.size, big: blob.size > BIG_FILE_BYTES };
}

// ---- import ---------------------------------------------------------------

export function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsText(file);
  });
}

/**
 * Parse and validate, and report what the merge would do. Nothing is written.
 * Returns { ok: false, error } or { ok: true, data, counts }.
 */
export async function inspectFile(file) {
  let data;
  try {
    data = JSON.parse(await readFile(file));
  } catch {
    return { ok: false, error: merge.ERR.shape };
  }

  const check = merge.validateFile(data);
  if (!check.ok) return { ok: false, error: check.error };

  const [medicines, schedules] = await Promise.all([store.getMedicines(), store.getSchedules()]);
  const counts = merge.summarize({ medicines, schedules }, data);
  return { ok: true, data, counts };
}

/**
 * Freeze every day from the last import up to yesterday, computed against the
 * CURRENT routine, before that routine is replaced. This is what stops an
 * updated medicine list from rewriting last month's calendar.
 *
 * Only the elder's device does this; a supporter device has no history to
 * protect.
 */
export async function buildLockSnapshots() {
  const [settings, doseLog] = await Promise.all([store.getSettings(), store.getDoseLog()]);
  const yesterday = addDays(todayStr(), -1);

  const dates = doseLog.map(r => r.date).filter(Boolean).sort();
  const earliestLog = dates[0] || null;

  // Nothing recorded and nothing previously frozen: there is nothing worth
  // freezing on a first import.
  if (!settings.lockedThrough && !earliestLog) {
    return { snapshots: [], lockedThrough: yesterday };
  }

  let from = settings.lockedThrough ? addDays(settings.lockedThrough, 1) : earliestLog;
  if (earliestLog && settings.lockedThrough && isAfter(earliestLog, from)) from = earliestLog;
  if (!from || isAfter(from, yesterday)) {
    return { snapshots: [], lockedThrough: yesterday };
  }

  const oldest = addDays(yesterday, -MAX_LOCK_DAYS);
  if (isAfter(oldest, from)) from = oldest;

  const existing = new Set((await store.getAllSnapshots()).map(s => s.date));
  const snapshots = [];
  for (let date = from; !isAfter(date, yesterday); date = addDays(date, 1)) {
    if (existing.has(date)) continue;
    const groups = await scheduleLib.dueOn(date);
    if (!groups.length) continue;                 // nothing due: nothing to freeze
    snapshots.push(scheduleLib.toSnapshot(date, groups));
  }

  return { snapshots, lockedThrough: yesterday };
}

/** Writes the merge. Call only after the person has confirmed. */
export async function applyImport(data) {
  const [settings, medicines, schedules, doseLog, snapshots] = await Promise.all([
    store.getSettings(), store.getMedicines(), store.getSchedules(),
    store.getDoseLog(), store.getAllSnapshots(),
  ]);

  const plan = merge.plan({
    medicines, schedules, doseLog, snapshots,
    slots: settings.slots,
    lockedThrough: settings.lockedThrough,
  }, data);

  // Locking happens on the elder's device only, and must be computed against
  // the pre-import routine, which is why it runs before any write.
  let lock = { snapshots: [], lockedThrough: plan.lockedThrough };
  if (settings.role === 'simple') {
    lock = await buildLockSnapshots();
    plan.lockedThrough = lock.lockedThrough;
  }

  const photoRows = [];
  for (const entry of data.photos || []) {
    if (!entry?.medicineId || !entry.dataUrl) continue;
    try {
      photoRows.push({ medicineId: entry.medicineId, blob: photos.dataUrlToBlob(entry.dataUrl) });
    } catch {
      // Skip a corrupt photo rather than failing the whole import: the
      // medicine and its schedule matter more than its picture.
    }
  }

  await store.applyImport({
    plan,
    snapshots: lock.snapshots,
    photos: photoRows,
    settingsPatch: { lastImportAt: nowIso() },
  });
}
