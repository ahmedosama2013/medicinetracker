/* The code-gated client for a supporter device. No session of any kind --
 * every call passes the household's share code, which the server resolves
 * to a household id itself. See supabase/migrations/0001_init.sql. */

import { blobToDataUrl } from './photos.js';

/* Loaded on first use rather than at the top.
 *
 * This module is reached statically from Today, Medicines and Settings, so a
 * top-level import would put the code-gated client on every device's boot --
 * including the elder's, which already has the full Supabase client and needs
 * only ONE call from here (set_slot_in_box, shared by both roles). That is
 * ~7KB of second HTTP client downloaded to make one RPC that may never happen.
 *
 * The module is memoized by the module system and the clients inside it are
 * memoized too, so this costs one extra microtask per call and nothing else.
 * A supporter fetches it as part of the first hydrate, still before any paint
 * that needs the data. */
const codeClient = () => import('./supabase-code.js');

async function call(fn, args) {
  const { restClient } = await codeClient();
  const { data, error } = await restClient().rpc(fn, args);
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

/* Called from BOTH roles' Settings -- the elder's device holds the household's
 * share code too, so a code-gated function reaches it without needing a
 * session. Deliberately narrower than save_slots, which can also archive a
 * slot; see the migration header. */
export const setSlotInBox = (code, slotId, inBox) =>
  call('set_slot_in_box', { p_code: code, p_slot_id: slotId, p_in_box: inBox });

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
  const { functionsClient } = await codeClient();
  const { data, error } = await functionsClient().invoke('nudge', { body: { code } });
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
  const { functionsClient } = await codeClient();
  const { data, error } = await functionsClient().invoke('supporter-photo', {
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
