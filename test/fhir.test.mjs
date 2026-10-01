import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFHIRBundle, fhirFilename, newUUID } from '../js/fhir.js';
import { voidDelivery } from '../js/record.js';
import { NOW, LCG, iso, mkPatient } from './helpers.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OBS_CATEGORY = 'http://terminology.hl7.org/CodeSystem/observation-category';
const SETTINGS = { facilityName: 'Test HC' };

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

/** A case with every kind of entry, initials and the Robson inputs (group 1 when born). */
function fullCase(extra = {}) {
  const p = mkPatient({
    id: 'case-1', name: 'Abeba Tesfaye', mrn: 'MRN-778', gaWeeks: 39, onsetMode: 'spontaneous', riskFactors: [],
    admission: { time: iso(6), by: 'AB', presentation: 'cephalic' },
  });
  p.obs.push(
    { id: 'b1', type: 'baby', time: iso(5), by: 'AB', v: { fhr: 150, decel: 'late', liquor: 'M3' } },
    { id: 'b2', type: 'baby', time: iso(4.5), by: 'AB', v: { fhr: 138, decel: 'none', liquor: 'M1' }, defaulted: ['decel'] },
    { id: 'e1', type: 'exam', time: iso(5), by: 'AB', v: { dilatation: 5, descent: 4, presentation: 'cephalic', position: 'OA', caput: 0, moulding: 1, liquor: 'C' } },
    { id: 'c1', type: 'contractions', time: iso(5), v: { count: 3, durBand: 'b20_40', duration: 30 } },
    { id: 'p1', type: 'pulse', time: iso(5), by: 'AB', v: { pulse: 88 } },
    { id: 'v1', type: 'vitals', time: iso(5), by: 'AB', v: { sys: 118, dia: 76, temp: 36.8, protein: 'neg', acetone: '+' } },
    { id: 's1', type: 'supportive', time: iso(4), by: 'AB', v: { companion: 'Y', painRelief: 'D', oralFluid: 'N', posture: 'supine' } },
    { id: 'x1', type: 'oxytocin', time: iso(3), by: 'AB', v: { uL: 5, dropsMin: 20 } },
    { id: 'ev', type: 'event', time: iso(2), by: 'AB', v: { event: 'pushing' } },
    { id: 'bad', type: 'pulse', time: iso(3), by: 'AB', v: { pulse: 188 }, voided: { at: iso(2.9), by: 'XY', reason: 'typed 188 for 88' } },
  );
  return Object.assign(p, extra);
}

/** fullCase after a birth at iso(1), with postpartum checks and drape readings. */
function bornCase(delivery = {}, newborn = {}) {
  const p = fullCase({ status: 'delivered' });
  p.delivery = { time: iso(1), mode: 'svd', outcome: 'live', eblMl: 250, by: 'CD', ppVitals: { sys: 110, dia: 70, pulse: 92 }, ...delivery };
  p.newborn = { sex: 'F', weightG: 3100, apgar1: { total: 7 }, apgar5: { total: 9 }, ...newborn };
  p.obs.push(
    { id: 'bl', type: 'bloodloss', time: iso(0.75), by: 'CD', v: { ml: 350, method: 'drape' } },
    { id: 'pm', type: 'ppMother', time: iso(0.5), by: 'CD', v: { bleeding: 'heavy', tone: 'soft', fundus: 'at', pulse: 104, sys: 100, dia: 60, urinePassed: 'N' } },
    { id: 'pb', type: 'ppBaby', time: iso(0.5), by: 'CD', v: { breathing: 'difficult', temp: 36.2, feeding: 'poor' } },
  );
  return p;
}

