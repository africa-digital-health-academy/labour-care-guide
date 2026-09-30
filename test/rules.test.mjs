// Every clinical rule: one reading that must raise the alert and one that must
// stay silent. Sources are cited in js/alerts.js and js/protocol.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateObs, evaluateTime, admissionRiskAlerts, birthAlerts, RESOLVE_ON,
} from '../js/alerts.js';
import { PROTOCOLS, alertLineAnchor, secondStageClockStart } from '../js/protocol.js';
import { applyObservations } from '../js/record.js';
import { NOW, iso, mkPatient, LCG, ETH, codes } from './helpers.mjs';

const MIN = 60000;

// Manual Table 6 lag limits, every centimetre, at one minute under and exactly at the limit.
for (const [cm, limit] of Object.entries(PROTOCOLS.lcg.dilatationLagMin)) {
  test(`LCG progress at ${cm} cm: silent at ${limit - 1} min, alert at ${limit} min`, () => {
    const base = +NOW - 20 * 3600000;
    const t = m => new Date(base + m * MIN).toISOString();
    const p = mkPatient({ status: 'latent', activeStartTime: null, admission: { time: t(0) } });
    applyObservations(p, t(0), { exam: { dilatation: Number(cm) } }, LCG);
    const early = applyObservations(p, t(limit - 1), { exam: { dilatation: Number(cm) } }, LCG);
    assert.ok(!codes(early.added).includes('lcg_progress'));
    const late = applyObservations(p, t(limit), { exam: { dilatation: Number(cm) } }, LCG);
    assert.ok(codes(late.added).includes('lcg_progress'));
  });
}

// Manual Table 6 second-stage limits, exact boundaries, counted from pushing.
for (const [para, limitMin, label] of [[0, 180, 'nulliparous'], [2, 120, 'multiparous']]) {
  test(`second stage (${label}): silent at ${limitMin - 1} min, alert at ${limitMin} min from pushing`, () => {
    const ago = m => new Date(+NOW - m * MIN).toISOString();
    const p = mkPatient({ para, status: 'second', secondStageStart: ago(limitMin + 30) });
    const push = { id: 'push', type: 'event', time: ago(limitMin), v: { event: 'pushing' } };
    p.obs.push(push);
    assert.ok(codes(evaluateTime(p, LCG, NOW)).includes('second_long'));
    push.time = ago(limitMin - 1);
    assert.ok(!codes(evaluateTime(p, LCG, NOW)).includes('second_long'));
  });
}

test('F2: a P recorded after the last exam below 10 cm starts the clock; an earlier urge does not', () => {
  const p = mkPatient({ status: 'second', activeStartTime: iso(6), secondStageStart: iso(2.5) });
  p.obs.push({ id: 'e8', type: 'exam', time: iso(4), v: { dilatation: 8 } });
  p.obs.push({ id: 'e10', type: 'exam', time: iso(2.5), v: { dilatation: 10 } });
  const push = { id: 'push', type: 'event', time: iso(3), v: { event: 'pushing' } };
  p.obs.push(push);
  assert.equal(secondStageClockStart(p, PROTOCOLS.lcg), iso(3));
  push.time = iso(5);
  assert.equal(secondStageClockStart(p, PROTOCOLS.lcg), iso(2.5));
});

test('S7 (v1 record, no exam at active start): the line starts at the admission dilatation, never a later exam', () => {
  const p = mkPatient({ activeStartTime: iso(4), admission: { time: iso(4), dilatation: 5 } });
  p.obs.push({ id: 'e1', type: 'exam', time: iso(1), v: { dilatation: 8 } });
  assert.deepEqual(alertLineAnchor(PROTOCOLS.ethiopia2021, p), { time: iso(4), cm: 5 });
});

