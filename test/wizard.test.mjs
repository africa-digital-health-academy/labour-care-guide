// The wizard's DOM-free contracts: every type the due list can ask for has a
// step set, the steps offer the WHO codes the engine reads (F1, F7, F9, N3,
// N4), and only defaults the midwife never touched are reported as defaulted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WIZARD_TYPES, wizardTypeFor, computeDefaulted, wizardSteps, prefillValues, currentCode, timeChoices,
} from '../js/wizard.js';
import { PROTOCOLS, dueList } from '../js/protocol.js';
import { NOW, iso, mkPatient } from './helpers.mjs';

const step = (type, key) => wizardSteps(type).find(s => s.key === key);
const valuesOf = s => s.options.map(o => o.value);
const alerting = s => s.options.filter(o => o.alert).map(o => o.value);
const requiredKeys = type => wizardSteps(type).filter(s => s.required).map(s => s.key);

test('every type the due list can ask for has a wizard step set', () => {
  const asked = new Set(['oxytocin', 'ppMother', 'ppBaby', 'ppBP', 'ppVoid']);
  for (const proto of Object.values(PROTOCOLS)) {
    for (const schedule of Object.values(proto.schedules)) Object.keys(schedule).forEach(k => asked.add(k));
  }
  for (const type of asked) assert.ok(WIZARD_TYPES.includes(wizardTypeFor(type)), `${type} has no wizard step set`);
  assert.ok(WIZARD_TYPES.includes('bloodloss'));
});

test('the live due list, in labour and in the postpartum watch, names only recordable types', () => {
  const oxytocin = { oxytocinRunning: true, meds: [{ id: 'm1', kind: 'oxytocin', time: iso(2), action: 'start' }] };
  const cases = [
    ...['latent', 'active', 'second'].map(status => mkPatient({ status, ...oxytocin })),
    mkPatient({ status: 'delivered', delivery: { time: iso(1) } }),
  ];
  for (const p of cases) {
    for (const proto of Object.values(PROTOCOLS)) {
      const types = dueList(p, proto, NOW).map(d => d.type);
      assert.ok(types.length, `nothing due for status ${p.status}`);
      for (const type of types) assert.ok(WIZARD_TYPES.includes(wizardTypeFor(type)), `${type} (${p.status})`);
    }
  }
});

test('wizardTypeFor: the postpartum BP and urine items are recorded in the mother check', () => {
  assert.equal(wizardTypeFor('ppBP'), 'ppMother');
  assert.equal(wizardTypeFor('ppVoid'), 'ppMother');
  for (const type of [...WIZARD_TYPES, 'event']) assert.equal(wizardTypeFor(type), type);
  assert.equal(wizardTypeFor('toString'), 'toString');
});

test('computeDefaulted: an untouched default is reported', () => {
  const out = computeDefaulted({ supportive: { companion: 'Y' } }, { supportive: { companion: 'Y' } }, { supportive: new Set() });
  assert.deepEqual(out, { supportive: ['companion'] });
});

test('computeDefaulted: a default the midwife touched is not reported', () => {
  const out = computeDefaulted({ supportive: { companion: 'Y' } }, { supportive: { companion: 'Y' } },
    { supportive: new Set(['companion']) });
  assert.deepEqual(out, {});
});

test('computeDefaulted: a value changed away from its default is not reported', () => {
  const out = computeDefaulted({ supportive: { companion: 'N' } }, { supportive: { companion: 'Y' } }, { supportive: new Set() });
  assert.deepEqual(out, {});
});

test('computeDefaulted: a type with no defaults is omitted; a zero default counts; a skipped key does not', () => {
  const out = computeDefaulted(
    { baby: { fhr: 140 }, exam: { dilatation: 6, caput: 0, moulding: 1 } },
    { exam: { caput: 0, moulding: 0, presentation: 'cephalic' } },
    { exam: ['moulding'] });
  assert.deepEqual(out, { exam: ['caput'] });
});

test('supportive care is coded Y, N or D; Y is the default and N the alert value (F1)', () => {
  for (const key of ['companion', 'painRelief', 'oralFluid']) {
    const s = step('supportive', key);
    assert.deepEqual(valuesOf(s), ['Y', 'N', 'D']);
    assert.deepEqual(alerting(s), ['N']);
    assert.equal(s.dflt, 'Y');
  }
  assert.deepEqual(alerting(step('supportive', 'posture')), ['supine']);
});

test('amniotic fluid offers I, C, M+ to M+++ and B at the FHR step and the exam; M+++ and B alert (F7)', () => {
  for (const type of ['baby', 'exam']) {
    const s = step(type, 'liquor');
    assert.deepEqual(valuesOf(s), ['I', 'C', 'M1', 'M2', 'M3', 'B']);
    assert.deepEqual(alerting(s), ['M3', 'B']);
    assert.ok(!s.required);
  }
});

