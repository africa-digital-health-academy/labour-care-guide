import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateObs, evaluateTime, FLAG, haemodynamicSigns, pphTrigger, urineGrade } from '../js/alerts.js';
import { LIMITS, CLOSE_FHR_CODES } from '../js/protocol.js';
import { applyObservations, correctObservation } from '../js/record.js';
import { NOW, iso, mkPatient } from './helpers.mjs';

const settings = { protocol: 'lcg' };
const codes = list => list.map(a => a.code);

test('FHR 96 fires the severe alert; FHR 140 fires nothing', () => {
  const p = mkPatient();
  const a = evaluateObs(p, { type: 'baby', time: iso(0), v: { fhr: 96 } }, settings);
  assert.ok(a.some(x => x.code === 'fhr_severe' && x.severity === 'danger'));
  const n = evaluateObs(p, { type: 'baby', time: iso(0), v: { fhr: 140, decel: 'none' } }, settings);
  assert.deepEqual(codes(n), []);
});

test('FHR 165 with late decelerations fires two alerts', () => {
  const a = evaluateObs(mkPatient(), { type: 'baby', time: iso(0), v: { fhr: 165, decel: 'late' } }, settings);
  assert.ok(codes(a).includes('fhr_abn') && codes(a).includes('decel'));
});

test('BP 168/112 is severe hypertension with MgSO4 advice; 120/80 is silent', () => {
  const a = evaluateObs(mkPatient(), { type: 'vitals', time: iso(0), v: { sys: 168, dia: 112 } }, settings);
  const sev = a.find(x => x.code === 'htn_severe');
  assert.ok(sev && sev.advice.join(' ').includes('MgSO'));
  const n = evaluateObs(mkPatient(), { type: 'vitals', time: iso(0), v: { sys: 120, dia: 80 } }, settings);
  assert.deepEqual(codes(n), []);
});

test('6 contractions per 10 min is tachysystole; 3 x 40 s is silent', () => {
  const a = evaluateObs(mkPatient(), { type: 'contractions', time: iso(0), v: { count: 6, duration: 70 } }, settings);
  assert.ok(codes(a).includes('tachysystole'));
  const n = evaluateObs(mkPatient(), { type: 'contractions', time: iso(0), v: { count: 3, duration: 40 } }, settings);
  assert.deepEqual(codes(n), []);
});

test('moulding +++ fires the obstruction danger alert', () => {
  const a = evaluateObs(mkPatient(), { type: 'exam', time: iso(0), v: { dilatation: 6, moulding: 3 } }, settings);
  assert.ok(codes(a).includes('moulding3'));
});

test('LCG: 6 cm for 5.5 h (limit 5 h) fires progress alerts on entry and on the timer', () => {
  const p = mkPatient({ activeStartTime: iso(6) });
  p.obs.push({ id: 'e1', type: 'exam', time: iso(5.5), v: { dilatation: 6 } });
  p.obs.push({ id: 'e2', type: 'exam', time: iso(0), v: { dilatation: 6 } });
  const onEntry = evaluateObs(p, { type: 'exam', time: iso(0), v: { dilatation: 6 } }, settings);
  assert.ok(codes(onEntry).includes('lcg_progress'));
  assert.ok(codes(evaluateTime(p, settings, NOW)).includes('lcg_progress_due'));
});

test('LCG: 6 cm for 2 h (limit 5 h) is silent', () => {
  const p = mkPatient({ activeStartTime: iso(6) });
  p.obs.push({ id: 'e1', type: 'exam', time: iso(2), v: { dilatation: 6 } });
  assert.ok(!codes(evaluateTime(p, settings, NOW)).includes('lcg_progress_due'));
});

test('second stage: nullipara warns at 2.5 h and is danger at 3.2 h; multipara is danger at 2.5 h', () => {
  assert.ok(codes(evaluateTime(mkPatient({ status: 'second', secondStageStart: iso(2.5) }), settings, NOW)).includes('second_warn'));
  const t2 = evaluateTime(mkPatient({ status: 'second', secondStageStart: iso(3.2) }), settings, NOW);
  assert.ok(t2.some(a => a.code === 'second_long' && a.severity === 'danger'));
  assert.ok(codes(evaluateTime(mkPatient({ status: 'second', secondStageStart: iso(2.5), para: 2 }), settings, NOW)).includes('second_long'));
});

test('second stage: nullipara at 1 h is silent', () => {
  const t = evaluateTime(mkPatient({ status: 'second', secondStageStart: iso(1) }), settings, NOW);
  assert.ok(!codes(t).some(c => c.startsWith('second_')));
});

