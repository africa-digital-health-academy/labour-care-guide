// Schedules: oxytocin from infusion start (F10), postpartum watch (N4),
// referred women still monitored (S8), parity keys (S12).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProtocol, dueList, isLabouring, monitoringStage, parityKey, byParity, inPostpartumWatch, scheduleFor, PROTOCOLS,
} from '../js/protocol.js';
import { evaluateTime } from '../js/alerts.js';
import { NOW, iso, mkPatient, LCG, ETH, codes } from './helpers.mjs';

const due = (p, settings, now = NOW) => dueList(p, getProtocol(settings, p), now);
const item = (list, type) => list.find(d => d.type === type);

test('F10: oxytocin is due 60 min after the infusion starts (LCG), not at once', () => {
  const p = mkPatient({ oxytocinRunning: true, meds: [{ id: 'm1', kind: 'oxytocin', time: iso(0.5), action: 'start' }] });
  const d = item(due(p, LCG), 'oxytocin');
  assert.equal(d.intervalMin, 60);
  assert.equal(d.state, 'ok');
  assert.equal(d.dueAt, iso(-0.5));
  assert.equal(item(due(p, LCG, new Date(+NOW + 45 * 60000)), 'oxytocin').state, 'overdue');
});

test('F10: each dose record restarts the oxytocin clock; the partograph checks every 30 min', () => {
  const p = mkPatient({ oxytocinRunning: true, meds: [{ id: 'm1', kind: 'oxytocin', time: iso(2), action: 'start' }] });
  p.obs.push({ id: 'o1', type: 'oxytocin', time: iso(0.25), v: { dropsMin: 20 } });
  assert.equal(item(due(p, LCG), 'oxytocin').state, 'ok');
  assert.equal(item(due(p, ETH), 'oxytocin').intervalMin, 30);
});

test('F10: no oxytocin item once the infusion is stopped', () => {
  const p = mkPatient({ oxytocinRunning: false, meds: [{ id: 'm1', kind: 'oxytocin', time: iso(2) }, { id: 'm2', kind: 'oxytocin', time: iso(1), action: 'stop' }] });
  assert.equal(item(due(p, LCG), 'oxytocin'), undefined);
});

function delivered(minAgo, extra = {}) {
  const time = new Date(+NOW - minAgo * 60000).toISOString();
  return mkPatient({ status: 'delivered', delivery: { time, outcome: 'live', ppVitals: {} }, ...extra });
}
const minAgo = m => new Date(+NOW - m * 60000).toISOString();

test('N4: the watch starts at birth - mother and baby every 15 min, BP shortly after birth, urine by 6 h', () => {
  const list = due(delivered(20), LCG);
  assert.equal(item(list, 'ppMother').intervalMin, 15);
  assert.equal(item(list, 'ppMother').state, 'due');
  assert.equal(item(list, 'ppBaby').state, 'due');
  assert.equal(item(list, 'ppBP').state, 'due');
  assert.equal(item(list, 'ppVoid').state, 'ok');
});

test('N4: checks become hourly from 2 h and four-hourly from 6 h; the watch ends at 24 h', () => {
  const mid = delivered(180);
  mid.obs.push({ id: 'pm', type: 'ppMother', time: minAgo(10), v: { bleeding: 'normal' } });
  assert.equal(item(due(mid, LCG), 'ppMother').intervalMin, 60);
  const late = delivered(480);
  late.obs.push({ id: 'pm', type: 'ppMother', time: minAgo(30), v: { bleeding: 'normal' } });
  assert.equal(item(due(late, LCG), 'ppMother').intervalMin, 240);
  const over = delivered(25 * 60);
  assert.equal(inPostpartumWatch(over, NOW), false);
  assert.deepEqual(due(over, LCG), []);
});

test('N4: the second BP is due within 6 h once the first is taken, and no BP item after two', () => {
  const one = delivered(60, {});
  one.delivery.ppVitals = { sys: 110, dia: 70, pulse: 80 };
  assert.equal(item(due(one, LCG), 'ppBP').intervalMin, 360);
  one.obs.push({ id: 'pm', type: 'ppMother', time: minAgo(10), v: { sys: 112, dia: 72 } });
  assert.equal(item(due(one, LCG), 'ppBP'), undefined);
});

test('N4: urine passed removes the 6-hour void item', () => {
  const p = delivered(90);
  p.obs.push({ id: 'pm', type: 'ppMother', time: minAgo(20), v: { urinePassed: 'Y' } });
  assert.equal(item(due(p, LCG), 'ppVoid'), undefined);
  assert.deepEqual(Object.keys(scheduleFor(p, PROTOCOLS.lcg, NOW)).sort(), ['ppBaby', 'ppMother']);
});

test('S8: a woman referred in labour keeps her stage schedule and time alerts until handover', () => {
  const p = mkPatient({ status: 'referred', referral: { time: iso(1) }, secondStageStart: iso(3.5) });
  assert.equal(isLabouring(p), true);
  assert.equal(monitoringStage(p), 'second');
  assert.equal(item(due(p, LCG), 'baby').intervalMin, 5);
  assert.ok(codes(evaluateTime(p, LCG, NOW)).includes('second_long'));
  p.referral.handoverAt = iso(0.5);
  assert.equal(isLabouring(p), false);
  assert.deepEqual(evaluateTime(p, LCG, NOW), []);
});

test('S12: parity keys and the stricter limit for unknown parity', () => {
  assert.equal(parityKey({ para: 0 }), 'nulli');
  assert.equal(parityKey({ para: '2' }), 'multi');
  assert.equal(parityKey({ para: null }), 'unknown');
  assert.equal(parityKey({}), 'unknown');
  assert.equal(parityKey({ para: 'x' }), 'unknown');
  assert.equal(byParity({ nulli: 12, multi: 10 }, 'unknown'), 10);
  assert.equal(byParity({ nulli: 180, multi: 120 }, 'nulli'), 180);
});
