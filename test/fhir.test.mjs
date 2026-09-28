import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFHIRBundle } from '../js/fhir.js';
import { iso, mkPatient } from './helpers.mjs';

function sample() {
  const p = mkPatient();
  p.obs.push(
    { id: 'o1', type: 'baby', time: iso(1), v: { fhr: 140 } },
    { id: 'o2', type: 'exam', time: iso(1), v: { dilatation: 6, descent: 3, moulding: 1 } },
    { id: 'o3', type: 'vitals', time: iso(1), v: { sys: 120, dia: 80, temp: 36.9 } },
    { id: 'o4', type: 'contractions', time: iso(1), v: { count: 3, duration: 30 } },
  );
  p.delivery = { time: iso(0), mode: 'svd', outcome: 'live', eblMl: 200, placentaComplete: 'Y' };
  p.newborn = { sex: 'F', weightG: 3200, apgar1: { total: 8 }, apgar5: { total: 9 } };
  p.referral = null;
  return p;
}
const byCode = (b, code) => b.entry.find(e => e.resource.code && e.resource.code.coding && e.resource.code.coding[0].code === code);

test('bundle has the core resources and serialises', () => {
  const b = buildFHIRBundle(sample(), { facilityName: 'Test HC' });
  assert.equal(b.resourceType, 'Bundle');
  const types = b.entry.map(e => e.resource.resourceType);
  for (const t of ['Patient', 'Encounter', 'Observation']) assert.ok(types.includes(t), t);
  assert.ok(b.entry.length > 8);
  assert.ok(JSON.stringify(b).length > 1000);
});

test('codes: FHR LOINC 55283-6, APGAR-5 9274-2 = 9, BP panel 85354-9 with 2 components', () => {
  const b = buildFHIRBundle(sample(), { facilityName: 'Test HC' });
  assert.ok(byCode(b, '55283-6'));
  assert.equal(byCode(b, '9274-2').resource.valueQuantity.value, 9);
  assert.equal(byCode(b, '85354-9').resource.component.length, 2);
});

test('export tag names this application', () => {
  const b = buildFHIRBundle(sample(), { facilityName: 'Test HC' });
  assert.equal(b.meta.tag[0].system, 'urn:labour-care-guide');
});