const resources = (b, type) => b.entry.map(e => e.resource).filter(r => !type || r.resourceType === type);
const hasCode = (r, code) => !!(r.code && r.code.coding && r.code.coding.some(c => c.code === code));
const withCode = (b, code) => resources(b).filter(r => hasCode(r, code));
const one = (b, code) => {
  const list = withCode(b, code);
  assert.equal(list.length, 1, `exactly one resource with code ${code}`);
  return list[0];
};
const byCode = (b, code) => b.entry.find(e => e.resource.code && e.resource.code.coding && e.resource.code.coding[0].code === code);
const valueCode = r => r.valueCodeableConcept.coding[0].code;
const urlOf = (b, r) => b.entry.find(e => e.resource === r).fullUrl;
const allRefs = b => {
  const out = [];
  JSON.stringify(b, (k, v) => { if (k === 'reference') out.push(v); return v; });
  return out;
};
const encounterAt = (p, now = NOW) => resources(buildFHIRBundle(p, SETTINGS, { now }), 'Encounter')[0];
const REFERRAL = Object.freeze({
  time: iso(2), reasons: ['Slow progress'], checklist: [{ code: 'iv', label: 'IV line', done: true }],
  facility: 'Primary Hospital', by: 'AB', handoverAt: null,
});
const alert = (id, code, severity, obsId) => ({
  id, code, severity, title: code, time: iso(0.5), lastSeen: iso(0.5), source: obsId ? 'obs' : 'birth',
  obsId: obsId || null, obsIds: obsId ? [obsId] : [], resolved: false,
});

test('bundle has the core resources and serialises', () => {
  const b = buildFHIRBundle(sample(), SETTINGS);
  assert.equal(b.resourceType, 'Bundle');
  const types = b.entry.map(e => e.resource.resourceType);
  for (const t of ['Patient', 'Encounter', 'Observation']) assert.ok(types.includes(t), t);
  assert.ok(b.entry.length > 8);
  assert.ok(JSON.stringify(b).length > 1000);
});

test('codes: FHR LOINC 55283-6, APGAR-5 9274-2 = 9, BP panel 85354-9 with 2 components', () => {
  const b = buildFHIRBundle(sample(), SETTINGS);
  assert.ok(byCode(b, '55283-6'));
  assert.equal(byCode(b, '9274-2').resource.valueQuantity.value, 9);
  assert.equal(byCode(b, '85354-9').resource.component.length, 2);
});

test('export tag names this application', () => {
  const b = buildFHIRBundle(sample(), SETTINGS);
  assert.equal(b.meta.tag[0].system, 'urn:labour-care-guide');
});

test('every resource id is a UUID, its fullUrl is urn:uuid:<id>, and every reference resolves', () => {
  const b = buildFHIRBundle(bornCase(), SETTINGS);
  const ids = new Set();
  for (const e of b.entry) {
    assert.match(e.resource.id, UUID, `${e.resource.resourceType} id`);
    assert.equal(e.fullUrl, 'urn:uuid:' + e.resource.id);
    assert.ok(!ids.has(e.resource.id), 'ids are unique');
    ids.add(e.resource.id);
  }
  const urls = new Set(b.entry.map(e => e.fullUrl));
  const refs = allRefs(b);
  assert.ok(refs.length > 20);
  for (const r of refs) assert.ok(urls.has(r), `reference ${r} resolves inside the bundle`);
  assert.match(b.identifier.value.replace('urn:uuid:', ''), UUID);
});

test('ids stay version-4 UUIDs where randomUUID is missing (plain http on a LAN)', () => {
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
  try {
    const ids = new Set(Array.from({ length: 50 }, () => newUUID()));
    assert.equal(ids.size, 50);
    for (const id of ids) assert.match(id, UUID);
  } finally {
    delete globalThis.crypto.randomUUID; // the prototype method shows through again
  }
  assert.equal(typeof globalThis.crypto.randomUUID, 'function');
});

test('no empty element anywhere, even from sparse or legacy records', () => {
  const p = bornCase({ mode: null, time: 'not a time' });
  p.alerts.push({ id: 'a1', code: 'fhr_abn', severity: 'warn', title: '', resolved: false });
  p.referral = { time: iso(2), reasons: 'legacy string', checklist: null, facility: '', by: '', handoverAt: null };
  delete p.admission.time;
  delete p.createdAt;
  const b = buildFHIRBundle(p, {});
  const walk = (v, path) => {
    if (v === null || v === '') assert.fail(`empty value at ${path}`);
    if (Array.isArray(v)) {
      assert.ok(v.length, `empty array at ${path}`);
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
    } else if (typeof v === 'object') {
      assert.ok(Object.keys(v).length, `empty object at ${path}`);
      for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    }
  };
  walk(b, 'Bundle');
  assert.ok(!JSON.stringify(b).includes('not a time'), 'an unreadable time is left out, never exported invalid');
  assert.equal(resources(b, 'Procedure')[0].code.text, 'Mode of birth not recorded');
});

