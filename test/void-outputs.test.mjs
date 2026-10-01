// M6: a medication entry or a note voided through the record layer
// (voidMedication, voidNote) leaves every place the record is read as care
// given or decided - the chart on both layouts, the print appendix, the
// referral note and the audit - and the FHIR export sends a voided medicine as
// entered-in-error with who voided it, when and why. Each output is checked
// here rather than assumed, on the stamp the record layer itself writes, with
// the same case not voided as the control.
import test from 'node:test';
import assert from 'node:assert/strict';
import { voidMedication, voidNote } from '../js/record.js';
import { chartSVG, printSheetsHTML } from '../js/chart.js';
import { givenMeds, medLine } from '../js/views/referral.js';
import { auditCase } from '../js/audit.js';
import { buildFHIRBundle } from '../js/fhir.js';
import { PROTOCOLS } from '../js/protocol.js';
import { NOW, iso, mkPatient, LCG, ETH } from './helpers.mjs';

/**
 * A labour in its active first stage with two medicines, an oxytocin start and
 * two notes; with `voided`, one medicine, the oxytocin start and one note are
 * voided as recorded in error.
 */
function recorded(voided = true) {
  const p = mkPatient({ name: 'Almaz', mrn: 'MRN-7', oxytocinRunning: true });
  p.meds.push(
    { id: 'amp', time: iso(3), kind: 'medicine', detail: 'Ampicillin 2 g IV', action: 'given', by: 'TE' },
    { id: 'gen', time: iso(2.5), kind: 'medicine', detail: 'Gentamicin 80 mg IV', action: 'given', by: 'TE' },
    { id: 'oxy', time: iso(2), kind: 'oxytocin', detail: '', oxyUL: 5, oxyDrops: 20, action: 'start', by: 'AB' },
  );
  p.notes.push(
    { id: 'keep', time: iso(2.2), by: 'TE', text: 'Progress normal', plan: 'Reassess in 4 h' },
    { id: 'gone', time: iso(1.8), by: 'TE', text: 'Membranes ruptured, fluid clear', plan: 'Wrong-case plan' },
  );
  if (voided) {
    voidMedication(p, 'gen', LCG, { by: 'AB', reason: 'given to another woman', at: iso(1) });
    voidMedication(p, 'oxy', LCG, { by: 'AB', reason: 'never started', at: iso(1) });
    voidNote(p, 'gone', { by: 'AB', reason: 'written on the wrong case', at: iso(1) });
  }
  return p;
}

const oxytocinLabel = /class="oxy"[^>]*>5\/20</;

test('M6: the chart leaves out a voided medicine, a voided oxytocin record and a voided note, on both layouts', () => {
  const lcg = p => chartSVG(p, LCG, NOW).svg;
  const eth = p => chartSVG(p, ETH, NOW).svg;
  const before = recorded(false), after = recorded();
  for (const svg of [lcg, eth]) {
    assert.ok(svg(before).includes('Gentamicin') && svg(after).includes('Ampicillin'), 'drawn while it stands');
    assert.ok(!svg(after).includes('Gentamicin'), 'a voided medicine is drawn nowhere');
  }
  assert.match(lcg(before), oxytocinLabel);
  assert.doesNotMatch(lcg(after), oxytocinLabel, 'the LCG oxytocin row');
  assert.ok(eth(before).includes('>oxytocin<') && !eth(after).includes('>oxytocin<'), 'the partograph oxytocin row');
  // the assessment and plan rows (F13)
  assert.ok(lcg(before).includes('Membranes ruptured') && lcg(before).includes('Wrong-case plan'));
  assert.ok(lcg(after).includes('Progress normal') && lcg(after).includes('Reassess in 4 h'));
  assert.ok(!lcg(after).includes('Membranes ruptured') && !lcg(after).includes('Wrong-case plan'));
});

