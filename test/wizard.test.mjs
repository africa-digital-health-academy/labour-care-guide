// The wizard's DOM-free contracts: every type the due list can ask for has a
// step set, the steps offer the WHO codes the engine reads (F1, F7, F9, N3,
// N4), and only defaults the midwife never touched are reported as defaulted.
// M5: the text is looked up in the current language when a screen is built,
// and an alert asked again - or a new episode of a code acknowledged before -
// names the last acknowledgement. The dialog starts on an action only when
// every alert in it is such a repeat of the same action, never on a default;
// its items are told apart by episode and closing time. Each acknowledgement
// is counted and its note tagged kind 'ack'; one with no action is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WIZARD_TYPES, wizardTypeFor, computeDefaulted, wizardSteps, prefillValues, currentCode, timeChoices,
  ackRepeat, ackPreselect, acknowledgeAlerts, ackRepeatText, ackItemTag,
} from '../js/wizard.js';
import { PROTOCOLS, dueList } from '../js/protocol.js';
import { applyObservations } from '../js/record.js';
import { t, setLang } from '../js/i18n.js';
import { fmtTime } from '../js/ui.js';
import { NOW, iso, mkPatient, LCG } from './helpers.mjs';

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

// ------------------------------------- M5: language, repeat acknowledgement ----

test('wizard text is looked up in the current language when a screen is built, not when the module loads', () => {
  try {
    setLang('am');
    assert.equal(step('baby', 'fhr').q, t('wz.q_fhr'));
    assert.notEqual(step('baby', 'fhr').q, 'Fetal heart rate (bpm)?');
    assert.equal(step('supportive', 'companion').options.find(o => o.value === 'Y').label, t('yes'));
    assert.equal(step('oxytocin', 'dropsMin').numpad.unit, t('wz.unit_drops'));
    assert.equal(timeChoices(null, NOW)[1].label, t('wz.time_ago', { n: 5 }));
  } finally {
    setLang('en');
  }
  assert.equal(step('baby', 'fhr').q, 'Fetal heart rate (bpm)?');
  assert.equal(step('baby', 'liquor').help,
    'Skip if membranes intact and nothing draining. M = meconium: + non-significant, ++ medium, +++ thick.');
  assert.equal(step('exam', 'liquor').options.find(o => o.value === 'M1').label, 'M+', 'codes are shown as they are');
  assert.equal(step('vitals', 'sys').numpad.unit, 'mmHg', 'units stay in Latin script');
  assert.deepEqual(timeChoices(null, NOW).map(c => c.label),
    ['Just now', '5 min ago', '10 min ago', '15 min ago', '30 min ago', '60 min ago']);
});

// an acknowledged alert as the engine leaves it when it asks again (fields kept from the last acknowledgement)
const waiting = (extra = {}) => ({
  id: 'a1', code: 'fhr_abn', severity: 'warn', title: 'Abnormal FHR', time: iso(2), raisedAt: iso(2),
  ack: false, action: 'senior', actionTime: iso(1.5), ackBy: 'TE', ...extra,
});

test('ackRepeat: an alert asked again after an acknowledgement gives the repeat number, its time and action', () => {
  assert.deepEqual(ackRepeat(waiting({ reAlertedAt: iso(1), ackCount: 2 })), { n: 2, at: iso(1.5), action: 'senior' });
  assert.deepEqual(ackRepeat(waiting({ escalatedAt: iso(1) })), { n: 1, at: iso(1.5), action: 'senior' },
    'severity raised; saved before M5 without a count: one earlier acknowledgement');
});

test('ackRepeat: nothing for an alert never acknowledged, or acknowledged since it was asked again', () => {
  assert.equal(ackRepeat({ id: 'n', severity: 'warn', ack: false, action: null }), null, 'new');
  assert.equal(ackRepeat({ id: 'e', severity: 'danger', ack: false, action: null, escalatedAt: iso(1) }), null,
    'raised in severity before any acknowledgement');
  assert.equal(ackRepeat(waiting({ reAlertedAt: iso(1), ack: true })), null, 'acknowledged again since');
  assert.equal(ackRepeat(waiting()), null, 'never asked again');
  assert.equal(ackRepeat(null), null);
});