test('each export mints new ids; the business identifiers stay the same', () => {
  const p = bornCase();
  const a = buildFHIRBundle(p, SETTINGS), b = buildFHIRBundle(p, SETTINGS);
  const idsA = new Set(a.entry.map(e => e.resource.id));
  assert.ok(b.entry.every(e => !idsA.has(e.resource.id)));
  const keys = x => resources(x, 'Observation').map(r => r.identifier[0].value).sort();
  assert.deepEqual(keys(a), keys(b));
  assert.equal(resources(a, 'Encounter')[0].identifier[0].value, 'case-1');
});

test('Encounter in-progress, no period.end: labouring, referred and not yet left, in the 24 h postpartum watch', () => {
  const labour = encounterAt(fullCase({ status: 'active' }));
  assert.equal(labour.status, 'in-progress');
  assert.equal(labour.period.start, iso(6));
  assert.equal(labour.period.end, undefined);

  const waiting = fullCase({ status: 'referred', referral: { ...REFERRAL } });
  assert.equal(encounterAt(waiting).status, 'in-progress', 'monitored until she leaves (S8)');
  assert.equal(encounterAt(waiting).period.end, undefined);
  assert.equal(resources(buildFHIRBundle(waiting, SETTINGS, { now: NOW }), 'ServiceRequest')[0].status, 'active');

  // born at iso(1): one hour, then 23.9 h, into the watch - still an inpatient under care
  for (const now of [NOW, iso(-22.9)]) {
    const watch = encounterAt(bornCase(), now);
    assert.equal(watch.status, 'in-progress', String(now));
    assert.equal(watch.period.end, undefined, 'no end while the watch runs, so none to move between exports');
  }

  // referred after the birth, transport not yet left: the watch goes on
  const ppWaiting = Object.assign(bornCase(), { status: 'referred', referral: { ...REFERRAL, time: iso(0.6) } });
  assert.equal(encounterAt(ppWaiting).status, 'in-progress');
});

test('Encounter finished: left on referral, case closed or watch over; period.end is when it ended and stays put', () => {
  const gone = fullCase({ status: 'referred', referral: { ...REFERRAL, handoverAt: iso(1.5), handoverBy: 'AB' } });
  const e = encounterAt(gone);
  assert.equal(e.status, 'finished');
  assert.equal(e.period.end, iso(1.5), 'her departure');
  assert.equal(e.hospitalization.dischargeDisposition.coding[0].code, 'other-hcf');
  assert.equal(e.hospitalization.destination.display, 'Primary Hospital');
  assert.equal(resources(buildFHIRBundle(gone, SETTINGS, { now: NOW }), 'ServiceRequest')[0].status, 'completed');

  // referred after the birth and gone during the watch
  const ppGone = Object.assign(bornCase(), { status: 'referred', referral: { ...REFERRAL, time: iso(0.6), handoverAt: iso(0.25) } });
  assert.equal(encounterAt(ppGone).status, 'finished');
  assert.equal(encounterAt(ppGone).period.end, iso(0.25));

  // closed during the watch
  const closed = Object.assign(bornCase(), { status: 'closed', closedAt: iso(0.1), closedBy: 'CD' });
  assert.equal(encounterAt(closed).status, 'finished');
  assert.equal(encounterAt(closed).period.end, iso(0.1));

  // the watch ran out (birth + 24 h = iso(-23)); closing the case later does not move the end
  const born = bornCase();
  const over = encounterAt(born, iso(-30));
  assert.equal(over.status, 'finished');
  assert.equal(over.period.end, iso(-23));
  Object.assign(born, { status: 'closed', closedAt: iso(-40), closedBy: 'CD' });
  assert.equal(encounterAt(born, iso(-48)).period.end, iso(-23));
});

