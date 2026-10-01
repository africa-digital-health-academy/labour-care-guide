// The screens' DOM-free checks (M3 review pass 1): the birth and admission
// forms never record an answer nobody gave, "Record check" offers no baby
// check after a stillbirth, and the admission summary shows only what was
// examined. M4: a birth recorded again after a correction is never later than
// a postpartum check that survived it, and closing a case has a tested rule
// and writes known fields. M5: the form messages come from t() - the expected
// texts are built with t(), and the message checks run in English and Amharic -
// while the referral record keeps storing English text. M6: a birth is never
// before the last labour entry, and a birth typed in its minute is stored at
// its time; units are written mL; correcting the birth of a woman who has left
// says her monitoring does not resume.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { birthProblem, birthStoredTime, correctBirthLines } from '../js/views/delivery.js';
import { admissionProblem } from '../js/views/admission.js';
import { referralRecord, transportText, riskText, givenMeds, medLine, buildShareText, medsShareLine } from '../js/views/referral.js';
import { recordTypes, admissionExamText, canClose, closeFields } from '../js/views/patient.js';
import { applyBirth, applyObservations, voidObservation, voidDelivery, recordEvent } from '../js/record.js';
import { postpartumBPCount, urinePassedSinceBirth, LIMITS, activeObs, isLabouring } from '../js/protocol.js';
import { fmtTime, fmtDT } from '../js/ui.js';
import { t, setLang } from '../js/i18n.js';
import { en as formsEN, am as formsAM } from '../js/i18n/forms.js';
import { en as wizardEN, am as wizardAM } from '../js/i18n/wizard.js';
import { iso, mkPatient, LCG } from './helpers.mjs';

/** Run fn once per screen language; English is restored afterwards. */
function inEachLanguage(fn) {
  for (const lang of ['en', 'am']) {
    setLang(lang);
    try { fn(lang); } finally { setLang('en'); }
  }
}

/** "Still to answer: ..." naming the given unanswered facts, in the current language. */
const stillToAnswer = (...keys) => t('fm.birth.stillToAnswer', { list: keys.map(k => t(k)).join(t('fm.listSep')) });

const answered = {
  outcome: 'live', mode: 'svd', resus: 'N', placentaComplete: 'Y', perineum: 'intact',
  apgar1: { total: 9 }, apgar5: { total: 10 },
};

test('birth form: an untouched form names every unanswered fact and cannot be saved', () => inEachLanguage(() => {
  const untouched = { outcome: 'live', mode: null, resus: null, placentaComplete: null, perineum: null, apgar1: {}, apgar5: {} };
  assert.equal(birthProblem(untouched, iso(1), 'TE'),
    stillToAnswer('fm.birth.ans.mode', 'fm.birth.ans.resus', 'fm.birth.ans.placenta', 'fm.birth.ans.perineum'));
  assert.equal(birthProblem({ ...answered, placentaComplete: null }, iso(1), 'TE'), stillToAnswer('fm.birth.ans.placenta'));
  assert.equal(birthProblem({ ...answered, placentaComplete: 'N' }, iso(1), 'TE'), null, 'an explicit No is an answer');
  assert.equal(birthProblem(answered, iso(1), 'TE'), null);
}));

test('birth form: the time, APGAR for a live birth and the initials are still checked', () => inEachLanguage(() => {
  assert.equal(birthProblem(answered, null, 'TE'), t('fm.birth.needTime'));
  assert.equal(birthProblem(answered, new Date(Date.now() + 3600000).toISOString(), 'TE'), t('fm.birth.timeFuture'));
  assert.equal(birthProblem({ ...answered, apgar5: {} }, iso(1), 'TE'), t('fm.birth.needApgar'));
  assert.equal(birthProblem({ ...answered, outcome: 'sb_macerated', apgar1: {}, apgar5: {} }, iso(1), 'TE'), null);
  assert.equal(birthProblem(answered, iso(1), ''), t('fm.needInitials'));
}));

const admitted = {
  name: 'Test', gravida: 1, para: 0, onsetMode: 'spontaneous', membranes: 'intact',
  romTime: '', romUnknown: false, dilatation: 5, fhr: 140, presentation: 'cephalic',
};