test('ackPreselect: the shared earlier action when every alert is a repeat; otherwise nothing, never monitoring', () => {
  const fresh = { id: 'z', code: 'decel', severity: 'danger', ack: false, action: null, episode: 1 };
  assert.equal(ackPreselect(undefined), null);
  assert.equal(ackPreselect([]), null);
  assert.equal(ackPreselect([fresh]), null, 'a new alert: no default action');
  assert.equal(ackPreselect([waiting({ reAlertedAt: iso(1), action: 'intervention' })]), 'intervention');
  assert.equal(ackPreselect([waiting({ reAlertedAt: iso(1), action: 'referral' })]), 'referral');
  assert.equal(ackPreselect([
    waiting({ id: 'x', escalatedAt: iso(1), action: 'senior' }),
    waiting({ id: 'y', code: 'htn', reAlertedAt: iso(1), action: 'senior' }),
  ]), 'senior', 'every alert a repeat of the same action');
  assert.equal(ackPreselect([
    waiting({ id: 'x', escalatedAt: iso(1), action: 'monitoring' }),
    waiting({ id: 'y', code: 'htn', reAlertedAt: iso(1), action: 'senior' }),
  ]), null, 'repeats of different actions: one action is written to all, so the midwife picks');
  assert.equal(ackPreselect([waiting({ reAlertedAt: iso(1), action: 'senior' }), fresh]), null,
    'a repeat with a new alert: nothing preselected');
  assert.equal(ackPreselect([waiting({ reAlertedAt: iso(1), action: 'transfer' })]), null,
    'an action no longer offered is not preselected');
});

test('ackPreselect, walk: FHR 175 acknowledged as senior called, then FHR 180 opens a new danger alert - nothing preselected', () => {
  const p = mkPatient();
  applyObservations(p, iso(2), { baby: { fhr: 175 } }, LCG, { by: 'TE' });
  const abn = p.alerts.find(x => x.code === 'fhr_abn');
  acknowledgeAlerts(p, [abn], 'senior', 'TE', iso(1.9));
  const r = applyObservations(p, iso(1.5), { baby: { fhr: 180 } }, LCG, { by: 'TE' });
  assert.deepEqual(r.added.map(a => [a.code, a.severity]), [['fhr_severe', 'danger']]);
  assert.equal(ackRepeat(r.added[0], p.alerts), null, 'another code: not a repeat');
  assert.equal(ackPreselect(r.added, p.alerts), null, 'the dialog starts with no action, not on monitoring');
});

// a case where fhr_abn was acknowledged (episode 1), cleared by a normal reading, then came back (episode 2)
function secondEpisode() {
  const p = mkPatient();
  applyObservations(p, iso(3), { baby: { fhr: 165 } }, LCG, { by: 'TE' });
  const first = p.alerts.find(x => x.code === 'fhr_abn');
  acknowledgeAlerts(p, [first], 'senior', 'TE', iso(2.9));
  applyObservations(p, iso(2.5), { baby: { fhr: 140 } }, LCG, { by: 'TE' });
  const r = applyObservations(p, iso(2), { baby: { fhr: 166 } }, LCG, { by: 'AB' });
  return { p, first, again: r.added };
}

test('ackRepeat: a new episode of a code acknowledged before names that acknowledgement and its own episode', () => {
  const { p, first, again } = secondEpisode();
  assert.equal(first.resolved, true, 'episode 1 closed on the normal reading');
  assert.deepEqual(again.map(a => [a.code, a.episode, a.action]), [['fhr_abn', 2, null]]);
  const [ep2] = again;
  assert.deepEqual(ackRepeat(ep2, p.alerts), { episode: 2, at: iso(2.9), action: 'senior' });
  assert.equal(ackRepeat(ep2), null, 'the earlier episodes are read from the case alerts given');
  assert.equal(ackRepeatText(ep2, p.alerts), `Episode 2 - last acknowledged ${fmtTime(iso(2.9))}: Senior/colleague called`);
  assert.equal(ackPreselect(again, p.alerts), 'senior', 'a new episode counts as a repeat');
  assert.equal(ackPreselect([...again, { id: 'n', code: 'decel', severity: 'danger', ack: false, action: null }], p.alerts), null);

  // episode 3 after episode 2 was acknowledged too: the last acknowledgement of the code
  acknowledgeAlerts(p, again, 'intervention', 'AB', iso(1.9));
  applyObservations(p, iso(1.5), { baby: { fhr: 141 } }, LCG, { by: 'AB' });
  const [ep3] = applyObservations(p, iso(1), { baby: { fhr: 167 } }, LCG, { by: 'AB' }).added;
  assert.deepEqual(ackRepeat(ep3, p.alerts), { episode: 3, at: iso(1.9), action: 'intervention' });
  assert.equal(ackRepeat({ ...ep3, ack: true, action: 'senior' }, p.alerts), null, 'acknowledged since');
  assert.equal(ackRepeat({ ...ep3, code: 'decel' }, p.alerts), null, 'no earlier episode of its own code');
  assert.equal(ackRepeat({ ...ep3, episode: 1 }, p.alerts), null, 'episode 1 has no earlier episode');
});

test('ackRepeatText: a repeat of the same alert keeps its line; the action in the screen language', () => {
  const a = waiting({ reAlertedAt: iso(1), ackCount: 2 });
  assert.equal(ackRepeatText(a), `Repeat 2 - last acknowledged ${fmtTime(iso(1.5))}: Senior/colleague called`);
  assert.equal(ackRepeatText(waiting()), null);
  try {
    setLang('am');
    assert.equal(ackRepeatText(a), t('wz.ack_repeat', { n: 2, time: fmtTime(iso(1.5)), action: t('wz.act_senior') }));
  } finally {
    setLang('en');
  }
});

