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

async function photoAction(action, body) {
  const { data, error } = await supabase().functions.invoke('supporter-photo', {
    body: { action, ...body },
  });
  if (error) throw new Error('That photo could not be saved.');
  return data;
}

export async function uploadPhoto(code, medicineId, blob) {
  const dataUrl = await blobToDataUrl(blob);
  const photoBase64 = dataUrl.split(',')[1];
  return photoAction('upload', { code, medicineId, photoBase64 });
}

export const deletePhoto = (code, medicineId) => photoAction('delete', { code, medicineId });

export async function getPhotoUrl(code, medicineId) {
  const { url } = await photoAction('getUrl', { code, medicineId });
  return url;
}
