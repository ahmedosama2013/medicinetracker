/* Keeps a supporter device's local cache current.
 *
 * The elder's device gets this for free from Supabase Realtime. A supporter
 * cannot: Realtime respects RLS, and a supporter has no session, so it matches
 * no rows and no events ever arrive. This polls instead -- which is why the
 * supporter's screens say when they last refreshed rather than implying they
 * are live.
 *
 * Everything lands in the same IndexedDB stores the elder's device uses, so
 * js/schedule.js, js/views/day.js and the calendar work unchanged on both
 * sides. That reverses the note in js/store.js's header ("a supporter device
 * never touches this file for medicines, schedules or slots"), which was
 * written when the supporter had no screen that needed to render a day. The
 * reason behind it still holds and still shapes this file: the cache is
 * READ-ONLY here. Supporter writes never go through js/sync.js's outbox --
 * nothing on this device would ever flush it -- they go straight out through
 * the code-gated RPCs in js/supporter.js and are followed by a refresh.
 */

import * as store from './store.js';
import * as supporter from './supporter.js';
import { todayStr, addDays, setTimezone } from './date.js';

/* Enough history for Today plus a couple of months of calendar paging without
 * a second round trip. Anything older is fetched by ensureRange when the
 * person actually pages back to it, rather than pulled down speculatively on
 * every app open over a phone connection. */
const INITIAL_DAYS = 75;

const POLL_MS = 60_000;

/** Dose-log ranges already pulled this session, as [from, to] pairs. */
const fetched = [];

/* What the server looked like at the end of the last sync.
 *
 * Most polls change nothing -- the elder marks a handful of doses a day and the
 * routine changes once a week. Calling back on every tick meant re-rendering
 * the screen every sixty seconds regardless, which throws away scroll position,
 * reloads every photo, and orphans any in-place slot update that happens to be
 * mid-flight (a confirm dialog is open for seconds, and a re-render underneath
 * it leaves the tap writing into a detached tree). So the caller is told only
 * when something actually moved. */
let lastSignature = null;

function signatureOf(routine, rows) {
  const meds = (routine?.medicines || [])
    .map(m => [m.id, m.name, m.strength, m.doseQty, m.form, m.notes, m.purpose,
      m.archived, m.photoPath, m.packetPhotoPath].join(':'))
    .sort().join('|');
  const schedules = (routine?.schedules || [])
    .map(s => `${s.id}:${s.slotId}:${s.time}:${s.active}:${JSON.stringify(s.frequency)}`)
    .sort().join('|');
  const slots = (routine?.slots || []).map(s => `${s.id}:${s.label}:${s.time}:${s.inBox}`).sort().join('|');
  const doses = (rows || []).map(r => `${r.id}:${r.status}:${r.loggedBy}`).sort().join('|');
  return `${meds}#${schedules}#${slots}#${doses}`;
}

/* When the cache last actually reached the server. Surfaced on the
 * supporter's Today, because polled data that presents itself as live is a
 * lie the person only discovers when it matters. */
let lastSyncAt = null;
export const lastSync = () => lastSyncAt;

function covered(from, to) {
  return fetched.some(([f, t]) => f <= from && t >= to);
}

function mapDose(row) {
  return {
    id: row.id,
    medicineId: row.medicineId,
    slotId: row.slotId,
    date: row.date,
    takenAt: row.takenAt,
    status: row.status,
    loggedBy: row.loggedBy,
  };
}

/**
 * Download the photos this device does not already have.
 *
 * The elder's device streams these straight out of storage; a supporter has no
 * session, so each one costs a signed URL from the `supporter-photo` edge
 * function first. That is two round trips per photo, which is why this is
 * guarded on the path actually having changed -- after the first run it
 * normally does nothing at all.
 *
 * Best effort throughout. A medicine whose photo fails to download falls back
 * to its generated tile, which is exactly what that tile is for.
 */