test('admission form: the presentation is asked, never assumed', () => inEachLanguage(() => {
  assert.equal(admissionProblem(admitted, 'TE'), null);
  assert.equal(admissionProblem({ ...admitted, presentation: null }, 'TE'), t('fm.adm.needPresentation'));
  assert.equal(admissionProblem({ ...admitted, presentation: 'breech' }, 'TE'), null);
  assert.equal(admissionProblem({ ...admitted, onsetMode: null }, 'TE'), t('fm.adm.needOnset'));
  assert.equal(admissionProblem(admitted, ''), t('fm.needInitials'));
}));

test('admission form: each missing answer is named, in order', () => inEachLanguage(() => {
  assert.equal(admissionProblem({ ...admitted, name: '  ' }, 'TE'), t('fm.adm.needName'));
  assert.equal(admissionProblem({ ...admitted, para: null }, 'TE'), t('fm.adm.needGP'));
  assert.equal(admissionProblem({ ...admitted, membranes: null }, 'TE'), t('fm.adm.needMembranes'));
  assert.equal(admissionProblem({ ...admitted, membranes: 'ruptured' }, 'TE'), t('fm.adm.needRom'));
  assert.equal(admissionProblem({ ...admitted, membranes: 'ruptured', romTime: '2099-01-01T10:00' }, 'TE'), t('fm.adm.romFuture'));
  assert.equal(admissionProblem({ ...admitted, membranes: 'ruptured', romUnknown: true }, 'TE'), null, 'U = unknown is an answer');
  assert.equal(admissionProblem({ ...admitted, fhr: null }, 'TE'), t('fm.adm.needExam'));
}));

test('M5: the form messages follow the screen language', () => {
  const untouched = { outcome: 'live', mode: null, resus: null, placentaComplete: null, perineum: null, apgar1: {}, apgar5: {} };
  const english = [birthProblem(untouched, iso(1), 'TE'), admissionProblem({ ...admitted, presentation: null }, 'TE')];
  setLang('am');
  try {
    const amharic = [birthProblem(untouched, iso(1), 'TE'), admissionProblem({ ...admitted, presentation: null }, 'TE')];
    amharic.forEach((msg, i) => {
      assert.notEqual(msg, english[i]);
      assert.match(msg, /[ሀ-፿]/, 'written in Ethiopic script');
      assert.doesNotMatch(msg, /fm\./, 'no raw key');
    });
  } finally {
    setLang('en');
  }
});

test('M5: forms.js has an Amharic draft for every key, with the same placeholders', () => {
  const keys = Object.keys(formsEN);
  assert.ok(keys.length > 100);
  assert.ok(keys.every(k => k.startsWith('fm.')), 'every key carries the fm. prefix');
  assert.deepEqual(Object.keys(formsAM).sort(), [...keys].sort(), 'the same keys in English and Amharic');
  const holes = s => s.match(/\{\w+\}/g) || [];
  for (const k of keys) {
    assert.ok(formsAM[k].trim(), `${k} has an Amharic draft`);
    assert.deepEqual(holes(formsAM[k]).sort(), holes(formsEN[k]).sort(), `${k}: same placeholders`);
    // t() fills the first occurrence of a placeholder only
    assert.equal(new Set(holes(formsEN[k])).size, holes(formsEN[k]).length, `${k}: each placeholder once`);
  }
});

