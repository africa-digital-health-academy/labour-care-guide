// fhir.js - HL7 FHIR R4 export of one labour case, for EMR interoperability.
//
// There is no WHO SMART Guidelines DAK or HL7 IG for intrapartum care yet
// (mid-2026), so the mapping follows the closest precedents: the HL7
// vital-signs profiles and the WHO smart-anc patterns. Every LOINC and SNOMED
// CT code below was looked up (NLM Clinical Tables, Ontoserver) on 1 Oct 2026;
// docs/FHIR_MAPPING.md lists them and marks the ones that still need a
// terminology review. Concepts with no standard code yet use local code
// systems under urn:labour-care-guide.
//
// Output: one Bundle (type collection) per case. Every resource gets a fresh
// random UUID from a per-export map (fullUrl urn:uuid:<id>), so references
// resolve inside the bundle; stable identifiers (case id, entry id) let a
// receiver recognise the same record in a later export. Nothing is dropped
// for having been corrected: a voided entry goes out as entered-in-error with
// its reason. A finding about the baby after the birth always has the newborn
// Patient as subject, never the mother. Pure, except downloadFHIR(), which
// needs the DOM, and the default export time (opts.now).

import { isLabouring, inPostpartumWatch, stageOf, birthTime, activeObs, toMs, POSTPARTUM } from './protocol.js';
import { robsonGroup } from './indicators.js';
import { APP_TZ_OFFSET } from './ui.js';

const LOINC = 'http://loinc.org';
const SCT = 'http://snomed.info/sct';
const UCUM = 'http://unitsofmeasure.org';
const OBS_CATEGORY = 'http://terminology.hl7.org/CodeSystem/observation-category';
const DATA_ABSENT = 'http://terminology.hl7.org/CodeSystem/data-absent-reason';
const ACT_CODE = 'http://terminology.hl7.org/CodeSystem/v3-ActCode';
const ROLE_CODE = 'http://terminology.hl7.org/CodeSystem/v3-RoleCode';
const PARTICIPATION = 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType';
const DISCHARGE = 'http://terminology.hl7.org/CodeSystem/discharge-disposition';
const FLAG_CATEGORY = 'http://terminology.hl7.org/CodeSystem/flag-category';
const BIRTH_TIME = 'http://hl7.org/fhir/StructureDefinition/patient-birthTime';
// Local code systems for what no standard code covers yet: LCG + ':<name>'.
const LCG = 'urn:labour-care-guide';
const LCG_OBS = LCG + ':observation';

// HL7 observation-category codes
const VITAL = 'vital-signs', EXAM = 'exam', SURVEY = 'survey', LAB = 'laboratory', PROCEDURE = 'procedure';
const CATEGORY_LABEL = { [VITAL]: 'Vital Signs', [EXAM]: 'Exam', [SURVEY]: 'Survey', [LAB]: 'Laboratory', [PROCEDURE]: 'Procedure' };

// ---------------------------------------------------------------- codes ----
// [system, code, display, text]. Displays are the SNOMED fully specified name
// without its tag, or the LOINC long common name.

const C = Object.freeze({
  fhr: [LOINC, '55283-6', 'Fetal heart rate'],
  decel: [SCT, '364364001', 'Characteristic of fetal heart deceleration', 'FHR decelerations'],
  liquor: [SCT, '168089007', 'Amniotic fluid appearance', 'Amniotic fluid'],
  dilatation: [SCT, '50629008', 'Cervical dilatation'],
  descent: [SCT, '278067008', 'Proportion of fetal head above pelvic brim', 'Descent (fifths palpable above the brim)'],
  presentation: [SCT, '271692001', 'Presentation of fetus'],
  position: [SCT, '364607000', 'Position of fetus'],
  caput: [SCT, '82729001', 'Caput succedaneum', 'Caput'],
  moulding: [SCT, '79114003', 'Fetal head molding', 'Moulding'],
  contractions: [SCT, '70514001', 'Uterine contraction', 'Uterine contractions'],
  contractionFrequency: [SCT, '364270005', 'Frequency of uterine contraction', 'Contractions per 10 minutes'],
  contractionDuration: [SCT, '364274001', 'Duration of uterine contraction'],
  pulse: [LOINC, '8867-4', 'Heart rate', 'Maternal pulse'],
  bp: [LOINC, '85354-9', 'Blood pressure panel with all children optional', 'Blood pressure'],
  sys: [LOINC, '8480-6', 'Systolic blood pressure'],
  dia: [LOINC, '8462-4', 'Diastolic blood pressure'],
  temp: [LOINC, '8310-5', 'Body temperature'],
  protein: [LOINC, '20454-5', 'Protein [Presence] in Urine by Test strip', 'Urine protein'],
  acetone: [LOINC, '2514-8', 'Ketones [Presence] in Urine by Test strip', 'Urine acetone'],
  companion: [LCG_OBS, 'companion', 'Companion of choice present'],
  painRelief: [LCG_OBS, 'pain-relief', 'Pain relief received'],
  oralFluid: [LCG_OBS, 'oral-fluid', 'Oral fluid taken'],
  posture: [LOINC, '8361-8', 'Body position with respect to gravity', 'Posture'],
  pushing: [SCT, '258134007', 'Bearing down', 'Pushing began (P: start of the active second stage)'],
  bloodLoss: [SCT, '719051004', 'Quantity of postpartum maternal blood loss', 'Blood loss (cumulative)'],
  bleeding: [SCT, '249212004', 'Quantity of lochia', 'Vaginal bleeding'],
  tone: [SCT, '364255009', 'Consistency of uterus', 'Uterine tone'],
  fundus: [SCT, '364253002', 'Fundal height of uterus'],
  urinePassed: [LCG_OBS, 'urine-passed', 'Urine passed since the birth'],
  breathing: [SCT, '248565000', 'Respiratory effort', 'Newborn breathing'],
  feeding: [SCT, '364652002', 'Infant feeding pattern', 'Newborn feeding'],
  birthWeight: [LOINC, '8339-4', 'Birth weight Measured'],
  apgar1: [LOINC, '9272-6', '1 minute Apgar Score'],
  apgar5: [LOINC, '9274-2', '5 minute Apgar Score'],
  apgar10: [LOINC, '9271-8', '10 minute Apgar Score'],
  outcome: [SCT, '364587008', 'Birth outcome'],
  sbTiming: [LCG_OBS, 'stillbirth-timing', 'Timing of fetal death'],
  robson: [SCT, '1303698009', 'Robson Ten Group Classification System category', 'Robson group'],
  labourEncounter: [SCT, '236973005', 'Delivery procedure'],
  referral: [SCT, '3457005', 'Patient referral'],
  oxytocin: [SCT, '112115002', 'Oxytocin'],
});

