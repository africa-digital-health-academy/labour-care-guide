// fhir.js — HL7 FHIR R4 export for EMR interoperability.
//
// There is (as of mid-2026) no published WHO SMART Guidelines DAK / FHIR IG
// for intrapartum care, so this mapping follows the closest authoritative
// precedents (WHO smart-anc patterns, HL7 vital-signs profiles) with
// LOINC/SNOMED codes verified against NLM/Ontoserver. See
// docs/FHIR_MAPPING.md for the full table and rationale.
//
// Output: a single `Bundle` (type: collection) per labour case containing
// Patient, Encounter, Observations, MedicationAdministrations, Flags and
// (if referred) a ServiceRequest. Ready for POST-per-resource or transaction
// conversion when a national HIE / OpenMRS / Bahmni endpoint exists.

const LOINC = 'http://loinc.org';
const SCT = 'http://snomed.info/sct';

function cc(system, code, display) {
  return { coding: [{ system, code, display }], text: display };
}

function quantity(value, unit, code) {
  return { value, unit, system: 'http://unitsofmeasure.org', code: code || unit };
}

let seq = 0;
function ref(type, id) { return { reference: `urn:uuid:${id}` }; }
function entry(resource, id) { return { fullUrl: `urn:uuid:${id}`, resource }; }
function nid(p) { return `${p.id}-${++seq}`; }

const OBS_MAP = {
  fhr: v => ({ code: cc(LOINC, '55283-6', 'Fetal heart rate'), valueQuantity: quantity(v, 'beats/min', '/min') }),
  dilatation: v => ({ code: cc(SCT, '50629008', 'Cervical dilatation'), valueQuantity: quantity(v, 'cm') }),
  descent: v => ({ code: cc(SCT, '278067008', 'Proportion of fetal head palpable above pelvic brim'), valueQuantity: quantity(v, '{fifths}', '{fifths}') }),
  pulse: v => ({ code: cc(LOINC, '8867-4', 'Heart rate'), valueQuantity: quantity(v, 'beats/min', '/min') }),
  temp: v => ({ code: cc(LOINC, '8310-5', 'Body temperature'), valueQuantity: quantity(v, 'Cel') }),
  moulding: v => ({ code: cc(SCT, '79114003', 'Fetal head molding'), valueString: '+'.repeat(v) || 'none' }),
  caput: v => ({ code: cc(SCT, '82729001', 'Caput succedaneum'), valueString: '+'.repeat(v) || 'none' }),
};

function bpObservation(p, o) {
  return {
    resourceType: 'Observation', status: 'final',
    code: cc(LOINC, '85354-9', 'Blood pressure panel'),
    subject: ref('Patient', p.id), encounter: ref('Encounter', p.id + '-enc'),
    effectiveDateTime: o.time,
    component: [
      { code: cc(LOINC, '8480-6', 'Systolic blood pressure'), valueQuantity: quantity(o.v.sys, 'mmHg', 'mm[Hg]') },
      { code: cc(LOINC, '8462-4', 'Diastolic blood pressure'), valueQuantity: quantity(o.v.dia, 'mmHg', 'mm[Hg]') },
    ],
  };
}

function contractionsObservation(p, o) {
  const comp = [{
    code: cc(SCT, '70514001', 'Uterine contraction frequency (per 10 min)'),
    valueQuantity: quantity(o.v.count, '/10min', '/(10.min)'),
  }];
  if (o.v.duration != null) {
    comp.push({ code: cc(SCT, '251680002', 'Uterine contraction duration'), valueQuantity: quantity(o.v.duration, 's') });
  }
  return {
    resourceType: 'Observation', status: 'final',
    code: cc(SCT, '70514001', 'Uterine contractions'),
    subject: ref('Patient', p.id), encounter: ref('Encounter', p.id + '-enc'),
    effectiveDateTime: o.time, component: comp,
  };
}

function apgarObservation(p, apgar, minute, loincCode) {
  return {
    resourceType: 'Observation', status: 'final',
    code: cc(LOINC, loincCode, `${minute} minute Apgar Score`),
    subject: ref('Patient', p.id + '-baby'),
    effectiveDateTime: p.delivery ? p.delivery.time : undefined,
    valueQuantity: { value: apgar.total, unit: '{score}' },
  };
}

