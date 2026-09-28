// test/smoke.mjs — logic smoke tests (no browser needed).
// Run: node test/smoke.mjs
import { toEthiopic, fromEthiopic, formatEthiopic } from '../js/ethiopic.js';
import { PROTOCOLS, getProtocol, dueList, lineStatus, stageOf } from '../js/protocol.js';
import { evaluateObs, evaluateTime } from '../js/alerts.js';
import { buildFHIRBundle } from '../js/fhir.js';

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.error('  ✗ FAIL:', name); }
}

console.log('— Ethiopian calendar —');
{
  const e = toEthiopic(new Date(2023, 8, 12)); // 12 Sep 2023 = Meskerem 1, 2016 EC
  ok(e.year === 2016 && e.month === 1 && e.day === 1, `2023-09-12 → ${e.year}-${e.month}-${e.day} (expect 2016-1-1)`);
  const e2 = toEthiopic(new Date(2024, 8, 11)); // 11 Sep 2024 = Meskerem 1, 2017 EC
  ok(e2.year === 2017 && e2.month === 1 && e2.day === 1, `2024-09-11 → ${e2.year}-${e2.month}-${e2.day} (expect 2017-1-1)`);
  const g = fromEthiopic(2016, 1, 1);
  ok(g.getFullYear() === 2023 && g.getMonth() === 8 && g.getDate() === 12, 'roundtrip 2016-1-1 EC → 2023-09-12');
  const today = new Date();
  const rt = fromEthiopic(...Object.values(toEthiopic(today)));
  ok(rt.toDateString() === today.toDateString(), 'today roundtrip: ' + formatEthiopic(today));
}

console.log('— Protocol engine —');
const NOW = new Date('2026-06-12T10:00:00');
const iso = (hAgo) => new Date(+NOW - hAgo * 3600000).toISOString();

function mkPatient(extra = {}) {
  return Object.assign({
    id: 'tst', createdAt: iso(6), name: 'Test', gravida: 1, para: 0,
    admission: { time: iso(6) },
    status: 'active', activeStartTime: iso(5), secondStageStart: null,
    obs: [], meds: [], alerts: [], notes: [], oxytocinRunning: false,
  }, extra);
}

{
  const settings = { protocol: 'lcg' };
  const p = mkPatient();
  p.obs.push({ id: '1', type: 'baby', time: iso(1), v: { fhr: 140 } });
  const due = dueList(p, getProtocol(settings, p), NOW);
  const baby = due.find(d => d.type === 'baby');
  ok(baby && baby.state === 'overdue', `FHR q30min → overdue after 60 min (got ${baby && baby.state})`);
  const exam = due.find(d => d.type === 'exam');
  ok(exam && exam.state === 'overdue', 'exam q4h → overdue after 5 h with no exam');
}

{
  // Ethiopian alert/action lines: active start 4 cm at t-5h; now 6 cm → expected 9 cm → alert; below action?
  const settings = { protocol: 'ethiopia2021' };
  const p = mkPatient();
  const proto = getProtocol(settings, p);
  ok(proto.activeStartCm === 4, 'ethiopia2021 active phase starts at 4 cm');
  ok(lineStatus(proto, p, 9, NOW.toISOString()) === 'left', '9 cm at +5h → left of alert line');
  ok(lineStatus(proto, p, 6, NOW.toISOString()) === 'alert', '6 cm at +5h → crossed alert line');
  ok(lineStatus(proto, p, 4, NOW.toISOString()) === 'action', '4 cm at +5h → crossed action line');
}

console.log('— Alert engine —');
{
  const settings = { protocol: 'lcg' };
  const p = mkPatient();
  const a1 = evaluateObs(p, { type: 'baby', time: iso(0), v: { fhr: 96 } }, settings);
  ok(a1.some(a => a.code === 'fhr_severe' && a.severity === 'danger'), 'FHR 96 → severe danger alert');
  const a2 = evaluateObs(p, { type: 'baby', time: iso(0), v: { fhr: 165, decel: 'late' } }, settings);
  ok(a2.some(a => a.code === 'fhr_abn') && a2.some(a => a.code === 'decel'), 'FHR 165 + late decels → two alerts');
  const a3 = evaluateObs(p, { type: 'vitals', time: iso(0), v: { sys: 168, dia: 112 } }, settings);
  ok(a3.some(a => a.code === 'htn_severe' && a.advice.join(' ').includes('MgSO₄')), 'BP 168/112 → severe HTN with MgSO4 advice');
  const a4 = evaluateObs(p, { type: 'contractions', time: iso(0), v: { count: 6, duration: 70 } }, settings);
  ok(a4.some(a => a.code === 'tachysystole'), '6 contractions/10min → tachysystole');
  const a5 = evaluateObs(p, { type: 'exam', time: iso(0), v: { dilatation: 6, moulding: 3 } }, settings);
  ok(a5.some(a => a.code === 'moulding3'), 'moulding +++ → obstruction danger');
}