// [code, observation type, firing values, silent values]
const OBS_CASES = [
  ['fhr_severe', 'baby', { fhr: 96 }, { fhr: 105 }],
  ['fhr_severe', 'baby', { fhr: 182 }, { fhr: 175 }],
  ['fhr_abn', 'baby', { fhr: 108 }, { fhr: 110 }],
  ['fhr_abn', 'baby', { fhr: 160 }, { fhr: 159 }],
  ['decel', 'baby', { fhr: 140, decel: 'late' }, { fhr: 140, decel: 'early' }],
  ['decel', 'baby', { fhr: 140, decel: 'prolonged' }, { fhr: 140, decel: 'variable' }],
  ['liquor_thick_mec', 'baby', { liquor: 'M3' }, { liquor: 'M2' }],
  ['liquor_thick_mec', 'exam', { dilatation: 6, liquor: 'M3' }, { dilatation: 6, liquor: 'M1' }], // F7
  ['liquor_blood', 'exam', { dilatation: 6, liquor: 'B' }, { dilatation: 6, liquor: 'C' }],        // F7
  ['liquor_blood', 'baby', { liquor: 'B' }, { liquor: 'I' }],
  ['liquor_mec', 'baby', { liquor: 'M' }, { liquor: 'M1' }],
  ['tachysystole', 'contractions', { count: 6 }, { count: 5 }],
  ['weak_contractions', 'contractions', { count: 2 }, { count: 3 }],
  ['contraction_long', 'contractions', { count: 3, duration: 70 }, { count: 3, duration: 60 }],   // F8: alone
  ['contraction_short', 'contractions', { count: 3, duration: 15 }, { count: 3, duration: 20 }],
  ['pulse_abn', 'pulse', { pulse: 120 }, { pulse: 119 }],
  ['pulse_abn', 'pulse', { pulse: 58 }, { pulse: 60 }],
  ['htn', 'vitals', { sys: 140, dia: 80 }, { sys: 139, dia: 89 }],
  ['htn', 'vitals', { sys: 120, dia: 90 }, { sys: 120, dia: 85 }],
  ['htn_severe', 'vitals', { sys: 160, dia: 100 }, { sys: 159, dia: 109 }],
  ['hypotension', 'vitals', { sys: 78, dia: 50 }, { sys: 80, dia: 50 }],
  ['fever', 'vitals', { temp: 38.0 }, { temp: 37.9 }],
  ['temp_high', 'vitals', { temp: 37.5 }, { temp: 37.4 }],
  ['temp_low', 'vitals', { temp: 34.9 }, { temp: 35.0 }],
  ['proteinuria', 'vitals', { protein: '++' }, { protein: '+' }],
  ['proteinuria', 'vitals', { protein: '++++' }, { protein: 'trace' }],   // F9
  ['ketonuria', 'vitals', { acetone: '+++' }, { acetone: 'neg' }],        // F9
  ['moulding3', 'exam', { dilatation: 6, moulding: 3 }, { dilatation: 6, moulding: 2 }],
  ['moulding2', 'exam', { dilatation: 6, moulding: 2 }, { dilatation: 6, moulding: 1 }],
  ['caput3', 'exam', { dilatation: 6, caput: 3 }, { dilatation: 6, caput: 2 }],
  ['malposition', 'exam', { dilatation: 6, position: 'OP' }, { dilatation: 6, position: 'OA' }],
  ['malposition', 'exam', { dilatation: 6, position: 'OT' }, { dilatation: 6, position: 'unknown' }],
  ['malpresentation', 'exam', { dilatation: 6, presentation: 'breech' }, { dilatation: 6, presentation: 'cephalic' }],
  ['no_companion', 'supportive', { companion: 'N' }, { companion: 'D' }],     // F1: D = declined
  ['no_pain_relief', 'supportive', { painRelief: 'N' }, { painRelief: 'D' }],
  ['no_fluids', 'supportive', { oralFluid: 'N' }, { oralFluid: 'Y' }],
  ['supine', 'supportive', { posture: 'SP' }, { posture: 'MO' }],
  ['supine', 'supportive', { posture: 'supine' }, { posture: 'lateral' }],    // v1 codes
  ['oxy_rate', 'oxytocin', { dropsMin: 61 }, { dropsMin: 60 }],
  ['pp_bleeding', 'ppMother', { bleeding: 'heavy' }, { bleeding: 'normal' }],
  ['pp_atony', 'ppMother', { tone: 'soft' }, { tone: 'firm' }],
  ['pp_pulse_abn', 'ppMother', { pulse: 125 }, { pulse: 110 }],
  ['pp_htn', 'ppMother', { sys: 145, dia: 92 }, { sys: 130, dia: 85 }],
  ['pp_htn_severe', 'ppMother', { sys: 165, dia: 112 }, { sys: 150, dia: 95 }],
  ['pp_hypotension', 'ppMother', { sys: 75, dia: 40 }, { sys: 95, dia: 60 }],
  ['pp_fever', 'ppMother', { temp: 38.2 }, { temp: 37.2 }],
  ['nb_breathing', 'ppBaby', { breathing: 'difficult' }, { breathing: 'normal' }],
  ['nb_cold', 'ppBaby', { temp: 36.2 }, { temp: 36.6 }],
  ['nb_hot', 'ppBaby', { temp: 37.8 }, { temp: 37.4 }],
  ['nb_feeding', 'ppBaby', { feeding: 'poor' }, { feeding: 'good' }],
];

