/* Simple-only: mirrors the household's Supabase tables into the local
 * IndexedDB cache (via js/store.js -- this module never touches db.js
 * directly), and queues dose-log writes so a dose tap never silently fails
 * offline.
 *
 * Supporter devices must never import this module. They do keep a cache now
 * (js/supporter-sync.js), but they cannot use Realtime and must not use the
 * outbox: with nothing here to flush it, a queued supporter write would sit
 * there looking saved forever. Write through js/doses.js, never directly. */

import { supabase } from './supabase.js';
import * as store from './store.js';
import { refresh } from './router.js';
import { setTimezone, todayStr, addDays } from './date.js';

/* Enumerates columns explicitly, which is exactly why every new medicine
 * column has to be added here as well as to the migration -- a column missing
 * from this list arrives from Postgres and is dropped on the doorstep, with
 * nothing anywhere to say so. See docs/phase-3-plan.md, item 23. */
function mapMedicine(row) {
  const reference = Array.isArray(row.community_medicine_references) ? row.community_medicine_references[0] : row.community_medicine_references;
  return {
    id: row.id, name: row.name, strength: row.strength, doseQty: row.dose_qty,
    form: row.form, notes: row.notes, purpose: row.purpose, archived: row.archived,
    createdAt: row.created_at,
    photoPath: row.photo_path || reference?.pill_photo_path, packetPhotoPath: row.packet_photo_path || reference?.packet_photo_path,
    photoBucket: row.photo_path ? 'med-photos' : (reference?.pill_photo_path ? 'community-med-photos' : null),
    packetPhotoBucket: row.packet_photo_path ? 'med-photos' : (reference?.packet_photo_path ? 'community-med-photos' : null),
    communityReferenceId: row.community_reference_id,
  };
}

function mapSchedule(row) {
  return {
    id: row.id, medicineId: row.medicine_id, slotId: row.slot_id, time: row.time,
    frequency: {
      type: row.freq_type, interval: row.freq_interval,
      daysOfWeek: row.freq_days_of_week, anchorDate: row.freq_anchor_date,
    },
    active: row.active, createdAt: row.created_at,
  };
}

function mapSlot(row) {
  return {
    id: row.id, label: row.label, time: row.time, order: row.sort_order,
    builtIn: row.built_in, inBox: row.in_box,
  };
}

function mapDose(row) {
  return { id: row.id, medicineId: row.medicine_id, slotId: row.slot_id, date: row.local_date, takenAt: row.taken_at, status: row.status, loggedBy: row.logged_by };
}

function mapSnapshot(row) {
  return { date: row.local_date, slots: row.slots };
}

/* What the local cache currently holds, as one comparable string.
 *
 * Used to answer "did that refetch actually change anything?" -- see the boot
 * sequence in startRealtime. Cheap at this data volume, and deliberately built
 * from the same fields the views render, so a change nobody can see does not
 * cost a redraw. Mirrors signatureOf in js/supporter-sync.js, which exists for
 * the same reason on the polling side. */
function routineSignature(medicines, schedules, slots) {
  const meds = medicines.map(m => [
    m.id, m.name, m.strength, m.doseQty, m.form, m.notes, m.purpose,
    m.archived, m.photoPath, m.packetPhotoPath,
  ].join(':')).sort().join('|');
  const scheds = schedules.map(x => [
    x.id, x.medicineId, x.slotId, x.time, x.active, JSON.stringify(x.frequency),
  ].join(':')).sort().join('|');
  const slotSig = slots.map(x => [x.id, x.label, x.time, x.inBox].join(':')).sort().join('|');
  return `${meds}#${scheds}#${slotSig}`;
}

async function cachedRoutineSignature() {
  const [medicines, schedules, slots] = await Promise.all([
    store.getMedicines(), store.getActiveSchedules(), store.getSlots(),
  ]);
  return routineSignature(medicines, schedules, slots);
}

/** Full refetch of a table the elder's device only ever reads (never writes
 * locally), replacing the local cache wholesale -- simplest correct option
 * at this data volume (a handful of medicines per household).
 *
 * Returns whether the cache actually changed, so the caller can decide about
 * redrawing. */