test('membranes ruptured 19 h fires prolonged ROM; 6 h is silent', () => {
  assert.ok(codes(evaluateTime(mkPatient({ romTime: iso(19) }), settings, NOW)).includes('prom_long'));
  assert.ok(!codes(evaluateTime(mkPatient({ romTime: iso(6) }), settings, NOW)).includes('prom_long'));
});

test('M6: each alert that asks for closer FHR monitoring names the interval the FHR schedule then keeps', () => {
  const drafts = [
    ...evaluateObs(mkPatient(), { type: 'baby', time: iso(0), v: { fhr: 96, decel: 'late', liquor: 'M3' } }, settings),
    ...evaluateObs(mkPatient(), { type: 'baby', time: iso(0), v: { fhr: 165 } }, settings),
  ];
  assert.deepEqual(CLOSE_FHR_CODES.filter(c => !codes(drafts).includes(c)), [], 'each one raised here');
  const every = new RegExp(`\\b${LIMITS.fhrCloseMin} min`);
  for (const d of drafts.filter(x => CLOSE_FHR_CODES.includes(x.code))) {
    assert.ok(d.advice.some(a => every.test(a)), `${d.code}: ${d.advice.join(' | ')}`);
  }
  // ungraded meconium asks to grade it and watch more closely, with no interval: it keeps the stage schedule
  const mec = evaluateObs(mkPatient(), { type: 'baby', time: iso(0), v: { fhr: 140, liquor: 'M' } }, settings);
  assert.deepEqual(codes(mec), ['liquor_mec']);
  assert.ok(!mec[0].advice.some(a => every.test(a)) && !CLOSE_FHR_CODES.includes('liquor_mec'));
});

/** Delivered 2 h ago, the birth form's first check normal; mother checks (ppMother) at the given hours ago. */
function born(checks = [], delivery = {}) {
  const p = mkPatient({ status: 'delivered', delivery: { time: iso(2), outcome: 'live', ppVitals: {}, ...delivery } });
  checks.forEach(([hAgo, v], i) => p.obs.push({ id: 'pm' + i, type: 'ppMother', time: iso(hAgo), v }));
  return p;
}

test('M6: the shock index shows two decimals - 125/120 is 1.04 beside "above 1"; exactly 1 is not a sign', () => {
  const signs = (pulse, sys) => haemodynamicSigns(born([[1.5, { pulse, sys, dia: 76 }]]));
  assert.deepEqual(signs(125, 120), ['pulse 125', 'shock index 1.04']);
  assert.deepEqual(signs(110, 105), ['pulse 110', 'shock index 1.05']);
  assert.deepEqual(signs(101, 100), ['pulse 101', 'shock index 1.01']);
  assert.deepEqual(signs(100, 100), [], 'pulse 100 and shock index 1.00 are not above their limits');
});

test('M6: a labour pulse or BP at the birth itself is no PPH sign; the birth form check stands', () => {
  const p = born([], { eblMl: 350, ppVitals: { pulse: 88, sys: 118, dia: 76 } });
  p.obs.push({ id: 'pu', type: 'pulse', time: iso(2), v: { pulse: 125 } }, { id: 'bp', type: 'vitals', time: iso(2), v: { sys: 90, dia: 55 } });
  assert.deepEqual(haemodynamicSigns(p), []);
  assert.equal(pphTrigger(p), null);
  assert.ok(!codes(evaluateObs(p, p.obs[0], settings)).includes('pph'), 'nor does it re-check the PPH');
  p.obs.push({ id: 'pu2', type: 'pulse', time: iso(1.9), v: { pulse: 125 } });
  assert.deepEqual(haemodynamicSigns(p), ['pulse 125', 'shock index 1.06'], 'a pulse after the birth is one');
  assert.equal(pphTrigger(p).level, 'signs');
});