for (const [code, type, fire, silent] of OBS_CASES) {
  test(`${code} fires on ${type} ${JSON.stringify(fire)}`, () => {
    const got = evaluateObs(mkPatient(), { type, time: iso(0), v: fire }, LCG);
    assert.ok(codes(got).includes(code), JSON.stringify(codes(got)));
  });
  test(`${code} stays silent on ${type} ${JSON.stringify(silent)}`, () => {
    const got = evaluateObs(mkPatient(), { type, time: iso(0), v: silent }, LCG);
    assert.ok(!codes(got).includes(code), JSON.stringify(codes(got)));
  });
}

// S1 guard: a rule without a resolution rule would fire once and stay open
// forever, which is the v1 defect. Only these are deliberately sticky.
const STICKY = ['liquor_thick_mec', 'liquor_blood'];
test('every observation rule can resolve (or is deliberately sticky)', () => {
  const missing = [...new Set(OBS_CASES.map(c => c[0]))].filter(c => !RESOLVE_ON[c] && !STICKY.includes(c));
  assert.deepEqual(missing, []);
  for (const [c, rule] of Object.entries(RESOLVE_ON)) assert.ok(rule.family.includes(c), c);
});

// ---------------------------------------------------- context-dependent ----

test('weak and short contractions stay silent in the latent phase', () => {
  const p = mkPatient({ status: 'latent', activeStartTime: null });
  assert.deepEqual(codes(evaluateObs(p, { type: 'contractions', time: iso(0), v: { count: 2, duration: 15 } }, LCG)), []);
});

test('on oxytocin, contractions over 60 s are danger and tachysystole says stop oxytocin', () => {
  const p = mkPatient({ oxytocinRunning: true });
  const a = evaluateObs(p, { type: 'contractions', time: iso(0), v: { count: 6, duration: 70 } }, LCG);
  assert.equal(a.find(x => x.code === 'contraction_long').severity, 'danger');
  assert.match(a.find(x => x.code === 'tachysystole').title, /STOP OXYTOCIN/);
  const off = evaluateObs(mkPatient(), { type: 'contractions', time: iso(0), v: { count: 3, duration: 70 } }, LCG);
  assert.equal(off.find(x => x.code === 'contraction_long').severity, 'warn');
});

test('Ethiopian partograph: a reading right of the alert line fires alert_line; on the line it is silent', () => {
  const p = mkPatient({ activeStartTime: iso(6) });
  p.obs.push({ id: 'e0', type: 'exam', time: iso(6), v: { dilatation: 4 } });
  assert.ok(codes(evaluateObs(p, { type: 'exam', time: iso(0), v: { dilatation: 7 } }, ETH)).includes('alert_line'));
  const onLine = evaluateObs(p, { type: 'exam', time: iso(3), v: { dilatation: 7 } }, ETH);
  assert.deepEqual(codes(onLine).filter(c => c.endsWith('_line')), []);
});

test('Ethiopian partograph: a reading right of the action line fires action_line', () => {
  const p = mkPatient({ activeStartTime: iso(6) });
  p.obs.push({ id: 'e0', type: 'exam', time: iso(6), v: { dilatation: 4 } });
  assert.ok(codes(evaluateObs(p, { type: 'exam', time: iso(0), v: { dilatation: 5 } }, ETH)).includes('action_line'));
});