async function refetchRoutine(householdId) {
  const client = supabase();
  const [medsRes, schedRes, slotsRes] = await Promise.all([
    client.from('medicines').select('*, community_medicine_references(name, strength, pill_photo_path, packet_photo_path)').eq('household_id', householdId),
    client.from('schedules').select('*').eq('household_id', householdId).eq('active', true),
    client.from('slots').select('*').eq('household_id', householdId).eq('archived', false),
  ]);

  const previous = await store.getMedicines();
  const previousPaths = new Map(previous.map(m => [m.id, m]));
  const before = await cachedRoutineSignature();

  const medicines = (medsRes.data || []).map(mapMedicine);
  const schedules = (schedRes.data || []).map(mapSchedule);
  const slots = (slotsRes.data || []).map(mapSlot);
  await store.replaceMedicinesCache(medicines);
  await store.replaceSchedulesCache(schedules);
  await store.saveSettings({ slots });
  const changed = routineSignature(medicines, schedules.filter(x => x.active), slots) !== before;

  /* In parallel, not one after another. `changed` is already decided above, so
   * these downloads hold up nothing but this function's return -- and the
   * caller redraws on that return, so a serial loop over a household's photos
   * was the elder waiting on the slowest possible ordering of a job with no
   * ordering requirement. Same downloads, same guards, at once. */
  await Promise.all(medicines.flatMap(medicine => {
    const was = previousPaths.get(medicine.id);
    return [
      syncPhoto(medicine, 'pill', medicine.photoPath, was?.photoPath, medicine.photoBucket),
      syncPhoto(medicine, 'packet', medicine.packetPhotoPath, was?.packetPhotoPath, medicine.packetPhotoBucket),
    ];
  }));

  return changed;
}

/* One photo of one kind. Re-attempts even when the path looks unchanged:
 * recording it as "seen" happens whether or not the download actually
 * succeeded, so a prior failure (see cachePhoto's catch) has to retry. */
async function syncPhoto(medicine, kind, path, previousPath, bucket = 'med-photos') {
  if (!path) {
    if (previousPath) await store.deletePhoto(medicine.id, kind);
    return;
  }
  const cached = await store.getPhotoBlob(medicine.id, kind);
  if (path === previousPath && cached) return;
  await cachePhoto(medicine.id, kind, path, bucket);
}

/* How much history the elder's device pulls without being asked.
 *
 * This used to be "all of it": every dose row and every frozen day the
 * household had ever recorded, refetched in full on boot, on every reconnect
 * and on every return to visibility. At roughly fifteen rows a day that is a
 * query with no ceiling, and the one part of this app that gets slower every
 * week it is used -- while `dose_log_day_idx (household_id, local_date)` sat
 * in the schema unused, because an unfiltered select has no date to index on.
 *
 * Seventy-five days covers Today and a couple of months of calendar paging.
 * Anything older is fetched by ensureRange when the person actually pages back
 * to it. Same number the supporter has always used; see INITIAL_DAYS in
 * js/supporter-sync.js. */
const HISTORY_DAYS = 75;

/** Dose-log ranges already pulled this session, as [from, to] pairs. */
const fetchedHistory = [];

function coveredHistory(from, to) {
  return fetchedHistory.some(([f, t]) => f <= from && t >= to);
}

/* Fetch a window and merge it in.
 *
 * Merge, never replace: a narrow range must not evict history a wider fetch
 * already put there. Nothing is deleted here at all, which is not a gap -- on
 * this device a dose that stops existing arrives as a Realtime DELETE and is
 * removed by handleDoseChange. That was already true when this fetched
 * everything; bounding the window does not change who owns removals. */
async function pullHistoryRange(householdId, from, to) {
  const client = supabase();
  const [doseRes, snapRes] = await Promise.all([
    client.from('dose_log').select('*').eq('household_id', householdId)
      .gte('local_date', from).lte('local_date', to),
    client.from('day_snapshots').select('*').eq('household_id', householdId)
      .gte('local_date', from).lte('local_date', to),
  ]);
  const rows = (doseRes.data || []).map(mapDose);
  await store.putDoseLogRows(rows);
  await store.putSnapshots((snapRes.data || []).map(mapSnapshot));
  return rows;
}

/**
 * A month the calendar has paged back to, beyond the window boot pulls.
 *
 * The supporter's calendar has always done this; the elder's never needed to,
 * because its cache held every row there was. Now that it does not, paging to
 * an old month without this would render hollow rings -- which do not read as
 * "not loaded", they read as "they took nothing all month".
 */