// Birth as a Procedure, by delivery.mode. No active SNOMED concept covers a
// vaginal breech birth without saying spontaneous or assisted.
const MODE = Object.freeze({
  svd: [SCT, '177184002', 'Normal delivery procedure', 'Spontaneous vaginal birth'],
  assisted: [SCT, '61586001', 'Delivery by vacuum extraction', 'Assisted vaginal birth (vacuum)'],
  breech: [SCT, '700000006', 'Vaginal delivery of fetus', 'Vaginal breech birth'],
  cs: [SCT, '11466000', 'Cesarean section', 'Caesarean section'],
  other: [SCT, '236973005', 'Delivery procedure', 'Other mode of birth'],
  none: [SCT, '236973005', 'Delivery procedure', 'Mode of birth not recorded'],
});

// Recorded value -> [SNOMED code, display, text]; a null code exports the text only.
const YES = ['373066001', 'Yes'], NO = ['373067005', 'No'];
const V = Object.freeze({
  ynd: { Y: [...YES, 'Y - yes'], N: [...NO, 'N - no'], D: ['443390004', 'Declined', 'D - declined by the woman'] },
  yn: { Y: [...YES, 'Yes'], N: [...NO, 'No'] },
  decel: {
    none: ['1399254006', 'Fetal heart rate deceleration absent', 'None'],
    early: ['251674005', 'Early fetal heart deceleration', 'Early'],
    late: ['251675006', 'Late fetal heart deceleration', 'Late'],
    variable: ['789258006', 'Variable fetal heart decelerations', 'Variable'],
    prolonged: ['789259003', 'Prolonged fetal heart deceleration', 'Prolonged'],
  },
  liquor: {
    I: ['249125003', 'Intact membranes', 'I - membranes intact'],
    C: ['168090003', 'Amniotic fluid clear', 'C - clear'],
    M1: ['408792005', 'Meconium stained liquor - grade I', 'M+ - non-significant meconium'],
    M2: ['408793000', 'Meconium stained liquor - grade II', 'M++ - medium meconium'],
    M3: ['408794006', 'Meconium stained liquor - grade III', 'M+++ - thick meconium'],
    M: ['168092006', 'Meconium stained amniotic fluid', 'M - meconium, grade not recorded'],
    B: ['249134008', 'Bloodstained liquor', 'B - blood-stained'],
  },
  presentation: {
    cephalic: ['1209182005', 'Cephalic fetal presentation', 'Cephalic'],
    breech: ['6096002', 'Breech presentation', 'Breech'],
    transverse: ['73161006', 'Transverse lie', 'Transverse'],
    other: [null, null, 'Other presentation'],
  },
  position: {
    OA: ['90381008', 'Occipitoanterior position', 'OA - occipito-anterior'],
    OT: ['249071008', 'Occipitolateral position', 'OT - occipito-transverse'],
    OP: ['37235006', 'Occipitoposterior position', 'OP - occipito-posterior'],
    unknown: [null, null, 'Position not determined'],
  },
  posture: {
    upright: [null, null, 'Upright / mobile (MO)'],
    MO: [null, null, 'Mobile (MO)'],
    lateral: ['32185000', 'Lateral decubitus position', 'Lying on her side (MO)'],
    supine: ['40199007', 'Supine body position', 'Supine (SP)'],
    SP: ['40199007', 'Supine body position', 'Supine (SP)'],
  },
  urine: {
    neg: ['260385009', 'Negative', 'Negative'],
    nil: ['260385009', 'Negative', 'Negative'],
    trace: ['260405006', 'Trace', 'Trace'],
    '+': ['260347006', 'Present + out of ++++', '+'],
    '++': ['260348001', 'Present ++ out of ++++', '++'],
    '+++': ['260349009', 'Present +++ out of ++++', '+++'],
    '++++': ['260350009', 'Present ++++ out of ++++', '++++'],
  },
  bleeding: { normal: ['289585005', 'Lochia normal', 'Normal'], heavy: ['289580000', 'Lochia heavy', 'Heavy'] },
  tone: { firm: ['289741005', 'Uterus contracted', 'Firm (contracted)'], soft: ['249201004', 'Uterus boggy', 'Soft'] },
  fundus: {
    below: ['289628001', 'Uterine fundus between symphysis pubis and umbilicus', 'Below the umbilicus'],
    at: ['289627006', 'Uterine fundus at umbilicus', 'At the umbilicus'],
    above: ['289629009', 'Uterine fundus above umbilicus', 'Above the umbilicus'],
  },
  breathing: {
    normal: ['1290338002', 'Normal respiratory effort', 'Breathing normally'],
    difficult: ['230145002', 'Difficulty breathing', 'Breathing with difficulty'],
    none: ['1023001', 'Apnea', 'Not breathing'],
  },
  feeding: { good: [null, null, 'Feeding well'], poor: ['276717003', 'Poor feeding of newborn', 'Feeding poorly'] },
  outcome: {
    live: ['281050002', 'Livebirth', 'Live birth'],
    sb_fresh: ['237365001', 'Fresh stillbirth', 'Stillbirth (fresh)'],
    sb_macerated: ['237366000', 'Macerated stillbirth', 'Stillbirth (macerated)'],
  },
  sbTiming: {
    antepartum: ['237361005', 'Antepartum fetal death', 'Before labour (antepartum)'],
    intrapartum: ['237362003', 'Intrapartum fetal death', 'During labour (intrapartum)'],
    unknown: ['408796008', 'Stillbirth - unknown if fetal death intrapartum or prior to labor', 'Unknown'],
  },
});

