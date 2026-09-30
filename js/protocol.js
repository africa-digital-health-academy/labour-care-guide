// protocol.js - clinical protocol engine: stages, schedules, limits.
//
// Two protocols; each case keeps the one it was admitted under (protocolId,
// stamped at admission since M1):
//
//  1. 'lcg'          WHO Labour Care Guide (2020), the default. Active first
//                    stage from 5 cm; per-centimetre lag limits instead of
//                    alert/action lines. Sources (local copies in _sources/):
//                    the LCG form; the WHO LCG user's manual (2020), Tables
//                    2-8; the WHO 2018 intrapartum recommendations reproduced
//                    in the manual's annex (cited below as "rec N").
//  2. 'ethiopia2021' Ethiopian modified WHO partograph (MOH Obstetrics
//                    Management Protocol for Health Centers, 2021), kept as a
//                    legacy option: active phase from 4 cm, alert line at
//                    1 cm/h, action line 4 h to its right.
//
// Every clinical threshold lives here or in alerts.js, never in the views
// (S13), so a guideline change is a one-file review. Values marked
// PANEL-TO-CONFIRM are placeholders the Ethiopian obstetric and midwifery
// panel must confirm before facility use.
//
// Everything here is pure over the case object except deriveStage(), which
// rewrites the stage fields of the case it is given.

export const PROTOCOLS = {
  lcg: {
    id: 'lcg',
    name: 'WHO Labour Care Guide (2020)',
    activeStartCm: 5,                              // rec 5; the LCG form starts at 5 cm
    // routine assessment intervals in minutes (they drive the due chips)
    schedules: {
      // The LCG starts at 5 cm. Latent care follows the national latent-phase
      // rule kept from v1 (F11); these are not WHO LCG intervals.
      latent: { baby: 60, contractions: 60, pulse: 240, vitals: 240, exam: 240, supportive: 60 },
      // manual Tables 3-6: FHR and contractions every 30 min, supportive care
      // hourly, pulse, BP, temperature, urine and vaginal exam every 4 h
      active: { baby: 30, contractions: 30, pulse: 240, vitals: 240, exam: 240, supportive: 60 },
      // manual Tables 4 and 6: FHR every 5 min, contractions at least every 15 min
      second: { baby: 5, contractions: 15, pulse: 60, vitals: 60, exam: null, supportive: 60 },
    },
    // What the paper form records per column, used by the audit (IRP Annex 8).
    // Second-stage cells are 15 min wide: "record the most clinically
    // significant value within the 15 minute timeframe" (manual Table 4).
    recording: {
      active: { supportive: 60, baby: 30, contractions: 30, pulse: 240, vitals: 240, exam: 240 },
      second: { supportive: 60, baby: 15, contractions: 15 },
    },
    oxytocinCheckMin: 60,                          // manual Table 7: dose recorded every 60 min while it runs (F10)
    dilatationLagMin: { 5: 360, 6: 300, 7: 180, 8: 150, 9: 120 },   // form alert column; manual Table 6
    alertActionLines: false,
    latentMaxHours: 8,                             // national latent-care rule; WHO sets no latent limit (rec 6) (F11)
    activeMaxHours: { nulli: 12, multi: 10 },      // rec 6 (F5)
    // manual Table 6: the second-stage limit counts from the start of the
    // ACTIVE second stage, marked P on the form when pushing begins (F2)
    secondStageClock: 'pushing',
    secondStagePassiveMaxMin: null,                // PANEL-TO-CONFIRM: WHO sets no passive-stage limit; null keeps this alert off
    secondStageWarnMin: { nulli: 120, multi: 60 }, // early warning kept from v1; not a WHO alert value
    secondStageLimitMin: { nulli: 180, multi: 120 }, // manual Table 6: >=3 h nulliparous, >=2 h multiparous; rec 33
  },
  ethiopia2021: {
    id: 'ethiopia2021',
    name: 'Ethiopian modified WHO partograph (MOH 2021)',
    activeStartCm: 4,
    schedules: {
      latent: { baby: 60, contractions: 60, pulse: 60, vitals: 240, exam: 240, supportive: 60 },
      active: { baby: 30, contractions: 30, pulse: 30, vitals: 240, exam: 240, supportive: 60 },
      second: { baby: 5, contractions: 15, pulse: 30, vitals: 60, exam: null, supportive: 60 },
    },
    recording: null,                               // the audit falls back to the schedules
    oxytocinCheckMin: 30,                          // partograph: oxytocin recorded every 30 min
    alertActionLines: true,                        // alert line 1 cm/h; action line 4 h to its right
    actionLineOffsetHours: 4,
    dilatationLagMin: null,
    latentMaxHours: 8,
    activeMaxHours: { nulli: 12, multi: 12 },      // v1 value kept for the legacy protocol
    secondStageClock: 'full',                      // the partograph times the second stage from full dilatation
    secondStagePassiveMaxMin: null,
    secondStageWarnMin: { nulli: 60, multi: 30 },
    secondStageLimitMin: { nulli: 120, multi: 60 },
  },
};