test('M6: a baby check never re-runs the PPH check - it neither joins the alert nor counts; the mother\'s entries do', () => {
  const p = born();
  const loss = applyObservations(p, iso(1.5), { bloodloss: { ml: 600, method: 'drape' } }, settings, { by: 'TE' });
  const pph = loss.added.find(a => a.code === 'pph');
  const seen = () => [pph.count, pph.obsIds, pph.lastSeen];
  assert.deepEqual(seen(), [1, [loss.obs[0].id], iso(1.5)]);
  const babyCheck = { ppBaby: { breathing: 'normal', temp: 36.8, feeding: 'good' } };
  const one = applyObservations(p, iso(1.4), babyCheck, settings, { by: 'TE' });
  const two = applyObservations(p, iso(1.3), babyCheck, settings, { by: 'TE' });
  assert.deepEqual([one.added, two.added, codes(evaluateObs(p, one.obs[0], settings))], [[], [], []]);
  assert.deepEqual(seen(), [1, [loss.obs[0].id], iso(1.5)], 'still seen once, after two baby checks');
  // a mother check, a pulse or a BP re-checks it: the trigger is still met, so it is seen again
  const mother = applyObservations(p, iso(1.2), { ppMother: { bleeding: 'normal', tone: 'firm', pulse: 90, sys: 112, dia: 72 } }, settings, { by: 'TE' });
  assert.deepEqual(seen(), [2, [loss.obs[0].id, mother.obs[0].id], iso(1.2)]);
  for (const type of ['pulse', 'vitals', 'bloodloss', 'ppMother']) {
    assert.ok(codes(evaluateObs(p, { type, time: iso(1.1), v: {} }, settings)).includes('pph'), type);
  }
  assert.ok(!codes(evaluateObs(p, { type: 'ppBaby', time: iso(1.1), v: {} }, settings)).includes('pph'));
});

// ------------------------------- M6 review: a defaulted value is no evidence ----
// The wizard pre-selects decelerations none, moulding 0 and companion Y; one
// committed untouched (entry.defaulted) is not a finding, so it never clears an
// alert. The same value touched by the midwife is evidence.

test('M6 review: a defaulted "no decelerations" never clears late decelerations; the FHR typed with it still clears its own alert', () => {
  const p = mkPatient();
  applyObservations(p, iso(2), { baby: { fhr: 165, decel: 'late' } }, settings, { by: 'TE' });
  const decel = p.alerts.find(a => a.code === 'decel'), fhr = p.alerts.find(a => a.code === 'fhr_abn');
  assert.equal(decel.severity, 'danger');
  // 30 min later the FHR is typed and Next tapped through the deceleration step
  const next = applyObservations(p, iso(1.5), { baby: { fhr: 140, decel: 'none' } }, settings,
    { by: 'TE', defaulted: { baby: ['decel'] } });
  assert.deepEqual([decel.resolved, fhr.resolved, next.resolved], [false, true, [fhr]], 'the typed FHR is evidence, the default is not');
  const real = applyObservations(p, iso(1), { baby: { fhr: 142, decel: 'none' } }, settings, { by: 'TE' });
  assert.deepEqual([decel.resolved, decel.resolvedHow, decel.resolvedByObs], [true, 'evidence', real.obs[0].id], 'answered: none');
});

test('M6 review: correcting another value of the entry keeps the untouched default from becoming evidence', () => {
  const p = mkPatient();
  applyObservations(p, iso(2), { baby: { fhr: 165, decel: 'late' } }, settings, { by: 'TE' });
  const decel = p.alerts.find(a => a.code === 'decel');
  const skipped = applyObservations(p, iso(1.5), { baby: { fhr: 140, decel: 'none' } }, settings,
    { by: 'TE', defaulted: { baby: ['decel'] } }).obs[0];
  // the FHR typo corrected; the wizard prefills decelerations 'none' as it was
  const fixed = correctObservation(p, skipped.id, { fhr: 145, decel: 'none' }, settings, { by: 'TE', reason: 'typo', at: iso(1.4) }).obs[0];
  assert.deepEqual([fixed.defaulted, decel.resolved], [['decel'], false]);
  // corrected to an answer the midwife chose: early decelerations are no alert value, so that clears it
  const answered = correctObservation(p, fixed.id, { fhr: 145, decel: 'early' }, settings, { by: 'TE', reason: 'decelerations seen', at: iso(1.3) }).obs[0];
  assert.deepEqual([answered.defaulted, decel.resolved, decel.resolvedByObs], [undefined, true, answered.id]);
});

test('M6 review: a defaulted moulding 0 never clears moulding +++; a touched 0 does', () => {
  const p = mkPatient();
  applyObservations(p, iso(4), { exam: { dilatation: 6, moulding: 3 } }, settings, { by: 'TE' });
  const m = p.alerts.find(a => a.code === 'moulding3');
  applyObservations(p, iso(2), { exam: { dilatation: 7, presentation: 'cephalic', caput: 0, moulding: 0 } }, settings,
    { by: 'TE', defaulted: { exam: ['presentation', 'caput', 'moulding'] } });
  assert.equal(m.resolved, false, 'obstruction is still the finding on record');
  applyObservations(p, iso(1), { exam: { dilatation: 8, moulding: 0 } }, settings, { by: 'TE' });
  assert.deepEqual([m.resolved, m.resolvedHow], [true, 'evidence']);
});

