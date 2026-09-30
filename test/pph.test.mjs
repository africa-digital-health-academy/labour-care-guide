// PPH (N3): the WHO/FIGO/ICM 2025 two-level trigger, the MOTIVE bundle,
// tranexamic acid on the emergency card, prevention without routine massage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pphTrigger, haemodynamicSigns, bloodLossTotal, birthAlerts, resolveAlert, PPH_BUNDLE, AMTSL_STEPS, EMERGENCIES,
} from '../js/alerts.js';
import { applyObservations, applyBirth, voidObservation, voidDelivery } from '../js/record.js';
import { iso, mkPatient, LCG } from './helpers.mjs';

function born(delivery = {}) {
  return mkPatient({ status: 'delivered', delivery: { time: iso(2), outcome: 'live', ppVitals: {}, ...delivery } });
}
const loss = (p, hAgo, ml) => p.obs.push({ id: 'b' + hAgo, type: 'bloodloss', time: iso(hAgo), v: { ml, method: 'drape' } });
const vitals = (p, hAgo, v) => p.obs.push({ id: 'm' + hAgo, type: 'ppMother', time: iso(hAgo), v });

test('500 mL alone meets the trigger; 499 mL with normal signs does not', () => {
  const p = born();
  loss(p, 1.5, 520);
  assert.equal(pphTrigger(p, iso(1)).level, 'volume');
  const q = born();
  loss(q, 1.5, 499);
  vitals(q, 1.4, { pulse: 88, sys: 118, dia: 76 });
  assert.equal(pphTrigger(q, iso(1)), null);
});

test('300 mL with a pulse above 100 meets the trigger; 300 mL with normal signs does not', () => {
  const p = born();
  loss(p, 1.5, 320);
  vitals(p, 1.4, { pulse: 125, sys: 110, dia: 70 });
  const t = pphTrigger(p, iso(1));
  assert.equal(t.level, 'signs');
  assert.ok(t.signs.includes('pulse 125'));
  const q = born();
  loss(q, 1.5, 320);
  vitals(q, 1.4, { pulse: 88, sys: 118, dia: 76 });
  assert.equal(pphTrigger(q, iso(1)), null);
});

test('299 mL does not meet the trigger even with abnormal signs', () => {
  const p = born();
  loss(p, 1.5, 299);
  vitals(p, 1.4, { pulse: 130, sys: 85, dia: 50 });
  assert.equal(pphTrigger(p, iso(1)), null);
});

test('haemodynamic cut-offs: pulse > 100, systolic < 100, diastolic < 60, shock index > 1', () => {
  const sign = v => { const p = born(); vitals(p, 1.5, v); return haemodynamicSigns(p, iso(1)); };
  assert.deepEqual(sign({ pulse: 101, sys: 120, dia: 80 }), ['pulse 101']);
  assert.deepEqual(sign({ pulse: 100, sys: 120, dia: 80 }), []);
  assert.deepEqual(sign({ pulse: 80, sys: 99, dia: 70 }), ['systolic 99']);
  assert.deepEqual(sign({ pulse: 80, sys: 100, dia: 60 }), []);
  assert.deepEqual(sign({ pulse: 80, sys: 110, dia: 59 }), ['diastolic 59']);
  assert.ok(sign({ pulse: 110, sys: 105, dia: 70 }).includes('shock index 1.0'));
});

test('drape readings are cumulative: the total is the highest reading, and the birth estimate counts', () => {
  const p = born({ eblMl: 250 });
  loss(p, 1.8, 200);
  loss(p, 1.5, 350);
  assert.equal(bloodLossTotal(p), 350);
  assert.equal(bloodLossTotal(born({ eblMl: 550 })), 550);
});

