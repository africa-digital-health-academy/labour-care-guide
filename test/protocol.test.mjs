import test from 'node:test';
import assert from 'node:assert/strict';
import { getProtocol, dueList, lineStatus } from '../js/protocol.js';
import { NOW, iso, mkPatient } from './helpers.mjs';

test('LCG: FHR every 30 min is overdue after 60 min; exam every 4 h is overdue after 5 h', () => {
  const settings = { protocol: 'lcg' };
  const p = mkPatient();
  p.obs.push({ id: '1', type: 'baby', time: iso(1), v: { fhr: 140 } });
  const due = dueList(p, getProtocol(settings, p), NOW);
  assert.equal(due.find(d => d.type === 'baby').state, 'overdue');
  assert.equal(due.find(d => d.type === 'exam').state, 'overdue');
});

test('LCG: nothing is due right after a full set of observations', () => {
  const settings = { protocol: 'lcg' };
  const p = mkPatient();
  for (const type of ['baby', 'contractions', 'pulse', 'vitals', 'exam', 'supportive']) {
    p.obs.push({ id: type, type, time: iso(0), v: {} });
  }
  const due = dueList(p, getProtocol(settings, p), NOW);
  assert.ok(due.every(d => d.state === 'ok'), JSON.stringify(due));
});

test('ethiopia2021: active phase at 4 cm and alert/action line geometry', () => {
  const settings = { protocol: 'ethiopia2021' };
  const p = mkPatient();
  const proto = getProtocol(settings, p);
  assert.equal(proto.activeStartCm, 4);
  assert.equal(lineStatus(proto, p, 9, NOW.toISOString()), 'left');
  assert.equal(lineStatus(proto, p, 6, NOW.toISOString()), 'alert');
  assert.equal(lineStatus(proto, p, 4, NOW.toISOString()), 'action');
});

test('unknown protocol id falls back to LCG', () => {
  assert.equal(getProtocol({ protocol: 'nope' }, mkPatient()).id, 'lcg');
});

test('getProtocol prefers patient.protocolId over the live settings.protocol (S2: a later Settings change must not retroactively change a case already in progress)', () => {
  const settings = { protocol: 'ethiopia2021' };
  const p = mkPatient({ protocolId: 'lcg' });
  assert.equal(getProtocol(settings, p).id, 'lcg');
});

test('getProtocol falls back to protocolOverride when protocolId is absent, then to settings.protocol', () => {
  const settings = { protocol: 'ethiopia2021' };
  assert.equal(getProtocol(settings, mkPatient({ protocolOverride: 'lcg' })).id, 'lcg');
  assert.equal(getProtocol(settings, mkPatient()).id, 'ethiopia2021');
});