async function cachePhotos(code, medicines, previous) {
  const results = await Promise.all(medicines.flatMap(medicine => {
    const was = previous.get(medicine.id);
    return [
      cachePhoto(code, medicine.id, 'pill', medicine.photoPath, was?.photoPath, medicine.communityReferenceId),
      cachePhoto(code, medicine.id, 'packet', medicine.packetPhotoPath, was?.packetPhotoPath, medicine.communityReferenceId),
    ];
  }));
  // Whether the cache on disk actually moved. The caller redraws only on true:
  // after the first run this is normally false, and a redraw that changes
  // nothing visible still costs the person their scroll position.
  return results.some(Boolean);
}

/** Returns true when this call changed what is stored for that photo. */
async function cachePhoto(code, medicineId, kind, path, previousPath, referenceId = null) {
  if (!path) {
    if (previousPath) {
      await store.deletePhoto(medicineId, kind).catch(() => {});
      return true;
    }
    return false;
  }
  // Re-attempt when the path is unchanged but nothing is cached: a failed
  // download must not be remembered as a success.
  const cached = await store.getPhotoBlob(medicineId, kind).catch(() => null);
  if (cached && path === previousPath) return false;

  try {
    const urls = referenceId ? await supporter.communityPhotoUrls(code, referenceId) : null;
    const url = referenceId ? urls?.[kind] : await supporter.getPhotoUrl(code, medicineId, kind);
    if (!url) return false;
    const res = await fetch(url);
    if (!res.ok) return false;
    await store.putPhoto(medicineId, kind, await res.blob());
    return true;
  } catch {
    // Stays missing locally until the next sync; the tile covers it.
    return false;
  }
}

/**
 * Medicines, schedules and slots. Cheap enough to replace wholesale.
 *
 * Returns the routine plus the photo download as an unstarted job, rather than
 * awaiting it here. Photos are the slow half by a wide margin -- two round
 * trips each for a supporter (a signed URL, then the file) against one RPC for
 * everything above -- and no caller needs them to draw a correct screen: a
 * medicine with no cached photo falls back to its generated tile. Handing the
 * job back lets hydrate() paint first and let them arrive after, while
 * refresh() keeps awaiting them as it always did.
 */
async function pullRoutine(code) {
  const routine = await supporter.loadRoutine(code);

  const previous = await store.getMedicines();
  const previousPaths = new Map(previous.map(m => [m.id, m]));

  const medicines = (routine.medicines || []).map(m => ({
    id: m.id, name: m.name, strength: m.strength, doseQty: m.doseQty,
    form: m.form, notes: m.notes, purpose: m.purpose, archived: m.archived,
    photoPath: m.photoPath || m.communityPillPhotoPath, packetPhotoPath: m.packetPhotoPath || m.communityPacketPhotoPath,
    communityReferenceId: m.communityReferenceId, communityPillPhotoPath: m.communityPillPhotoPath, communityPacketPhotoPath: m.communityPacketPhotoPath,
  }));
  await store.replaceMedicinesCache(medicines);
  await store.replaceSchedulesCache((routine.schedules || []).map(s => ({
    id: s.id, medicineId: s.medicineId, slotId: s.slotId,
    time: s.time, active: s.active, frequency: s.frequency,
  })));
  if (routine.slots?.length) await store.saveSettings({ slots: routine.slots });

  /* get_routine has always returned this and nothing ever read it. Without it
   * the supporter's device answers "what day is it?" with its own clock, so a
   * supporter in Chicago saw Sunday while the elder in Karachi was already
   * most of the way through Monday -- a whole day of doses shown as not yet
   * due. See js/date.js. */
  const timezone = routine.household?.timezone;
  if (timezone) {
    await store.saveSettings({ timezone });
    setTimezone(timezone);
  }

  return { routine, photos: () => cachePhotos(code, medicines, previousPaths) };
}

/**
 * Dose rows and frozen days for a date range, plus the household's lock line.
 * Skipped entirely when a wider range has already been pulled this session.
 */
