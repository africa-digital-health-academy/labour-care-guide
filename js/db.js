// db.js — IndexedDB persistence layer (offline-first, no server required).
// Stores: patients (one document per labour case), settings (singleton),
// backups (automatic pre-migration/pre-restore snapshots — a safety net, not
// a substitute for the midwife's own exported backup file).

import { planRestore } from './migrate.js';
import { toast } from './ui.js';

const DB_NAME = 'labour-care-guide';
const DB_VERSION = 2;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (e.oldVersion < 1) {
        const s = db.createObjectStore('patients', { keyPath: 'id' });
        s.createIndex('status', 'status');
        s.createIndex('createdAt', 'createdAt');
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (e.oldVersion < 2) {
        db.createObjectStore('backups', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // another tab upgrading needs this connection closed, or it blocks forever
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => toast('Close this app in other open tabs to finish updating.', 'danger');
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

// Used by migration and restore, which must NOT bump updatedAt (that would
// make a merely-migrated record look newer than an actual newer backup).
export function putPatients(list) {
  return tx('patients', 'readwrite', s => { for (const p of list) s.put(p); });
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

export function putBackup(id, patients) {
  return tx('backups', 'readwrite', s => s.put({ id, at: new Date().toISOString(), patients }));
}

// ---- backup / restore (JSON file) — critical for devices that may be wiped/replaced ----

export async function exportBackup() {
  const patients = await getAllPatients();
  const settings = await getSettings();
  return {
    app: 'labour-care-guide',
    schema: DB_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    patients,
  };
}

/**
 * Import a backup. With dryRun, computes the merge outcome without writing
 * anything, so the caller can show a summary before committing. The actual
 * merge policy (newer wins, ties keep local) lives in migrate.js's
 * planRestore(), which is pure and unit-tested without IndexedDB.
 */
export async function importBackup(data, { dryRun = false } = {}) {
  if (!data || !['labour-care-guide', 'parthograph'].includes(data.app) || !Array.isArray(data.patients)) {
    throw new Error('Not a valid Labour Care Guide (or Parthograph v1) backup file');
  }
  const settings = await getSettings();
  const existing = await getAllPatients();
  const { toWrite, added, updated, skipped } = planRestore(existing, data.patients, settings);

  if (!dryRun) {
    if (toWrite.length) {
      await putBackup('pre-restore-' + new Date().toISOString(), existing);
      await putPatients(toWrite);
    }
    // keep current device settings; only adopt imported settings if device has none
    if (data.settings && !settings) await putSettings(data.settings);
  }
  return { added, updated, skipped };
}

export function uid() {
  // compact unique id: time component + randomness (no external deps)
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