// WHO Robson classification implementation manual (2017), group definitions.
const ROBSON = Object.freeze({
  1: 'nulliparous, single cephalic, >= 37 weeks, spontaneous labour',
  '2a': 'nulliparous, single cephalic, >= 37 weeks, induced labour',
  '2b': 'nulliparous, single cephalic, >= 37 weeks, caesarean before labour',
  3: 'multiparous without previous caesarean, single cephalic, >= 37 weeks, spontaneous labour',
  '4a': 'multiparous without previous caesarean, single cephalic, >= 37 weeks, induced labour',
  '4b': 'multiparous without previous caesarean, single cephalic, >= 37 weeks, caesarean before labour',
  5: 'multiparous with at least one previous caesarean, single cephalic, >= 37 weeks',
  6: 'nulliparous, single breech',
  7: 'multiparous, single breech, including previous caesarean',
  8: 'multiple pregnancy, including previous caesarean',
  9: 'single pregnancy in transverse or oblique lie, including previous caesarean',
  10: 'single cephalic, < 37 weeks, including previous caesarean',
});

const LOSS_METHOD = Object.freeze({ drape: 'Calibrated drape', weighed: 'Weighed pads and linen', estimate: 'Visual estimate' });

// The wizard records contraction duration as a band; record.js keeps a
// representative second count for the rules, which is not a measurement.
const DURATION_BAND = Object.freeze({ lt20: [null, 20], b20_40: [20, 40], b40_60: [40, 60], gt60: [60, null] });

// --------------------------------------------------------------- helpers ----

/** A random (version 4) UUID. randomUUID needs a secure context; plain http on a LAN has getRandomValues only. */
export function newUUID() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  if (!c || typeof c.getRandomValues !== 'function') throw new Error('No secure random source for FHIR ids');
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const s = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

const isEmpty = v => v === undefined || v === null || v === ''
  || (Array.isArray(v) ? !v.length : typeof v === 'object' && !Object.keys(v).length);

/** A copy without undefined, null, empty-string, empty-array or empty-object members: FHIR forbids empty elements. */
function compact(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (!isEmpty(v)) out[k] = v;
  }
  return out;
}

const blank = v => v === undefined || v === null || v === '';
const coding = (system, code, display) => compact({ system, code, display });
/** A fresh CodeableConcept from a code-table row. */
const cc = ([system, code, display, text]) => ({ coding: [coding(system, code, display)], text: text || display });
const category = code => [{ coding: [coding(OBS_CATEGORY, code, CATEGORY_LABEL[code])] }];
const ucum = (value, unit, code) => ({ value, unit, system: UCUM, code });

/** The CodeableConcept of a recorded value; an unknown value keeps its text. */
function valueConcept(table, raw) {
  const hit = table[raw];
  if (!hit) return { text: String(raw) };
  const [code, display, text] = hit;
  return code ? { coding: [coding(SCT, code, display)], text } : { text };
}

/** Whoever recorded it, known by initials only (F3): no Practitioner resource is invented. */
const byRef = by => (blank(by) ? undefined : { type: 'Practitioner', display: String(by) });

function voidNotes(voided) {
  if (!voided) return [];
  return [compact({
    authorString: blank(voided.by) ? undefined : String(voided.by),
    time: when(voided.at),
    text: `Entered in error (voided): ${voided.reason || 'no reason recorded'}`,
  })];
}

const MIN_MS = 60000;
// '+03:00' -> 180: East Africa Time keeps one offset all year (no daylight saving)
const OFFSET_MIN = (s => (s[0] === '-' ? -1 : 1) * (60 * Number(s.slice(1, 3)) + Number(s.slice(4, 6))))(APP_TZ_OFFSET);

/**
 * An instant on the ward clock (East Africa Time, ui.js APP_TZ_OFFSET):
 * {date: 'YYYY-MM-DD', dateTime: 'YYYY-MM-DDTHH:MM:SS+03:00'}, or null. A
 * birth at 01:30 on the 2nd is born on the 2nd, though it is still the 1st in UTC.
 */