export async function ensureHistoryRange(householdId, from, to) {
  if (!householdId || coveredHistory(from, to)) return;
  await pullHistoryRange(householdId, from, to);
  fetchedHistory.push([from, to]);
}

/** Recent dose history and calendar freezes: pulled on startup, then kept
 * current by the Realtime subscription below. */
async function refetchHistory(householdId) {
  const to = todayStr();
  const from = addDays(to, -HISTORY_DAYS);

  /* Compared over the same window that was fetched. Against the whole local
   * cache it would count every row older than the window as "missing from the
   * server" and report a change on every single backfill. */
  const sig = xs => xs.map(r => `${r.id}:${r.status}:${r.loggedBy}`).sort().join('|');
  const inWindow = r => r.date >= from && r.date <= to;
  const before = sig((await store.getDoseLog()).filter(inWindow));

  const rows = await pullHistoryRange(householdId, from, to);
  if (!coveredHistory(from, to)) fetchedHistory.push([from, to]);

  /* Only the dose rows are compared. Snapshots are a record of frozen past
   * days and cannot change what today's screen shows, so a nightly freeze
   * landing while the app is open is not a reason to redraw under someone. */
  return sig(rows) !== before;
}

async function refetchHouseholdMeta(householdId) {
  const { data } = await supabase().from('households').select('locked_through, timezone').eq('id', householdId).single();
  if (!data) return false;
  const before = await store.getSettings();
  await store.saveSettings({ lockedThrough: data.locked_through, timezone: data.timezone });
  setTimezone(data.timezone);
  // The lock line moves once a night, and moving it changes which past days
  // the calendar will still accept a correction on -- so it is worth a redraw,
  // and only then.
  return before.lockedThrough !== data.locked_through;
}

/* Reads straight out of storage, whichever bucket the photo lives in.
 *
 * A community photo needs no signed-URL detour here the way it does for a
 * supporter (js/supporter-sync.js): that round trip buys a supporter the
 * service role they have no session to get any other way. An elder is
 * authenticated, and 0024/0025 let them read the published `references/`
 * catalogue directly -- so this is the same one-hop download as a personal
 * photo, and the bucket is the only thing that differs. */
async function cachePhoto(medicineId, kind, path, bucket = 'med-photos') {
  try {
    const { data, error } = await supabase().storage.from(bucket).download(path);
    if (error || !data) return;
    await store.putPhoto(medicineId, kind, data);
  } catch {
    // Best effort: the photo stays missing locally until the next successful sync.
  }
}

/* ---- Realtime echoes and bursts -------------------------------------------
 *
 * Postgres broadcasts every change to every subscriber, this device included.
 * So a dose tap here came straight back as an event, and refreshing on it
 * re-rendered the whole screen -- undoing the swap-only-the-tapped-slot
 * behaviour js/views/day.js goes to real trouble to do, and which its comment
 * explains: a full redraw re-reads the database, reloads every photo and jumps
 * the scroll position under the person's thumb.
 *
 * It also produced the renders that used to stack up. A Done tap on a
 * five-medicine slot is five row changes and was therefore five refreshes.
 *
 * The mirror still runs on every event -- the local cache must absorb the row
 * either way. Only the redraw is skipped, and only for rows this device just
 * wrote. Keyed strictly on row id and expired quickly: a refresh wrongly
 * skipped costs one stale screen until the next event, while a mirror wrongly
 * skipped would cost data.
 */
const ECHO_MS = 10_000;
const localWrites = new Map();     // dose row id -> when it stops counting

function markLocalWrite(id) {
  if (!id) return;
  if (localWrites.size > 200) {
    const now = Date.now();
    for (const [key, until] of localWrites) if (until < now) localWrites.delete(key);
  }
  localWrites.set(id, Date.now() + ECHO_MS);
}

/* Routine tables use the same map. The elder's own Settings can now write to
 * `slots` (the pill-box flags), and without this the realtime echo of that
 * write re-rendered the whole Settings screen underneath the person's finger
 * -- the chip had already moved itself, so the redraw was pure loss. Same rule
 * as doses: mirror always, redraw only for changes this device did not make. */
export const markRoutineWrite = markLocalWrite;

