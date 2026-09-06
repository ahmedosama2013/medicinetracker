/* Writing a dose, from whichever device is holding it.
 *
 * The two roles reach the same rows by completely different routes and it is
 * worth being explicit about why, because the wrong one is silently broken
 * rather than loudly broken:
 *
 *   Elder      writes locally first, then queues to Supabase through
 *              js/sync.js's outbox, so a tap survives no signal.
 *   Supporter  writes straight out through the code-gated RPCs in
 *              js/supporter.js, then mirrors the result into the local cache.
 *              It must NOT use the outbox: nothing on a supporter device ever
 *              flushes it (js/sync.js is elder-only), so a queued write would
 *              sit there forever looking like it had saved.
 *
 * That asymmetry also means a supporter write needs connectivity and an elder
 * write does not, which is the honest behaviour: marking a dose for someone
 * else is not something to silently defer.
 */

import * as store from './store.js';
import * as sync from './sync.js';
import * as supporter from './supporter.js';

const isSupporter = settings => settings.role === 'supporter';

/** One medicine, one state. `status` of null clears it back to unmarked. */
export async function setDose(settings, date, slotId, medicineId, status) {
  if (!isSupporter(settings)) {
    return sync.setDose(settings.householdId, date, slotId, medicineId, status);
  }
  await supporter.logDose(settings.supporterCode, date, slotId, medicineId, status);
  // Mirror into the cache so the screen and the store agree before the next
  // poll; the poll then reconciles against the server's own view.
  return status === null
    ? store.clearDose(date, slotId, medicineId)
    : store.setDose(date, slotId, medicineId, status);
}

/** Marks every medicine in the slot that is not already marked. */
export async function logSlot(settings, date, slotId, medicineIds) {
  if (!isSupporter(settings)) {
    return sync.logSlot(settings.householdId, date, slotId, medicineIds);
  }

  const existing = await store.getDoseLogForSlot(date, slotId);
  const already = new Set(existing.map(r => r.medicineId));
  const pending = medicineIds.filter(id => !already.has(id));

  /* Sequential, not parallel. These are separate RPC calls rather than one
   * transaction, and firing six at once at a free-tier project is how you
   * discover its connection limit. Six medicines is the realistic worst case. */
  for (const medicineId of pending) {
    await supporter.logDose(settings.supporterCode, date, slotId, medicineId, 'taken');
    await store.setDose(date, slotId, medicineId, 'taken');
  }
  return pending;
}

/** Back to untouched, skips included -- same contract as the elder's Undo. */
export async function undoSlot(settings, date, slotId) {
  if (!isSupporter(settings)) {
    return sync.undoSlot(settings.householdId, date, slotId);
  }
  const n = await supporter.unlogSlot(settings.supporterCode, date, slotId);
  await store.undoSlot(date, slotId);
  return n;
}
