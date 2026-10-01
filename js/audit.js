// audit.js - per-case LCG audit and completeness score (N2).
//
// A digital translation of the "WHO LCG clinical audit tool for routine use"
// (WHO LCG implementation resource package, 2025, Annex 8, adapted there from
// the MCGL LCG learning resource package). Annex 8 reviews each LCG row for:
// recording frequency met (every 30 min, hourly, 4-hourly), alert values
// circled, assessment and plan recorded, initials present, plus the Section 1
// header (name, parity, labour onset) and the lengths of the stages.
//
// Method: the active first stage and the second stage are cut into windows of
// each row's recording interval (protocol.recording, or the schedules when a
// protocol has none), like the columns of the paper form. A window is met
// when a non-voided entry of that row falls inside it; a window counts once
// it has ended inside the stage (for a stage still running, once the
// 10-minute grace of the due chips has also passed). Voided entries never
// count. Defaulted values (committed by the
// wizard without being touched) count, but are reported separately.
// "Circled" is automatic in the digital form - every alert value raises an
// alert - so what is audited is the human step: acknowledged with the action
// taken, within LIMITS.audit.ackWithinMin.
//
// Pure: no DOM, no I/O.

import {
  LIMITS, GRACE_MIN, activeObs, toMs, byTime, parityKey, birthTime, isOxytocinStop,
} from './protocol.js';

const MIN = 60000;

// Section rows (IRP Annex 8 sections 2-5) and the observation types behind them.
const SECTION_TYPES = {
  supportive: ['supportive'],
  baby: ['baby'],
  woman: ['pulse', 'vitals'],
  progress: ['contractions', 'exam'],
};

/**
 * Consecutive slots of `intervalMin` from `from`, like the columns of the
 * paper form: a slot is met when an entry falls inside it. A slot counts
 * once it has ended inside the stage; while the stage is still running the
 * due chips' grace applies first, so an entry due a minute ago is not yet
 * charged. Returns {total, met}.
 */
function windows(times, from, to, intervalMin, ongoing = false) {
  const I = intervalMin * MIN, G = ongoing ? GRACE_MIN * MIN : 0;
  let total = 0, met = 0;
  for (let w = from; w + I + G <= to; w += I) {
    total++;
    if (times.some(t => t >= w && t < w + I)) met++;
  }
  return { total, met };
}

const rateOf = (met, total) => (total ? met / total : null);

function entryTimes(p, type) {
  return activeObs(p).filter(o => o.type === type).map(o => toMs(o.time));
}

/** The LCG window: from the start of the active first stage (or second stage) to birth, handover or now. */
function bounds(p, now) {
  const birth = birthTime(p);
  const handover = p.referral && p.referral.handoverAt;
  const end = birth ? toMs(birth) : handover ? toMs(handover) : toMs(now);
  const active = p.activeStartTime
    ? { from: toMs(p.activeStartTime), to: p.secondStageStart ? toMs(p.secondStageStart) : end } : null;
  const second = p.secondStageStart ? { from: toMs(p.secondStageStart), to: end } : null;
  const start = active ? active.from : second ? second.from : null;
  return { active, second, start, end, ongoing: !birth && !handover };
}

// a span still running at `now` (its end is now, not a birth or a handover)
const running = (b, to) => b.ongoing && to === b.end;

function sectionAdherence(p, types, b, rec) {
  let total = 0, met = 0;
  for (const [stage, span] of [['active', b.active], ['second', b.second]]) {
    if (!span || !rec[stage]) continue;
    for (const type of types) {
      const interval = rec[stage][type];
      if (!interval) continue;
      const w = windows(entryTimes(p, type), span.from, span.to, interval, running(b, span.to));
      total += w.total; met += w.met;
    }
  }
  return { windows: total, met, rate: rateOf(met, total) };
}

/** Oxytocin infusion periods inside the LCG window (Annex 8 section 6). */
function oxytocinPeriods(p, b) {
  const periods = [];
  let start = null;
  for (const m of (p.meds || []).filter(x => !x.voided && x.kind === 'oxytocin').sort(byTime)) {
    if (isOxytocinStop(m)) {
      if (start != null) periods.push({ from: start, to: toMs(m.time) });
      start = null;
    } else if (start == null) {
      start = toMs(m.time);
    }
  }
  if (start != null) periods.push({ from: start, to: b.end });
  return periods
    .map(x => ({ from: Math.max(x.from, b.start), to: Math.min(x.to, b.end) }))
    .filter(x => x.to > x.from);
}

function medication(p, proto, b) {
  const periods = oxytocinPeriods(p, b);
  if (!periods.length) return null; // no oxytocin during the LCG: not applicable
  const times = entryTimes(p, 'oxytocin').concat((p.meds || [])
    .filter(m => !m.voided && m.kind === 'oxytocin' && !isOxytocinStop(m)).map(m => toMs(m.time)));
  let total = 0, met = 0;
  for (const x of periods) {
    const w = windows(times, x.from, x.to, proto.oxytocinCheckMin, running(b, x.to));
    total += w.total; met += w.met;
  }
  return { windows: total, met, rate: rateOf(met, total) };
}

/** Annex 8 "Initials, frequency 60 mins": each hour holding entries must have every entry signed. */
function initials(p, b) {
  const entries = [...activeObs(p), ...(p.notes || []).filter(n => !n.voided), ...(p.meds || []).filter(m => !m.voided)]
    .map(e => ({ t: toMs(e.time), by: e.by }))
    .filter(e => e.t >= b.start && e.t <= b.end);
  let total = 0, met = 0;
  for (let w = b.start; w <= b.end; w += 60 * MIN) {
    const inW = entries.filter(e => e.t >= w && e.t < w + 60 * MIN);
    if (!inW.length) continue;
    total++;
    if (inW.every(e => e.by)) met++;
  }
  return { windows: total, met, rate: rateOf(met, total) };
}

