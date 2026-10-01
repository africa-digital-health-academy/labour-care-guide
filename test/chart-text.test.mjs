// chart-text.test.mjs - words, not codes, on the chart and in the print
// appendix (M5 browser walk): acknowledgement actions in the plan row and
// risk factors in the header.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chartSVG, printSheetsHTML } from '../js/chart.js';
import { planText, flagState, urineText } from '../js/partograph.js';
import { NOW, iso, mkPatient, LCG, ETH } from './helpers.mjs';
import { applyObservations } from '../js/record.js';

test('planText: an acknowledgement action code is written in words', () => {
  assert.equal(planText({ kind: 'ack', text: 'Alerts acknowledged: FHR 170', plan: 'senior' }), 'Senior/colleague called');
  assert.equal(planText({ kind: 'ack', text: 'Alerts acknowledged: x', plan: 'monitoring' }), 'Continue close monitoring');
  // saved before M5: no kind, recognised by its opening words
  assert.equal(planText({ text: 'Alerts acknowledged: x', plan: 'referral' }), 'Referral started');
});

test('planText: a typed plan is written as typed, even when it is a code word', () => {
  assert.equal(planText({ text: 'Progress normal', plan: 'senior' }), 'senior');
  assert.equal(planText({ text: 'Progress normal', plan: 'Reassess in 4 h' }), 'Reassess in 4 h');
  assert.equal(planText({ kind: 'ack', text: 'Alerts acknowledged: x', plan: 'something new' }), 'something new');
  assert.equal(planText({ text: 'x' }), '');
  assert.equal(planText(null), '');
});

test('the chart plan row and the print appendix write the action in words', () => {
  const p = mkPatient({ riskFactors: ['prior_cs', 'anaemia'] });
  p.notes = [{ id: 'n1', time: iso(1), by: 'TE', kind: 'ack', text: 'Alerts acknowledged: FHR 170', plan: 'senior' }];
  const svg = chartSVG(p, LCG, NOW).svg;
  assert.ok(svg.includes('Senior/colleague called'), 'plan row in words');
  assert.ok(!/>senior</.test(svg), 'no bare code in the plan row');
  const html = printSheetsHTML(p, LCG, NOW);
  assert.ok(html.includes('Senior/colleague called'), 'print appendix in words');
});

test('the chart header writes risk factors in words', () => {
  const p = mkPatient({ riskFactors: ['prior_cs', 'anaemia', 'unknown_code'] });
  const svg = chartSVG(p, LCG, NOW).svg;
  assert.ok(svg.includes('Risk factors: Previous CS, Anaemia, unknown code'), 'short words, and an unknown code still readable');
  assert.ok(!svg.includes('prior cs') && !svg.includes('prior_cs'));
  // every risk code the admission form offers has a short label
  const all = ['prior_cs', 'grand_multi', 'multiple', 'malpresentation', 'aph', 'preeclampsia', 'anaemia', 'diabetes', 'hiv', 'young', 'short', 'preterm'];
  const full = chartSVG(mkPatient({ riskFactors: all.slice(0, 3) }), LCG, NOW).svg;
  assert.ok(full.includes('Previous CS, Grand multipara, Multiple pregnancy'));
});

const RED_BAR = /width="12" height="[^"]*" fill="[^"]*" stroke="#c62828"/;
const ANY_BAR = /width="12" height="[^"]*" fill="[^"]*" stroke="/;

test('Ethiopian partograph: a contraction bar is red only where the engine raised a contraction alert', () => {
  const latent = mkPatient({ activeStartTime: null });
  applyObservations(latent, iso(1), { contractions: { count: 1, durBand: 'lt20' } }, ETH);
  assert.deepEqual(latent.obs[0].flags || [], [], 'no contraction alert in the latent phase');
  const s1 = chartSVG(latent, ETH, NOW).svg;
  assert.ok(ANY_BAR.test(s1), 'the bar is drawn');
  assert.ok(!RED_BAR.test(s1), 'latent: not red');
  const active = mkPatient();
  applyObservations(active, iso(1), { contractions: { count: 1, durBand: 'lt20' } }, ETH);
  assert.ok((active.obs[0].flags || []).length > 0, 'active labour: flagged');
  assert.ok(RED_BAR.test(chartSVG(active, ETH, NOW).svg), 'active: red');
  // a v1 entry without stored flags keeps the value test
  delete active.obs[0].flags;
  assert.ok(RED_BAR.test(chartSVG(active, ETH, NOW).svg));
});

test('the chart header line starts beside the title column, never under it', () => {
  const svg = chartSVG(mkPatient({ riskFactors: ['prior_cs'] }), LCG, NOW).svg;
  const m = svg.match(/<text x="([0-9.]+)" y="11"[^>]*>Parity /);
  assert.ok(m, 'header line found');
  assert.ok(Number(m[1]) >= 160, 'starts at the time grid (x ' + m[1] + '), clear of the title column');
});

test('flagState: an alert closed when raised (needsAck false) draws its value as handled, never as a red circle forever', () => {
  const o = { id: 'o1', time: iso(3) };
  const quiet = new Map([['o1', [{ code: 'fhr_abn', needsAck: false }]]]);
  assert.equal(flagState(quiet, o, 'fhr'), 'ack');
  const open = new Map([['o1', [{ code: 'fhr_abn' }]]]);
  assert.equal(flagState(open, o, 'fhr'), 'open', 'an ordinary unacknowledged alert stays red');
});

test('urineText writes one notation whatever was stored, and never reads an ungradable value as negative', () => {
  assert.equal(urineText('++'), '++');
  assert.equal(urineText('P++'), '++', 'no double P on the chart');
  assert.equal(urineText('2+'), '++');
  assert.equal(urineText('neg'), '-');
  assert.equal(urineText('trace'), 'tr');
  assert.equal(urineText('xyz'), '?');
});

test('Ethiopian partograph: an ungradable urine value is written P? / A?, as on the LCG chart - never dropped, never under a tick', () => {
  const p = mkPatient();
  // a v1 entry kept "urine passed" (urineVoided) beside its dipstick reading
  p.obs.push({ id: 'u1', type: 'vitals', time: iso(4), v: { sys: 120, dia: 80, protein: 'pos', acetone: 'neg', urineVoided: true } });
  p.obs.push({ id: 'u2', type: 'vitals', time: iso(2), v: { sys: 118, dia: 78, acetone: 'xyz' } });
  p.obs.push({ id: 'u3', type: 'vitals', time: iso(1), v: { sys: 118, dia: 78, protein: 'neg', urineVoided: true } });
  p.obs.push({ id: 'u4', type: 'vitals', time: iso(0.5), v: { sys: 118, dia: 78, protein: 'P++', acetone: 'A 1+' } });
  const svg = chartSVG(p, ETH, NOW).svg;
  // the urine row's value cells (centred; the row label at the same height is not)
  const urineRow = [...svg.matchAll(/<text [^>]*y="761"[^>]*text-anchor="middle"[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);
  assert.deepEqual(urineRow, ['P?', 'A?', '✓', 'P++ A+'], 'not assessed is shown as such; a negative with urine passed keeps its tick');
  assert.equal((svg.match(/<ellipse class="flag-circle/g) || []).length, 1, 'only P++ is circled: ? is never an alert value');
  const lcg = chartSVG(p, LCG, NOW).svg;
  assert.ok(lcg.includes('>P?<') && lcg.includes('>A?<'), 'the LCG chart writes the same');
});
