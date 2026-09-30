// The screens' DOM-free checks (M3 review pass 1): the birth and admission
// forms never record an answer nobody gave, "Record check" offers no baby
// check after a stillbirth, and the admission summary shows only what was
// examined. M4: a birth recorded again after a correction is never later than
// a postpartum check that survived it, and closing a case has a tested rule
// and writes known fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import { birthProblem } from '../js/views/delivery.js';
import { admissionProblem } from '../js/views/admission.js';
import { recordTypes, admissionExamText, canClose, closeFields } from '../js/views/patient.js';
import { applyBirth, applyObservations, voidObservation, voidDelivery } from '../js/record.js';
import { postpartumBPCount, urinePassedSinceBirth } from '../js/protocol.js';
import { fmtTime, fmtDT } from '../js/ui.js';
import { iso, mkPatient, LCG } from './helpers.mjs';

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

// ------------------------------- M4: correcting a birth record's time -----

// Fixed UTC times on one Addis Ababa day (07:00Z is 10:00 there), whatever
// the test machine's timezone: the message names the check's time of day.
const at = min => new Date(Date.UTC(2026, 5, 12, 7, 0) + min * 60000).toISOString();
const tooLate = o => `Birth time is after a postpartum check recorded at ${fmtTime(o.time)} - check the time, or void that check in Entries if it was wrong`;
const motherCheck = { ppMother: { bleeding: 'normal', tone: 'firm', pulse: 82, sys: 112, dia: 72, urinePassed: 'Y' } };

/** Birth recorded at at(0), postpartum entries at the given minutes, then the birth record corrected. */
function correctedBirth(entries) {
  const p = mkPatient({
    createdAt: at(-360), admission: { time: at(-360) },
    status: 'second', activeStartTime: at(-300), secondStageStart: at(-60),
  });
  applyBirth(p, { time: at(0), mode: 'svd', outcome: 'live', ppVitals: {} }, {}, LCG, { by: 'TE' });
  const obs = entries.map(([min, values]) => applyObservations(p, at(min), values, LCG, { by: 'TE' }).obs[0]);
  voidDelivery(p, LCG, { by: 'TE', reason: 'wrong birth time' });
  return { p, obs };
}

test('birth form: a corrected birth may not be later than a postpartum check that survived it', () => {
  const { p, obs: [check] } = correctedBirth([[20, motherCheck]]);
  assert.equal(birthProblem(answered, at(30), 'TE', p), tooLate(check));
  assert.equal(birthProblem(answered, at(20), 'TE', p), null, 'at the time of the check');
  assert.equal(birthProblem(answered, at(10), 'TE', p), null, 'before the check');
  // the bound is the engine's own: a check at the birth time still counts
  applyBirth(p, { time: at(20), mode: 'svd', outcome: 'live', ppVitals: {} }, {}, LCG, { by: 'TE' });
  assert.equal(postpartumBPCount(p), 1);
  assert.equal(urinePassedSinceBirth(p), true);
});

test('birth form: the earliest surviving postpartum entry of any kind bounds the birth; voided ones do not', () => {
  const { p, obs: [loss, baby, mother] } = correctedBirth([
    [15, { bloodloss: { ml: 200, method: 'drape' } }],
    [25, { ppBaby: { breathing: 'normal' } }],
    [40, motherCheck],
  ]);
  assert.equal(birthProblem(answered, at(20), 'TE', p), tooLate(loss));
  voidObservation(p, loss.id, LCG, { by: 'TE', reason: 'drape of another woman' });
  assert.equal(birthProblem(answered, at(20), 'TE', p), null, 'a voided reading sets no bound');
  assert.equal(birthProblem(answered, at(30), 'TE', p), tooLate(baby));
  voidObservation(p, baby.id, LCG, { by: 'TE', reason: 'wrong baby' });
  assert.equal(birthProblem(answered, at(45), 'TE', p), tooLate(mother));
  voidObservation(p, mother.id, LCG, { by: 'TE', reason: 'wrong woman' });
  assert.equal(birthProblem(answered, at(45), 'TE', p), null, 'every check voided: no bound');
});

test('birth form: with the case given, the existing rules still apply', () => {
  const { p } = correctedBirth([[20, motherCheck]]);
  assert.equal(birthProblem({ ...answered, perineum: null }, at(10), 'TE', p), 'Still to answer: perineum');
  assert.match(birthProblem(answered, new Date(Date.now() + 3600000).toISOString(), 'TE', p), /future/);
  assert.match(birthProblem(answered, at(10), '', p), /initials/);
  assert.equal(birthProblem(answered, at(30), 'TE', mkPatient()), null, 'no postpartum entry: no bound');
});

test('birth form: a check on another day than the typed birth time is named with its date', () => {
  // 23:50 on 12 June in Addis Ababa; the birth typed as 00:10 on 13 June
  const checkAt = '2026-06-12T20:50:00.000Z';
  const p = mkPatient({ obs: [{ id: 'pm', type: 'ppMother', time: checkAt, by: 'TE', v: { bleeding: 'normal' } }] });
  assert.equal(birthProblem(answered, '2026-06-12T21:10:00.000Z', 'TE', p),
    `Birth time is after a postpartum check recorded at ${fmtDT(checkAt)} - check the time, or void that check in Entries if it was wrong`);
});

// ------------------------------------------------ M4: closing a case ------

test('close case: only when she is not in labour, and only once', () => {
  for (const status of ['latent', 'active', 'second']) assert.equal(canClose(mkPatient({ status })), false, status);
  assert.equal(canClose(mkPatient({ status: 'referred' })), false, 'referred in labour, handover not recorded');
  assert.equal(canClose(mkPatient({ status: 'referred', referral: { handoverAt: iso(1) } })), true, 'handed over');
  assert.equal(canClose(mkPatient({ status: 'delivered', delivery: { time: iso(1) } })), true,
    'in the postpartum watch: allowed, the dialog warns');
  assert.equal(canClose(mkPatient({ status: 'closed' })), false, 'already closed');
});

test('close case: writes status, time and initials as new fields; refuses what canClose refuses', () => {
  const p = mkPatient({ status: 'delivered', delivery: { time: iso(2) } });
  const before = structuredClone(p);
  const fields = closeFields(p, 'TE', iso(0));
  assert.deepEqual(fields, { status: 'closed', closedAt: iso(0), closedBy: 'TE' });
  assert.deepEqual(p, before, 'the case itself is not changed');
  const closed = { ...p, ...fields };
  assert.equal(canClose(closed), false);
  assert.throws(() => closeFields(closed, 'TE', iso(0)), /already closed/);
  assert.throws(() => closeFields(mkPatient({ status: 'active' }), 'TE', iso(0)), /in labour cannot be closed/);
  assert.throws(() => closeFields(mkPatient({ status: 'referred' }), 'TE', iso(0)), /in labour cannot be closed/);
  assert.throws(() => closeFields(p, '', iso(0)), /Initials are required/);
  assert.throws(() => closeFields(p, '  ', iso(0)), /Initials are required/);
});