test('a post-birth entry that completes the trigger raises a danger PPH alert with the MOTIVE bundle and tranexamic acid', () => {
  const p = born();
  const first = applyObservations(p, iso(1.5), { bloodloss: { ml: 350, method: 'drape' } }, LCG);
  assert.deepEqual(first.added, []);
  const r = applyObservations(p, iso(1.4), { ppMother: { pulse: 118, sys: 104, dia: 70 } }, LCG);
  const a = r.added.find(x => x.code === 'pph');
  assert.equal(a.severity, 'danger');
  assert.ok(a.advice.some(t => /Tranexamic acid 1 g IV/.test(t)));
  assert.match(a.title, /350 mL with pulse 118/);
});

test('an estimated loss of 500 mL on the birth record raises PPH at birth', () => {
  assert.ok(birthAlerts(born({ eblMl: 550 })).some(a => a.code === 'pph'));
  assert.ok(!birthAlerts(born({ eblMl: 250 })).some(a => a.code === 'pph'));
});

test('after a PPH episode is closed, nothing new keeps it closed; more measured blood re-opens it', () => {
  const p = born();
  applyObservations(p, iso(1.5), { bloodloss: { ml: 600 } }, LCG);
  const one = p.alerts.find(a => a.code === 'pph');
  resolveAlert(p, one.id, { by: 'TE', reason: 'bleeding controlled' });
  const calm = applyObservations(p, iso(1.3), { ppMother: { pulse: 90, sys: 110, dia: 70 } }, LCG);
  assert.ok(!calm.added.some(a => a.code === 'pph'));
  const more = applyObservations(p, iso(1.2), { bloodloss: { ml: 750 } }, LCG);
  assert.equal(more.added.find(a => a.code === 'pph').episode, 2);
});

test('after a PPH episode is closed, a new abnormal sign re-opens it even without more blood', () => {
  const p = born();
  applyObservations(p, iso(1.5), { bloodloss: { ml: 600 } }, LCG);
  resolveAlert(p, p.alerts.find(a => a.code === 'pph').id, { by: 'TE', reason: 'controlled' });
  // pulse 112 and systolic 92: below the stand-alone pulse and hypotension alerts, a PPH sign after 600 mL
  const shock = applyObservations(p, iso(1.25), { ppMother: { pulse: 112, sys: 92, dia: 64 } }, LCG);
  const again = shock.added.find(a => a.code === 'pph');
  assert.equal(again.episode, 2);
  assert.match(again.title, /pulse 112/);
});

test('an open PPH alert shows the latest measured total', () => {
  const p = born();
  applyObservations(p, iso(1.5), { bloodloss: { ml: 550 } }, LCG);
  applyObservations(p, iso(1.2), { bloodloss: { ml: 900 } }, LCG);
  const open = p.alerts.filter(a => a.code === 'pph');
  assert.equal(open.length, 1);
  assert.match(open[0].title, /900 mL/);
});

test('voiding a postpartum check does not close a PPH raised by the birth record', () => {
  const p = mkPatient({ status: 'second', secondStageStart: iso(3) });
  applyBirth(p, { time: iso(2), outcome: 'live', eblMl: 600, ppVitals: {} }, {}, LCG);
  const pph = p.alerts.find(a => a.code === 'pph');
  const check = applyObservations(p, iso(1.5), { ppMother: { pulse: 90, sys: 110, dia: 70 } }, LCG).obs[0];
  voidObservation(p, check.id, LCG, { reason: 'entered on the wrong woman' });
  assert.equal(pph.resolved, false);
});

test('an entry-raised PPH closes when its only qualifying reading is voided, and stays open while others still qualify', () => {
  const p = born();
  const r = applyObservations(p, iso(1.5), { bloodloss: { ml: 600 } }, LCG);
  const pph = r.added.find(a => a.code === 'pph');
  voidObservation(p, r.obs[0].id, LCG, { reason: 'drape reading of another woman' });
  assert.equal(pph.resolved, true);
  assert.equal(pph.resolvedHow, 'void');
  const q = born();
  applyObservations(q, iso(1.6), { bloodloss: { ml: 550 } }, LCG);
  const dup = applyObservations(q, iso(1.5), { bloodloss: { ml: 650 } }, LCG).obs[0];
  voidObservation(q, dup.id, LCG, { reason: 'duplicate reading' });
  assert.equal(q.alerts.find(a => a.code === 'pph').resolved, false);
});