function wardTime(t) {
  const ms = toMs(t);
  if (!Number.isFinite(ms)) return null;
  const shifted = new Date(ms + OFFSET_MIN * MIN_MS).toISOString(); // its UTC fields read as EAT
  return { date: shifted.slice(0, 10), dateTime: shifted.slice(0, 19) + APP_TZ_OFFSET };
}

/** A FHIR dateTime for a recorded time; an unreadable legacy value is left out rather than exported invalid. */
function when(t) {
  if (blank(t) || !Number.isFinite(toMs(t))) return undefined;
  return typeof t === 'string' ? t : new Date(toMs(t)).toISOString();
}
const minutesAfter = (t, min) => (when(t) ? new Date(toMs(t) + min * MIN_MS).toISOString() : undefined);
const admissionTime = p => (p.admission && p.admission.time) || p.createdAt;

// --------------------------------------------------------------- context ----

/**
 * One export: a stable key -> UUID map (references resolve inside the bundle,
 * a new export mints new ids), the entry list and the export time.
 */
function createContext(p, settings, now) {
  const ids = new Map();
  const idOf = key => {
    if (!ids.has(key)) ids.set(key, newUUID());
    return ids.get(key);
  };
  const caseId = String(p.id || 'case');
  const entries = [];
  return {
    p, settings, now, entries, caseId,
    hasBirth: !!p.delivery,
    hasNewborn: needsNewborn(p),
    ref: key => ({ reference: 'urn:uuid:' + idOf(key) }),
    /** Business identifier: the same record carries the same value in every export. */
    recordId: key => [{ system: LCG + ':record', value: `${caseId}/${key}` }],
    add(key, resourceType, body) {
      const id = idOf(key);
      entries.push({ fullUrl: 'urn:uuid:' + id, resource: { resourceType, id, ...compact(body) } });
      return id;
    },
  };
}

/**
 * One Observation. src: what it was recorded from - {time, by (initials:
 * the performer), voided, defaulted (note text)}. f: {code (table row), cat,
 * value ({valueX}), subject key, status, partOf, method, component, note}.
 */
function addObservation(ctx, key, src, f) {
  const notes = voidNotes(src.voided);
  if (src.defaulted) notes.push({ text: src.defaulted });
  if (f.note) notes.push({ text: f.note });
  ctx.add(key, 'Observation', {
    identifier: ctx.recordId(key),
    partOf: f.partOf,
    status: src.voided ? 'entered-in-error' : f.status || 'final',
    category: category(f.cat),
    code: cc(f.code),
    subject: ctx.ref(f.subject || 'mother'),
    encounter: ctx.ref('encounter'),
    effectiveDateTime: when(src.time),
    performer: byRef(src.by) ? [byRef(src.by)] : undefined,
    ...(f.value || {}),
    note: notes,
    method: f.method,
    component: f.component,
  });
}

// --------------------------------------------------------------- entries ----

const measured = (unit, code) => raw => {
  const n = Number(raw);
  return Number.isFinite(n) ? { valueQuantity: ucum(n, unit, code) } : { valueString: String(raw) };
};
const coded = table => raw => ({ valueCodeableConcept: valueConcept(table, raw) });
const GRADE = ['none', '+', '++', '+++'];
const graded = raw => ({ valueString: GRADE[raw] || String(raw) });

// One Observation per recorded value: code, category, value builder.
const ELEMENT = Object.freeze({
  fhr: { code: C.fhr, cat: EXAM, value: measured('beats/min', '/min') },
  decel: { code: C.decel, cat: EXAM, value: coded(V.decel) },
  liquor: { code: C.liquor, cat: EXAM, value: coded(V.liquor) },
  dilatation: { code: C.dilatation, cat: EXAM, value: measured('cm', 'cm') },
  descent: { code: C.descent, cat: EXAM, value: measured('fifths', '{fifths}') },
  presentation: { code: C.presentation, cat: EXAM, value: coded(V.presentation) },
  position: { code: C.position, cat: EXAM, value: coded(V.position) },
  caput: { code: C.caput, cat: EXAM, value: graded },
  moulding: { code: C.moulding, cat: EXAM, value: graded },
  pulse: { code: C.pulse, cat: VITAL, value: measured('beats/min', '/min') },
  temp: { code: C.temp, cat: VITAL, value: measured('Cel', 'Cel') },
  protein: { code: C.protein, cat: LAB, value: coded(V.urine) },
  acetone: { code: C.acetone, cat: LAB, value: coded(V.urine) },
  companion: { code: C.companion, cat: SURVEY, value: coded(V.ynd) },
  painRelief: { code: C.painRelief, cat: SURVEY, value: coded(V.ynd) },
  oralFluid: { code: C.oralFluid, cat: SURVEY, value: coded(V.ynd) },
  posture: { code: C.posture, cat: SURVEY, value: coded(V.posture) },
  bleeding: { code: C.bleeding, cat: EXAM, value: coded(V.bleeding) },
  tone: { code: C.tone, cat: EXAM, value: coded(V.tone) },
  fundus: { code: C.fundus, cat: EXAM, value: coded(V.fundus) },
  urinePassed: { code: C.urinePassed, cat: EXAM, value: coded(V.yn) },
  breathing: { code: C.breathing, cat: EXAM, value: coded(V.breathing) },
  feeding: { code: C.feeding, cat: EXAM, value: coded(V.feeding) },
});