test('M6: the print appendix writes out the medicine and the note that stand, never the voided ones', () => {
  for (const settings of [LCG, ETH]) {
    const html = printSheetsHTML(recorded(), settings, NOW);
    const appendix = html.slice(html.indexOf('<section class="print-notes">'));
    assert.ok(appendix.includes('<td>Ampicillin 2 g IV</td>') && appendix.includes('<td>Progress normal</td>'));
    for (const gone of ['Gentamicin', '5 U/L', 'Membranes ruptured', 'Wrong-case plan']) assert.ok(!html.includes(gone), gone);
    assert.ok(printSheetsHTML(recorded(false), settings, NOW).includes('Gentamicin 80 mg IV'), 'printed while it stands');
  }
});

test('M6: the referral note lists the medicine that stands, not the voided medicine or oxytocin', () => {
  assert.deepEqual(givenMeds(recorded()).map(medLine), ['Medicine: Ampicillin 2 g IV']);
  assert.deepEqual(givenMeds(recorded(false)).map(m => m.id), ['amp', 'gen', 'oxy']);
});

test('M6: the audit counts a voided note as no decision, a voided oxytocin record as no infusion, an unsigned voided entry not at all', () => {
  // 2 h of active first stage ended by the birth: two hourly columns
  const start = +NOW - 5 * 3600000;
  const at = m => new Date(start + m * 60000).toISOString();
  const p = mkPatient({
    name: 'Audit', para: 0, onsetMode: 'spontaneous', protocolId: 'lcg', status: 'delivered',
    activeStartTime: at(0), delivery: { time: at(120), outcome: 'live', mode: 'svd' },
  });
  p.notes.push(
    { id: 'n0', time: at(10), by: 'TE', text: 'Progress normal', plan: 'Routine monitoring' },
    { id: 'n1', time: at(70), by: 'TE', text: 'Written on the wrong case', plan: 'x' },
  );
  p.meds.push(
    { id: 'ox', time: at(0), kind: 'oxytocin', oxyDrops: 10, action: 'start', by: 'TE' },
    { id: 'pcm', time: at(100), kind: 'medicine', detail: 'Paracetamol 1 g', action: 'given', by: null },
  );
  let a = auditCase(p, PROTOCOLS.lcg, NOW);
  assert.deepEqual([a.sections.decisions.met, a.sections.decisions.windows], [2, 2]);
  assert.ok(a.sections.medication, 'oxytocin ran: the medication row applies');
  assert.deepEqual([a.sections.initials.met, a.sections.initials.windows], [1, 2], 'the unsigned medicine');
  voidNote(p, 'n1', { by: 'AB', reason: 'written on the wrong case' });
  voidMedication(p, 'ox', LCG, { by: 'AB', reason: 'never started' });
  voidMedication(p, 'pcm', LCG, { by: 'AB', reason: 'recorded on the wrong woman' });
  a = auditCase(p, PROTOCOLS.lcg, NOW);
  assert.deepEqual([a.sections.decisions.met, a.sections.decisions.windows], [1, 2]);
  assert.equal(a.sections.medication, null, 'no infusion stands: not applicable');
  assert.deepEqual([a.sections.initials.met, a.sections.initials.windows], [1, 1]);
});

test('M6: the FHIR export sends a voided medicine as entered-in-error with who voided it, when and why', () => {
  const b = buildFHIRBundle(recorded(), { facilityName: 'Test HC' }, { now: NOW });
  const admin = id => b.entry.map(e => e.resource)
    .find(r => r.resourceType === 'MedicationAdministration' && r.identifier[0].value === `tst/med:${id}`);
  assert.equal(admin('amp').status, 'completed');
  for (const [id, reason] of [['gen', 'given to another woman'], ['oxy', 'never started']]) {
    const r = admin(id);
    assert.equal(r.status, 'entered-in-error', id);
    assert.deepEqual(r.note[0], { authorString: 'AB', time: iso(1), text: `Entered in error (voided): ${reason}` }, id);
  }
  // notes are not part of the export, voided or not
  assert.ok(!JSON.stringify(b).includes('Membranes ruptured'));
});