export function buildFHIRBundle(p, settings) {
  seq = 0;
  const entries = [];

  entries.push(entry({
    resourceType: 'Patient', id: p.id,
    name: [{ text: p.name }],
    telecom: p.phone ? [{ system: 'phone', value: p.phone }] : undefined,
    gender: 'female',
    address: p.kebele ? [{ text: p.kebele, country: 'ET' }] : undefined,
    identifier: p.mrn ? [{ system: 'urn:ethiopia:mrn', value: p.mrn }] : undefined,
  }, p.id));

  entries.push(entry({
    resourceType: 'Encounter', id: p.id + '-enc', status: p.status === 'referred' ? 'finished' : 'in-progress',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IMP', display: 'inpatient encounter' },
    type: [cc(SCT, '236973005', 'Delivery procedure')],
    subject: ref('Patient', p.id),
    period: { start: (p.admission && p.admission.time) || p.createdAt, end: p.delivery ? p.delivery.time : undefined },
    serviceProvider: { display: settings.facilityName || 'Health centre' },
  }, p.id + '-enc'));

  // observations
  for (const o of (p.obs || [])) {
    const push = res => entries.push(entry(res, nid(p)));
    if (o.type === 'baby' && o.v.fhr != null) push(simpleObs(p, o, OBS_MAP.fhr(o.v.fhr)));
    if (o.type === 'exam') {
      if (o.v.dilatation != null) push(simpleObs(p, o, OBS_MAP.dilatation(o.v.dilatation)));
      if (o.v.descent != null) push(simpleObs(p, o, OBS_MAP.descent(o.v.descent)));
      if (o.v.moulding) push(simpleObs(p, o, OBS_MAP.moulding(o.v.moulding)));
      if (o.v.caput) push(simpleObs(p, o, OBS_MAP.caput(o.v.caput)));
    }
    if (o.type === 'pulse' && o.v.pulse != null) push(simpleObs(p, o, OBS_MAP.pulse(o.v.pulse)));
    if (o.type === 'vitals') {
      if (o.v.sys != null && o.v.dia != null) push(bpObservation(p, o));
      if (o.v.temp != null) push(simpleObs(p, o, OBS_MAP.temp(o.v.temp)));
    }
    if (o.type === 'contractions' && o.v.count != null) push(contractionsObservation(p, o));
  }

  // medications
  for (const m of (p.meds || [])) {
    entries.push(entry({
      resourceType: 'MedicationAdministration', status: 'completed',
      medicationCodeableConcept: m.kind === 'oxytocin'
        ? cc(SCT, '112115002', 'Oxytocin')
        : { text: m.detail || m.kind },
      subject: ref('Patient', p.id), context: ref('Encounter', p.id + '-enc'),
      effectiveDateTime: m.time,
      note: m.detail ? [{ text: m.detail }] : undefined,
    }, nid(p)));
  }

  // alerts as Flags
  for (const a of (p.alerts || []).filter(x => x.severity !== 'info')) {
    entries.push(entry({
      resourceType: 'Flag', status: a.resolved ? 'inactive' : 'active',
      code: { text: a.title }, subject: ref('Patient', p.id),
      period: { start: a.time },
    }, nid(p)));
  }

  // newborn + APGAR
  if (p.delivery && p.newborn) {
    entries.push(entry({
      resourceType: 'Patient', id: p.id + '-baby',
      gender: p.newborn.sex === 'M' ? 'male' : p.newborn.sex === 'F' ? 'female' : 'unknown',
      birthDate: p.delivery.time ? p.delivery.time.slice(0, 10) : undefined,
      link: [{ other: ref('Patient', p.id), type: 'seealso' }],
    }, p.id + '-baby'));
    if (p.newborn.weightG != null) {
      entries.push(entry({
        resourceType: 'Observation', status: 'final',
        code: cc(LOINC, '8339-4', 'Birth weight measured'),
        subject: ref('Patient', p.id + '-baby'),
        effectiveDateTime: p.delivery.time,
        valueQuantity: quantity(p.newborn.weightG, 'g'),
      }, nid(p)));
    }
    if (p.newborn.apgar1) entries.push(entry(apgarObservation(p, p.newborn.apgar1, 1, '9272-6'), nid(p)));
    if (p.newborn.apgar5) entries.push(entry(apgarObservation(p, p.newborn.apgar5, 5, '9274-2'), nid(p)));
    if (p.newborn.apgar10) entries.push(entry(apgarObservation(p, p.newborn.apgar10, 10, '9271-8'), nid(p)));
  }

  // referral as ServiceRequest
  if (p.referral) {
    entries.push(entry({
      resourceType: 'ServiceRequest', status: 'active', intent: 'order', priority: 'urgent',
      code: cc(SCT, '3457005', 'Patient referral'),
      subject: ref('Patient', p.id), encounter: ref('Encounter', p.id + '-enc'),
      authoredOn: p.referral.time,
      reasonCode: p.referral.reasons.map(r => ({ text: r })),
      performer: [{ display: p.referral.facility || 'Receiving hospital' }],
      note: [{ text: 'Pre-referral: ' + p.referral.checklist.filter(c => c.done).map(c => c.label).join('; ') }],
    }, nid(p)));
  }

  return {
    resourceType: 'Bundle', type: 'collection',
    timestamp: new Date().toISOString(),
    meta: { tag: [{ system: 'urn:parthograph', code: 'parthograph-export' }] },
    entry: entries,
  };
}

function simpleObs(p, o, fields) {
  return Object.assign({
    resourceType: 'Observation', status: 'final',
    subject: ref('Patient', p.id), encounter: ref('Encounter', p.id + '-enc'),
    effectiveDateTime: o.time,
  }, fields);
}

export function downloadFHIR(p, settings) {
  const bundle = buildFHIRBundle(p, settings);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `parthograph-fhir-${(p.name || 'case').replace(/\s+/g, '_')}-${p.id}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
