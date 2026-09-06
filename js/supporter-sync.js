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
import { todayStr, addDays } from './date.js';

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
    .map(m => `${m.id}:${m.name}:${m.strength}:${m.dosage}:${m.form}:${m.notes}:${m.archived}:${m.photoPath}`)
    .sort().join('|');
  const schedules = (routine?.schedules || [])
    .map(s => `${s.id}:${s.slotId}:${s.time}:${s.active}:${JSON.stringify(s.frequency)}`)
    .sort().join('|');
  const slots = (routine?.slots || []).map(s => `${s.id}:${s.label}:${s.time}`).sort().join('|');
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
async function cachePhotos(code, medicines, previousPaths) {
  await Promise.all(medicines.map(async medicine => {
    if (!medicine.photoPath) {
      if (previousPaths.get(medicine.id)) await store.deletePhoto(medicine.id).catch(() => {});
      return;
    }
    // Re-attempt when the path is unchanged but nothing is cached: a failed
    // download must not be remembered as a success.
    const cached = await store.getPhoto(medicine.id).catch(() => null);
    if (cached?.blob && medicine.photoPath === previousPaths.get(medicine.id)) return;

    try {
      const url = await supporter.getPhotoUrl(code, medicine.id);
      if (!url) return;
      const res = await fetch(url);
      if (!res.ok) return;
      await store.putPhoto(medicine.id, await res.blob());
    } catch {
      // Stays missing locally until the next sync; the tile covers it.
    }
  }));
}

/** Medicines, schedules and slots. Cheap enough to replace wholesale. */
async function pullRoutine(code) {
  const routine = await supporter.loadRoutine(code);

  const previous = await store.getMedicines();
  const previousPaths = new Map(previous.map(m => [m.id, m.photoPath]));

  const medicines = (routine.medicines || []).map(m => ({
    id: m.id, name: m.name, strength: m.strength, dosage: m.dosage,
    form: m.form, notes: m.notes, archived: m.archived, photoPath: m.photoPath,
  }));
  await store.replaceMedicinesCache(medicines);
  await store.replaceSchedulesCache((routine.schedules || []).map(s => ({
    id: s.id, medicineId: s.medicineId, slotId: s.slotId,
    time: s.time, active: s.active, frequency: s.frequency,
  })));
  if (routine.slots?.length) await store.saveSettings({ slots: routine.slots });

  await cachePhotos(code, medicines, previousPaths);
  return routine;
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
  for (const row of rows) await store.putDoseLogRow(row);
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

/** Everything, on entering supporter mode. */
export async function hydrate(code) {
  const to = todayStr();
  const from = addDays(to, -INITIAL_DAYS);
  const routine = await pullRoutine(code);
  const rows = await ensureRange(code, from, to);
  // So the first poll does not report a change that is only "we had not looked
  // before".
  lastSignature = signatureOf(routine, rows);
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
  const routine = await pullRoutine(code);

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