test('referral record: reasons and checklist labels are stored in English whatever the screen language', () => inEachLanguage(() => {
  const form = {
    selected: new Set(['preeclampsia', 'preterm']), checks: { mgso4: true },
    otherReason: 'headache', facility: 'Primary Hospital', phone: '0911', transport: 'ambulance',
  };
  const r = referralRecord(form, { by: 'EF', referredBy: 'Sr A', time: iso(0) });
  assert.deepEqual(r.reasons, ['Severe pre-eclampsia / eclampsia', 'Preterm labour']);
  assert.deepEqual(r.checklist.map(c => c.code),
    ['iv', 'fluids', 'mgso4', 'antihtn', 'catheter', 'position', 'called', 'ambulance', 'escort', 'family']);
  const label = code => r.checklist.find(c => c.code === code).label;
  // the dose text is clinical: it must never change by accident (M6: mL, on purpose)
  assert.equal(label('mgso4'), 'MgSO₄ loading dose given — 4 g IV (20%) slowly over 5–20 min + 10 g IM (50%: 5 g each buttock with 1 mL lidocaine 2%)');
  assert.equal(label('antihtn'), `Antihypertensive given (if BP ≥ ${LIMITS.sys.severe}/${LIMITS.dia.severe})`);
  assert.equal(label('iv'), 'IV line secured (16–18G)');
  assert.deepEqual(r.checklist.filter(c => c.done).map(c => c.code), ['mgso4']);
  const { reasons, checklist, ...rest } = r;
  assert.ok(reasons && checklist);
  assert.deepEqual(rest, {
    time: iso(0), otherReason: 'headache',
    facility: 'Primary Hospital', phone: '0911', transport: 'ambulance', referredBy: 'Sr A', by: 'EF',
  });
  const odd = referralRecord({ ...form, selected: new Set(['other', 'unknown_code']) }, { by: 'EF' });
  assert.deepEqual(odd.reasons, ['Other', 'unknown_code'], 'an unknown code is kept as it is');
}));

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
const tooLate = o => t('fm.birth.afterCheck', { time: fmtTime(o.time) });
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
  inEachLanguage(() => {
    assert.equal(birthProblem(answered, at(30), 'TE', p), tooLate(check));
    assert.equal(birthProblem(answered, at(20), 'TE', p), null, 'at the time of the check');
    assert.equal(birthProblem(answered, at(10), 'TE', p), null, 'before the check');
  });
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
  inEachLanguage(() => {
    assert.equal(birthProblem({ ...answered, perineum: null }, at(10), 'TE', p), stillToAnswer('fm.birth.ans.perineum'));
    assert.equal(birthProblem(answered, new Date(Date.now() + 3600000).toISOString(), 'TE', p), t('fm.birth.timeFuture'));
    assert.equal(birthProblem(answered, at(10), '', p), t('fm.needInitials'));
    assert.equal(birthProblem(answered, at(30), 'TE', mkPatient()), null, 'no postpartum entry: no bound');
  });
});

test('birth form: a check on another day than the typed birth time is named with its date', () => {
  // 23:50 on 12 June in Addis Ababa; the birth typed as 00:10 on 13 June
  const checkAt = '2026-06-12T20:50:00.000Z';
  const p = mkPatient({ obs: [{ id: 'pm', type: 'ppMother', time: checkAt, by: 'TE', v: { bleeding: 'normal' } }] });
  inEachLanguage(() => {
    assert.equal(birthProblem(answered, '2026-06-12T21:10:00.000Z', 'TE', p), t('fm.birth.afterCheck', { time: fmtDT(checkAt) }));
  });
});

// ----------------------- M6: the birth is never before the labour entries -----
// The form takes whole minutes (10:43 is 10:43:00); the entries keep their
// seconds. Found on the M6 walk: a birth at 10:43:00 came before its 10 cm exam
// (10:43:28) and pushing mark (10:43:37), and a birth timed 2 h back saved
// cleanly - the chart and the print end at the birth and dropped the rest.

const sec = (min, s) => new Date(Date.UTC(2026, 5, 12, 7, min, s)).toISOString();
const beforeLabour = o => t('fm.birth.beforeLabour', { time: fmtTime(o.time) });
const laterThanBirth = p => activeObs(p).filter(o => new Date(o.time) > new Date(p.delivery.time));

/** Active from 06:00 (6 cm); 10 cm at 10:43:28, the pushing mark at 10:43:37. */
function pushing() {
  const p = mkPatient({ createdAt: at(-300), admission: { time: at(-300) }, status: 'latent', activeStartTime: null });
  applyObservations(p, at(-240), { exam: { dilatation: 6 } }, LCG, { by: 'TE' });
  const ten = applyObservations(p, sec(43, 28), { exam: { dilatation: 10 } }, LCG, { by: 'TE' }).obs[0];
  const push = recordEvent(p, 'pushing', sec(43, 37), LCG, { by: 'TE' }).event;
  return { p, ten, push };
}