test('Encounter unknown when the record cannot say: a delivered status with no birth record', () => {
  const e = encounterAt(fullCase({ status: 'delivered' }));
  assert.equal(e.status, 'unknown');
  assert.equal(e.period.end, undefined);
});

test('stillbirth: outcome, timing of death and a deceased newborn; a live birth stays alive', () => {
  const fresh = buildFHIRBundle(bornCase({ outcome: 'sb_fresh', stillbirthTiming: 'intrapartum' }, { apgar1: null, apgar5: null }), SETTINGS);
  const out = one(fresh, '364587008');
  assert.equal(valueCode(out), '237365001');
  assert.equal(out.component[0].valueCodeableConcept.coding[0].code, '237362003');
  assert.equal(out.partOf[0].reference, urlOf(fresh, resources(fresh, 'Procedure')[0]));
  const baby = resources(fresh, 'Patient').find(r => r.gender !== 'female' || r.deceasedBoolean);
  assert.equal(baby.deceasedBoolean, true);
  assert.equal(out.subject.reference, urlOf(fresh, baby), 'the outcome is about the baby');
  assert.equal(withCode(fresh, '9272-6').length, 0, 'no APGAR recorded for a stillbirth');

  const macerated = buildFHIRBundle(bornCase({ outcome: 'sb_macerated' }), SETTINGS);
  const m = one(macerated, '364587008');
  assert.equal(valueCode(m), '237366000');
  assert.equal(m.component[0].valueCodeableConcept.coding[0].code, '408796008', 'timing not recorded: unknown');

  const live = buildFHIRBundle(bornCase(), SETTINGS);
  assert.equal(valueCode(one(live, '364587008')), '281050002');
  assert.ok(resources(live, 'Patient').every(r => r.deceasedBoolean === undefined));
});

test('a voided entry is exported as entered-in-error with its reason, not dropped', () => {
  const p = bornCase();
  p.meds.push({ id: 'm1', time: iso(3), kind: 'medicine', detail: 'Ampicillin 2 g IV', action: 'given', by: 'AB', voided: { at: iso(2.5), by: 'AB', reason: 'wrong patient' } });
  const b = buildFHIRBundle(p, SETTINGS);
  const voided = resources(b, 'Observation').filter(r => r.status === 'entered-in-error');
  assert.equal(voided.length, 1);
  assert.equal(voided[0].valueQuantity.value, 188, 'the value entered in error is kept');
  assert.match(voided[0].note[0].text, /typed 188 for 88/);
  assert.equal(voided[0].note[0].authorString, 'XY');
  const med = resources(b, 'MedicationAdministration').find(r => r.medicationCodeableConcept.text === 'Ampicillin 2 g IV');
  assert.equal(med.status, 'entered-in-error');
  assert.match(med.note[0].text, /wrong patient/);
  assert.ok(resources(b, 'Observation').filter(r => r !== voided[0]).every(r => ['final', 'preliminary'].includes(r.status)));
});

test('every Observation carries an HL7 category: vital signs, exam, survey, laboratory, procedure', () => {
  const b = buildFHIRBundle(bornCase(), SETTINGS);
  const cat = r => r.category[0].coding[0].code;
  for (const r of resources(b, 'Observation')) {
    assert.equal(r.category[0].coding[0].system, OBS_CATEGORY);
    assert.ok(['vital-signs', 'exam', 'survey', 'laboratory', 'procedure'].includes(cat(r)), cat(r));
  }
  for (const code of ['8867-4', '85354-9', '8310-5']) assert.ok(withCode(b, code).every(r => cat(r) === 'vital-signs'), code);
  for (const code of ['50629008', '278067008', '55283-6', '168089007']) assert.equal(cat(withCode(b, code)[0]), 'exam', code);
  for (const code of ['companion', 'pain-relief', 'oral-fluid', '8361-8', '9272-6', '1303698009']) assert.equal(cat(withCode(b, code)[0]), 'survey', code);
  assert.equal(cat(one(b, '20454-5')), 'laboratory');
  assert.ok(withCode(b, '719051004').every(r => cat(r) === 'procedure'));
});

