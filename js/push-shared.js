/* The two pieces of Web Push plumbing common to both roles: waiting for the
 * service worker, and converting the VAPID key to the form the browser wants.
 *
 * Deliberately no imports. js/push.js (elder) imports js/supabase.js at its
 * top, which pulls in the full Supabase client -- auth, realtime, storage.
 * Importing js/push.js from a supporter-loaded module would drag all of that
 * onto a device that will never use it, exactly what js/supabase-code.js
 * exists to avoid. This file has nothing to pull in, so both js/push.js and
 * js/supporter-push.js can import it with no such cost.
 */

/* navigator.serviceWorker.ready never resolves if no worker ever activates --
 * a failed sw.js fetch, a hard-reloaded tab. Awaiting it unguarded left the
 * Settings screen as a lone heading, indefinitely, with nothing to say so. */
const SW_READY_MS = 4000;

export function serviceWorkerReady() {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('The app has not finished starting up.')), SW_READY_MS);
    }),
  ]);
}

export function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64safe);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