test('M6: a birth may not fall in a minute before the last labour entry; typed in its minute it is stored at its time', () => {
  const { p, push } = pushing();
  inEachLanguage(() => {
    assert.equal(birthProblem(answered, sec(43, 0), 'TE', p), null, 'the minute of the pushing mark');
    assert.equal(birthProblem(answered, sec(42, 0), 'TE', p), beforeLabour(push), 'the minute before it');
    assert.equal(birthProblem(answered, at(-77), 'TE', p), beforeLabour(push), 'two hours back');
    assert.equal(birthProblem(answered, sec(44, 0), 'TE', p), null);
  });
  assert.equal(birthStoredTime(sec(43, 0), p), push.time, 'stored at the pushing mark, never before it');
  assert.equal(birthStoredTime(sec(44, 0), p), sec(44, 0), 'a later minute is stored as typed');
  assert.equal(birthStoredTime(sec(43, 0), mkPatient()), sec(43, 0), 'no labour entry: as typed');
  applyBirth(p, { time: birthStoredTime(sec(43, 0), p), mode: 'svd', outcome: 'live', ppVitals: {} }, {}, LCG, { by: 'TE' });
  assert.deepEqual(laterThanBirth(p), [], 'nothing recorded in labour falls after the birth');
});

test('M6: a voided labour entry sets no bound: the last one standing does', () => {
  const { p, ten, push } = pushing();
  voidObservation(p, push.id, LCG, { by: 'TE', reason: 'pressed by mistake' });
  assert.equal(birthStoredTime(sec(43, 0), p), ten.time, 'the 10 cm exam is the last labour entry now');
  voidObservation(p, ten.id, LCG, { by: 'TE', reason: 'examined the wrong woman' });
  assert.equal(birthProblem(answered, sec(42, 0), 'TE', p), null, 'the 06:00 exam bounds it now');
  assert.equal(birthStoredTime(sec(43, 0), p), sec(43, 0));
});

test('M6: a corrected birth record is bounded the same way: not before the labour entries, not after a postpartum check', () => {
  // the walk: a birth saved two hours back hid the last hour of labour; the record is corrected
  const { p, push } = pushing();
  applyBirth(p, { time: at(-77), mode: 'svd', outcome: 'live', ppVitals: {} }, {}, LCG, { by: 'TE' });
  const check = applyObservations(p, sec(55, 0), motherCheck, LCG, { by: 'TE' }).obs[0];
  voidDelivery(p, LCG, { by: 'TE', reason: 'wrong birth time' });
  inEachLanguage(() => {
    assert.equal(birthProblem(answered, at(-77), 'TE', p), beforeLabour(push), 'the wrong time again');
    assert.equal(birthProblem(answered, sec(43, 0), 'TE', p), null, 'the minute of the pushing mark');
    assert.equal(birthProblem(answered, sec(50, 0), 'TE', p), null, 'between the labour and the postpartum entries');
    assert.equal(birthProblem(answered, sec(56, 0), 'TE', p), tooLate(check), 'after the postpartum check');
  });
  assert.equal(birthStoredTime(sec(43, 0), p), push.time);
  // the time as stored is checked: typed 10:43 is 10:43:37, after a check at 10:43:30
  const q = pushing().p;
  const early = applyObservations(q, sec(43, 30), motherCheck, LCG, { by: 'TE' }).obs[0];
  assert.equal(birthProblem(answered, sec(43, 0), 'TE', q), tooLate(early));
  voidObservation(q, early.id, LCG, { by: 'TE', reason: 'timed wrongly' });
  assert.equal(birthProblem(answered, sec(43, 0), 'TE', q), null);
});

test('M6: correcting the birth record of a woman who has left on referral does not say her monitoring resumes', () => inEachLanguage(() => {
  const born = extra => mkPatient({ status: 'delivered', delivery: { time: iso(2) }, ...extra });
  const here = born();
  const waiting = born({ status: 'referred', referral: { time: iso(1), handoverAt: null } });
  const left = born({ status: 'referred', referral: { time: iso(1), handoverAt: iso(0.5) } });
  const lines = ['fm.birth.correctLine1', 'fm.birth.correctLine2', 'fm.birth.correctLine3', 'fm.birth.correctLine4'].map(k => t(k));
  assert.deepEqual(correctBirthLines(here), lines);
  assert.deepEqual(correctBirthLines(waiting), lines, 'referred, not gone: monitored in labour again (S8)');
  assert.deepEqual(correctBirthLines(left), [lines[0], t('fm.birth.correctLine2Left'), lines[2], lines[3]]);
  // the dialog says what the record layer does
  for (const [p, resumes] of [[here, true], [waiting, true], [left, false]]) {
    const q = structuredClone(p);
    voidDelivery(q, LCG, { by: 'TE', reason: 'wrong woman' });
    assert.equal(isLabouring(q), resumes);
    assert.equal(correctBirthLines(p)[1] === t('fm.birth.correctLine2'), resumes);
  }
}));

