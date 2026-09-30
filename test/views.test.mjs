// The screens' DOM-free checks (M3 review pass 1): the birth and admission
// forms never record an answer nobody gave, "Record check" offers no baby
// check after a stillbirth, and the admission summary shows only what was
// examined.
import test from 'node:test';
import assert from 'node:assert/strict';
import { birthProblem } from '../js/views/delivery.js';
import { admissionProblem } from '../js/views/admission.js';
import { recordTypes, admissionExamText } from '../js/views/patient.js';
import { iso, mkPatient } from './helpers.mjs';

const answered = {
  outcome: 'live', mode: 'svd', resus: 'N', placentaComplete: 'Y', perineum: 'intact',
  apgar1: { total: 9 }, apgar5: { total: 10 },
};

test('birth form: an untouched form names every unanswered fact and cannot be saved', () => {
  const untouched = { outcome: 'live', mode: null, resus: null, placentaComplete: null, perineum: null, apgar1: {}, apgar5: {} };
  assert.equal(birthProblem(untouched, iso(1), 'TE'),
    'Still to answer: mode of birth, resuscitation, placenta complete, perineum');
  assert.equal(birthProblem({ ...answered, placentaComplete: null }, iso(1), 'TE'), 'Still to answer: placenta complete');
  assert.equal(birthProblem({ ...answered, placentaComplete: 'N' }, iso(1), 'TE'), null, 'an explicit No is an answer');
  assert.equal(birthProblem(answered, iso(1), 'TE'), null);
});

test('birth form: the time, APGAR for a live birth and the initials are still checked', () => {
  assert.match(birthProblem(answered, null, 'TE'), /time of birth/);
  assert.match(birthProblem(answered, new Date(Date.now() + 3600000).toISOString(), 'TE'), /future/);
  assert.match(birthProblem({ ...answered, apgar5: {} }, iso(1), 'TE'), /APGAR/);
  assert.equal(birthProblem({ ...answered, outcome: 'sb_macerated', apgar1: {}, apgar5: {} }, iso(1), 'TE'), null);
  assert.match(birthProblem(answered, iso(1), ''), /initials/);
});

const admitted = {
  name: 'Test', gravida: 1, para: 0, onsetMode: 'spontaneous', membranes: 'intact',
  romTime: '', romUnknown: false, dilatation: 5, fhr: 140, presentation: 'cephalic',
};

test('admission form: the presentation is asked, never assumed', () => {
  assert.equal(admissionProblem(admitted, 'TE'), null);
  assert.equal(admissionProblem({ ...admitted, presentation: null }, 'TE'),
    'Presentation: choose Cephalic, Breech, Transverse or Other');
  assert.equal(admissionProblem({ ...admitted, presentation: 'breech' }, 'TE'), null);
  assert.equal(admissionProblem({ ...admitted, onsetMode: null }, 'TE'), 'Labour onset: choose Spontaneous or Induced');
  assert.match(admissionProblem(admitted, ''), /initials/);
});

test('Record check offers no baby check after a stillbirth; Record now adds oxytocin while it runs', () => {
  const born = outcome => mkPatient({ status: 'delivered', delivery: { time: iso(1), outcome } });
  assert.deepEqual(recordTypes(born('live'), 'postpartum'), ['ppMother', 'ppBaby', 'bloodloss']);
  assert.deepEqual(recordTypes(born('sb_fresh'), 'postpartum'), ['ppMother', 'bloodloss']);
  assert.deepEqual(recordTypes(born('sb_macerated'), 'postpartum'), ['ppMother', 'bloodloss']);
  assert.ok(!recordTypes(mkPatient(), 'labour').includes('oxytocin'));
  assert.ok(recordTypes(mkPatient({ oxytocinRunning: true }), 'labour').includes('oxytocin'));
});

test('admission summary: descent and presentation are shown only when recorded', () => {
  const parts = a => admissionExamText(a).split(' · ');
  assert.deepEqual(parts({ dilatation: 4, descent: null, fhr: 140, presentation: 'cephalic' }), ['4 cm', 'FHR 140', 'cephalic']);
  assert.deepEqual(parts({ dilatation: 4, descent: 0, fhr: 140 }), ['4 cm', 'descent 0/5', 'FHR 140']);
  assert.deepEqual(parts({ dilatation: 6, descent: 3, fhr: 150, presentation: 'breech' }),
    ['6 cm', 'descent 3/5', 'FHR 150', 'breech']);
});
