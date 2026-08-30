/* Import validation and merge. Pure functions over plain arrays: no database
 * access, no DOM, so the rules below can be reasoned about and exercised from
 * the browser console.
 *
 * The premise of the whole design: the supporter's device is the source of
 * truth for the routine, and the elder's device is the source of truth for
 * what was actually taken. So a routine is replaced wholesale while doseLog is
 * only ever added to. That asymmetry is what makes import safe to repeat.
 */

import { isDateStr, max as maxDate } from './date.js';

export const SCHEMA_VERSION = 4;

export const ERR = {
  shape: 'shape',
  version: 'version',
  slots: 'slots',
};

const isArray = Array.isArray;
const isStr = v => typeof v === 'string' && v.length > 0;

/**
 * Structural check plus the two guards that would otherwise fail silently.
 * Returns { ok: true } or { ok: false, error: ERR.* }.
 */
export function validateFile(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: ERR.shape };

  const version = Number(data.schemaVersion);
  if (!Number.isFinite(version) || version < 1) return { ok: false, error: ERR.shape };

  // A newer file means this install is stale, not that the file is broken.
  // Worth its own message, because opening the app online is literally the fix.
  if (version > SCHEMA_VERSION) return { ok: false, error: ERR.version };

  if (!isArray(data.medicines) || !isArray(data.schedules) || !isArray(data.slots)) {
    return { ok: false, error: ERR.shape };
  }
  if (data.doseLog && !isArray(data.doseLog)) return { ok: false, error: ERR.shape };
  if (data.daySnapshots && !isArray(data.daySnapshots)) return { ok: false, error: ERR.shape };
  if (data.photos && !isArray(data.photos)) return { ok: false, error: ERR.shape };

  for (const slot of data.slots) {
    if (!slot || !isStr(slot.id) || !isStr(slot.label) || !isStr(slot.time)) {
      return { ok: false, error: ERR.shape };
    }
  }
  for (const medicine of data.medicines) {
    if (!medicine || !isStr(medicine.id) || !isStr(medicine.name)) {
      return { ok: false, error: ERR.shape };
    }
  }

  const slotIds = new Set(data.slots.map(s => s.id));
  const medicineIds = new Set(data.medicines.map(m => m.id));

  for (const schedule of data.schedules) {
    if (!schedule || !isStr(schedule.id) || !isStr(schedule.medicineId) || !isStr(schedule.slotId)) {
      return { ok: false, error: ERR.shape };
    }
    if (!medicineIds.has(schedule.medicineId)) return { ok: false, error: ERR.shape };
    const freq = schedule.frequency || {};
    if (!['daily', 'everyNDays', 'weekly'].includes(freq.type)) return { ok: false, error: ERR.shape };
    if (freq.type === 'everyNDays' && !isDateStr(freq.anchorDate)) return { ok: false, error: ERR.shape };

    // Slots are replaced wholesale, so a schedule pointing at a slot the file
    // does not describe would be scheduled into nothing: invisible on every
    // screen, with no way for either person to notice a medicine went missing.
    if (!slotIds.has(schedule.slotId)) return { ok: false, error: ERR.slots };
  }

  if (data.lockedThrough && !isDateStr(data.lockedThrough)) return { ok: false, error: ERR.shape };

  return { ok: true };
}

const MEDICINE_FIELDS = ['name', 'strength', 'dosage', 'form', 'notes'];

function medicineChanged(a, b) {
  return MEDICINE_FIELDS.some(field => (a[field] || '') !== (b[field] || ''));
}

/**
 * What the person is about to agree to, in counts:
 *   added     - medicines in the file that this device has never seen
 *   changed   - same medicine, different details or times
 *   removed   - medicines the file has archived that were active here
 *   unchanged - everything else
 */
export function summarize(local, incoming) {
  const localById = new Map((local.medicines || []).map(m => [m.id, m]));
  const localSchedules = new Map();
  for (const schedule of local.schedules || []) {
    if (!localSchedules.has(schedule.medicineId)) localSchedules.set(schedule.medicineId, []);
    localSchedules.get(schedule.medicineId).push(schedule);
  }
  const fileSchedules = new Map();
  for (const schedule of incoming.schedules || []) {
    if (!fileSchedules.has(schedule.medicineId)) fileSchedules.set(schedule.medicineId, []);
    fileSchedules.get(schedule.medicineId).push(schedule);
  }

  const scheduleKey = list => (list || [])
    .filter(s => s.active !== false)
    .map(s => `${s.slotId}|${s.time || ''}|${s.frequency?.type}|${s.frequency?.interval || ''}|${(s.frequency?.daysOfWeek || []).join(',')}|${s.frequency?.anchorDate || ''}`)
    .sort()
    .join(';');

  let added = 0; let changed = 0; let removed = 0; let unchanged = 0;

  for (const medicine of incoming.medicines || []) {
    const mine = localById.get(medicine.id);
    if (!mine) {
      if (medicine.archived) unchanged += 1;      // arrives already archived: not news
      else added += 1;
      continue;
    }
    if (medicine.archived && !mine.archived) { removed += 1; continue; }
    const detailsDiffer = medicineChanged(mine, medicine);
    const timesDiffer = scheduleKey(localSchedules.get(medicine.id)) !== scheduleKey(fileSchedules.get(medicine.id));
    if (detailsDiffer || timesDiffer) changed += 1;
    else unchanged += 1;
  }

  // A medicine that is active here but absent from the file altogether also
  // stops appearing, because its schedules are deactivated below. Counting it
  // is the difference between "1 removed" and a medicine vanishing silently.
  const fileIds = new Set((incoming.medicines || []).map(m => m.id));
  for (const medicine of local.medicines || []) {
    if (fileIds.has(medicine.id) || medicine.archived) continue;
    removed += 1;
  }

  return { added, changed, removed, unchanged };
}