test('M6: units are written mL, never ml - the form and wizard strings, the birth view and the alerts', () => {
  const unit = /\d ?ml\b|\(ml\)|' ml\b|(^|\s)ml(\s|$)/;
  const strip = s => s.replace(/\{\w+\}/g, '');
  for (const dict of [formsEN, formsAM, wizardEN, wizardAM]) {
    for (const [k, v] of Object.entries(dict)) assert.doesNotMatch(strip(v), unit, k);
  }
  assert.match(formsEN['fm.birth.ebl'], /\(mL\)/);
  assert.match(formsAM['fm.birth.ebl'], /\(mL\)/);
  // the unit after a number, in brackets or ending a string - not a variable named ml
  for (const file of ['views/delivery.js', 'alerts.js']) {
    const src = readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\d ?ml\b| \(ml\)| ml['`]/, file);
  }
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

test('referral note: stored codes are written as English labels, voided medication is left out', () => inEachLanguage(() => {
  assert.equal(transportText('private'), 'Private vehicle');
  assert.equal(transportText('ambulance'), 'Ambulance');
  assert.equal(transportText('other'), 'Other');
  assert.equal(transportText('boat'), 'boat', 'an unknown code is shown as stored');
  assert.equal(riskText(['prior_cs', 'anaemia']), 'Previous caesarean section, Anaemia');
  assert.equal(riskText([]), '');
  const p = { meds: [{ kind: 'oxytocin', detail: '10 IU' }, { kind: 'mgso4', detail: 'typo', voided: { by: 'TE' } }] };
  assert.deepEqual(givenMeds(p).map(m => m.kind), ['oxytocin']);
  assert.deepEqual(givenMeds({}), []);
}));

test('referral note: medication lines name the kind in English and carry the oxytocin rate', () => inEachLanguage(() => {
  assert.equal(medLine({ kind: 'ivfluid', detail: 'RL 1 L' }), 'IV fluids: RL 1 L');
  assert.equal(medLine({ kind: 'medicine', detail: '' }), 'Medicine: -');
  assert.equal(medLine({ kind: 'oxytocin', detail: '', oxyUL: 2.5, oxyDrops: 10, action: 'start' }), 'Oxytocin: 2.5 U/L, 10 drops/min');
  assert.equal(medLine({ kind: 'oxytocin', detail: 'Oxytocin STOPPED', action: 'stop' }), 'Oxytocin: Oxytocin STOPPED');
}));

test('referral share text: risk factors and what was given are in words, never codes', () => inEachLanguage(() => {
  const form = { selected: new Set(['preeclampsia']), checks: { mgso4: true, called: true }, otherReason: '', facility: 'Hospital', phone: '', transport: 'private' };
  const p = mkPatient({ name: 'Test', age: 24, riskFactors: ['prior_cs'], referral: referralRecord(form, { by: 'EF', referredBy: 'Sr A', time: iso(0) }) });
  const text = buildShareText(p, { facilityName: 'HC' });
  assert.ok(text.includes('Risk factors: Previous caesarean section'), text);
  assert.ok(text.includes('MgSO'), text);
  assert.ok(!/Given \/ done: [a-z_]+(, |$)/m.test(text), text);
  assert.ok(text.includes('transport: Private vehicle'), text);
}));

test('referral share text: medication with the date, and whether oxytocin is still running', () => inEachLanguage(() => {
  const p = mkPatient({ meds: [
    { kind: 'oxytocin', detail: '', oxyUL: 10, oxyDrops: 10, action: 'start', time: iso(2) },
    { kind: 'medicine', detail: 'typo', voided: { by: 'TE' }, time: iso(1) },
  ], oxytocinRunning: true });
  const line = medsShareLine(p);
  assert.ok(line.startsWith('Medication in labour: '), line);
  assert.ok(line.includes('Oxytocin: 10 U/L, 10 drops/min'), line);
  assert.ok(!line.includes('typo'), 'a voided medicine is left out');
  assert.ok(line.endsWith('OXYTOCIN STILL RUNNING'), line);
  assert.ok(line.includes(fmtDT(iso(2))), 'carries the date, not the time alone');
  assert.equal(medsShareLine(mkPatient()), 'Medication in labour: none recorded');
}));