// The values each entry type holds ('bp' = the sys/dia pair as one panel).
const ENTRY_ELEMENTS = Object.freeze({
  baby: ['fhr', 'decel', 'liquor'],
  exam: ['dilatation', 'descent', 'presentation', 'position', 'caput', 'moulding', 'liquor'],
  pulse: ['pulse'],
  vitals: ['bp', 'temp', 'protein', 'acetone'],
  supportive: ['companion', 'painRelief', 'oralFluid', 'posture'],
  ppMother: ['bleeding', 'tone', 'fundus', 'pulse', 'bp', 'temp', 'urinePassed'],
  ppBaby: ['breathing', 'temp', 'feeding'],
});

const DEFAULTED = 'Recorded as the form default, not changed by the recorder';
// The entry type whose findings are about the baby after the birth
const NEWBORN_ENTRY = 'ppBaby';
const NO_BIRTH_NOTE = 'Newborn check; no birth record on file (voided, not yet recorded again): the newborn has no birth date in this export';

/** The values of an entry that become Observations ('bp' when either half is recorded). */
function recordedElements(o) {
  if (!o || !o.v) return [];
  return (ENTRY_ELEMENTS[o.type] || []).filter(el => (el === 'bp' ? !blank(o.v.sys) || !blank(o.v.dia) : !blank(o.v[el])));
}

function entrySource(o, el) {
  const defaulted = Array.isArray(o.defaulted) && o.defaulted.includes(el);
  return { time: o.time, by: o.by, voided: o.voided, defaulted: defaulted ? DEFAULTED : null };
}

/** Blood pressure as the HL7 panel; a missing half is marked unknown, as the profile asks. */
function addBP(ctx, key, src, v, subject) {
  const part = (code, n) => (blank(n) || !Number.isFinite(Number(n))
    ? { code: cc(code), dataAbsentReason: cc([DATA_ABSENT, 'unknown', 'Unknown']) }
    : { code: cc(code), valueQuantity: ucum(Number(n), 'mmHg', 'mm[Hg]') });
  addObservation(ctx, key, src, { code: C.bp, cat: VITAL, subject, component: [part(C.sys, v.sys), part(C.dia, v.dia)] });
}

function contractionsEntry(ctx, o, id) {
  const v = o.v;
  const component = [];
  if (!blank(v.count)) {
    component.push({ code: cc(C.contractionFrequency), valueQuantity: ucum(Number(v.count), 'per 10 min', '/(10.min)') });
  }
  const band = DURATION_BAND[v.durBand];
  const secs = n => ucum(n, 's', 's');
  if (band) {
    const range = compact({ low: band[0] == null ? null : secs(band[0]), high: band[1] == null ? null : secs(band[1]) });
    component.push({ code: cc(C.contractionDuration), valueRange: range });
  } else if (!blank(v.duration)) {
    component.push({ code: cc(C.contractionDuration), valueQuantity: secs(Number(v.duration)) });
  }
  if (!component.length) return;
  addObservation(ctx, `obs:${id}:contractions`, entrySource(o), { code: C.contractions, cat: EXAM, component });
}

const lossMethod = m => (blank(m) ? undefined
  : { coding: [coding(LCG + ':blood-loss-method', String(m), LOSS_METHOD[m])], text: LOSS_METHOD[m] || String(m) });
const millilitres = ml => measured('mL', 'mL')(ml);

/** A drape reading is the running total since the birth (PPH 2025); the method says how it was measured. */
function bloodLossEntry(ctx, o, id) {
  if (blank(o.v.ml)) return;
  const src = entrySource(o, 'ml');
  if (Array.isArray(o.defaulted) && o.defaulted.includes('method')) {
    src.defaulted = 'Measurement method recorded as the form default, not changed by the recorder';
  }
  addObservation(ctx, `obs:${id}:bloodloss`, src, {
    code: C.bloodLoss, cat: PROCEDURE, value: millilitres(o.v.ml), method: lossMethod(o.v.method),
    note: 'Cumulative blood loss since the birth',
  });
}

/** The form's P: when pushing began. */
function eventEntry(ctx, o, id) {
  if (o.v.event !== 'pushing') return;
  addObservation(ctx, `obs:${id}:pushing`, entrySource(o), { code: C.pushing, cat: EXAM, value: { valueBoolean: true } });
}

/** The LCG oxytocin row (U/L, drops/min) is an administration record, not an observation. */
function oxytocinEntry(ctx, o, id) {
  if (blank(o.v.dropsMin) && blank(o.v.uL)) return;
  addMedication(ctx, `obs:${id}:oxytocin`, o, {
    medication: cc(C.oxytocin), rate: o.v.dropsMin, concentration: o.v.uL, note: 'Oxytocin infusion check (LCG medication row)',
  });
}

const SPECIAL_ENTRY = { contractions: contractionsEntry, bloodloss: bloodLossEntry, event: eventEntry, oxytocin: oxytocinEntry };

function exportEntry(ctx, o, i) {
  if (!o || !o.v) return;
  const id = o.id || `i${i}`;
  if (SPECIAL_ENTRY[o.type]) {
    SPECIAL_ENTRY[o.type](ctx, o, id);
    return;
  }
  // a baby check is about the newborn, with or without a birth record on file
  const aboutBaby = o.type === NEWBORN_ENTRY;
  const subject = aboutBaby ? 'newborn' : 'mother';
  const note = aboutBaby && !ctx.hasBirth ? NO_BIRTH_NOTE : undefined;
  for (const el of recordedElements(o)) {
    const key = `obs:${id}:${el}`;
    if (el === 'bp') {
      addBP(ctx, key, entrySource(o, el), o.v, subject);
      continue;
    }
    const spec = ELEMENT[el];
    addObservation(ctx, key, entrySource(o, el), { code: spec.code, cat: spec.cat, subject, value: spec.value(o.v[el]), note });
  }
}

