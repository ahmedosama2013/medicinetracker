/* The code-gated client for a supporter device. No session of any kind --
 * every call passes the household's share code, which the server resolves
 * to a household id itself. See supabase/migrations/0001_init.sql. */

import { supabase } from './supabase.js';
import { blobToDataUrl } from './photos.js';

async function call(fn, args) {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new Error(error.message || 'That could not be saved.');
  return data;
}

export const loadRoutine = code => call('get_routine', { p_code: code });

export const saveMedicine = (code, medicine) =>
  call('upsert_medicine', { p_code: code, p_medicine: medicine });

export const setArchived = (code, medicineId, archived) =>
  call('set_medicine_archived', { p_code: code, p_medicine_id: medicineId, p_archived: archived });

export const replaceSchedules = (code, medicineId, schedules) =>
  call('replace_schedules', { p_code: code, p_medicine_id: medicineId, p_schedules: schedules });

export const saveSlots = (code, slots) =>
  call('save_slots', { p_code: code, p_slots: slots });

// ---- history (see supabase/migrations/0006_supporter_parity.sql) -----------

export const loadDoseLog = (code, from, to) =>
  call('get_dose_log', { p_code: code, p_from: from, p_to: to });

export const loadHistory = (code, from, to) =>
  call('get_history', { p_code: code, p_from: from, p_to: to });

/** One medicine, one state. `status` of null clears it back to unmarked. */
export const logDose = (code, date, slotId, medicineId, status) =>
  call('log_dose', {
    p_code: code, p_date: date, p_slot_id: slotId,
    p_medicine_id: medicineId, p_status: status,
  });

export const unlogSlot = (code, date, slotId) =>
  call('unlog_slot', { p_code: code, p_date: date, p_slot_id: slotId });

/** Ask the elder's phone to buzz. Rate limited server-side; see the function. */
export async function nudge(code) {
  const { data, error } = await supabase().functions.invoke('nudge', { body: { code } });
  // A 429 arrives as an error with the body attached, so the cooldown has to
  // be read out of it rather than treated as a failure.
  if (error) {
    const detail = await error.context?.json?.().catch(() => null);
    if (detail?.retryInMinutes) return { sent: 0, retryInMinutes: detail.retryInMinutes };
    throw new Error('That could not be sent.');
  }
  return data;
}

async function photoAction(action, body) {
  const { data, error } = await supabase().functions.invoke('supporter-photo', {
    body: { action, ...body },
  });
  if (error) throw new Error('That photo could not be saved.');
  return data;
}

/* `kind` selects which of a medicine's two photos this is: 'pill' (the
 * default, and every caller that predates Phase 3) or 'packet'. The edge
 * function maps it to a column; everything else about the three actions is
 * identical. */
export async function uploadPhoto(code, medicineId, blob, kind = 'pill') {
  const dataUrl = await blobToDataUrl(blob);
  const photoBase64 = dataUrl.split(',')[1];
  return photoAction('upload', { code, medicineId, photoBase64, kind });
}

export const deletePhoto = (code, medicineId, kind = 'pill') =>
  photoAction('delete', { code, medicineId, kind });

export async function getPhotoUrl(code, medicineId, kind = 'pill') {
  const { url } = await photoAction('getUrl', { code, medicineId, kind });
  return url;
}