test('S7: the alert line starts at the dilatation plotted at active start, not at 4 cm', () => {
  const p = mkPatient({ activeStartTime: iso(2), admission: { time: iso(2), dilatation: 7 } });
  p.obs.push({ id: 'e0', type: 'exam', time: iso(2), v: { dilatation: 7 } });
  assert.deepEqual(alertLineAnchor(PROTOCOLS.ethiopia2021, p), { time: iso(2), cm: 7 });
  // 2 h later at 8 cm is 1 cm behind the line; v1 (anchored at 4 cm) saw nothing
  assert.ok(codes(evaluateObs(p, { type: 'exam', time: iso(0), v: { dilatation: 8 } }, ETH)).includes('alert_line'));
});

// --------------------------------------------------------------- time ----

test('latent phase over 8 h warns under the national latent-care rule; 7 h is silent', () => {
  const p = mkPatient({ status: 'latent', activeStartTime: null, laborOnsetTime: iso(9) });
  const a = evaluateTime(p, LCG, NOW).find(x => x.code === 'latent_long');
  assert.ok(a);
  assert.match(a.advice[0], /National latent-phase care rule/);
  const q = mkPatient({ status: 'latent', activeStartTime: null, laborOnsetTime: iso(7) });
  assert.ok(!codes(evaluateTime(q, LCG, NOW)).includes('latent_long'));
});

test('F5: active first stage alert at 12 h in a first labour, not at 11 h', () => {
  assert.ok(codes(evaluateTime(mkPatient({ activeStartTime: iso(12.2) }), LCG, NOW)).includes('active_long'));
  assert.ok(!codes(evaluateTime(mkPatient({ activeStartTime: iso(11) }), LCG, NOW)).includes('active_long'));
});

test('F5: active first stage alert at 10 h in a subsequent labour, not at 9.5 h', () => {
  assert.ok(codes(evaluateTime(mkPatient({ para: 2, activeStartTime: iso(10.2) }), LCG, NOW)).includes('active_long'));
  assert.ok(!codes(evaluateTime(mkPatient({ para: 2, activeStartTime: iso(9.5) }), LCG, NOW)).includes('active_long'));
});

test('S12: missing parity takes the stricter limit and says so', () => {
  const a = evaluateTime(mkPatient({ para: null, activeStartTime: iso(10.2) }), LCG, NOW).find(x => x.code === 'active_long');
  assert.ok(a);
  assert.match(a.title, /10 h/);
  assert.match(a.title, /parity not recorded/);
  const s = evaluateTime(mkPatient({ para: undefined, status: 'second', secondStageStart: iso(2.1) }), LCG, NOW);
  assert.ok(codes(s).includes('second_long'), 'unknown parity uses the 2 h multiparous limit');
});

test('F2: once pushing is recorded, the second-stage limit counts from pushing', () => {
  const p = mkPatient({ status: 'second', secondStageStart: iso(3.5) });
  p.obs.push({ id: 'push', type: 'event', time: iso(1), v: { event: 'pushing' } });
  assert.ok(!codes(evaluateTime(p, LCG, NOW)).some(c => c.startsWith('second_')));
});

test('F2: until pushing is recorded, the clock runs from full dilatation', () => {
  const a = evaluateTime(mkPatient({ status: 'second', secondStageStart: iso(3.5) }), LCG, NOW);
  assert.ok(a.some(x => x.code === 'second_long' && /full dilatation/.test(x.title)));
});

test('F2: pushing recorded before full dilatation does not delay the clock', () => {
  const p = mkPatient({ status: 'second', secondStageStart: iso(3.5) });
  p.obs.push({ id: 'push', type: 'event', time: iso(4), v: { event: 'pushing' } });
  assert.ok(codes(evaluateTime(p, LCG, NOW)).includes('second_long'));
});

test('the Ethiopian partograph keeps timing the second stage from full dilatation', () => {
  const p = mkPatient({ status: 'second', secondStageStart: iso(2.5) });
  p.obs.push({ id: 'push', type: 'event', time: iso(0.5), v: { event: 'pushing' } });
  assert.ok(codes(evaluateTime(p, ETH, NOW)).includes('second_long'));
});