/** True if this row is the echo of a write made on this device. Consumes it. */
function isLocalEcho(id) {
  const until = localWrites.get(id);
  if (until === undefined) return false;
  localWrites.delete(id);
  return until >= Date.now();
}

/* Several events arriving together should cost one redraw, not one each: a
 * supporter saving a medicine fires `medicines`, `schedules` and `slots` at
 * once. Trailing, because the point is to let the burst finish. */
const BURST_MS = 150;
let refreshTimer = null;
let routineTimer = null;
let routineIds = [];

function scheduleRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => { refreshTimer = null; refresh(); }, BURST_MS);
}

function scheduleRoutineRefetch(householdId, rowId) {
  routineIds.push(rowId);
  if (routineTimer) return;
  routineTimer = setTimeout(async () => {
    routineTimer = null;
    const ids = routineIds.splice(0);
    try {
      await refetchRoutine(householdId);
    } catch {
      // The cache keeps its last good copy; the next event tries again.
      return;
    }
    /* Mapped before reducing, not `.every()`: isLocalEcho consumes, and
     * short-circuiting would leave the rest of the burst's ids in the map to
     * swallow somebody else's later change. */
    const echoes = ids.map(id => isLocalEcho(id));
    if (echoes.length && echoes.every(Boolean)) return;
    scheduleRefresh();
  }, BURST_MS);
}

/* Everything missed while the socket was down.
 *
 * refetchHistory() ran once, at boot. The Supabase client reconnects on its
 * own, but events that happened while the phone was asleep are never replayed
 * -- so an elder whose phone slept all night saw nothing the supporter had
 * changed until the app was restarted. And subscribe() was called with no
 * status callback, so a channel that failed to rejoin at all was invisible. */
/* A timestamp rather than a boolean, and this is not fussiness.
 *
 * The flag exists to stop two backfills overlapping, and it was only ever
 * cleared in the `finally`. A fetch that never settles -- no response, no
 * rejection, which is precisely what a phone with one bar of signal produces
 * -- means the `finally` never runs and backfill is disabled for the rest of
 * the page's life. The one mechanism whose entire job is recovering from a
 * bad connection would have been switched off by a bad connection.
 *
 * So a run older than the timeout no longer blocks a new one. Two overlapping
 * backfills are harmless: both replace the same caches with the same server
 * state. */
const BACKFILL_STUCK_MS = 30_000;
let backfillingSince = 0;

async function backfill(householdId) {
  if (backfillingSince && Date.now() - backfillingSince < BACKFILL_STUCK_MS) return;
  backfillingSince = Date.now();
  try {
    /* Only when something actually came back different. This runs on every
     * reconnect and every return to visibility -- an elder who picks the phone
     * up, looks at Today and puts it down again would otherwise get the screen
     * rebuilt under them each time, reloading every photo and losing their
     * scroll position, to show exactly what was already there. Same rule the
     * supporter's poll follows. */
    const changed = await Promise.all([
      refetchRoutine(householdId).catch(() => false),
      refetchHistory(householdId).catch(() => false),
      refetchHouseholdMeta(householdId).catch(() => false),
    ]);
    if (changed.some(Boolean)) scheduleRefresh();
  } finally {
    backfillingSince = 0;
  }
}