/**
 * Annex 8 section 7 (shared decision-making): an assessment and plan per
 * hourly column. The note an alert acknowledgement writes (kind 'ack')
 * records the action taken on that alert, not a decision made with the
 * woman, so it never fills a column; voided notes never count either.
 * Acknowledgement notes saved before M5 carry no kind; their fixed opening
 * words identify them.
 */
const ACK_NOTE_PREFIX = 'Alerts acknowledged:';
export const isAckNote = n => !!n && (n.kind === 'ack' || String(n.text || '').startsWith(ACK_NOTE_PREFIX));

function decisions(p, b) {
  const times = (p.notes || []).filter(n => !n.voided && !isAckNote(n) && (n.text || n.plan)).map(n => toMs(n.time));
  const w = windows(times, b.start, b.end, 60, b.ongoing);
  return { windows: w.total, met: w.met, rate: rateOf(w.met, w.total) };
}

/** When the alert last asked for acknowledgement: raised, severity raised, or asked again by a new entry. */
function promptedAt(a) {
  return Math.max(...[a.reAlertedAt, a.escalatedAt, a.raisedAt, a.time].filter(Boolean).map(toMs).filter(Number.isFinite));
}

function alertHandling(p, b) {
  const raised = (p.alerts || []).filter(a => a.severity !== 'info' && toMs(a.time) >= b.start && toMs(a.time) <= b.end);
  const acked = raised.filter(a => a.ack);
  const inTime = acked.filter(a => a.actionTime
    && toMs(a.actionTime) - promptedAt(a) <= LIMITS.audit.ackWithinMin * MIN);
  return {
    raised: raised.length, acknowledged: acked.length, ackedInTime: inTime.length,
    actioned: acked.filter(a => a.action).length,
    rate: rateOf(inTime.length, raised.length),
  };
}

/**
 * Audit one case. Returns {applicable, tool, startedAt, durations, header,
 * sections, alerts, defaulted, voided, score (0-100), completed}. Not
 * applicable (score null) when the active first stage never began.
 */
export function auditCase(p, proto, now = new Date()) {
  const b = bounds(p, now);
  const tool = proto.id === 'lcg' ? 'lcg' : 'partograph';
  const voided = (p.obs || []).filter(o => o.voided).length;
  if (b.start == null) {
    return { applicable: false, tool, startedAt: null, score: null, completed: false, voided };
  }

  const inLcg = o => toMs(o.time) >= b.start && toMs(o.time) <= b.end;
  const startExam = activeObs(p).filter(o => o.type === 'exam' && o.v && o.v.dilatation != null)
    .sort(byTime).find(o => toMs(o.time) === b.start);
  const startedAt = {
    stage: b.active ? 'active' : 'second',
    cm: startExam ? startExam.v.dilatation : (p.admission && p.admission.dilatation) ?? null,
  };

  const header = {
    name: !!(p.name && String(p.name).trim()),
    parity: parityKey(p) !== 'unknown',
    onset: p.onsetMode === 'spontaneous' || p.onsetMode === 'induced',
  };
  header.score = [header.name, header.parity, header.onset].filter(Boolean).length / 3;

  const rec = proto.recording || proto.schedules;
  const sections = {
    supportive: sectionAdherence(p, SECTION_TYPES.supportive, b, rec),
    baby: sectionAdherence(p, SECTION_TYPES.baby, b, rec),
    woman: sectionAdherence(p, SECTION_TYPES.woman, b, rec),
    progress: sectionAdherence(p, SECTION_TYPES.progress, b, rec),
    medication: medication(p, proto, b),
    decisions: decisions(p, b),
    initials: initials(p, b),
  };
  const alerts = { ...alertHandling(p, b), flaggedEntries: activeObs(p).filter(o => inLcg(o) && o.flags && o.flags.length).length };

  const defaultedEntries = activeObs(p).filter(o => inLcg(o) && o.defaulted && o.defaulted.length);
  const defaulted = { entries: defaultedEntries.length, values: defaultedEntries.reduce((n, o) => n + o.defaulted.length, 0) };

  const W = LIMITS.audit.weights;
  const parts = {
    header: header.score, supportive: sections.supportive.rate, baby: sections.baby.rate,
    woman: sections.woman.rate, progress: sections.progress.rate,
    medication: sections.medication ? sections.medication.rate : null,
    decisions: sections.decisions.rate, initials: sections.initials.rate, alerts: alerts.rate,
  };
  let num = 0, den = 0;
  for (const [k, r] of Object.entries(parts)) {
    if (r == null) continue;
    num += W[k] * r; den += W[k];
  }

  const durations = {
    activeMin: b.active ? Math.round((b.active.to - b.active.from) / MIN) : null,
    secondMin: b.second ? Math.round((b.second.to - b.second.from) / MIN) : null,
  };
  durations.activeOver12h = durations.activeMin != null && durations.activeMin >= 12 * 60;
  durations.secondOver3h = durations.secondMin != null && durations.secondMin >= 3 * 60;

  // Operational definition for the "LCG use" indicator (IRP Table 3),
  // PANEL-TO-CONFIRM: an LCG case with name and parity recorded and at least
  // one entry in each core section (supportive care, baby, woman, progress).
  const hasEntry = types => activeObs(p).some(o => types.includes(o.type) && inLcg(o));
  const completed = tool === 'lcg' && header.name && header.parity
    && Object.values(SECTION_TYPES).every(hasEntry);

  return {
    applicable: true, tool, startedAt, durations, header, sections, alerts, defaulted, voided,
    score: den ? Math.round((100 * num) / den) : null, completed,
  };
}
