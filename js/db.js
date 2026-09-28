// db.js — IndexedDB persistence layer (offline-first, no server required).
// Stores: patients (one document per labour case), settings (singleton).

const DB_NAME = 'parthograph';
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('patients')) {
        const s = db.createObjectStore('patients', { keyPath: 'id' });
        s.createIndex('status', 'status');
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => reject(t.error);
  }));
}

export async function getAllPatients() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('patients').objectStore('patients').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getPatient(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('patients').objectStore('patients').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export function putPatient(p) {
  p.updatedAt = new Date().toISOString();
  return tx('patients', 'readwrite', s => s.put(p));
}

export function deletePatient(id) {
  return tx('patients', 'readwrite', s => s.delete(id));
}

export async function getSettings() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('settings').objectStore('settings').get('app');
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
  });
}

export function putSettings(value) {
  return tx('settings', 'readwrite', s => s.put({ key: 'app', value }));
}

// ---- backup / restore (JSON file) — critical for devices that may be wiped/replaced ----

export async function exportBackup() {
  const patients = await getAllPatients();
  const settings = await getSettings();
  return {
    app: 'parthograph',
    schema: DB_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    patients,
  };
}

export async function importBackup(data) {
  if (!data || data.app !== 'parthograph' || !Array.isArray(data.patients)) {
    throw new Error('Not a valid Parthograph backup file');
  }
  for (const p of data.patients) await putPatient(p);
  if (data.settings) {
    const current = await getSettings();
    // keep current device settings; only adopt imported settings if device has none
    if (!current) await putSettings(data.settings);
  }
  return data.patients.length;
}

export function uid() {
  // compact unique id: time component + randomness (no external deps)
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