// Thresholds shared by both protocols. Unless noted, they are the "Alert"
// column of the LCG form (manual Tables 3-6); the severe tiers are v1
// refinements of those same alert values.
export const LIMITS = {
  fhr: { low: 110, high: 160, severeLow: 100, severeHigh: 180 },
  pulse: { low: 60, high: 120, severeHigh: 140 },
  sys: { shock: 80, high: 140, severe: 160 },
  dia: { high: 90, severe: 110 },
  temp: { low: 35.0, high: 37.5, fever: 38.0 },
  contractions: { low: 2, high: 5, durLow: 20, durHigh: 60 },
  urineAlertGrade: 2,        // P++ or A++ and above (manual Table 5)
  romMaxHours: 18,           // prolonged rupture of membranes (v1 rule, not on the LCG form)
  oxytocinMaxDropsMin: 60,   // highest infusion rate per concentration step (v1 rule)
  apgarLow: 7,               // APGAR below 7 at 5 minutes; also triggers the 10-minute score
  apgarSevere: 4,            // display band only: 0-3 severely depressed
  newbornTemp: { low: 36.5, high: 37.5 },   // PANEL-TO-CONFIRM: normal axillary range, WHO thermal-protection guidance
  // WHO/FIGO/ICM consolidated PPH guidelines (2025): start the first-response
  // bundle at >= 300 mL with any abnormal haemodynamic sign (pulse > 100,
  // shock index > 1, systolic < 100, diastolic < 60), or at >= 500 mL,
  // whichever comes first within 24 h of birth (N3).
  pph: {
    volume: 500,
    volumeWithSigns: 300,
    signs: { pulseAbove: 100, shockIndexAbove: 1, sbpBelow: 100, dbpBelow: 60 },
    windowHours: 24,
  },
  audit: {
    ackWithinMin: 15,        // PANEL-TO-CONFIRM: acknowledgement counted as timely
    // PANEL-TO-CONFIRM: section weights of the per-case score (audit.js)
    weights: { header: 1, supportive: 1, baby: 2, woman: 1, progress: 2, medication: 1, decisions: 1, initials: 1, alerts: 2 },
  },
};

// Postpartum watch (N4). Rec 55: regular assessment of vaginal bleeding,
// uterine contraction, fundal height, temperature and pulse during the first
// 24 h, starting from the first hour after birth; BP shortly after birth and,
// if normal, again within 6 h; urine void documented within 6 h. The 2025 PPH
// guidelines ask for particular vigilance in the first 2 h.
export const POSTPARTUM = {
  watchHours: 24,
  // PANEL-TO-CONFIRM: check intervals (minutes) by time since birth
  phases: [
    { untilMin: 120, mother: 15, baby: 15 },
    { untilMin: 360, mother: 60, baby: 60 },
    { untilMin: 1440, mother: 240, baby: 240 },
  ],
  bpFirstMin: 15,            // PANEL-TO-CONFIRM: "shortly after birth"
  bpSecondByMin: 360,        // rec 55: second BP within 6 h
  voidByMin: 360,            // rec 55: urine void within 6 h
};

export const GRACE_MIN = 10; // minutes past due before a chip turns red - no hard lock-outs

// ------------------------------------------------------------- helpers ----

export const toMs = t => +new Date(t);
export const byTime = (a, b) => toMs(a.time) - toMs(b.time);
export function hoursBetween(a, b) { return (toMs(b) - toMs(a)) / 3600000; }
export function minutesBetween(a, b) { return (toMs(b) - toMs(a)) / 60000; }

export function getProtocol(settings, patient) {
  // protocolId is stamped once at admission (or inferred by migration) so a
  // later Settings change never retroactively changes a case already in
  // progress (S2); protocolOverride is kept as a legacy fallback.
  const id = (patient && (patient.protocolId || patient.protocolOverride))
    || (settings && settings.protocol) || 'lcg';
  return PROTOCOLS[id] || PROTOCOLS.lcg;
}

// -------------------------------------------------------- observations ----

