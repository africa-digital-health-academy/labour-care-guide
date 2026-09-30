import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateObs, evaluateTime, FLAG } from '../js/alerts.js';
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

test('FLAG.newbornTemp marks exactly the temperatures the ppBaby rule alerts on (nb_cold, nb_hot)', () => {
  for (const [temp, flagged, code] of [[36.4, true, 'nb_cold'], [36.5, false, null], [37.4, false, null], [37.5, true, 'nb_hot']]) {
    assert.equal(FLAG.newbornTemp(temp), flagged, `wizard hint at ${temp}`);
    const got = codes(evaluateObs(mkPatient(), { type: 'ppBaby', time: iso(0), v: { breathing: 'normal', temp } }, settings))
      .filter(c => c === 'nb_cold' || c === 'nb_hot');
    assert.deepEqual(got, code ? [code] : [], `rule at ${temp}`);
  }
});