test('ackItemTag: alerts with the same title are told apart by episode above 1 and by the closing time', () => {
  const at = iso(1.2);
  assert.equal(ackItemTag(waiting({ episode: 1 })), null, 'open, episode 1: nothing to add');
  assert.equal(ackItemTag(waiting()), null, 'saved without an episode number: episode 1');
  assert.equal(ackItemTag(waiting({ episode: 2 })), 'Episode 2');
  assert.equal(ackItemTag(waiting({ resolved: true, resolvedAt: at })), `Closed ${fmtTime(at)}`);
  assert.equal(ackItemTag(waiting({ episode: 3, resolved: true, resolvedAt: at })), `Episode 3 · Closed ${fmtTime(at)}`);
  assert.equal(ackItemTag(waiting({ episode: 3, resolved: true, resolvedAt: at, ack: true })), 'Episode 3',
    'closed and acknowledged: not awaiting acknowledgement');
  assert.equal(ackItemTag(null), null);

  // the walk: closed and re-opened episodes of one code, none acknowledged yet, carry the same title
  const p = mkPatient();
  [[3, 165], [2.5, 140], [2, 165], [1.5, 140], [1, 165]].forEach(([hAgo, fhr]) =>
    applyObservations(p, iso(hAgo), { baby: { fhr } }, LCG, { by: 'TE' }));
  const awaiting = p.alerts.filter(a => !a.ack);
  assert.equal(awaiting.length, 3);
  assert.equal(new Set(awaiting.map(a => a.title)).size, 1, 'the same title three times');
  assert.deepEqual(awaiting.map(ackItemTag),
    [`Closed ${fmtTime(iso(2.5))}`, `Episode 2 · Closed ${fmtTime(iso(1.5))}`, 'Episode 3']);
  try {
    setLang('am');
    assert.equal(ackItemTag(awaiting[1]),
      `${t('wz.ack_item_episode', { n: 2 })} · ${t('wz.ack_item_closed', { time: fmtTime(iso(1.5)) })}`);
  } finally {
    setLang('en');
  }
});

test('acknowledgeAlerts refuses an action that is not offered (none chosen) and changes nothing', () => {
  const p = mkPatient({ alerts: [waiting({ reAlertedAt: iso(1) })] });
  const before = structuredClone(p);
  for (const action of [null, undefined, '', 'transfer']) {
    assert.throws(() => acknowledgeAlerts(p, [p.alerts[0]], action, 'TE', iso(0.9)), { message: t('wz.ack_choose') });
  }
  assert.deepEqual(p, before);
});

test('acknowledgeAlerts counts each acknowledgement and writes a note tagged kind ack; a repeat names the last one', () => {
  const p = mkPatient();
  applyObservations(p, iso(2), { baby: { fhr: 165 } }, LCG, { by: 'TE' });
  const [a] = p.alerts.filter(x => x.code === 'fhr_abn');
  acknowledgeAlerts(p, [a], 'senior', 'TE', iso(1.9));
  assert.deepEqual([a.ack, a.action, a.actionTime, a.ackBy, a.ackCount], [true, 'senior', iso(1.9), 'TE', 1]);
  const note = p.notes.at(-1);
  assert.deepEqual([note.kind, note.by, note.time, note.plan], ['ack', 'TE', iso(1.9), 'senior']);
  assert.match(note.text, /^Alerts acknowledged: /, 'record text stays English');

  const r = applyObservations(p, iso(1.5), { baby: { fhr: 166 } }, LCG, { by: 'AB' });
  assert.deepEqual(r.added, [a], 'asked again by the new abnormal reading');
  assert.deepEqual(ackRepeat(a), { n: 1, at: iso(1.9), action: 'senior' });
  assert.equal(ackPreselect(r.added), 'senior');
  acknowledgeAlerts(p, r.added, 'intervention', 'AB', iso(1.4));
  assert.deepEqual([a.ackCount, a.action, ackRepeat(a)], [2, 'intervention', null]);
  applyObservations(p, iso(1), { baby: { fhr: 167 } }, LCG, { by: 'AB' });
  assert.deepEqual(ackRepeat(a), { n: 2, at: iso(1.4), action: 'intervention' });
  assert.deepEqual(p.notes.map(n => n.kind), ['ack', 'ack']);
});

test('acknowledgeAlerts: matched by id after a restore; an earlier action saved before M5 counts as one', () => {
  const p = mkPatient({ alerts: [waiting({ reAlertedAt: iso(1) })] });
  acknowledgeAlerts(p, [structuredClone(p.alerts[0])], 'monitoring', 'TE', iso(0.9));
  assert.deepEqual([p.alerts[0].ack, p.alerts[0].ackCount, p.alerts[0].actionTime], [true, 2, iso(0.9)]);
});