/** The entries that count: everything except voided ones (S5). */
export function activeObs(p) {
  return (p.obs || []).filter(o => !o.voided);
}

/** Latest non-voided observation of a type, optionally matching a test. */
export function lastObs(p, type, test) {
  let best = null;
  for (const o of activeObs(p)) {
    if (o.type !== type || (test && !test(o))) continue;
    if (!best || toMs(o.time) > toMs(best.time)) best = o;
  }
  return best;
}

/** Non-voided vaginal examinations that carry a dilatation, oldest first. */
export function exams(p) {
  return activeObs(p).filter(o => o.type === 'exam' && o.v && o.v.dilatation != null).sort(byTime);
}

// -------------------------------------------------------------- stages ----

const LABOUR = ['latent', 'active', 'second'];
const TERMINAL = ['delivered', 'referred', 'closed'];

export function stageOf(p) {
  return p.status || 'latent';
}

/** S8: a woman referred in labour is still monitored until her handover is recorded. */
export function awaitingHandover(p) {
  return stageOf(p) === 'referred' && !p.delivery && !(p.referral && p.referral.handoverAt);
}

export function isLabouring(p) {
  return LABOUR.includes(stageOf(p)) || awaitingHandover(p);
}

/** Labour stage read from the recorded times, whatever the status says. */
export function labourStage(p) {
  if (p.delivery) return 'delivered';
  if (p.secondStageStart) return 'second';
  if (p.activeStartTime) return 'active';
  return 'latent';
}

/** The stage that drives schedules and rules: a referred woman keeps her labour stage. */
export function monitoringStage(p) {
  return awaitingHandover(p) ? labourStage(p) : stageOf(p);
}

export function stageSnapshot(p) {
  return {
    status: stageOf(p),
    activeStartTime: p.activeStartTime || null,
    secondStageStart: p.secondStageStart || null,
  };
}

/**
 * The exams that define the stage: non-voided exams, plus the admission
 * dilatation for records that never stored it as an entry (v1 data). Null
 * when there is no dilatation data at all, so the stored times are kept.
 */
function stageExams(p) {
  const all = (p.obs || []).filter(o => o.type === 'exam' && o.v && o.v.dilatation != null);
  const adm = p.admission;
  const admCm = !!(adm && adm.time && adm.dilatation != null);
  if (!all.length && !admCm) return null;
  const list = all.filter(o => !o.voided);
  if (admCm && !all.some(o => toMs(o.time) === toMs(adm.time))) {
    list.push({ time: adm.time, v: { dilatation: adm.dilatation } });
  }
  return list.sort(byTime);
}

/**
 * Recompute activeStartTime (first exam at or above activeStartCm) and
 * secondStageStart (first exam at 10 cm) from the non-voided exams, then the
 * status. Voiding a mistyped 10 cm entry therefore reverts the second stage
 * and its timers (S5). A terminal status (delivered, referred, closed) is
 * never changed; its stage times still are. Mutates p; returns the snapshot.
 */
export function deriveStage(p, proto) {
  const list = stageExams(p);
  if (list) {
    const active = list.find(o => o.v.dilatation >= proto.activeStartCm);
    const full = list.find(o => o.v.dilatation >= 10);
    p.activeStartTime = active ? active.time : null;
    p.secondStageStart = full ? full.time : null;
  }
  if (!TERMINAL.includes(p.status)) {
    p.status = p.secondStageStart ? 'second' : p.activeStartTime ? 'active' : 'latent';
  }
  return stageSnapshot(p);
}

// -------------------------------------------------------------- parity ----

export const PARITY_LABEL = {
  nulli: 'first birth',
  multi: 'multipara',
  unknown: 'parity not recorded - stricter limit used',
};

/** 'nulli' | 'multi' | 'unknown'. v1 read a missing parity as nulliparous, the more lenient limit (S12). */
export function parityKey(p) {
  const raw = p.para;
  if (raw === null || raw === undefined || raw === '') return 'unknown';
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 'unknown';
  return n > 0 ? 'multi' : 'nulli';
}

/** Pick from a {nulli, multi} limit; unknown parity takes the stricter (shorter) value. */
export function byParity(map, key) {
  if (!map) return null;
  return key === 'unknown' ? Math.min(map.nulli, map.multi) : map[key];
}

// ------------------------------------------------------- second stage ----

/** When pushing began (the form's P), at or after `from` when given. */
export function pushingStart(p, from) {
  const ev = activeObs(p)
    .filter(o => o.type === 'event' && o.v && o.v.event === 'pushing' && (!from || toMs(o.time) >= toMs(from)))
    .sort(byTime)[0];
  return ev ? ev.time : null;
}

