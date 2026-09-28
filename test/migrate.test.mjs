import test from 'node:test';
import assert from 'node:assert/strict';
import { CASE_SCHEMA, migrateCase, migrateAll, planRestore } from '../js/migrate.js';

// A real pre-M1 (schema-less) record, in the exact shape admission.js/demo.js
// have always produced: no schemaVersion, no protocolId, obs without
// source/by, alerts without episode, no deliveryHistory/onsetMode/romUnknown.
const V1_PATIENT = {
  id: 'p1', createdAt: '2026-06-12T04:00:00.000Z',
  name: 'Test Mother', age: 24, mrn: 'MRN-1', phone: '', kebele: '',
  gravida: 2, para: 1, gaWeeks: 39, riskFactors: [],
  laborOnsetTime: '2026-06-12T02:00:00.000Z', romTime: null,
  admission: {
    time: '2026-06-12T04:00:00.000Z', dilatation: 5, descent: 4, fhr: 138, pulse: 84,
    sys: 110, dia: 70, temp: 36.8, presentation: 'cephalic', companion: 'Y',
  },
  status: 'active', activeStartTime: '2026-06-12T04:00:00.000Z', secondStageStart: null,
  obs: [
    { id: 'o1', type: 'exam', time: '2026-06-12T04:00:00.000Z', v: { dilatation: 5, descent: 4 } },
    { id: 'o2', type: 'baby', time: '2026-06-12T05:00:00.000Z', v: { fhr: 142 } },
  ],
  meds: [],
  alerts: [
    { id: 'a1', time: '2026-06-12T05:00:00.000Z', code: 'fhr_high', severity: 'warn', title: 'FHR high', advice: [], source: 'obs', ack: false, resolved: false, action: null },
  ],
  notes: [],
  protocolOverride: null, oxytocinRunning: false, referral: null, delivery: null, newborn: null,
};

test('a v1 record migrates: schema stamped, protocolId inferred, obs source/by, alerts episode, new fields added', () => {
  const settings = { protocol: 'ethiopia2021' };
  const { p, changed } = migrateCase(V1_PATIENT, settings);
  assert.equal(changed, true);
  assert.equal(p.schemaVersion, CASE_SCHEMA);
  assert.equal(p.protocolId, 'ethiopia2021');
  assert.equal(p.protocolIdInferred, true);
  assert.equal(p.obs[0].source, 'admission'); // time equals admission.time
  assert.equal(p.obs[1].source, 'entry');
  assert.equal(p.obs[0].by, null);
  assert.equal(p.alerts[0].episode, 1);
  assert.deepEqual(p.deliveryHistory, []);
  assert.equal(p.onsetMode, 'unknown');
  assert.equal(p.romUnknown, false);
  assert.equal(V1_PATIENT.schemaVersion, undefined, 'migrateCase must not mutate its input');
});

test('an explicit protocolOverride wins over settings.protocol when inferring protocolId', () => {
  const withOverride = { ...V1_PATIENT, protocolOverride: 'lcg' };
  const { p } = migrateCase(withOverride, { protocol: 'ethiopia2021' });
  assert.equal(p.protocolId, 'lcg');
});

test('a record that already carries protocolId is left alone and not marked inferred', () => {
  const already = { ...V1_PATIENT, protocolId: 'lcg' };
  const { p } = migrateCase(already, { protocol: 'ethiopia2021' });
  assert.equal(p.protocolId, 'lcg');
  assert.equal(p.protocolIdInferred, undefined);
});

test('migrating twice is a no-op', () => {
  const once = migrateCase(V1_PATIENT, { protocol: 'lcg' });
  assert.equal(once.changed, true);
  const twice = migrateCase(once.p, { protocol: 'lcg' });
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.p, once.p);
});

test('migrateAll reports changed=false once every record is already current', () => {
  const current = migrateCase(V1_PATIENT, { protocol: 'lcg' }).p;
  const result = migrateAll([current], { protocol: 'lcg' });
  assert.equal(result.changed, false);
  assert.equal(result.patients[0], current);
});

test('restore matrix: a patient absent locally is added', () => {
  const { toWrite, added, updated, skipped } = planRestore([], [V1_PATIENT], { protocol: 'lcg' });
  assert.equal(added, 1); assert.equal(updated, 0); assert.equal(skipped, 0);
  assert.equal(toWrite.length, 1);
});

test('restore matrix: an incoming record newer than local updates it', () => {
  const local = { ...V1_PATIENT, updatedAt: '2026-06-12T05:00:00.000Z' };
  const incoming = { ...V1_PATIENT, updatedAt: '2026-06-12T06:00:00.000Z' };
  const { added, updated, skipped } = planRestore([local], [incoming], { protocol: 'lcg' });
  assert.equal(updated, 1); assert.equal(added, 0); assert.equal(skipped, 0);
});

test('restore matrix: a local record newer than the incoming one is kept', () => {
  const local = { ...V1_PATIENT, updatedAt: '2026-06-12T07:00:00.000Z' };
  const incoming = { ...V1_PATIENT, updatedAt: '2026-06-12T06:00:00.000Z' };
  const { updated, skipped } = planRestore([local], [incoming], { protocol: 'lcg' });
  assert.equal(skipped, 1); assert.equal(updated, 0);
});

test('restore matrix: a tie keeps the local record', () => {
  const local = { ...V1_PATIENT, updatedAt: '2026-06-12T06:00:00.000Z' };
  const incoming = { ...V1_PATIENT, updatedAt: '2026-06-12T06:00:00.000Z' };
  const { updated, skipped } = planRestore([local], [incoming], { protocol: 'lcg' });
  assert.equal(skipped, 1); assert.equal(updated, 0);
});
