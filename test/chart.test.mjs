// Chart split (M2): chartSVG() is pure, never draws voided entries, and draws
// the Ethiopian alert line from the first active dilatation (S7).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chartSVG } from '../js/chart.js';
import { NOW, iso, mkPatient, LCG, ETH } from './helpers.mjs';

test('chartSVG is pure and renders in Node', () => {
  const p = mkPatient();
  p.obs.push({ id: 'b1', type: 'baby', time: iso(1), v: { fhr: 150 } });
  const { svg, width, height, legend } = chartSVG(p, LCG, NOW);
  assert.match(svg, /^<svg/);
  assert.ok(width > 0 && height > 0);
  assert.match(legend, /LCG progress time-limit/);
});

test('voided entries are not drawn', () => {
  const p = mkPatient();
  p.obs.push({ id: 'b1', type: 'baby', time: iso(1), v: { fhr: 150 } });
  p.obs.push({ id: 'b2', type: 'baby', time: iso(0.5), v: { fhr: 175 }, voided: { at: iso(0.4), by: 'TE', reason: 'typo' } });
  const abnormalMarker = 'r="5" fill="#fff"';
  assert.ok(!chartSVG(p, LCG, NOW).svg.includes(abnormalMarker));
  delete p.obs[1].voided;
  assert.ok(chartSVG(p, LCG, NOW).svg.includes(abnormalMarker));
});

test('S7: the Ethiopian alert line starts at the admission dilatation (7 cm), not at 4 cm', () => {
  const p = mkPatient({ activeStartTime: iso(6), admission: { time: iso(6), dilatation: 7 } });
  p.obs.push({ id: 'e0', type: 'exam', time: iso(6), v: { dilatation: 7 } });
  const { svg } = chartSVG(p, ETH, NOW);
  // x = the admission column (gutter 118 px); y = the 7 cm row of the cervicograph
  assert.ok(svg.includes('class="alert-line" x1="118" y1="310"'), svg.match(/class="alert-line"[^>]*/)[0]);
});