/**
 * Start of the second-stage clock. LCG: the start of the active second stage,
 * when pushing began (manual Table 6; F2). Until pushing is recorded the clock
 * runs from full dilatation, which is earlier, so the alert can only come
 * sooner, never later. Partograph: always from full dilatation.
 */
export function secondStageClockStart(p, proto) {
  if (!p.secondStageStart) return null;
  if (proto.secondStageClock !== 'pushing') return p.secondStageStart;
  return pushingStart(p, p.secondStageStart) || p.secondStageStart;
}

/** Anchor of the monitoring schedule: stage start, falling back to admission. */
export function stageStartTime(p) {
  const s = monitoringStage(p);
  if (s === 'second' && p.secondStageStart) return p.secondStageStart;
  if (s === 'active' && p.activeStartTime) return p.activeStartTime;
  return (p.admission && p.admission.time) || p.createdAt;
}

// ------------------------------------------------------------ oxytocin ----

export const isOxytocinStop = m => m.action === 'stop' || /stopped/i.test(m.detail || '');

/** Start of the infusion now running (first start after the last stop). */
export function oxytocinStartTime(p) {
  if (!p.oxytocinRunning) return null;
  let start = null;
  for (const m of (p.meds || []).filter(x => !x.voided && x.kind === 'oxytocin').sort(byTime)) {
    if (isOxytocinStop(m)) start = null;
    else if (!start) start = m.time;
  }
  return start;
}

/** Latest oxytocin dose record: a wizard check or a medication entry (manual Table 7). */
export function lastOxytocinRecord(p) {
  const times = activeObs(p).filter(o => o.type === 'oxytocin').map(o => o.time)
    .concat((p.meds || []).filter(m => !m.voided && m.kind === 'oxytocin' && !isOxytocinStop(m)).map(m => m.time));
  if (!times.length) return null;
  return times.reduce((a, b) => (toMs(a) >= toMs(b) ? a : b));
}

// ---------------------------------------------------------- postpartum ----

export function birthTime(p) {
  return (p.delivery && p.delivery.time) || null;
}

/** Postpartum watch: the first 24 h after birth (rec 55), unless closed or handed over. */
export function inPostpartumWatch(p, now = new Date()) {
  const t = birthTime(p);
  if (!t || stageOf(p) === 'closed') return false;
  if (p.referral && p.referral.handoverAt && toMs(p.referral.handoverAt) >= toMs(t)) return false;
  const min = minutesBetween(t, now);
  return min >= 0 && min < POSTPARTUM.watchHours * 60;
}

/** Postpartum phase in force at `at`; null once the watch is over. */
export function postpartumPhase(p, at) {
  const t = birthTime(p);
  if (!t) return null;
  const min = Math.max(0, minutesBetween(t, at));
  return POSTPARTUM.phases.find(ph => min < ph.untilMin) || null;
}

/** BP readings since birth: the birth form's first check plus later ones. */
export function postpartumBPCount(p) {
  const t = birthTime(p);
  if (!t) return 0;
  const pv = p.delivery.ppVitals;
  const first = pv && pv.sys != null && pv.dia != null ? 1 : 0;
  return first + activeObs(p).filter(o => (o.type === 'ppMother' || o.type === 'vitals')
    && toMs(o.time) >= toMs(t) && o.v && o.v.sys != null && o.v.dia != null).length;
}

export function urinePassedSinceBirth(p) {
  const t = birthTime(p);
  return !!t && activeObs(p).some(o => o.type === 'ppMother' && toMs(o.time) >= toMs(t) && o.v && o.v.urinePassed === 'Y');
}

// ----------------------------------------------------------- schedules ----

export const OBS_TYPES = ['baby', 'contractions', 'pulse', 'vitals', 'exam', 'supportive', 'oxytocin'];

/** Assessment intervals (minutes) in force for a case at `now`. */
export function scheduleFor(p, proto, now = new Date()) {
  if (!isLabouring(p)) {
    const ph = inPostpartumWatch(p, now) ? postpartumPhase(p, now) : null;
    return ph ? { ppMother: ph.mother, ppBaby: ph.baby } : {};
  }
  const stage = monitoringStage(p);
  const key = stage === 'latent' ? 'latent' : stage === 'second' ? 'second' : 'active';
  const sched = { ...proto.schedules[key] };
  if (p.oxytocinRunning) sched.oxytocin = proto.oxytocinCheckMin;
  return sched;
}