test('urine protein and acetone are graded Negative to ++++; ++ and above alert (F9)', () => {
  for (const key of ['protein', 'acetone']) {
    const s = step('vitals', key);
    assert.deepEqual(valuesOf(s), ['neg', 'trace', '+', '++', '+++', '++++']);
    assert.deepEqual(alerting(s), ['++', '+++', '++++']);
  }
});

test('postpartum mother and baby checks collect the shapes the engine reads (N4)', () => {
  assert.deepEqual(wizardSteps('ppMother').map(s => s.key),
    ['bleeding', 'tone', 'fundus', 'pulse', 'sys', 'dia', 'temp', 'urinePassed']);
  assert.deepEqual(requiredKeys('ppMother'), ['bleeding', 'tone', 'pulse']);
  assert.deepEqual(valuesOf(step('ppMother', 'bleeding')), ['normal', 'heavy']);
  assert.deepEqual(valuesOf(step('ppMother', 'tone')), ['firm', 'soft']);
  assert.deepEqual(valuesOf(step('ppMother', 'fundus')), ['below', 'at', 'above']);
  assert.deepEqual(valuesOf(step('ppMother', 'urinePassed')), ['Y', 'N']);
  assert.ok(step('ppMother', 'dia').requiredIf({ sys: 120 }), 'a systolic needs its diastolic');
  assert.ok(!step('ppMother', 'dia').requiredIf({}));
  assert.deepEqual(requiredKeys('ppBaby'), ['breathing']);
  assert.deepEqual(valuesOf(step('ppBaby', 'breathing')), ['normal', 'difficult', 'none']);
  assert.deepEqual(valuesOf(step('ppBaby', 'feeding')), ['good', 'poor']);
});

test('blood loss is a required running total (4 digits) with its method, drape by default (N3)', () => {
  assert.deepEqual(requiredKeys('bloodloss'), ['ml']);
  assert.equal(step('bloodloss', 'ml').numpad.maxLen, 4);
  assert.deepEqual(valuesOf(step('bloodloss', 'method')), ['drape', 'weighed', 'estimate']);
  assert.equal(step('bloodloss', 'method').dflt, 'drape');
});

test('every step has a unique key, and every default is one of its own options', () => {
  for (const type of WIZARD_TYPES) {
    const keys = wizardSteps(type).map(s => s.key);
    assert.equal(new Set(keys).size, keys.length, type);
    for (const s of wizardSteps(type)) {
      if (s.dflt === undefined) continue;
      assert.ok(s.options && s.options.some(o => o.value === s.dflt), `${type}.${s.key}`);
    }
  }
  assert.deepEqual(wizardSteps('event'), []);
});

// ------------------------------------------ M3 review pass 1 regressions ----

test('prefillValues: a correction drops the seconds derived from the band, keeps a v1 duration without one', () => {
  assert.deepEqual(prefillValues('contractions', { count: 3, durBand: 'gt60', duration: 70 }), { count: 3, durBand: 'gt60' });
  assert.deepEqual(prefillValues('contractions', { count: 3, duration: 45 }), { count: 3, duration: 45 });
  assert.deepEqual(prefillValues('baby', { fhr: 140, decel: undefined, _time: 'x' }), { fhr: 140 });
});

test('prefillValues and currentCode: v1 urine nil is shown as neg; a code with no equivalent is kept', () => {
  assert.deepEqual(prefillValues('vitals', { sys: 120, dia: 80, protein: 'nil', acetone: '+' }),
    { sys: 120, dia: 80, protein: 'neg', acetone: '+' });
  assert.equal(currentCode(step('vitals', 'protein'), 'nil'), 'neg');
  assert.equal(currentCode(step('vitals', 'acetone'), '++'), '++');
  assert.equal(currentCode(step('exam', 'liquor'), 'M'), 'M', 'ungraded meconium has no current code');
  assert.equal(currentCode(step('baby', 'fhr'), 140), 140, 'a numpad answer is unchanged');
  assert.equal(currentCode(undefined, 'x'), 'x');
});

test('timeChoices: once a birth is recorded no earlier time is offered; Just now always is', () => {
  const minAgo = m => new Date(+NOW - m * 60000).toISOString();
  const offered = birth => timeChoices(birth, NOW).map(c => c.value);
  assert.deepEqual(offered(null), [0, 5, 10, 15, 30, 60]);
  assert.deepEqual(offered(minAgo(120)), [0, 5, 10, 15, 30, 60]);
  assert.deepEqual(offered(minAgo(12)), [0, 5, 10]);
  assert.deepEqual(offered(minAgo(15)), [0, 5, 10, 15], 'an entry at the birth time itself is allowed');
  assert.deepEqual(offered(minAgo(2)), [0]);
  assert.deepEqual(offered(minAgo(-5)), [0], 'a birth time ahead of the clock still leaves Just now');
});
