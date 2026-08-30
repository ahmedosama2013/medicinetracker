/* Minimal promise wrapper over IndexedDB.
 *
 * Stands in for the `idb` library, which would mean either a build step or a
 * CDN fetch that breaks offline use. The surface needed is small; this is all
 * of it. Only js/store.js should import this module.
 */

const DB_NAME = 'medtrack';
const DB_VERSION = 2;

export const STORES = {
  medicines: 'medicines',
  photos: 'photos',
  schedules: 'schedules',
  doseLog: 'doseLog',
  daySnapshots: 'daySnapshots',
  settings: 'settings',
  outbox: 'outbox',
};

let dbPromise = null;

function upgrade(db) {
  if (!db.objectStoreNames.contains(STORES.medicines)) {
    db.createObjectStore(STORES.medicines, { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains(STORES.photos)) {
    db.createObjectStore(STORES.photos, { keyPath: 'medicineId' });
  }
  if (!db.objectStoreNames.contains(STORES.schedules)) {
    const s = db.createObjectStore(STORES.schedules, { keyPath: 'id' });
    s.createIndex('byMedicine', 'medicineId');
  }
  if (!db.objectStoreNames.contains(STORES.doseLog)) {
    const s = db.createObjectStore(STORES.doseLog, { keyPath: 'id' });
    s.createIndex('byDate', 'date');
    s.createIndex('byDateSlot', ['date', 'slotId']);
  }
  if (!db.objectStoreNames.contains(STORES.daySnapshots)) {
    db.createObjectStore(STORES.daySnapshots, { keyPath: 'date' });
  }
  if (!db.objectStoreNames.contains(STORES.settings)) {
    db.createObjectStore(STORES.settings, { keyPath: 'key' });
  }
  // Dose-log writes that couldn't reach Supabase yet -- see js/sync.js.
  if (!db.objectStoreNames.contains(STORES.outbox)) {
    db.createObjectStore(STORES.outbox, { keyPath: 'id' });
  }
}

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => {
      // A second tab running a newer version needs this one to let go.
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database blocked by another tab'));
  });
  return dbPromise;
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function get(store, key) {
  const db = await open();
  return wrap(db.transaction(store, 'readonly').objectStore(store).get(key));
}

export async function getAll(store) {
  const db = await open();
  return wrap(db.transaction(store, 'readonly').objectStore(store).getAll());
}

export async function getAllFromIndex(store, index, query) {
  const db = await open();
  return wrap(db.transaction(store, 'readonly').objectStore(store).index(index).getAll(query));
}

export async function put(store, value) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const done = wrap(tx.objectStore(store).put(value));
  await done;
  return value;
}

export async function putMany(store, values) {
  if (!values.length) return;
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  await Promise.all(values.map(v => wrap(os.put(v))));
}

export async function del(store, key) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  return wrap(tx.objectStore(store).delete(key));
}

export async function delMany(store, keys) {
  if (!keys.length) return;
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  await Promise.all(keys.map(k => wrap(os.delete(k))));
}

export async function clear(store) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  return wrap(tx.objectStore(store).clear());
}

/** Crypto-backed where available, so ids stay unique across two devices. */
export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  (globalThis.crypto || { getRandomValues: a => a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); }) })
    .getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
