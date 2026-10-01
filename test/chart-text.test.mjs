// chart-text.test.mjs - words, not codes, on the chart and in the print
// appendix (M5 browser walk): acknowledgement actions in the plan row and
// risk factors in the header.

import test from 'node:test';
import assert from 'node:assert/strict';
import { chartSVG, printSheetsHTML } from '../js/chart.js';
import { planText } from '../js/partograph.js';
import { NOW, iso, mkPatient, LCG } from './helpers.mjs';

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
