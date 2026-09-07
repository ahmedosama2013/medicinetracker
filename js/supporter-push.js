/* Supporter-only: Web Push subscribe/unsubscribe with no session of any kind.
 *
 * The elder-side equivalent (js/push.js) authenticates with
 * supabase().auth.getUser() and writes push_subscriptions directly, gated by
 * RLS. A supporter has neither a session nor an RLS-visible row -- every call
 * here goes through the code-gated RPCs in js/supporter.js instead
 * (supabase/migrations/0016_supporter_push_subscriptions.sql), the same way
 * every other supporter write does.
 *
 * Same shape as js/push.js on purpose -- same three operations, same
 * ordering rules -- so the two files read as one idea applied twice, not two
 * unrelated designs.
 */

import * as supporter from './supporter.js';
import { serviceWorkerReady, urlBase64ToUint8Array } from './push-shared.js';
import { VAPID_PUBLIC_KEY } from './config.js';

/**
 * Subscribed means BOTH the browser has a push subscription and the server
 * has a live row for it -- see js/push.js's isSubscribed() for why a "both
 * must agree" check matters more than trusting either alone.
 *
 * Returns `null` (unknown), `false` (off), or `{ escalationAfter }` (on --
 * `escalationAfter` is `null` in the offline branch, where the browser is
 * trusted but there is no row to read a value from).
 */
export async function isSubscribed(code) {
  if (!('serviceWorker' in navigator)) return false;

  let sub;
  try {
    const reg = await serviceWorkerReady();
    sub = await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
  if (!sub) return false;

  try {
    const rows = await supporter.pushSubscriptionStatus(code, sub.endpoint);
    if (!rows?.length) return false;
    return { escalationAfter: rows[0].escalation_after };
  } catch {
    // Offline: trust the browser rather than claiming it's off.
    return { escalationAfter: null };
  }
}

export async function subscribe(code, escalationAfter) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Notifications are not supported on this device.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permission was not granted.');

  const reg = await serviceWorkerReady();
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });

  try {
    await supporter.subscribePush(code, sub.toJSON(), escalationAfter);
  } catch (err) {
    // Mirrors js/push.js: never leave the browser subscribed once the server
    // doesn't know about it -- that mismatch is what made the elder-side bug
    // invisible before it was fixed.
    await sub.unsubscribe().catch(() => {});
    throw new Error(`Notifications could not be turned on: ${err.message}`);
  }
}

export async function unsubscribe(code) {
  if (!('serviceWorker' in navigator)) return;
  const reg = await serviceWorkerReady();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;

  // Server first, browser only once that succeeds -- same ordering, same
  // reason, as js/push.js's unsubscribe().
  await supporter.unsubscribePush(code, sub.endpoint);
  await sub.unsubscribe();
}

/** Change the escalation delay without touching the browser subscription. */
export async function setEscalation(code, escalationAfter) {
  const reg = await serviceWorkerReady();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) throw new Error('Notifications are not on for this device.');
  await supporter.setPushEscalation(code, sub.endpoint, escalationAfter);
}