// ----------------------------------------------------------- medication ----

function medicationDosage(rate, concentration) {
  const drops = Number(rate);
  if (blank(rate) || !Number.isFinite(drops)) {
    return blank(concentration) ? undefined : { text: `${concentration} U/L` };
  }
  return {
    text: `${blank(concentration) ? '' : concentration + ' U/L at '}${drops} drops/min`,
    route: cc([SCT, '47625008', 'Intravenous route']),
    rateQuantity: ucum(drops, 'drops/min', '{drop}/min'),
  };
}

/** One MedicationAdministration; src is the record it comes from ({time, by, voided}). */
function addMedication(ctx, key, src, f) {
  ctx.add(key, 'MedicationAdministration', {
    identifier: ctx.recordId(key),
    status: src.voided ? 'entered-in-error' : f.stopped ? 'stopped' : 'completed',
    medicationCodeableConcept: f.medication,
    subject: ctx.ref('mother'),
    context: ctx.ref('encounter'),
    effectiveDateTime: when(src.time),
    performer: byRef(src.by) ? [{ actor: byRef(src.by) }] : undefined,
    note: [...voidNotes(src.voided), ...(blank(f.note) ? [] : [{ text: String(f.note) }])],
    dosage: medicationDosage(f.rate, f.concentration),
  });
}

/** What was given, as free text: the medication modal records drug, dose and route as one line. */
function medicationText(m) {
  const detail = blank(m.detail) ? '' : String(m.detail);
  if (m.kind === 'ivfluid') return detail ? `IV fluids: ${detail}` : 'IV fluids';
  return detail || 'Medicine';
}

function exportMedication(ctx, m, i) {
  if (!m) return;
  const oxy = m.kind === 'oxytocin';
  addMedication(ctx, `med:${m.id || 'i' + i}`, m, {
    medication: oxy ? cc(C.oxytocin) : { text: medicationText(m) },
    stopped: oxy && m.action === 'stop',
    rate: oxy ? m.oxyDrops : null,
    concentration: oxy ? m.oxyUL : null,
    note: oxy ? m.detail : null,
  });
}

// --------------------------------------------------------- mother, stay ----

function exportMother(ctx) {
  const { p } = ctx;
  ctx.add('mother', 'Patient', {
    identifier: blank(p.mrn) ? undefined : [{ system: 'urn:ethiopia:mrn', value: String(p.mrn) }],
    name: blank(p.name) ? undefined : [{ text: String(p.name) }],
    telecom: blank(p.phone) ? undefined : [{ system: 'phone', value: String(p.phone) }],
    gender: 'female',
    address: blank(p.kebele) ? undefined : [{ text: String(p.kebele), country: 'ET' }],
    // Patient.link joins records of the SAME person: here, this Patient and the
    // RelatedPerson "mother of the newborn" (R4 allows a RelatedPerson target)
    link: ctx.hasNewborn ? [{ other: ctx.ref('mother-of-newborn'), type: 'seealso' }] : undefined,
  });
}

const WATCH_MIN = POSTPARTUM.watchHours * 60;
const watchEnd = p => minutesAfter(birthTime(p), WATCH_MIN);
/** The 24 h postpartum watch after a recorded birth has run out by `now`. */
const watchOver = (p, now) => !!watchEnd(p) && toMs(watchEnd(p)) <= toMs(now);

/**
 * The stay (protocol.js decides): in-progress while she labours, while a
 * referred woman has not left (S8) and through the 24 h postpartum watch;
 * finished once the case is closed, she has left on referral or the watch has
 * run out. A record that fits none of these (a delivered status with no birth
 * record, a time of birth ahead of the clock) is unknown.
 */
function encounterStatus(p, now) {
  if (isLabouring(p) || inPostpartumWatch(p, now)) return 'in-progress';
  if (stageOf(p) === 'closed' || (p.referral && p.referral.handoverAt) || watchOver(p, now)) return 'finished';
  return 'unknown';
}

/**
 * When a finished stay ended: the moment it became finished, so the end never
 * moves between exports - the first of her departure on referral (one recorded
 * before the birth did not end it), the case closure and the end of the watch.
 */
function encounterEnd(p, now) {
  const birth = birthTime(p);
  const r = p.referral || {};
  const left = r.handoverAt && !(birth && toMs(r.handoverAt) < toMs(birth)) ? r.handoverAt : null;
  const ends = [left, stageOf(p) === 'closed' ? p.closedAt : null, watchOver(p, now) ? watchEnd(p) : null].filter(t => when(t));
  if (!ends.length) return lastCare(p);
  return ends.reduce((a, b) => (toMs(b) < toMs(a) ? b : a));
}

/** The last care recorded (birth, handover, latest entry): the end of a legacy record closed without a time. */
function lastCare(p) {
  const times = [birthTime(p), p.referral && p.referral.handoverAt, ...activeObs(p).map(o => o.time)].filter(t => when(t));
  return times.length ? times.reduce((a, b) => (toMs(b) > toMs(a) ? b : a)) : undefined;
}