test('newborn birthDate is the East Africa Time date of the birth, not the UTC date', () => {
  const birthDate = time => {
    const p = bornCase({ time });
    const b = buildFHIRBundle(p, SETTINGS);
    return resources(b, 'Patient').find(r => r.birthDate);
  };
  assert.equal(birthDate('2026-06-01T20:30:00.000Z').birthDate, '2026-06-01', '23:30 EAT on the 1st');
  const late = birthDate('2026-06-01T22:30:00.000Z'); // 01:30 EAT on the 2nd, still the 1st in UTC
  assert.equal(late.birthDate, '2026-06-02');
  assert.equal(late._birthDate.extension[0].url, 'http://hl7.org/fhir/StructureDefinition/patient-birthTime');
  assert.equal(late._birthDate.extension[0].valueDateTime, '2026-06-02T01:30:00+03:00');
});

test('Robson group is an Observation: final after the birth, preliminary before, absent when unclassifiable', () => {
  const born = buildFHIRBundle(bornCase(), SETTINGS);
  const r = one(born, '1303698009');
  assert.equal(valueCode(r), '1');
  assert.equal(r.status, 'final');
  assert.equal(r.valueCodeableConcept.coding[0].system, 'urn:labour-care-guide:robson-group');

  const labour = one(buildFHIRBundle(fullCase({ status: 'active' }), SETTINGS), '1303698009');
  assert.equal(labour.status, 'preliminary');

  const cs = bornCase({ mode: 'cs' });
  Object.assign(cs, { para: 2, riskFactors: ['prior_cs'] });
  const csb = buildFHIRBundle(cs, SETTINGS);
  assert.equal(valueCode(one(csb, '1303698009')), '5');
  assert.equal(resources(csb, 'Procedure')[0].code.coding[0].code, '11466000', 'caesarean section as the mode of birth');

  const noGA = buildFHIRBundle(fullCase({ gaWeeks: null }), SETTINGS);
  assert.equal(withCode(noGA, '1303698009').length, 0);
});

test('performer comes from the initials recorded with each entry', () => {
  const p = bornCase();
  p.meds.push({ id: 'm2', time: iso(3), kind: 'ivfluid', detail: 'RL 500 mL', action: 'given', by: 'EF' });
  const b = buildFHIRBundle(p, SETTINGS);
  const fhr = withCode(b, '55283-6')[0];
  assert.deepEqual(fhr.performer, [{ type: 'Practitioner', display: 'AB' }]);
  assert.equal(one(b, '70514001').performer, undefined, 'no initials, no performer');
  const iv = resources(b, 'MedicationAdministration').find(r => r.medicationCodeableConcept.text === 'IV fluids: RL 500 mL');
  assert.equal(iv.performer[0].actor.display, 'EF');
  assert.equal(resources(b, 'Procedure')[0].performer[0].actor.display, 'CD');
  assert.equal(resources(b, 'Encounter')[0].participant[0].individual.display, 'AB');
  assert.equal(resources(b, 'Practitioner').length, 0, 'no Practitioner resource is invented from initials');
});

test('the newborn is linked to her mother through RelatedPerson, never a Patient.link between two people', () => {
  const b = buildFHIRBundle(bornCase(), SETTINGS);
  const [mother, baby] = resources(b, 'Patient');
  const rp = resources(b, 'RelatedPerson')[0];
  assert.equal(baby.link, undefined);
  assert.equal(rp.patient.reference, urlOf(b, baby));
  assert.equal(rp.relationship[0].coding[0].code, 'MTH');
  assert.equal(mother.link[0].other.reference, urlOf(b, rp));
  for (const l of mother.link) assert.ok(['replaced-by', 'replaces', 'refer', 'seealso'].includes(l.type), l.type);
});

