// store.js — in-memory state + persistence glue. Views import from here;
// app.js listens to `bus` and re-renders the current route on change.

import * as db from './db.js';
import { setLang } from './i18n.js';
import { migrateAll, CASE_SCHEMA } from './migrate.js';

export const DEFAULT_SETTINGS = {
  facilityName: '',
  facilityLevel: 'health_center', // 'health_center' | 'hospital'
  protocol: 'lcg',                // 'lcg' | 'ethiopia2021'
  lang: 'en',
  sound: true,
  ethiopianDates: true,
  midwifeName: '',
};

export const S = {
  patients: [],
  settings: { ...DEFAULT_SETTINGS },
  ready: false,
};

export const bus = new EventTarget();
export function emit() { bus.dispatchEvent(new Event('change')); }

export async function initStore() {
  const [patients, rawSettings] = await Promise.all([db.getAllPatients(), db.getSettings()]);
  const settings = Object.assign({ ...DEFAULT_SETTINGS }, rawSettings || {});
  const { patients: migrated, changed } = migrateAll(patients, settings);
  if (changed) {
    // snapshot the pre-migration shape before anything is overwritten (S11)
    await db.putBackup(`pre-migrate-v${CASE_SCHEMA}-` + new Date().toISOString(), patients);
    await db.putPatients(migrated);
  }
  S.patients = migrated.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  S.settings = settings;
  setLang(S.settings.lang);
  S.ready = true;
}

export function patientById(id) {
  return S.patients.find(p => p.id === id) || null;
}

export async function savePatient(p) {
  // Second guard behind record.createCase(): every case reaching the store is
  // current, so an unstamped one is new and must never be re-migrated.
  if (p.schemaVersion == null) p.schemaVersion = CASE_SCHEMA;
  await db.putPatient(p);
  const i = S.patients.findIndex(x => x.id === p.id);
  if (i >= 0) S.patients[i] = p; else S.patients.unshift(p);
  emit();
  return p;
}

export async function removePatient(id) {
  await db.deletePatient(id);
  S.patients = S.patients.filter(p => p.id !== id);
  emit();
}

export async function saveSettings(next) {
  S.settings = Object.assign({}, S.settings, next);
  setLang(S.settings.lang);
  await db.putSettings(S.settings);
  emit();
}

export { uid, exportBackup, importBackup } from './db.js';