/** Fetch a range and merge it in. Returns the rows the server actually has. */
async function pullRange(code, from, to) {
  const [doses, history] = await Promise.all([
    supporter.loadDoseLog(code, from, to),
    supporter.loadHistory(code, from, to),
  ]);

  /* Merged row by row rather than clearing first: a narrow range must not
   * delete history a wider earlier fetch already put there. Removals are
   * reconciled by refresh() below, which knows the full server-side set. */
  const rows = (doses || []).map(mapDose);
  await store.putDoseLogRows(rows);
  if (history?.snapshots?.length) await store.putSnapshots(history.snapshots);
  await store.saveSettings({ lockedThrough: history?.lockedThrough || null });

  lastSyncAt = Date.now();
  return rows;
}

export async function ensureRange(code, from, to) {
  if (!code || covered(from, to)) return null;
  const rows = await pullRange(code, from, to);
  fetched.push([from, to]);
  return rows;
}

/**
 * Everything, on entering supporter mode.
 *
 * Awaited before the first render (see js/main.js), so what it waits for is
 * what the person waits for on a cold start. That is the routine and the dose
 * rows -- one RPC each -- and deliberately not the photos, which used to sit in
 * front of the first paint at two round trips apiece and turned a cold open on
 * a phone connection into seconds of blank screen.
 *
 * `onPhotos` is called once, later, and only if the photo cache actually
 * changed; wire it to a redraw so the tiles fill in without waiting for the
 * next poll a minute away.
 */
export async function hydrate(code, { onPhotos } = {}) {
  const to = todayStr();
  const from = addDays(to, -INITIAL_DAYS);
  const { routine, photos } = await pullRoutine(code);
  const rows = await ensureRange(code, from, to);
  // So the first poll does not report a change that is only "we had not looked
  // before".
  lastSignature = signatureOf(routine, rows);

  /* Started, pointedly not awaited: hydrate resolves and the screen draws
   * while these are still in flight. Failure is already swallowed per photo. */
  photos().then(changed => { if (changed) onPhotos?.(); }).catch(() => {});
}

/**
 * Re-pull what is already loaded. Unlike ensureRange this ignores the cache,
 * because its whole job is to notice that something changed -- including a
 * dose the elder has since undone, which only shows up as a row that has
 * stopped existing.
 *
 * Returns true when the server's view differs from the last sync. The cache is
 * updated either way; the boolean is only about whether the screen has any
 * reason to redraw.
 */
export async function refresh(code) {
  const { routine, photos } = await pullRoutine(code);
  /* Awaited here, unlike hydrate: a poll has no first paint to protect, and
   * the redraw it may trigger should have the new photos already on disk.
   * After the first run this is a no-op -- every photo is guarded on its path
   * having actually changed. */
  await photos();

  const to = todayStr();
  const from = fetched.length
    ? fetched.reduce((earliest, [f]) => (f < earliest ? f : earliest), to)
    : addDays(to, -INITIAL_DAYS);

  /* Fetch first, delete second. The obvious order -- clear the range, then
   * refill it -- means one failed poll leaves the supporter staring at an
   * empty history, and "they have taken nothing" is the single most alarming
   * thing this screen can say wrongly. Nothing is removed until the
   * replacement is in hand. */
  const rows = await pullRange(code, from, to);

  // A dose the elder undid shows up only as a row that stopped existing.
  const live = new Set(rows.map(r => r.id));
  const local = (await store.getDoseLog()).filter(r => r.date >= from && r.date <= to);
  await Promise.all(local
    .filter(r => !live.has(r.id))
    .map(r => store.deleteDoseLogRow(r.id)));

  fetched.length = 0;
  fetched.push([from, to]);

  const signature = signatureOf(routine, rows);
  const changed = signature !== lastSignature;
  lastSignature = signature;
  return changed;
}

let timer = null;

/** Poll while the app is on screen. Returns a stop function. */
export function startPolling(code, onUpdate) {
  const tick = async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      if (await refresh(code)) onUpdate?.();
    } catch {
      // A failed poll is not worth interrupting anyone over; the screen keeps
      // showing the last good data and the next tick tries again.
    }
  };

  const onVisible = () => { if (document.visibilityState === 'visible') tick(); };

  timer = setInterval(tick, POLL_MS);
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    clearInterval(timer);
    timer = null;
    document.removeEventListener('visibilitychange', onVisible);
  };
}