test('every newborn finding has the newborn as subject: weight, APGAR, outcome, baby checks, newborn alerts', () => {
  const p = bornCase();
  p.alerts.push(alert('a1', 'nb_breathing', 'danger', 'pb'), alert('a2', 'apgar_low', 'danger'),
    alert('a3', 'pp_atony', 'danger', 'pm'), alert('a4', 'fhr_abn', 'warn', 'b1'));
  const b = buildFHIRBundle(p, SETTINGS, { now: NOW });
  const [mother, baby] = resources(b, 'Patient');
  const about = r => r.subject.reference;
  for (const code of ['8339-4', '9272-6', '9274-2', '364587008', '248565000', '364652002', 'nb_breathing', 'apgar_low']) {
    assert.equal(about(one(b, code)), urlOf(b, baby), code);
  }
  const temp = value => withCode(b, '8310-5').find(r => r.valueQuantity.value === value);
  assert.equal(about(temp(36.2)), urlOf(b, baby), 'the baby check temperature');
  assert.equal(about(temp(36.8)), urlOf(b, mother), 'her own temperature in labour');
  assert.equal(about(one(b, 'pp_atony')), urlOf(b, mother));
  // fetal findings in labour stay on the mother: the fetus is not a Patient
  for (const code of ['55283-6', '364364001', 'fhr_abn']) assert.ok(withCode(b, code).every(r => about(r) === urlOf(b, mother)), code);
  assert.equal(one(b, '364587008').partOf[0].reference, urlOf(b, resources(b, 'Procedure')[0]));
  assert.equal(temp(36.2).note, undefined, 'no missing-birth note while the birth is on record');
});

test('birth record voided, not yet recorded again: the baby check still goes to the newborn, never the mother', () => {
  const p = bornCase();
  p.alerts.push(alert('a1', 'nb_cold', 'warn', 'pb'), alert('a2', 'pp_bleeding', 'danger', 'pm'));
  voidDelivery(p, LCG, { by: 'CD', reason: 'recorded on the wrong woman', at: iso(0.25) });
  assert.equal(p.delivery, null);
  assert.equal(p.deliveryHistory.length, 1);
  const b = buildFHIRBundle(p, SETTINGS, { now: NOW });
  const [mother, baby] = resources(b, 'Patient');
  assert.equal(resources(b, 'Patient').length, 2, 'the newborn goes out without a birth record');
  assert.deepEqual(baby.identifier, [{ system: 'urn:labour-care-guide:record', value: 'case-1/newborn' }]);
  assert.equal(baby.birthDate, undefined);
  assert.equal(baby._birthDate, undefined);
  assert.equal(baby.gender, 'unknown');
  const check = resources(b, 'Observation').filter(r => r.identifier[0].value.startsWith('case-1/obs:pb:'));
  assert.equal(check.length, 3, 'breathing, temperature, feeding');
  for (const r of check) {
    assert.equal(r.subject.reference, urlOf(b, baby));
    assert.match(r.note[0].text, /no birth record on file/);
  }
  const onMother = resources(b, 'Observation').filter(r => r.subject.reference === urlOf(b, mother));
  assert.ok(!onMother.some(r => r.valueQuantity && r.valueQuantity.value === 36.2), '36.2 C is never a maternal temperature');
  assert.ok(!onMother.some(r => hasCode(r, '248565000') || hasCode(r, '364652002')));
  assert.equal(one(b, 'nb_cold').subject.reference, urlOf(b, baby));
  assert.equal(one(b, 'pp_bleeding').subject.reference, urlOf(b, mother));
  const rp = resources(b, 'RelatedPerson')[0];
  assert.equal(rp.patient.reference, urlOf(b, baby));
  assert.equal(mother.link[0].other.reference, urlOf(b, rp));
  // nothing from the voided birth record goes out
  assert.equal(resources(b, 'Procedure').length, 0);
  for (const code of ['8339-4', '9272-6', '9274-2', '364587008']) assert.equal(withCode(b, code).length, 0, code);
  assert.equal(resources(b, 'Encounter')[0].status, 'in-progress', 'in labour again until the birth is recorded again');
  const urls = new Set(b.entry.map(e => e.fullUrl));
  for (const r of allRefs(b)) assert.ok(urls.has(r), `reference ${r} resolves inside the bundle`);
});

test('no newborn Patient before the birth when nothing is about the baby', () => {
  const b = buildFHIRBundle(fullCase({ status: 'active' }), SETTINGS, { now: NOW });
  assert.equal(resources(b, 'Patient').length, 1);
  assert.equal(resources(b, 'RelatedPerson').length, 0);
  assert.equal(resources(b, 'Patient')[0].link, undefined);
});

