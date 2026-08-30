/* Medicine Tracker service worker.
 *
 * Strategy, per spec v3 section 2.1:
 *
 *   Network first  - the shell (navigations), JS, CSS
 *   Cache first    - icons, manifest
 *
 * There is no build step, so nothing bumps a cache version on deploy. A
 * cache-first worker would serve stale JavaScript forever, silently. Network
 * first means online you always run current code and offline you fall back to
 * cache. The shell is in the network-first set on purpose: index.html lists
 * every module entry point, so caching it would pin the module graph and no
 * amount of fresh JS would reach the device.
 */

const CACHE = 'medtrack';
const TIMEOUT_MS = 2500;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/icon-192.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // Individually, so one 404 cannot fail the whole install.
      .then(cache => Promise.all(PRECACHE.map(url => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cacheable(response) {
  return response && response.ok && response.type !== 'opaque';
}

/* Network first is defeated by the browser's own HTTP cache: a static host
 * answers the revalidation with 304, the browser reconstructs the response
 * from ITS cache, and the worker cheerfully stores and serves last week's
 * JavaScript while believing it went to the network.
 *
 * `cache: 'no-cache'` forces a real revalidation and returns the new bytes
 * whenever the file has actually changed. Built from request.url rather than
 * by cloning: a navigation request cannot be reconstructed directly. */
function bypassHttpCache(request) {
  try {
    return new Request(request.url, {
      cache: 'no-cache',
      credentials: 'same-origin',
      redirect: 'follow',
    });
  } catch {
    return request;
  }
}

/* Race the network against a timer. On a weak mobile connection fetch can hang
 * for 30s or more without resolving or rejecting, and the untimed version of
 * this shows a blank screen while a perfectly good cache sits unused. A network
 * response arriving after the timeout is still cached, just not rendered. */
function networkFirst(request) {
  return new Promise(resolve => {
    let settled = false;
    const done = value => { if (!settled) { settled = true; resolve(value); } };

    const fromCache = () => caches.match(request).then(hit => {
      if (hit) return done(hit);
      // Offline with a cold cache: a navigation can still fall back to the shell.
      if (request.mode === 'navigate') {
        return caches.match('./index.html').then(shell => done(shell || Response.error()));
      }
      return done(Response.error());
    });

    const timer = setTimeout(fromCache, TIMEOUT_MS);

    fetch(bypassHttpCache(request)).then(response => {
      clearTimeout(timer);
      if (cacheable(response)) {
        const copy = response.clone();
        caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {});
        done(response);
        return;
      }
      // Not cacheable: a 404, a 500, a redirect we cannot store. Prefer the
      // last known-good copy over showing the person an error page.
      fromCache();
    }).catch(() => {
      clearTimeout(timer);
      fromCache();
    });
  });
}

function cacheFirst(request) {
  return caches.match(request).then(hit => {
    if (hit) return hit;
    return fetch(request).then(response => {
      if (cacheable(response)) {
        const copy = response.clone();
        caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {});
      }
      return response;
    }).catch(() => Response.error());
  });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // never touch cross-origin

  const isShell = request.mode === 'navigate';
  const isCode = /\.(js|css)$/.test(url.pathname);
  const isAsset = /\.(png|jpg|jpeg|svg|webmanifest|woff2?)$/.test(url.pathname);

  if (isShell || isCode) {
    event.respondWith(networkFirst(request));
  } else if (isAsset) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener('push', event => {
  let payload = { title: 'Medicine Tracker', body: 'Time for your medicines' };
  try { payload = { ...payload, ...event.data.json() }; } catch { /* keep default */ }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      return self.clients.openWindow('./#/today');
    })
  );
});