function dueItem(type, intervalMin, last, fromISO, now) {
  const dueAtMs = toMs(fromISO) + intervalMin * 60000;
  const diffMin = (toMs(now) - dueAtMs) / 60000;
  const state = diffMin >= GRACE_MIN ? 'overdue' : diffMin >= 0 ? 'due' : 'ok';
  return {
    type, intervalMin, last: last || null,
    dueAt: new Date(dueAtMs).toISOString(),
    state, overdueMin: Math.max(0, Math.round(diffMin)),
  };
}

/**
 * Due status of every scheduled item, most urgent first:
 * [{type, intervalMin, last, dueAt, state: 'ok'|'due'|'overdue', overdueMin}].
 * Labour: recurring items from the stage schedule; oxytocin from the infusion
 * start, then from each dose record (F10). Postpartum watch (N4): mother and
 * baby checks by phase, plus the one-off BP and urine items of rec 55.
 */
export function dueList(p, proto, now = new Date()) {
  const out = [];
  if (isLabouring(p)) {
    const anchor = stageStartTime(p);
    for (const [type, interval] of Object.entries(scheduleFor(p, proto, now))) {
      if (!interval) continue;
      if (type === 'oxytocin') {
        const last = lastOxytocinRecord(p);
        out.push(dueItem(type, interval, last, last || oxytocinStartTime(p) || anchor, now));
        continue;
      }
      const last = lastObs(p, type);
      out.push(dueItem(type, interval, last ? last.time : null, last ? last.time : anchor, now));
    }
  } else if (inPostpartumWatch(p, now)) {
    const birth = birthTime(p);
    for (const [type, key] of [['ppMother', 'mother'], ['ppBaby', 'baby']]) {
      const last = lastObs(p, type, o => toMs(o.time) >= toMs(birth));
      const from = last ? last.time : birth;
      // the interval of the phase the last check fell in: at a boundary the shorter one wins
      const ph = postpartumPhase(p, from);
      if (ph) out.push(dueItem(type, ph[key], last ? last.time : null, from, now));
    }
    const bps = postpartumBPCount(p);
    if (bps < 2) out.push(dueItem('ppBP', bps === 0 ? POSTPARTUM.bpFirstMin : POSTPARTUM.bpSecondByMin, null, birth, now));
    if (!urinePassedSinceBirth(p)) out.push(dueItem('ppVoid', POSTPARTUM.voidByMin, null, birth, now));
  }
  const rank = { overdue: 0, due: 1, ok: 2 };
  out.sort((a, b) => rank[a.state] - rank[b.state] || b.overdueMin - a.overdueMin);
  return out;
}

// ------------------------------------------------- dilatation progress ----

/** Time the cervix first reached its current (latest) dilatation value. */
export function timeReachedCurrentDilatation(p) {
  const list = exams(p);
  if (!list.length) return null;
  const current = list[list.length - 1].v.dilatation;
  let first = list[list.length - 1];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].v.dilatation === current) first = list[i];
    else break;
  }
  return { cm: current, since: first.time };
}

/**
 * Ethiopian partograph: where the alert line starts. On admission in active
 * labour, or when a latent plot is transferred, the first active dilatation is
 * plotted ON the alert line, so the line starts at that point and not at 4 cm
 * (S7: v1 anchored it at 4 cm whatever the admission dilatation, up to
 * cm - 4 hours late). Returns {time, cm}, or null.
 */
export function alertLineAnchor(proto, p) {
  if (!proto.alertActionLines || !p.activeStartTime) return null;
  const start = toMs(p.activeStartTime);
  const first = exams(p).find(o => toMs(o.time) >= start && o.v.dilatation >= proto.activeStartCm);
  let cm = first ? first.v.dilatation : null;
  if (cm == null && p.admission && p.admission.dilatation != null && toMs(p.admission.time) === start) {
    cm = p.admission.dilatation;
  }
  if (cm == null) cm = proto.activeStartCm;
  return { time: p.activeStartTime, cm: Math.min(10, Math.max(proto.activeStartCm, cm)) };
}

/** A reading against the alert/action lines: 'left' | 'alert' | 'action'. */
export function lineStatus(proto, p, dilatationCm, atTime) {
  const a = alertLineAnchor(proto, p);
  if (!a) return 'left';
  const hours = hoursBetween(a.time, atTime);
  if (dilatationCm >= a.cm + hours) return 'left';                                 // alert line: 1 cm/h
  if (dilatationCm < a.cm + hours - proto.actionLineOffsetHours) return 'action';  // action line: 4 h to its right
  return 'alert';
}

// ---------------------------------------------------------- formatting ----

export function fmtMin(min) {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}