test('WHO LCG rows: amniotic fluid, decelerations, supportive care, pushing, blood loss, postpartum checks', () => {
  const b = buildFHIRBundle(bornCase(), SETTINGS);
  const fluid = withCode(b, '168089007').map(valueCode);
  assert.deepEqual(fluid.sort(), ['168090003', '408792005', '408794006'], 'C, M+ and M+++ graded');
  assert.deepEqual(withCode(b, '364364001').map(valueCode).sort(), ['1399254006', '251675006']);
  assert.match(withCode(b, '364364001').find(r => valueCode(r) === '1399254006').note[0].text, /form default/);
  assert.equal(valueCode(one(b, 'pain-relief')), '443390004', 'D = declined');
  assert.equal(valueCode(one(b, 'oral-fluid')), '373067005');
  assert.equal(valueCode(one(b, '8361-8')), '40199007', 'supine');
  assert.equal(one(b, '258134007').valueBoolean, true, 'pushing began (P)');
  const drape = withCode(b, '719051004').find(r => r.method && r.method.coding[0].code === 'drape');
  assert.equal(drape.valueQuantity.value, 350);
  assert.equal(drape.valueQuantity.code, 'mL');
  assert.equal(valueCode(one(b, '364255009')), '249201004', 'soft uterus');
  assert.equal(valueCode(one(b, '249212004')), '289580000', 'heavy bleeding');
  const breathing = one(b, '248565000');
  assert.equal(valueCode(breathing), '230145002');
  const baby = resources(b, 'Patient').find(r => r.birthDate);
  assert.equal(breathing.subject.reference, urlOf(b, baby), 'the newborn check is about the newborn');
  assert.equal(withCode(b, '8310-5').filter(r => r.subject.reference === urlOf(b, baby)).length, 1);
});

test('contractions: frequency and duration codes, the duration as its recorded band', () => {
  const b = buildFHIRBundle(bornCase(), SETTINGS);
  const c = one(b, '70514001');
  assert.deepEqual(c.component.map(x => x.code.coding[0].code), ['364270005', '364274001']);
  assert.deepEqual(c.component[1].valueRange, {
    low: { value: 20, unit: 's', system: 'http://unitsofmeasure.org', code: 's' },
    high: { value: 40, unit: 's', system: 'http://unitsofmeasure.org', code: 's' },
  });
  assert.ok(!JSON.stringify(b).includes('251680002'), 'the intensity code is not used for duration');
});

test('oxytocin: infusion records carry the rate; a stop is a stopped administration', () => {
  const p = fullCase();
  p.meds.push(
    { id: 'm3', time: iso(3.5), kind: 'oxytocin', detail: '', oxyUL: 5, oxyDrops: 10, action: 'start', by: 'AB' },
    { id: 'm4', time: iso(2.5), kind: 'oxytocin', detail: 'Oxytocin STOPPED', action: 'stop', by: 'AB' },
  );
  const meds = resources(buildFHIRBundle(p, SETTINGS), 'MedicationAdministration');
  assert.equal(meds.length, 3);
  const check = meds.find(r => r.dosage && r.dosage.rateQuantity && r.dosage.rateQuantity.value === 20);
  assert.equal(check.dosage.rateQuantity.code, '{drop}/min');
  assert.equal(check.medicationCodeableConcept.coding[0].code, '112115002');
  assert.equal(meds.find(r => r.dosage && r.dosage.rateQuantity && r.dosage.rateQuantity.value === 10).status, 'completed');
  assert.equal(meds.find(r => !r.dosage).status, 'stopped');
});

test('filename carries the case id and ward date, never the name or MRN', () => {
  const p = fullCase();
  const name = fhirFilename(p, new Date('2026-06-01T22:30:00.000Z'));
  assert.equal(name, 'lcg-fhir-case-1-2026-06-02.json');
  for (const s of ['Abeba', 'Tesfaye', 'MRN', '778']) assert.ok(!name.includes(s), s);
  assert.match(fhirFilename({ id: '../x y' }), /^lcg-fhir-xy-\d{4}-\d{2}-\d{2}\.json$/);
  assert.match(fhirFilename({}), /^lcg-fhir-case-/);
});