test('M6 review: a defaulted companion Y never clears "no companion"; a touched Y does', () => {
  const p = mkPatient();
  applyObservations(p, iso(3), { supportive: { companion: 'N', painRelief: 'Y', oralFluid: 'Y', posture: 'MO' } }, settings, { by: 'TE' });
  const a = p.alerts.find(x => x.code === 'no_companion');
  applyObservations(p, iso(2), { supportive: { companion: 'Y', painRelief: 'Y', oralFluid: 'Y', posture: 'upright' } }, settings,
    { by: 'TE', defaulted: { supportive: ['companion', 'painRelief', 'oralFluid', 'posture'] } });
  assert.equal(a.resolved, false);
  applyObservations(p, iso(1), { supportive: { companion: 'Y' } }, settings, { by: 'TE' });
  assert.deepEqual([a.resolved, a.resolvedHow], [true, 'evidence']);
});

// ---------------------------------------- M6 review: urine notations ----
// The manual records P (protein) and A (acetone) as Negative, Trace, + to ++++
// and also writes 'P 2+', 'A 1+', 'P -'. An unreadable value is not assessed:
// it never alerts and never clears an alert - it was graded negative before.

test('M6 review: the manual\'s urine notations are graded; an unreadable value is not assessed, never negative', () => {
  const grades = {
    neg: 0, nil: 0, Negative: 0, '-': 0, 'P -': 0, 'P \u2013': 0, trace: 0.5, 'P Trace': 0.5,
    '+': 1, '1+': 1, 'A+': 1, 'P 1+': 1, '++': 2, '2+': 2, 'P++': 2, 'A 2+': 2, '+++': 3, 'P 3+': 3, '++++': 4, 'A 4+': 4,
  };
  for (const [s, g] of Object.entries(grades)) assert.equal(urineGrade(s), g, s);
  for (const s of ['pos', 'positive', '2', '5+', '+++++', '?', 'P', '']) assert.equal(urineGrade(s), null, `'${s}'`);
  for (const [s, flagged] of [['2+', true], ['P++', true], ['A 3+', true], ['1+', false], ['P Trace', false], ['pos', false]]) {
    assert.equal(FLAG.urine(s), flagged, s);
    const got = codes(evaluateObs(mkPatient(), { type: 'vitals', time: iso(0), v: { protein: s, acetone: s } }, settings));
    assert.deepEqual(got, flagged ? ['proteinuria', 'ketonuria'] : [], s);
  }
});

test('M6 review: an unreadable urine value neither alerts nor clears proteinuria; a graded one below the alert value clears it', () => {
  const p = mkPatient();
  const r = applyObservations(p, iso(3), { vitals: { sys: 120, dia: 80, protein: '2+' } }, settings, { by: 'TE' });
  assert.deepEqual(codes(r.added), ['proteinuria'], 'the manual\'s 2+ is the alert value');
  const a = r.added[0];
  const odd = applyObservations(p, iso(2), { vitals: { sys: 118, dia: 78, protein: 'pos' } }, settings, { by: 'TE' });
  assert.deepEqual([odd.obs[0].flags, a.resolved], [[], false], 'not assessed: no alert of its own, and no evidence');
  applyObservations(p, iso(1), { vitals: { sys: 118, dia: 78, protein: 'P 1+' } }, settings, { by: 'TE' });
  assert.deepEqual([a.resolved, a.resolvedHow], [true, 'evidence']);
});

test('FLAG.newbornTemp marks exactly the temperatures the ppBaby rule alerts on (nb_cold, nb_hot)', () => {
  for (const [temp, flagged, code] of [[36.4, true, 'nb_cold'], [36.5, false, null], [37.4, false, null], [37.5, true, 'nb_hot']]) {
    assert.equal(FLAG.newbornTemp(temp), flagged, `wizard hint at ${temp}`);
    const got = codes(evaluateObs(mkPatient(), { type: 'ppBaby', time: iso(0), v: { breathing: 'normal', temp } }, settings))
      .filter(c => c === 'nb_cold' || c === 'nb_hot');
    assert.deepEqual(got, code ? [code] : [], `rule at ${temp}`);
  }
});