test('passive second stage: off until the panel sets a limit, then silent once pushing is recorded', () => {
  const p = mkPatient({ status: 'second', secondStageStart: iso(2) });
  assert.ok(!codes(evaluateTime(p, LCG, NOW)).includes('passive_second_long'));
  PROTOCOLS.lcg.secondStagePassiveMaxMin = 60;
  try {
    assert.ok(codes(evaluateTime(p, LCG, NOW)).includes('passive_second_long'));
    p.obs.push({ id: 'push', type: 'event', time: iso(1.5), v: { event: 'pushing' } });
    assert.ok(!codes(evaluateTime(p, LCG, NOW)).includes('passive_second_long'));
  } finally {
    PROTOCOLS.lcg.secondStagePassiveMaxMin = null;
  }
});

test('Ethiopian projection: the alert-line projection waits until the next exam is due', () => {
  const early = mkPatient({ activeStartTime: iso(3) });
  early.obs.push({ id: 'e0', type: 'exam', time: iso(3), v: { dilatation: 6 } });
  assert.deepEqual(codes(evaluateTime(early, ETH, NOW)).filter(c => c.endsWith('_proj')), []);
  const due = mkPatient({ activeStartTime: iso(4) });
  due.obs.push({ id: 'e0', type: 'exam', time: iso(4), v: { dilatation: 6 } });
  assert.ok(codes(evaluateTime(due, ETH, NOW)).includes('alert_line_proj'));
});

test('Ethiopian projection: beyond the action line fires action_line_proj', () => {
  const p = mkPatient({ activeStartTime: iso(4.5) });
  p.obs.push({ id: 'e0', type: 'exam', time: iso(4.5), v: { dilatation: 6 } });
  assert.ok(codes(evaluateTime(p, ETH, NOW)).includes('action_line_proj'));
});

test('time rules stop when she is no longer in labour', () => {
  const p = mkPatient({ status: 'delivered', romTime: iso(30), activeStartTime: iso(20) });
  assert.deepEqual(evaluateTime(p, LCG, NOW), []);
});

// ------------------------------------------------- admission and birth ----

test('admission risk: prior caesarean fires at a health centre, not at a hospital or without a risk', () => {
  const p = mkPatient({ riskFactors: ['prior_cs'], admission: { time: iso(6), presentation: 'cephalic' } });
  assert.deepEqual(codes(admissionRiskAlerts(p, LCG)), ['admission_risk']);
  assert.deepEqual(admissionRiskAlerts(p, { ...LCG, facilityLevel: 'hospital' }), []);
  assert.deepEqual(admissionRiskAlerts(mkPatient({ riskFactors: ['anaemia'] }), LCG), []);
});

test('admission risk: a non-cephalic presentation counts as malpresentation', () => {
  const p = mkPatient({ riskFactors: [], admission: { time: iso(6), presentation: 'breech' } });
  const a = admissionRiskAlerts(p, LCG, c => (c === 'malpresentation' ? 'Known malpresentation' : c));
  assert.match(a[0].advice[0], /Known malpresentation/);
});

function born(delivery, newborn = {}) {
  return mkPatient({ status: 'delivered', delivery: { time: iso(1), outcome: 'live', placentaComplete: 'Y', ...delivery }, newborn });
}

test('birth: APGAR 5 at 5 minutes fires; 7 is silent', () => {
  assert.ok(codes(birthAlerts(born({}, { apgar5: { total: 5 } }))).includes('apgar_low'));
  assert.ok(!codes(birthAlerts(born({}, { apgar5: { total: 7 } }))).includes('apgar_low'));
});

test('birth: an incomplete placenta fires retained_products; a complete one is silent', () => {
  assert.ok(codes(birthAlerts(born({ placentaComplete: 'N' }))).includes('retained_products'));
  assert.ok(!codes(birthAlerts(born({ placentaComplete: 'Y' }))).includes('retained_products'));
});

test('birth: a stillbirth raises the supportive-care alert; a live birth does not', () => {
  assert.ok(codes(birthAlerts(born({ outcome: 'sb_fresh' }))).includes('stillbirth'));
  assert.ok(!codes(birthAlerts(born({ outcome: 'live' }))).includes('stillbirth'));
});