/**
 * The write plan. Nothing is deleted anywhere: schedules the file no longer
 * carries are deactivated, and doseLog is append-only.
 *
 * local:    { medicines, schedules, slots, doseLog, snapshots, lockedThrough }
 * incoming: the parsed file
 */
export function plan(local, incoming) {
  const out = {
    medicines: [],
    schedules: [],
    slots: [],
    doseLog: [],
    snapshots: [],
    lockedThrough: local.lockedThrough || null,
  };

  // --- medicines: file wins, field by field, keeping local createdAt ------
  const localMedicines = new Map((local.medicines || []).map(m => [m.id, m]));
  for (const medicine of incoming.medicines || []) {
    const mine = localMedicines.get(medicine.id);
    out.medicines.push({
      id: medicine.id,
      name: medicine.name,
      strength: medicine.strength || '',
      dosage: medicine.dosage || '',
      form: medicine.form || 'tablet',
      notes: medicine.notes || '',
      archived: !!medicine.archived,
      createdAt: mine?.createdAt || medicine.createdAt || new Date().toISOString(),
    });
  }

  // --- schedules: file wins by id; local-only rows are deactivated -------
  const fileScheduleIds = new Set((incoming.schedules || []).map(s => s.id));
  for (const schedule of incoming.schedules || []) {
    out.schedules.push({
      id: schedule.id,
      medicineId: schedule.medicineId,
      slotId: schedule.slotId,
      time: schedule.time || null,
      frequency: {
        type: schedule.frequency.type,
        interval: schedule.frequency.type === 'everyNDays' ? Number(schedule.frequency.interval) || 2 : null,
        daysOfWeek: schedule.frequency.type === 'weekly' ? [...(schedule.frequency.daysOfWeek || [])] : null,
        anchorDate: schedule.frequency.type === 'everyNDays' ? schedule.frequency.anchorDate : null,
      },
      active: schedule.active !== false,
      createdAt: schedule.createdAt || new Date().toISOString(),
    });
  }
  for (const schedule of local.schedules || []) {
    if (fileScheduleIds.has(schedule.id)) continue;
    if (schedule.active === false) continue;
    // A schedule the file no longer carries was removed by the supporter, so
    // it stops appearing - including when its whole medicine has gone from the
    // file. Deactivated, never deleted: doseLog rows point at it. `summarize`
    // counts these as removed, so the person is told before agreeing.
    out.schedules.push({ ...schedule, active: false });
  }

  // --- slots: replaced from the file --------------------------------------
  out.slots = (incoming.slots || []).map((slot, index) => ({
    id: slot.id,
    label: slot.label,
    time: slot.time,
    order: Number.isFinite(slot.order) ? slot.order : index + 1,
    builtIn: !!slot.builtIn,
  }));

  // --- doseLog: union by id, never overwritten ---------------------------
  const localLogIds = new Set((local.doseLog || []).map(r => r.id));
  for (const row of incoming.doseLog || []) {
    if (!row || !isStr(row.id) || !isDateStr(row.date)) continue;
    if (localLogIds.has(row.id)) continue;
    out.doseLog.push({
      id: row.id,
      medicineId: row.medicineId,
      slotId: row.slotId,
      date: row.date,
      takenAt: row.takenAt || null,
      status: row.status === 'skipped' ? 'skipped' : 'taken',
    });
  }

  // --- snapshots: local wins, because a local snapshot is what this device
  //     actually saw on that day -----------------------------------------
  const localSnapshotDates = new Set((local.snapshots || []).map(s => s.date));
  for (const snapshot of incoming.daySnapshots || []) {
    if (!snapshot || !isDateStr(snapshot.date) || !isArray(snapshot.slots)) continue;
    if (localSnapshotDates.has(snapshot.date)) continue;
    out.snapshots.push({ date: snapshot.date, slots: snapshot.slots });
  }

  // --- lockedThrough: the later of the two, so a restore cannot reopen
  //     days this device had already frozen ------------------------------
  if (incoming.lockedThrough) {
    out.lockedThrough = out.lockedThrough
      ? maxDate(out.lockedThrough, incoming.lockedThrough)
      : incoming.lockedThrough;
  }

  return out;
}
