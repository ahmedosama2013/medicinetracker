/* Simple-only: Web Push subscribe/unsubscribe. Requires the service worker
 * (registered in main.js) and, on iOS, the app installed to the home screen
 * on 16.4+ -- it does not work in a plain Safari tab. */

import { supabase } from './supabase.js';
import { VAPID_PUBLIC_KEY } from './config.js';

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64safe);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

/**
 * Subscribed means BOTH the browser has a push subscription and the server has
 * the row -- only the server can actually send anything.
 *
 * Checking the browser alone made Settings report "Reminders are on" while
 * push_subscriptions was empty, so a failed save looked identical to a
 * successful one and the person had no way to find out. A switch that cannot
 * be wrong is worse than one that is simply off.
 */
export async function isSubscribed() {
  if (!('serviceWorker' in navigator)) return false;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return false;

  try {
    const { data, error } = await supabase()
      .from('push_subscriptions')
      .select('id')
      .eq('endpoint', sub.endpoint)
      .is('disabled_at', null)
      .maybeSingle();
    if (error) return false;
    return !!data;
  } catch {
    // Offline: trust the browser rather than claiming reminders are off.
    return true;
  }
}

export async function subscribe(householdId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Notifications are not supported on this device.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permission was not granted.');

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  const json = sub.toJSON();

  const { data: { user } } = await supabase().auth.getUser();
  if (!user) throw new Error('You need to be signed in to turn reminders on.');

  /* The error was previously discarded, which is how a household could have
   * reminders "on" for weeks with nothing to deliver to. Everything downstream
   * -- the nightly reminder job, the supporter's nudge -- reads this row, so a
   * failure here has to be loud. */
  const { error } = await supabase().from('push_subscriptions').upsert({
    household_id: householdId,
    user_id: user.id,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth_key: json.keys.auth,
    disabled_at: null,
  }, { onConflict: 'endpoint' });

  if (error) {
    // Leaving the browser subscribed while the server knows nothing is the
    // exact mismatch that made this invisible; roll it back.
    await sub.unsubscribe().catch(() => {});
    throw new Error(`Reminders could not be turned on: ${error.message}`);
  }
}

export async function unsubscribe() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await supabase().from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}