function exportEncounter(ctx) {
  const { p, settings, now } = ctx;
  const status = encounterStatus(p, now);
  const r = p.referral;
  const admittedBy = p.admission && p.admission.by;
  ctx.add('encounter', 'Encounter', {
    identifier: [{ system: LCG + ':case', value: ctx.caseId }],
    status,
    class: coding(ACT_CODE, 'IMP', 'inpatient encounter'),
    type: [cc(C.labourEncounter)],
    subject: ctx.ref('mother'),
    participant: byRef(admittedBy) ? [{ type: [cc([PARTICIPATION, 'ADM', 'admitter'])], individual: byRef(admittedBy) }] : undefined,
    period: compact({ start: when(admissionTime(p)), end: status === 'finished' ? when(encounterEnd(p, now)) : undefined }),
    hospitalization: r && r.handoverAt ? compact({
      dischargeDisposition: cc([DISCHARGE, 'other-hcf', 'Other healthcare facility']),
      destination: blank(r.facility) ? undefined : { display: String(r.facility) },
    }) : undefined,
    serviceProvider: { display: (settings && settings.facilityName) || 'Health centre' },
  });
}

// ---------------------------------------------------------------- birth ----

const isStillbirth = d => !blank(d.outcome) && d.outcome !== 'live';
// Alerts about the baby after the birth: the ppBaby rules (nb_*) and the birth record's APGAR rule
const isNewbornAlert = code => typeof code === 'string' && (code.startsWith('nb_') || code === 'apgar_low');

/**
 * The newborn Patient goes out with the birth record and with any finding
 * about the baby - a baby check or a newborn alert, voided or not - even when
 * the birth record is not on file (voided, not yet recorded again).
 */
function needsNewborn(p) {
  return !!p.delivery
    || (p.obs || []).some(o => o && o.type === NEWBORN_ENTRY && recordedElements(o).length > 0)
    || (p.alerts || []).some(a => exportsFlag(a) && isNewbornAlert(a.code));
}

/**
 * The newborn, and the mother as her RelatedPerson (two people: never a
 * Patient.link between them). With no birth record on file: no birth date,
 * gender unknown - the same identifier, so a later export completes it.
 */
function exportNewborn(ctx) {
  const { p } = ctx;
  const d = p.delivery, nb = (d && p.newborn) || {};
  const born = d ? wardTime(d.time) : null;
  ctx.add('newborn', 'Patient', {
    identifier: ctx.recordId('newborn'),
    gender: nb.sex === 'M' ? 'male' : nb.sex === 'F' ? 'female' : 'unknown',
    birthDate: born ? born.date : undefined,
    _birthDate: born ? { extension: [{ url: BIRTH_TIME, valueDateTime: born.dateTime }] } : undefined,
    deceasedBoolean: d && isStillbirth(d) ? true : undefined,
  });
  ctx.add('mother-of-newborn', 'RelatedPerson', {
    patient: ctx.ref('newborn'),
    relationship: [cc([ROLE_CODE, 'MTH', 'mother'])],
    name: blank(p.name) ? undefined : [{ text: String(p.name) }],
    gender: 'female',
  });
  if (d) exportBirthMeasures(ctx, d, nb);
}

/** What the birth form measured on the baby: birth weight and APGAR. */
function exportBirthMeasures(ctx, d, nb) {
  const src = { time: d.time, by: d.by };
  if (!blank(nb.weightG)) {
    addObservation(ctx, 'newborn:weight', src, { code: C.birthWeight, cat: EXAM, subject: 'newborn', value: measured('g', 'g')(nb.weightG) });
  }
  for (const [k, minute] of [['apgar1', 1], ['apgar5', 5], ['apgar10', 10]]) {
    const a = nb[k];
    if (!a || blank(a.total)) continue;
    addObservation(ctx, `newborn:${k}`, { time: minutesAfter(d.time, minute), by: a.by || d.by }, {
      code: C[k], cat: SURVEY, subject: 'newborn', value: { valueQuantity: ucum(Number(a.total), '{score}', '{score}') },
    });
  }
}

/** The birth as a Procedure (mode, incl. caesarean), its outcome (about the baby), and what the birth form measured on the mother. */
function exportBirth(ctx) {
  const d = ctx.p.delivery;
  ctx.add('birth', 'Procedure', {
    identifier: ctx.recordId('birth'),
    status: 'completed',
    code: cc(blank(d.mode) ? MODE.none : MODE[d.mode] || MODE.other),
    subject: ctx.ref('mother'),
    encounter: ctx.ref('encounter'),
    performedDateTime: when(d.time),
    performer: byRef(d.by) ? [{ actor: byRef(d.by) }] : undefined,
  });
  const src = { time: d.time, by: d.by };
  const partOf = [ctx.ref('birth')];
  if (!blank(d.outcome)) {
    const timing = isStillbirth(d)
      ? [{ code: cc(C.sbTiming), valueCodeableConcept: valueConcept(V.sbTiming, d.stillbirthTiming || 'unknown') }] : undefined;
    addObservation(ctx, 'birth:outcome', src, {
      code: C.outcome, cat: PROCEDURE, subject: 'newborn', partOf,
      value: { valueCodeableConcept: valueConcept(V.outcome, d.outcome) }, component: timing,
    });
  }
  if (!blank(d.eblMl)) {
    addObservation(ctx, 'birth:blood-loss', src, {
      code: C.bloodLoss, cat: PROCEDURE, partOf, value: millilitres(d.eblMl), method: lossMethod('estimate'),
      note: 'Estimated blood loss at birth (birth record)',
    });
  }
  // the first postpartum check on the birth form
  const pv = d.ppVitals || {};
  if (!blank(pv.sys) || !blank(pv.dia)) addBP(ctx, 'birth:pp-bp', src, pv, 'mother');
  if (!blank(pv.pulse)) addObservation(ctx, 'birth:pp-pulse', src, { code: C.pulse, cat: VITAL, value: ELEMENT.pulse.value(pv.pulse) });
}

