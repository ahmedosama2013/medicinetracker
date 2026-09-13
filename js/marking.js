/* Writing dose marks, from either role.
 *
 * Three rules the handoff cares about, and they all live here so no screen can
 * quietly break one:
 *
 * 1. THE SCREEN MOVES ON THE TAP, not on the round trip. Marks are optimistic
 *    and queued; offline they sit in the outbox and the Today banner says so.
 *    Nothing is ever disabled for being offline.
 *
 * 2. MARKING FOR SOMEONE ELSE IS ALWAYS LABELLED. The helper is asked once per
 *    session and then never again — replaced by the persistent dashed chip on
 *    their Today. Asking on every tap is how you train someone to dismiss
 *    dialogs without reading them.
 *
 * 3. UNDO IS NOT A TOAST. Marking something flips the same button/row in
 *    place (Take -> Undo, Mark taken -> Clear mark); that inline flip is the
 *    undo, so a mark never raises a toast of its own. Toasts stay for the
 *    things a person cannot already see on screen: a failure, or a reminder
 *    actually being sent.
 */

import * as doses from './doses.js';
import { S } from './strings.js';
import { confirmDialog } from './ui.js';

/* Once per session, not once per tap. Module-level so it survives every
 * re-render and every navigation within the app's lifetime, and resets on a
 * reload — which is the right granularity for "while you are in the app". */
let behalfConfirmed = false;

/** Whether the helper's "acting on their behalf" chip should be showing. */
export const onBehalfActive = () => behalfConfirmed;

/**
 * Ask the helper once, for one medicine. Resolves false if they decline.
 * The elder is never asked about their own medicines.
 */
export async function mayMark(settings, { householdName } = {}) {
  if (settings.role !== 'supporter' || behalfConfirmed) return true;
  const ok = await confirmDialog({
    title: S.markOnBehalfTitle(householdName),
    body: S.markOnBehalfBody,
    confirmLabel: S.markOnBehalfConfirm,
    cancelLabel: S.markOnBehalfCancel,
  });
  if (ok) behalfConfirmed = true;
  return ok;
}

/** The same question for a whole slot, which names how many it covers. */
export async function mayMarkSlot(settings, { slotName, count, householdName } = {}) {
  if (settings.role !== 'supporter' || behalfConfirmed) return true;
  const ok = await confirmDialog({
    title: S.markAllOnBehalfTitle(slotName, householdName),
    body: S.markAllOnBehalfBody(count),
    confirmLabel: S.markOnBehalfConfirm,
    cancelLabel: S.markOnBehalfCancel,
  });
  if (ok) behalfConfirmed = true;
  return ok;
}

/* Writes for one dose, in the order they were tapped.
 *
 * Two taps on the same medicine used to fire two independent writes and let
 * the network decide which won. Chaining per dose means the last tap is the
 * last write, which is the only ordering a person would predict. Different
 * medicines still write in parallel — they cannot conflict. */
const writeQueue = new Map();

export function queueWrite(key, task) {
  const previous = writeQueue.get(key) || Promise.resolve();
  const next = previous.then(task, task);
  writeQueue.set(key, next.then(() => {}, () => {}));
  return next;
}

/** Wait for anything still in flight for these dose keys. */
export function settled(keys) {
  return Promise.all(keys.map(k => writeQueue.get(k)).filter(Boolean));
}

export { doses };