export function startRealtime(householdId) {
  const client = supabase();
  /* The first SUBSCRIBED arrives moments after subscribe() and the boot
   * refetches below already cover it. Every later one is a reconnection. */
  let subscribedBefore = false;
  const channel = client
    .channel(`household-${householdId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'medicines', filter: `household_id=eq.${householdId}` },
      ({ eventType, new: row, old: oldRow }) =>
        scheduleRoutineRefetch(householdId, eventType === 'DELETE' ? oldRow?.id : row?.id))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules', filter: `household_id=eq.${householdId}` },
      ({ eventType, new: row, old: oldRow }) =>
        scheduleRoutineRefetch(householdId, eventType === 'DELETE' ? oldRow?.id : row?.id))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'slots', filter: `household_id=eq.${householdId}` },
      ({ eventType, new: row, old: oldRow }) =>
        scheduleRoutineRefetch(householdId, eventType === 'DELETE' ? oldRow?.id : row?.id))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dose_log', filter: `household_id=eq.${householdId}` },
      payload => handleDoseChange(payload).then(changed => { if (changed) scheduleRefresh(); }))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'day_snapshots', filter: `household_id=eq.${householdId}` },
      payload => handleSnapshotChange(payload).then(scheduleRefresh))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'households', filter: `id=eq.${householdId}` },
      () => refetchHouseholdMeta(householdId).then(scheduleRefresh))
    .subscribe(status => {
      if (status !== 'SUBSCRIBED') return;
      if (!subscribedBefore) { subscribedBefore = true; return; }
      backfill(householdId);
      flushOutbox();
    });

  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    backfill(householdId);
    flushOutbox();
  };
  document.addEventListener('visibilitychange', onVisible);

  /* Boot. These used to be fired and forgotten, and nothing re-rendered when
   * they landed -- so an elder signing in on a device whose cache had been
   * wiped (a fresh install, or the sign-out that clears it) got the cold-start
   * screen with their share code on it, and kept it until they navigated
   * somewhere and back. Their medicines were already on screen a second later
   * in the database and nowhere in the DOM.
   *
   * js/main.js has always hydrated the SUPPORTER before its first render for
   * exactly this reason; the elder's side never got the equivalent. Redrawing
   * afterwards rather than awaiting before is the better trade here: the elder
   * opens this app every day with a warm cache, and making them wait on the
   * network for a screen that is already correct would be a daily cost to fix
   * an occasional one. So it renders from cache immediately and redraws only
   * if the server actually turned out to differ. */
  Promise.all([
    refetchRoutine(householdId).catch(() => false),
    refetchHistory(householdId).catch(() => false),
  ]).then(([routineChanged, historyChanged]) => {
    if (routineChanged || historyChanged) scheduleRefresh();
  });
  refetchHouseholdMeta(householdId);
  flushOutbox();

  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    client.removeChannel(channel);
  };
}

/** Mirrors the row, and reports whether the screen needs redrawing for it. */
async function handleDoseChange({ eventType, new: row, old: oldRow }) {
  const id = eventType === 'DELETE' ? oldRow?.id : row?.id;
  if (eventType === 'DELETE') await store.deleteDoseLogRow(oldRow.id).catch(() => {});
  else await store.putDoseLogRow(mapDose(row));
  return !isLocalEcho(id);
}

async function handleSnapshotChange({ eventType, new: row, old: oldRow }) {
  if (eventType === 'DELETE') await store.deleteSnapshot(oldRow.local_date).catch(() => {});
  else await store.putSnapshot(mapSnapshot(row));
}

// ---- dose-log offline outbox ----------------------------------------------

/* Every per-medicine write is queued under this key rather than under the
 * dose's uuid. Cycling a medicine taken -> skipped -> unmarked while offline
 * therefore leaves exactly ONE pending item holding the final state, instead
 * of three that have to be replayed in an order the outbox does not preserve
 * (it flushes in IndexedDB key order, not insertion order). */
const doseKey = (date, slotId, medicineId) => `dose:${date}:${slotId}:${medicineId}`;

/* One flush at a time.
 *
 * Every setDose / logSlot / undoSlot calls flushOutbox() without awaiting it,
 * so three fast taps used to start three flushes. Each read the queue at a
 * different moment and then raced to the network, and whichever request
 * happened to land last won -- not necessarily the one the person tapped last.
 * A quick unmarked -> taken -> skipped could finish as `taken` on the server
 * while the phone said `skipped`, and Realtime would then push `taken` back and
 * quietly overwrite the last tap.
 *
 * The queue itself was always right: one item per dose, holding the final state
 * (see supabase/migrations/0005_skipped_doses.sql). The bug was purely in there
 * being more than one flusher. Serialising also means a burst of taps costs one
 * flush that reads the already-coalesced result. */
let flushing = null;
let flushDirty = false;

/* Dose taps are local-first. This tiny event lets Today say so honestly without
 * redrawing the day or making the person wait for a network round trip. */
async function emitOutboxStatus() {
  const pending = (await store.getOutbox()).length;
  window.dispatchEvent(new CustomEvent('medtrack-outbox-change', {
    detail: { pending, online: navigator.onLine },
  }));
}

export async function outboxStatus() {
  return { pending: (await store.getOutbox()).length, online: navigator.onLine };
}

function flushOutbox() {
  if (flushing) {
    // Something was queued after this flush read the outbox. Go round again
    // rather than starting a second flush alongside it.
    flushDirty = true;
    return flushing;
  }

  flushing = (async () => {
    try {
      do {
        flushDirty = false;
        await drainOutbox();
      } while (flushDirty);
    } finally {
      flushing = null;
    }
  })();

  return flushing;
}

async function drainOutbox() {
  if (!navigator.onLine) return;
  const pending = await store.getOutbox();
  for (const item of pending) {
    try {
      if (item.op === 'log') {
        // ignoreDuplicates: false, so a status change to an already-logged
        // dose actually lands. Needs the UPDATE policy added in migration
        // 0005; before that this silently no-opped on conflict.
        await supabase().from('dose_log').upsert(item.payload, { onConflict: 'household_id,local_date,slot_id,medicine_id', ignoreDuplicates: false });
      } else if (item.op === 'undo-one') {
        await supabase().from('dose_log').delete()
          .eq('household_id', item.payload.household_id)
          .eq('local_date', item.payload.local_date)
          .eq('slot_id', item.payload.slot_id)
          .eq('medicine_id', item.payload.medicine_id);
      } else {
        await supabase().from('dose_log').delete()
          .eq('household_id', item.payload.household_id)
          .eq('local_date', item.payload.local_date)
          .eq('slot_id', item.payload.slot_id);
      }
      await store.deleteOutboxItem(item.id);
      await emitOutboxStatus();
    } catch {
      // Stays queued. A real rejection (e.g. writing into a locked day) looks
      // the same as "offline" here -- both just retry on the next flush.
    }
  }
}

window.addEventListener('online', () => { emitOutboxStatus(); flushOutbox(); });
window.addEventListener('offline', emitOutboxStatus);

/** Writes locally first (identical feel to today), then queues the push to
 * Supabase so a lost connection never drops a logged dose. */
export async function logSlot(householdId, date, slotId, medicineIds) {
  const rows = await store.logSlot(date, slotId, medicineIds);
  for (const row of rows) {
    markLocalWrite(row.id);
    await store.putOutboxItem({
      id: doseKey(date, slotId, row.medicineId), op: 'log',
      payload: {
        id: row.id, household_id: householdId, medicine_id: row.medicineId,
        slot_id: row.slotId, local_date: row.date, taken_at: row.takenAt,
        status: row.status,
      },
    });
  }
  await emitOutboxStatus();
  flushOutbox();
  return rows;
}

/** One medicine, one state. `status` of null clears it back to unmarked. */
export async function setDose(householdId, date, slotId, medicineId, status) {
  if (status === null) {
    const cleared = await store.clearDose(date, slotId, medicineId);
    markLocalWrite(cleared?.id);
    await store.putOutboxItem({
      id: doseKey(date, slotId, medicineId), op: 'undo-one',
      payload: {
        household_id: householdId, local_date: date,
        slot_id: slotId, medicine_id: medicineId,
      },
    });
    await emitOutboxStatus();
    flushOutbox();
    return null;
  }

  const row = await store.setDose(date, slotId, medicineId, status);
  markLocalWrite(row.id);
  await store.putOutboxItem({
    id: doseKey(date, slotId, medicineId), op: 'log',
    payload: {
      id: row.id, household_id: householdId, medicine_id: medicineId,
      slot_id: slotId, local_date: date, taken_at: row.takenAt, status,
    },
  });
  await emitOutboxStatus();
  flushOutbox();
  return row;
}

export async function undoSlot(householdId, date, slotId) {
  const removed = await store.undoSlot(date, slotId);
  for (const row of removed) markLocalWrite(row.id);

  /* Drop per-medicine writes still queued for this slot. They have been
   * superseded, and left in place they would flush AFTER the slot delete --
   * outbox order is IndexedDB key order -- and resurrect rows the person just
   * cleared. Dropping them is safe: undoSlot already cleared the same rows
   * locally, so nothing is lost that the person still expects to see. */
  const prefix = `dose:${date}:${slotId}:`;
  for (const item of await store.getOutbox()) {
    if (String(item.id).startsWith(prefix)) await store.deleteOutboxItem(item.id);
  }

  await store.putOutboxItem({
    id: `undo:${date}:${slotId}`, op: 'undo',
    payload: { household_id: householdId, local_date: date, slot_id: slotId },
  });
  await emitOutboxStatus();
  flushOutbox();
  return removed.length;
}
