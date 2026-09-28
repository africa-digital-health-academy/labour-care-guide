// migrate.js - pure schema migration for stored patient (labour case) records.
// No I/O and no DOM: db.js calls into this on load and on restore. Every rule
// here only ADDS fields, so UI code that has not been touched yet keeps
// working unchanged (fixes S11: v1 had no schema version and no migration at
// all, so an older backup could silently overwrite newer on-device data).

export const CASE_SCHEMA = 2;

const ENTRY_ARRAYS = ['obs', 'meds', 'notes'];

/**
 * Bring one patient record up to CASE_SCHEMA. Idempotent: a record already at
 * CASE_SCHEMA is returned unchanged, so migrating twice is a no-op.
 */
export function migrateCase(patient, settings) {
  if ((patient.schemaVersion || 1) >= CASE_SCHEMA) return { p: patient, changed: false };

  const admissionTime = patient.admission && patient.admission.time;
  const next = { ...patient };
  next.schemaVersion = CASE_SCHEMA;

  // S2: a case must remember the protocol it was actually run under, so a
  // later Settings change never retroactively changes women already in labour.
  if (!next.protocolId) {
    next.protocolId = next.protocolOverride || (settings && settings.protocol) || 'lcg';
    next.protocolIdInferred = true;
  }

  for (const key of ENTRY_ARRAYS) {
    next[key] = (next[key] || []).map(entry => (entry.by === undefined ? { ...entry, by: null } : entry));
  }
  // an observation taken at admission time was recorded as part of admission,
  // not a routine round - kept distinct for the audit/completeness logic (M2).
  next.obs = next.obs.map(o => (o.source === undefined
    ? { ...o, source: admissionTime && o.time === admissionTime ? 'admission' : 'entry' }
    : o));

  next.alerts = (next.alerts || []).map(a => (a.episode === undefined ? { ...a, episode: 1 } : a));
  next.deliveryHistory = next.deliveryHistory || [];
  if (next.onsetMode === undefined) next.onsetMode = 'unknown';
  if (next.romUnknown === undefined) next.romUnknown = false;

  return { p: next, changed: true };
}

/** Migrate a whole patient list; reports whether any record actually changed. */
export function migrateAll(patients, settings) {
  let changed = false;
  const out = (patients || []).map(p => {
    const r = migrateCase(p, settings);
    if (r.changed) changed = true;
    return r.p;
  });
  return { patients: out, changed };
}

/**
 * Decide, for a restore, which incoming patients should be written. Pure: no
 * I/O, so the merge policy is fully unit-testable. Newer wins by updatedAt
 * (falling back to createdAt); a tie keeps the on-device record (S11) because
 * restore should never look like data loss when nothing actually changed.
 */
export function planRestore(existing, incoming, settings) {
  const byId = new Map((existing || []).map(p => [p.id, p]));
  let added = 0, updated = 0, skipped = 0;
  const toWrite = [];
  for (const raw of incoming || []) {
    const { p } = migrateCase(raw, settings);
    const local = byId.get(p.id);
    if (!local) { added++; toWrite.push(p); continue; }
    const localTime = local.updatedAt || local.createdAt || '';
    const incomingTime = p.updatedAt || p.createdAt || '';
    if (incomingTime > localTime) { updated++; toWrite.push(p); }
    else skipped++;
  }
  return { toWrite, added, updated, skipped };
}