// review pass 2 regressions
test('a voided typo sets no bar: a real bleed after it still raises PPH', () => {
  const p = born();
  const typo = applyObservations(p, iso(1.5), { bloodloss: { ml: 6500 } }, LCG).obs[0];
  voidObservation(p, typo.id, LCG, { reason: 'typed 6500 for 650' });
  const real = applyObservations(p, iso(1.2), { bloodloss: { ml: 550 } }, LCG);
  const pph = real.added.find(a => a.code === 'pph');
  assert.ok(pph, 'the 550 mL haemorrhage must alert');
  assert.equal(pph.episode, 2);
});

test('a birth voided and recorded again raises PPH again', () => {
  const p = mkPatient({ status: 'second', secondStageStart: iso(3) });
  applyBirth(p, { time: iso(2), outcome: 'live', eblMl: 600, ppVitals: {} }, {}, LCG);
  voidDelivery(p, LCG, { reason: 'recorded on the wrong woman' });
  const again = applyBirth(p, { time: iso(1.8), outcome: 'live', eblMl: 600, ppVitals: {} }, {}, LCG);
  assert.ok(again.added.some(a => a.code === 'pph'));
});

test('voiding the volume reading that completed nothing on its own still re-checks the PPH', () => {
  const p = born();
  const volume = applyObservations(p, iso(1.5), { bloodloss: { ml: 350 } }, LCG).obs[0];
  applyObservations(p, iso(1.4), { ppMother: { pulse: 118, sys: 104, dia: 70 } }, LCG);
  const pph = p.alerts.find(a => a.code === 'pph');
  assert.equal(pph.obsIds.includes(volume.id), false, 'the reading was never linked');
  voidObservation(p, volume.id, LCG, { reason: 'drape of another woman' });
  assert.equal(pph.resolved, true);
  assert.equal(pph.resolvedHow, 'void');
});

test('when the PPH is still met after a void, it shows the remaining total, not the voided one', () => {
  const p = born();
  applyObservations(p, iso(1.5), { bloodloss: { ml: 550 } }, LCG);
  const typo = applyObservations(p, iso(1.3), { bloodloss: { ml: 6500 } }, LCG).obs[0];
  const pph = p.alerts.find(a => a.code === 'pph');
  assert.match(pph.title, /6500 mL/);
  voidObservation(p, typo.id, LCG, { reason: 'typo' });
  assert.equal(pph.resolved, false);
  assert.match(pph.title, /550 mL/);
  assert.equal(pph.meta.totalMl, 550);
});

test('the trigger is only checked in the 24 h after birth', () => {
  const p = mkPatient({ status: 'delivered', delivery: { time: iso(30), outcome: 'live', ppVitals: {} } });
  const r = applyObservations(p, iso(1), { bloodloss: { ml: 800 } }, LCG);
  assert.deepEqual(r.added, []);
});

test('N3: the PPH emergency card carries tranexamic acid and the six MOTIVE steps', () => {
  const card = EMERGENCIES.find(e => e.code === 'pph');
  assert.ok(card.advice.some(a => /Tranexamic acid/.test(a)));
  assert.deepEqual(PPH_BUNDLE.map(b => b.label[0]), ['M', 'O', 'T', 'I', 'V', 'E']);
});

test('N3: third-stage prevention drops routine uterine massage (WHO 2018 rec 46) and offers carbetocin', () => {
  assert.ok(!AMTSL_STEPS.some(([, label]) => /massage/i.test(label)));
  assert.ok(AMTSL_STEPS.some(([, label]) => /carbetocin/i.test(label)));
  assert.ok(AMTSL_STEPS.some(([code]) => code === 'oxy_amtsl'), 'v1 key kept for comparable records');
});