{
  // LCG dilatation stagnation: 6 cm reached 5.5 h ago, still 6 cm now (limit 5 h)
  const settings = { protocol: 'lcg' };
  const p = mkPatient({ activeStartTime: iso(6) });
  p.obs.push({ id: 'e1', type: 'exam', time: iso(5.5), v: { dilatation: 6 } });
  const drafts = evaluateObs(p, { type: 'exam', time: iso(0), v: { dilatation: 6 } }, settings);
  // note: evaluateObs checks against current obs list; push the new exam first as the app does
  p.obs.push({ id: 'e2', type: 'exam', time: iso(0), v: { dilatation: 6 } });
  const drafts2 = evaluateObs(p, { type: 'exam', time: iso(0), v: { dilatation: 6, _pushed: true } }, settings);
  ok(drafts2.some(a => a.code === 'lcg_progress'), 'LCG: 6 cm for 5.5 h (limit 5 h) → progress danger');
  const timeAlerts = evaluateTime(p, settings, NOW);
  ok(timeAlerts.some(a => a.code === 'lcg_progress_due'), 'LCG time-based: progress limit reached → exam prompt');
}

{
  // second stage duration (nullipara): warn at 2 h, danger at 3 h (LCG)
  const settings = { protocol: 'lcg' };
  const p = mkPatient({ status: 'second', secondStageStart: iso(2.5) });
  const t1 = evaluateTime(p, settings, NOW);
  ok(t1.some(a => a.code === 'second_warn'), '2nd stage 2.5 h nullipara → warn');
  const p2 = mkPatient({ status: 'second', secondStageStart: iso(3.2) });
  const t2 = evaluateTime(p2, settings, NOW);
  ok(t2.some(a => a.code === 'second_long' && a.severity === 'danger'), '2nd stage 3.2 h nullipara → danger');
  const p3 = mkPatient({ status: 'second', secondStageStart: iso(2.5), para: 2 });
  const t3 = evaluateTime(p3, settings, NOW);
  ok(t3.some(a => a.code === 'second_long'), '2nd stage 2.5 h multipara → danger (limit 2 h)');
}

{
  // prolonged ROM
  const settings = { protocol: 'lcg' };
  const p = mkPatient({ romTime: iso(19) });
  const t1 = evaluateTime(p, settings, NOW);
  ok(t1.some(a => a.code === 'prom_long'), 'ROM 19 h → prolonged ROM warning');
}

console.log('— FHIR export —');
{
  const p = mkPatient();
  p.obs.push(
    { id: 'o1', type: 'baby', time: iso(1), v: { fhr: 140 } },
    { id: 'o2', type: 'exam', time: iso(1), v: { dilatation: 6, descent: 3, moulding: 1 } },
    { id: 'o3', type: 'vitals', time: iso(1), v: { sys: 120, dia: 80, temp: 36.9 } },
    { id: 'o4', type: 'contractions', time: iso(1), v: { count: 3, duration: 30 } },
  );
  p.delivery = { time: iso(0), mode: 'svd', outcome: 'live', eblMl: 200, placentaComplete: 'Y' };
  p.newborn = { sex: 'F', weightG: 3200, apgar1: { total: 8 }, apgar5: { total: 9 } };
  p.referral = null;
  const b = buildFHIRBundle(p, { facilityName: 'Test HC' });
  ok(b.resourceType === 'Bundle' && b.entry.length > 8, `bundle has ${b.entry.length} entries`);
  const types = b.entry.map(e => e.resource.resourceType);
  ok(types.includes('Patient') && types.includes('Encounter') && types.includes('Observation'), 'has Patient/Encounter/Observation');
  const fhr = b.entry.find(e => e.resource.code && e.resource.code.coding && e.resource.code.coding[0].code === '55283-6');
  ok(!!fhr, 'FHR observation uses LOINC 55283-6');
  const apgar5 = b.entry.find(e => e.resource.code && e.resource.code.coding && e.resource.code.coding[0].code === '9274-2');
  ok(apgar5 && apgar5.resource.valueQuantity.value === 9, 'APGAR-5 uses LOINC 9274-2 with value 9');
  const bp = b.entry.find(e => e.resource.code && e.resource.code.coding && e.resource.code.coding[0].code === '85354-9');
  ok(bp && bp.resource.component.length === 2, 'BP panel 85354-9 with 2 components');
  ok(JSON.stringify(b).length > 1000, 'bundle serialises');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
