// protocol.js — clinical protocol engine.
//
// Two protocols are supported, selectable in Settings (per MOH policy):
//
//  1. 'lcg'          WHO Labour Care Guide (2020): active phase from 5 cm,
//                    per-centimetre time limits instead of alert/action lines.
//                    Source: WHO LCG User's Manual (2021), Tables 3–7.
//  2. 'ethiopia2021' Ethiopian modified WHO partograph per the MOH Obstetrics
//                    Management Protocol for Health Centers (2021): active
//                    phase from 4 cm, alert line at 1 cm/h, action line 4 h
//                    to the right, latent-phase follow-up before 4 cm.
//
// All thresholds live here — NOT scattered in UI code — so they can be
// reviewed and updated when national guidance changes (a key lesson from the
// Jhpiego ePartogram trial, where 8/77 hard-coded rules went stale).

export const PROTOCOLS = {
  lcg: {
    id: 'lcg',
    name: 'WHO Labour Care Guide (2020)',
    activeStartCm: 5,
    // routine monitoring intervals in minutes, per stage
    schedules: {
      latent: { baby: 60, contractions: 60, pulse: 240, vitals: 240, exam: 240, supportive: 60 },
      active: { baby: 30, contractions: 30, pulse: 240, vitals: 240, exam: 240, supportive: 60 },
      second: { baby: 5, contractions: 15, pulse: 60, vitals: 60, exam: null, supportive: 60 },
    },
    // minutes allowed at each dilatation (cm) without further progress
    dilatationLagMin: { 5: 360, 6: 300, 7: 180, 8: 150, 9: 120 },
    alertActionLines: false,
    secondStageWarnMin: { nulli: 120, multi: 60 },
    secondStageLimitMin: { nulli: 180, multi: 120 },
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
    // alert line: 1 cm/h from activeStartCm; action line 4 h to the right
    alertActionLines: true,
    actionLineOffsetHours: 4,
    dilatationLagMin: null,
    secondStageWarnMin: { nulli: 60, multi: 30 },
    secondStageLimitMin: { nulli: 120, multi: 60 },
  },
};

// thresholds shared by both protocols (WHO LCG User's Manual; MOH 2021)
export const LIMITS = {
  fhr: { low: 110, high: 160, severeLow: 100, severeHigh: 180 },
  pulse: { low: 60, high: 120 },
  sys: { shock: 80, high: 140, severe: 160 },
  dia: { high: 90, severe: 110 },
  temp: { low: 35.0, high: 37.5, fever: 38.0 },
  contractions: { low: 2, high: 5, durLow: 20, durHigh: 60 },
  latentMaxHours: 8,         // prolonged latent phase
  activeMaxHours: 12,        // LCG sheet spans 12 h of active first stage
  romMaxHours: 18,           // prolonged rupture of membranes
  eblAlertMl: 500,           // postpartum haemorrhage threshold
};

export function getProtocol(settings, patient) {
  const id = (patient && patient.protocolOverride) || (settings && settings.protocol) || 'lcg';
  return PROTOCOLS[id] || PROTOCOLS.lcg;
}

// ---------------------------------------------------------------- stages ----

export function stageOf(patient) {
  return patient.status || 'latent';
}

export function isLabouring(patient) {
  return ['latent', 'active', 'second'].includes(stageOf(patient));
}

export function parityKey(patient) {
  return (Number(patient.para) || 0) > 0 ? 'multi' : 'nulli';
}

/** Anchor time for monitoring schedules (stage start, falling back to admission). */
export function stageStartTime(patient) {
  const s = stageOf(patient);
  if (s === 'second' && patient.secondStageStart) return patient.secondStageStart;
  if (s === 'active' && patient.activeStartTime) return patient.activeStartTime;
  return (patient.admission && patient.admission.time) || patient.createdAt;
}

// ------------------------------------------------------------- schedules ----

export const OBS_TYPES = ['baby', 'contractions', 'pulse', 'vitals', 'exam', 'supportive', 'oxytocin'];

export function scheduleFor(patient, proto) {
  const stage = stageOf(patient);
  const base = proto.schedules[stage === 'latent' ? 'latent' : stage === 'second' ? 'second' : 'active'];
  const sched = Object.assign({}, base);
  // oxytocin infusions are monitored every 30 min while running
  if (patient.oxytocinRunning) sched.oxytocin = 30;
  return sched;
}

export function lastObs(patient, type) {
  const list = (patient.obs || []).filter(o => o.type === type);
  if (!list.length) return null;
  return list.reduce((a, b) => (a.time > b.time ? a : b));
}

const GRACE_MIN = 10; // minutes past due before a chip turns red — no hard lock-outs

/**
 * Compute due status for every scheduled observation type.
 * Returns [{type, intervalMin, last, dueAt, state: 'ok'|'due'|'overdue', overdueMin}]
 */
export function dueList(patient, proto, now = new Date()) {
  if (!isLabouring(patient)) return [];
  const sched = scheduleFor(patient, proto);
  const anchor = new Date(stageStartTime(patient));
  const out = [];
  for (const type of Object.keys(sched)) {
    const interval = sched[type];
    if (!interval) continue;
    const last = lastObs(patient, type);
    const from = last ? new Date(last.time) : anchor;
    const dueAt = new Date(from.getTime() + interval * 60000);
    const diffMin = (now - dueAt) / 60000;
    let state = 'ok';
    if (diffMin >= GRACE_MIN) state = 'overdue';
    else if (diffMin >= 0) state = 'due';
    out.push({
      type, intervalMin: interval,
      last: last ? last.time : null,
      dueAt: dueAt.toISOString(),
      state, overdueMin: Math.max(0, Math.round(diffMin)),
    });
  }
  // most urgent first
  const rank = { overdue: 0, due: 1, ok: 2 };
  out.sort((a, b) => rank[a.state] - rank[b.state] || b.overdueMin - a.overdueMin);
  return out;
}

// ------------------------------------------------- dilatation progress ------

/** Latest vaginal-exam observations sorted by time ascending. */
export function exams(patient) {
  return (patient.obs || []).filter(o => o.type === 'exam' && o.v.dilatation != null)
    .sort((a, b) => a.time.localeCompare(b.time));
}

/** Time the cervix first reached its current (latest) dilatation value. */
export function timeReachedCurrentDilatation(patient) {
  const list = exams(patient);
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
 * Ethiopian modified partograph: position of a dilatation reading relative to
 * the alert/action lines. Returns 'left' | 'alert' | 'action'.
 */
export function lineStatus(proto, patient, dilatationCm, atTime) {
  if (!proto.alertActionLines || !patient.activeStartTime) return 'left';
  const hours = (new Date(atTime) - new Date(patient.activeStartTime)) / 3600000;
  const expected = proto.activeStartCm + hours; // alert line: 1 cm/h
  if (dilatationCm >= expected) return 'left';
  const actionExpected = proto.activeStartCm + (hours - proto.actionLineOffsetHours);
  if (dilatationCm < actionExpected) return 'action';
  return 'alert';
}

// ------------------------------------------------------------ formatting ----

export function fmtMin(min) {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function hoursBetween(a, b) {
  return (new Date(b) - new Date(a)) / 3600000;
}
