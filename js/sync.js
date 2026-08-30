/* Simple-only: mirrors the household's Supabase tables into the local
 * IndexedDB cache (via js/store.js -- this module never touches db.js
 * directly), and queues dose-log writes so Done/Undo never silently fails
 * offline. Supporter devices never import this module -- see js/supporter.js,
 * which talks to Supabase directly with no local cache at all. */

import { supabase } from './supabase.js';
import * as store from './store.js';
import { refresh } from './router.js';

function mapMedicine(row) {
  return {
    id: row.id, name: row.name, strength: row.strength, dosage: row.dosage,
    form: row.form, notes: row.notes, archived: row.archived,
    createdAt: row.created_at, photoPath: row.photo_path,
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
  return { id: row.id, label: row.label, time: row.time, order: row.sort_order, builtIn: row.built_in };
}

function mapDose(row) {
  return { id: row.id, medicineId: row.medicine_id, slotId: row.slot_id, date: row.local_date, takenAt: row.taken_at, status: row.status };
}

function mapSnapshot(row) {
  return { date: row.local_date, slots: row.slots };
}

/** Full refetch of a table the elder's device only ever reads (never writes
 * locally), replacing the local cache wholesale -- simplest correct option
 * at this data volume (a handful of medicines per household). */
async function refetchRoutine(householdId) {
  const client = supabase();
  const [medsRes, schedRes, slotsRes] = await Promise.all([
    client.from('medicines').select('*').eq('household_id', householdId),
    client.from('schedules').select('*').eq('household_id', householdId).eq('active', true),
    client.from('slots').select('*').eq('household_id', householdId).eq('archived', false),
  ]);

  const previous = await store.getMedicines();
  const previousPhotoPath = new Map(previous.map(m => [m.id, m.photoPath]));

  const medicines = (medsRes.data || []).map(mapMedicine);
  await store.replaceMedicinesCache(medicines);
  await store.replaceSchedulesCache((schedRes.data || []).map(mapSchedule));
  await store.saveSettings({ slots: (slotsRes.data || []).map(mapSlot) });

  for (const medicine of medicines) {
    if (medicine.photoPath && medicine.photoPath !== previousPhotoPath.get(medicine.id)) {
      await cachePhoto(medicine.id, medicine.photoPath);
    } else if (!medicine.photoPath && previousPhotoPath.get(medicine.id)) {
      await store.deletePhoto(medicine.id);
    }
  }
}

/** Dose history and calendar freezes: fetched in full once on startup, then
 * kept current by the Realtime subscription below. */
async function refetchHistory(householdId) {
  const client = supabase();
  const [doseRes, snapRes] = await Promise.all([
    client.from('dose_log').select('*').eq('household_id', householdId),
    client.from('day_snapshots').select('*').eq('household_id', householdId),
  ]);
  const rows = (doseRes.data || []).map(mapDose);
  await Promise.all(rows.map(store.putDoseLogRow));
  await store.putSnapshots((snapRes.data || []).map(mapSnapshot));
}

async function refetchHouseholdMeta(householdId) {
  const { data } = await supabase().from('households').select('locked_through, timezone').eq('id', householdId).single();
  if (data) await store.saveSettings({ lockedThrough: data.locked_through, timezone: data.timezone });
}

async function cachePhoto(medicineId, path) {
  try {
    const { data, error } = await supabase().storage.from('med-photos').download(path);
    if (error || !data) return;
    await store.putPhoto(medicineId, data);
  } catch {
    // Best effort: the photo stays missing locally until the next successful sync.
  }
}

export function startRealtime(householdId) {
  const client = supabase();
  const channel = client
    .channel(`household-${householdId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'medicines', filter: `household_id=eq.${householdId}` },
      () => refetchRoutine(householdId).then(refresh))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules', filter: `household_id=eq.${householdId}` },
      () => refetchRoutine(householdId).then(refresh))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'slots', filter: `household_id=eq.${householdId}` },
      () => refetchRoutine(householdId).then(refresh))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dose_log', filter: `household_id=eq.${householdId}` },
      payload => handleDoseChange(payload).then(refresh))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'day_snapshots', filter: `household_id=eq.${householdId}` },
      payload => handleSnapshotChange(payload).then(refresh))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'households', filter: `id=eq.${householdId}` },
      () => refetchHouseholdMeta(householdId).then(refresh))
    .subscribe();

  refetchRoutine(householdId);
  refetchHistory(householdId);
  refetchHouseholdMeta(householdId);
  flushOutbox();

  return () => client.removeChannel(channel);
}

async function handleDoseChange({ eventType, new: row, old: oldRow }) {
  if (eventType === 'DELETE') await store.deleteDoseLogRow(oldRow.id).catch(() => {});
  else await store.putDoseLogRow(mapDose(row));
}

async function handleSnapshotChange({ eventType, new: row, old: oldRow }) {
  if (eventType === 'DELETE') await store.deleteSnapshot(oldRow.local_date).catch(() => {});
  else await store.putSnapshot(mapSnapshot(row));
}

// ---- dose-log offline outbox ----------------------------------------------

async function flushOutbox() {
  if (!navigator.onLine) return;
  const pending = await store.getOutbox();
  for (const item of pending) {
    try {
      if (item.op === 'log') {
        await supabase().from('dose_log').upsert(item.payload, { onConflict: 'household_id,local_date,slot_id,medicine_id', ignoreDuplicates: true });
      } else {
        await supabase().from('dose_log').delete()
          .eq('household_id', item.payload.household_id)
          .eq('local_date', item.payload.local_date)
          .eq('slot_id', item.payload.slot_id);
      }
      await store.deleteOutboxItem(item.id);
    } catch {
      // Stays queued. A real rejection (e.g. writing into a locked day) looks
      // the same as "offline" here -- both just retry on the next flush.
    }
  }
}

window.addEventListener('online', flushOutbox);

/** Writes locally first (identical feel to today), then queues the push to
 * Supabase so a lost connection never drops a logged dose. */
export async function logSlot(householdId, date, slotId, medicineIds) {
  const rows = await store.logSlot(date, slotId, medicineIds);
  for (const row of rows) {
    await store.putOutboxItem({
      id: row.id, op: 'log',
      payload: {
        id: row.id, household_id: householdId, medicine_id: row.medicineId,
        slot_id: row.slotId, local_date: row.date, taken_at: row.takenAt,
      },
    });
  }
  flushOutbox();
  return rows;
}

export async function undoSlot(householdId, date, slotId) {
  const n = await store.undoSlot(date, slotId);
  await store.putOutboxItem({
    id: `undo-${date}-${slotId}`, op: 'undo',
    payload: { household_id: householdId, local_date: date, slot_id: slotId },
  });
  flushOutbox();
  return n;
}