/** Robson group (IRP Table 3): final once the birth is recorded, preliminary before. */
function exportRobson(ctx) {
  const { p } = ctx;
  const group = robsonGroup(p);
  if (!group) return;
  const d = p.delivery;
  const label = ROBSON[group] ? `Group ${group}: ${ROBSON[group]}` : `Group ${group}`;
  addObservation(ctx, 'robson', { time: d ? d.time : admissionTime(p) }, {
    status: d ? 'final' : 'preliminary',
    code: C.robson, cat: SURVEY,
    value: { valueCodeableConcept: { coding: [coding(LCG + ':robson-group', group, label)], text: `Robson group ${group}` } },
    note: 'Derived by the app from parity, previous caesarean, onset of labour, gestational age, presentation and number of fetuses'
      + (d ? '' : '; preliminary until the birth is recorded'),
  });
}

// ---------------------------------------------------------- flags, referral ----

const exportsFlag = a => !!a && a.severity !== 'info';

/** A Flag on the mother, or on the newborn for an alert about the baby. */
function exportAlert(ctx, a, i) {
  if (!exportsFlag(a)) return;
  const key = `alert:${a.id || 'i' + i}`;
  ctx.add(key, 'Flag', {
    identifier: ctx.recordId(key),
    status: a.resolved ? 'inactive' : 'active',
    category: [cc([FLAG_CATEGORY, 'clinical', 'Clinical'])],
    code: compact({ coding: blank(a.code) ? undefined : [coding(LCG + ':alert', String(a.code))], text: a.title || a.code || 'Alert' }),
    subject: ctx.ref(isNewbornAlert(a.code) ? 'newborn' : 'mother'),
    period: compact({ start: when(a.time), end: a.resolved ? when(a.resolvedAt) : undefined }),
    encounter: ctx.ref('encounter'),
  });
}

function exportReferral(ctx) {
  const r = ctx.p.referral;
  const reasons = [...(Array.isArray(r.reasons) ? r.reasons : []), ...(blank(r.otherReason) ? [] : [r.otherReason])];
  const list = Array.isArray(r.checklist) ? r.checklist.filter(Boolean) : [];
  const given = list.filter(c => c.done).map(c => c.label);
  const missed = list.filter(c => !c.done).map(c => c.label);
  const requester = [r.referredBy, blank(r.by) ? null : `(${r.by})`].filter(x => !blank(x)).join(' ');
  ctx.add('referral', 'ServiceRequest', {
    identifier: ctx.recordId('referral'),
    status: r.handoverAt ? 'completed' : 'active',
    intent: 'order',
    priority: 'urgent',
    code: cc(C.referral),
    subject: ctx.ref('mother'),
    encounter: ctx.ref('encounter'),
    authoredOn: when(r.time),
    requester: requester ? { type: 'Practitioner', display: requester } : undefined,
    performer: [{ display: blank(r.facility) ? 'Receiving hospital' : String(r.facility) }],
    reasonCode: reasons.map(x => ({ text: String(x) })),
    note: [
      given.length ? { text: 'Pre-referral care given: ' + given.join('; ') } : null,
      missed.length ? { text: 'Pre-referral items NOT done: ' + missed.join('; ') } : null,
    ].filter(Boolean),
  });
}

// ---------------------------------------------------------------- export ----

const timeOrder = (a, b) => (toMs(a && a.time) || 0) - (toMs(b && b.time) || 0);

/**
 * The case as a FHIR R4 Bundle (type collection). opts.now is the export
 * time: it stamps the bundle and decides whether the postpartum watch is still
 * running (tests pass it). Every call mints new resource ids.
 */
export function buildFHIRBundle(p, settings = {}, { now = new Date() } = {}) {
  const ctx = createContext(p, settings || {}, now);
  exportMother(ctx);
  exportEncounter(ctx);
  if (ctx.hasNewborn) exportNewborn(ctx);
  [...(p.obs || [])].sort(timeOrder).forEach((o, i) => exportEntry(ctx, o, i));
  if (ctx.hasBirth) exportBirth(ctx);
  exportRobson(ctx);
  (p.meds || []).forEach((m, i) => exportMedication(ctx, m, i));
  (p.alerts || []).forEach((a, i) => exportAlert(ctx, a, i));
  if (p.referral) exportReferral(ctx);
  return {
    resourceType: 'Bundle',
    meta: { tag: [{ system: LCG, code: 'lcg-export' }] },
    identifier: { system: 'urn:ietf:rfc:3986', value: 'urn:uuid:' + newUUID() },
    type: 'collection',
    timestamp: new Date(now).toISOString(),
    entry: ctx.entries,
  };
}

/** Download name: the random case id and the ward date - never her name or MRN. */
export function fhirFilename(p, now = new Date()) {
  const id = String((p && p.id) || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'case';
  const day = wardTime(now);
  return `lcg-fhir-${id}${day ? '-' + day.date : ''}.json`;
}

export function downloadFHIR(p, settings) {
  const bundle = buildFHIRBundle(p, settings);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fhirFilename(p);
  document.body.append(a);
  a.click();
  a.remove();
  // revoking at once can cancel the download in some browsers
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
