// record.js - the record layer between the screens and the case document.
//
// No DOM and no I/O: callers persist with savePatient(). The functions change
// the case they are given IN PLACE - the store keeps live case objects, and a
// copy would be overwritten by the next save of the original - and return
// what changed, so a screen can toast, beep or ask for confirmation.
//
// Corrections are append-only (S5): nothing is deleted. A voided entry keeps
// its values and gains voided: {at, by, reason}; a correction is a void plus
// a new entry that names the one it replaces. Every write re-derives the
// labour stage from the surviving entries, so voiding a mistyped 10 cm exam
// takes the woman back to the active first stage with its timers. When that
// moves a stage start, the entries whose stage at their own time changed are
// judged again for the stage-gated rules (restage), so their flags, their
// alerts and the chart circles drawn from both stay in step.

import { getProtocol, deriveStage, stageSnapshot, toMs, activeObs, byTime, birthTime } from './protocol.js';
import {
  evaluateObs, addAlerts, reconcileAlerts, birthAlerts, closeTimeAlerts, resolveWhere, reopenWhere,
  unlinkObservation, LABOUR_ONLY,
} from './alerts.js';
import { CASE_SCHEMA } from './migrate.js';
import { uid } from './db.js';

// Representative seconds for the wizard's contraction-duration bands.
const DURATION_BAND_S = { lt20: 15, b20_40: 30, b40_60: 50, gt60: 70 };

const nowISO = () => new Date().toISOString();
const validTime = t => !!t && !Number.isNaN(toMs(t));

/** Copy of the values with derived fields filled in (duration from its band). */
export function normalizeValues(type, raw) {
  const v = { ...raw };
  if (type === 'contractions' && v.durBand && DURATION_BAND_S[v.durBand] != null) {
    v.duration = DURATION_BAND_S[v.durBand];
  }
  return v;
}

/**
 * A new case, born in the current schema. An unstamped case would be run
 * through the migration again on the next load, and the schema 3 step would
 * then mark an open referral as departed.
 */
export function createCase(fields) {
  return {
    schemaVersion: CASE_SCHEMA,
    obs: [], meds: [], alerts: [], notes: [], deliveryHistory: [],
    onsetMode: 'unknown', romUnknown: false, oxytocinRunning: false, protocolOverride: null,
    referral: null, delivery: null, newborn: null,
    ...fields,
  };
}

/**
 * The entries an admission creates: only what was actually examined or asked
 * (S4). v1 also recorded clear fluid, "no decelerations" and "yes" to pain
 * relief, oral fluid and mobility that nobody had assessed, and dropped a
 * temperature taken without a BP.
 * form: {fhr, contractions, pulse, sys, dia, temp, dilatation, descent,
 *        presentation, membranes: 'intact' | 'ruptured', liquor, companion}
 */
export function admissionEntries(f) {
  const out = { baby: { fhr: f.fhr } };
  if (f.contractions != null) out.contractions = { count: f.contractions };
  if (f.pulse != null) out.pulse = { pulse: f.pulse };
  const vitals = {};
  for (const k of ['sys', 'dia', 'temp']) if (f[k] != null) vitals[k] = f[k];
  if (Object.keys(vitals).length) out.vitals = vitals;
  const exam = { dilatation: f.dilatation };
  if (f.descent != null) exam.descent = f.descent;
  if (f.presentation) exam.presentation = f.presentation;
  // fluid: intact is an observation; a colour is recorded only when chosen
  const liquor = f.membranes === 'intact' ? 'I' : f.liquor || null;
  if (liquor) exam.liquor = liquor;
  out.exam = exam;
  if (f.companion) out.supportive = { companion: f.companion };
  return out;
}

const fluidSeen = o => (o.type === 'baby' || o.type === 'exam') && o.v && o.v.liquor && o.v.liquor !== 'I';

/**
 * ROM time from the entries: the earliest surviving entry that found fluid,
 * so voiding a mis-tapped "clear" entry also clears the rupture. A time
 * reported at admission (no romSource) or recorded as unknown (form code U)
 * is never touched.
 */
function deriveRom(p) {
  if (p.romUnknown || (p.romTime && !p.romSource)) return;
  const first = activeObs(p).filter(fluidSeen).sort(byTime)[0];
  p.romTime = first ? first.time : null;
  p.romSource = first ? first.id : null;
}

/** Stage changes between two snapshots, for toasts and the void confirmation. */
function transitions(before, after) {
  const out = [];
  if (!before.activeStartTime && after.activeStartTime) out.push('active');
  if (!before.secondStageStart && after.secondStageStart) out.push('second');
  if (before.activeStartTime && !after.activeStartTime) out.push('active_reverted');
  if (before.secondStageStart && !after.secondStageStart) out.push('second_reverted');
  if (before.activeStartTime && after.activeStartTime && before.activeStartTime !== after.activeStartTime) out.push('active_moved');
  if (before.secondStageStart && after.secondStageStart && before.secondStageStart !== after.secondStageStart) out.push('second_moved');
  return out;
}

// ------------------------------------------------- stage-gated rules ----

// The rules in alerts.js that read the labour stage (OBS_RULES contractions
// and exam; keep the two in step): weak and short contractions are alert
// values only once active labour has begun - normal in the latent phase -
// and the progress rules (LCG time limits, partograph alert and action lines)
// apply in the active first stage only.
const GATED = {
  contractions: { codes: ['weak_contractions', 'contraction_short'], open: stage => stage !== 'latent' },
  exam: { codes: ['lcg_progress', 'alert_line', 'action_line'], open: stage => stage === 'active' },
};
const NONE = Object.freeze({ added: [], resolved: [] });

/** The labour stage at time t, from a snapshot of the stage start times. */
function stageAt(snap, t) {
  const ms = toMs(t);
  if (!snap.activeStartTime || ms < toMs(snap.activeStartTime)) return 'latent';
  if (snap.secondStageStart && ms >= toMs(snap.secondStageStart)) return 'second';
  return 'active';
}

/**
 * The stage-gated alert drafts of an entry judged at its own time: the case
 * as it stood then (the entries up to that time) in the stage it was in, so a
 * later exam never changes what an earlier one meant.
 */
function gatedDrafts(p, o, settings, stage) {
  const t = toMs(o.time);
  const then = { ...p, status: stage, obs: activeObs(p).filter(x => toMs(x.time) <= t) };
  return evaluateObs(then, o, settings).filter(d => GATED[o.type].codes.includes(d.code));
}

/**
 * Open or join the alert a re-judged entry now raises, as if it had raised it
 * when it was made: an acknowledgement given after the entry was made already
 * covers it (the chart greys it), so that alert is joined, not asked again.
 */
function raise(p, o, d, at) {
  const open = (p.alerts || []).find(a => a.code === d.code && !a.resolved);
  if (open && open.ack && open.actionTime && toMs(open.actionTime) >= toMs(o.enteredAt || o.time)) {
    open.obsIds = [...new Set([...(open.obsIds || (open.obsId ? [open.obsId] : [])), o.id])];
    open.count = (open.count || 1) + 1;
    if (!open.lastSeen || toMs(o.time) > toMs(open.lastSeen)) open.lastSeen = o.time;
    return [];
  }
  return addAlerts(p, [d], 'obs', { time: o.time, obsId: o.id, raisedAt: at });
}

/** The entry no longer raises `code`: it lets go of those alerts; one left with no entry behind it closes. */
function letGo(p, o, code, at, by) {
  const closed = [];
  for (const a of p.alerts || []) {
    const ids = a.obsIds || (a.obsId ? [a.obsId] : []);
    if (a.code !== code || !ids.includes(o.id)) continue;
    a.obsIds = ids.filter(id => id !== o.id);
    if (!a.resolved && a.source === 'obs' && !a.obsIds.length) closed.push(...resolveWhere(p, x => x === a, at, 'restaged', by));
  }
  return closed;
}

/**
 * After a stage start moved (a back-timed exam, a void, a correction), judge
 * again the stage-gated codes of each standing entry whose stage at its own
 * time crossed a gate: its flags follow, a code it now raises opens or joins
 * its alert, and a code it no longer raises lets go of its alert, which
 * closes ('restaged') when no entry is left behind it. The chart circles
 * values from these flags and alerts, so it never shows a solid red circle
 * with no alert behind it, nor misses one. An alert a recorded birth would
 * have closed (a labour finding) is closed at the birth, as applyBirth does.
 * Entries without stored flags (v1 records) are charted by value and left
 * alone; `skip` holds the entries the caller has just judged.
 * Returns {added, resolved}.
 */
function restage(p, settings, before, { at, by = null, skip = [] }) {
  const after = stageSnapshot(p);
  if (before.activeStartTime === after.activeStartTime && before.secondStageStart === after.secondStageStart) return NONE;
  const out = { added: [], resolved: [] };
  const birth = birthTime(p);
  for (const o of activeObs(p)) {
    const gate = GATED[o.type];
    if (!gate || !o.v || !Array.isArray(o.flags) || skip.includes(o)) continue;
    const stage = stageAt(after, o.time);
    if (gate.open(stageAt(before, o.time)) === gate.open(stage)) continue;
    const drafts = gate.open(stage) ? gatedDrafts(p, o, settings, stage) : [];
    const had = o.flags.filter(c => gate.codes.includes(c));
    o.flags = [...o.flags.filter(c => !gate.codes.includes(c)), ...drafts.map(d => d.code)];
    for (const code of had.filter(c => !drafts.some(d => d.code === c))) out.resolved.push(...letGo(p, o, code, at, by));
    for (const d of drafts.filter(x => !had.includes(x.code))) {
      for (const a of raise(p, o, d, at)) {
        if (birth && LABOUR_ONLY.includes(a.code) && !a.resolved) out.resolved.push(...resolveWhere(p, x => x === a, birth, 'birth'));
        else out.added.push(a);
      }
    }
  }
  return out;
}

// ------------------------------------------------------------- entries ----

/**
 * Record one round of observations taken at `timeISO`. `values` maps an
 * observation type to its values, e.g. {baby: {fhr: 140}, exam: {...}}.
 * opts: by (initials), source ('entry' | 'admission'), defaulted ({type:
 * [keys the wizard committed without the midwife touching them]}), replaces
 * (id of the entry this one corrects), enteredAt.
 * Returns {obs, added, resolved, transitions}; added and resolved include the
 * alerts of earlier entries judged again because a stage start moved.
 */
export function applyObservations(p, timeISO, values, settings, opts = {}) {
  return recordRound(p, timeISO, values, settings, opts, true);
}

/** applyObservations; `restaging` is false inside a correction, which judges the whole correction at its end. */
function recordRound(p, timeISO, values, settings, opts, restaging) {
  if (!validTime(timeISO)) throw new Error('A valid observation time is required');
  const { by = null, source = 'entry', defaulted = {}, replaces = null } = opts;
  const enteredAt = opts.enteredAt || nowISO();
  const proto = getProtocol(settings, p);
  p.obs = p.obs || [];
  const before = stageSnapshot(p);

  const created = [];
  for (const [type, raw] of Object.entries(values || {})) {
    if (!raw || !Object.keys(raw).length) continue;
    const v = normalizeValues(type, raw);
    const o = { id: uid(), type, time: timeISO, enteredAt, source, by, v };
    if (defaulted[type] && defaulted[type].length) o.defaulted = [...defaulted[type]];
    if (replaces) o.replaces = replaces;
    p.obs.push(o);
    created.push(o);
  }

  deriveRom(p);
  deriveStage(p, proto);
  const added = [];
  for (const o of created) {
    const drafts = evaluateObs(p, o, settings);
    o.flags = drafts.map(d => d.code);
    added.push(...addAlerts(p, drafts, 'obs', { time: o.time, obsId: o.id, raisedAt: enteredAt }));
  }
  const re = restaging ? restage(p, settings, before, { at: enteredAt, by, skip: created }) : NONE;
  const resolved = reconcileAlerts(p, settings);
  return {
    obs: created, added: [...added, ...re.added], resolved: [...re.resolved, ...resolved],
    transitions: transitions(before, stageSnapshot(p)),
  };
}

/**
 * Void an entry (append-only). A reason is required. Alerts that rested only
 * on this entry resolve; alerts this entry had cleared re-open; the stage is
 * re-derived, and when a stage start moves the entries it moved across a
 * stage-gated rule are judged again (restage). Returns {entry, before, after,
 * transitions, resolved, reopened, added} - added: alerts the new stage raised.
 */
export function voidObservation(p, obsId, settings, opts = {}) {
  return voidEntry(p, obsId, settings, opts, true);
}

/** voidObservation; `restaging` is false inside a correction, which judges the whole correction at its end. */
function voidEntry(p, obsId, settings, { by = null, reason = '', at } = {}, restaging) {
  const o = (p.obs || []).find(x => x.id === obsId);
  if (!o) throw new Error('Entry not found');
  if (o.voided) throw new Error('This entry is already voided');
  const why = String(reason || '').trim();
  if (!why) throw new Error('A reason is required to void an entry');
  const when = at || nowISO();
  const before = stageSnapshot(p);
  o.voided = { at: when, by, reason: why };
  // a voided admission value no longer describes the admission (card, risk alert)
  if (o.source === 'admission') mirrorAdmission(p, o.type, {});
  const { resolved, reopened } = unlinkObservation(p, obsId, when, by);
  deriveRom(p);
  deriveStage(p, getProtocol(settings, p));
  const re = restaging ? restage(p, settings, before, { at: when, by }) : NONE;
  const cleared = reconcileAlerts(p, settings);
  const after = stageSnapshot(p);
  return {
    entry: o, before, after, transitions: transitions(before, after),
    resolved: [...resolved, ...re.resolved, ...cleared], reopened: reopened.filter(a => !a.resolved), added: re.added,
  };
}

/**
 * What voiding would change, without changing anything - for the confirm
 * dialog: alert titles that would close (resolved), re-open, or open (added).
 */
export function previewVoid(p, obsId, settings, opts = {}) {
  const copy = structuredClone(p);
  const r = voidObservation(copy, obsId, settings, { reason: 'preview', ...opts });
  return {
    before: r.before, after: r.after, transitions: r.transitions,
    resolved: r.resolved.map(a => a.title), reopened: r.reopened.map(a => a.title), added: r.added.map(a => a.title),
  };
}

// The admission values the case also keeps on p.admission (summary card,
// indicators, admission risk), by the type of the admission entry holding them.
const ADMISSION_MIRROR = {
  baby: ['fhr'],
  exam: ['dilatation', 'descent', 'presentation'],
  pulse: ['pulse'],
  vitals: ['sys', 'dia', 'temp'],
  supportive: ['companion'],
};

/**
 * A corrected admission entry: p.admission shows the corrected values, and a
 * value the correction no longer records becomes null. The companion answer
 * also decides whether she wanted a companion (as at admission).
 */
function mirrorAdmission(p, type, v) {
  if (!p.admission || !Object.prototype.hasOwnProperty.call(ADMISSION_MIRROR, type)) return;
  const next = { ...p.admission };
  for (const k of ADMISSION_MIRROR[type]) next[k] = v[k] ?? null;
  p.admission = next;
  if (type !== 'supportive') return;
  if (v.companion) p.companionWanted = v.companion !== 'D';
  else delete p.companionWanted;
}

/**
 * Correct an entry: void it, then record the corrected values in its place.
 * The other entries are judged again once, for the net stage change: judged
 * after each half, a correction that leaves the stage where it was would
 * close their alerts and then open new, unacknowledged ones.
 */
export function correctObservation(p, obsId, newValues, settings, { by = null, reason = 'Corrected entry', time } = {}) {
  const old = (p.obs || []).find(x => x.id === obsId);
  if (!old) throw new Error('Entry not found');
  const before = stageSnapshot(p);
  const voided = voidEntry(p, obsId, settings, { by, reason }, false);
  const applied = recordRound(p, time || old.time, { [old.type]: newValues }, settings,
    { by, source: old.source || 'entry', replaces: obsId }, false);
  const fresh = applied.obs[0];
  if (fresh && old.source === 'admission') mirrorAdmission(p, old.type, fresh.v);
  const re = restage(p, settings, before, { at: nowISO(), by, skip: applied.obs });
  const cleared = reconcileAlerts(p, settings);
  // the net stage change of the whole correction: the void half alone would
  // report a reversion, the re-entry half alone nothing
  return {
    voided, ...applied, added: [...applied.added, ...re.added], resolved: [...applied.resolved, ...re.resolved, ...cleared],
    transitions: transitions(before, stageSnapshot(p)),
  };
}

/**
 * Events. 'pushing': the form's P - starts the WHO second-stage clock (F2).
 * 'handover': the referred woman has left with her escort - monitoring on
 * this device stops (S8).
 */
export function recordEvent(p, kind, timeISO, settings, { by = null } = {}) {
  if (!validTime(timeISO)) throw new Error('A valid time is required');
  if (kind === 'pushing') {
    const r = applyObservations(p, timeISO, { event: { event: 'pushing' } }, settings, { by });
    return { ...r, event: r.obs[0] };
  }
  if (kind === 'handover') {
    if (!p.referral) throw new Error('No referral is recorded for this case');
    if (p.referral.handoverAt) throw new Error('The handover is already recorded');
    p.referral = { ...p.referral, handoverAt: timeISO, handoverBy: by };
    return { handoverAt: timeISO, resolved: closeTimeAlerts(p, timeISO, 'handover') };
  }
  throw new Error('Unknown event: ' + kind);
}

/**
 * Record a referral. handoverAt is written as null - "not yet left" - so she
 * stays monitored until her departure is recorded (S8), and a reload never
 * mistakes the referral for a pre-M2 one.
 */
export function applyReferral(p, referral, { by = null } = {}) {
  if (p.referral) throw new Error('A referral is already recorded for this case');
  if (!referral || !validTime(referral.time)) throw new Error('A valid referral time is required');
  p.referral = { ...referral, handoverAt: null };
  p.status = 'referred';
  const reasons = (referral.reasons || []).join(', ');
  p.notes = [...(p.notes || []),
    { id: uid(), time: referral.time, by, text: `REFERRED to ${referral.facility || 'hospital'}: ${reasons}`, plan: 'referral' }];
  return p.referral;
}

/**
 * Record the birth. Labour clocks stop (their time alerts close), findings
 * about the labour itself close, and the birth rules run: APGAR, retained
 * placenta, stillbirth, PPH trigger.
 */
export function applyBirth(p, delivery, newborn, settings, { by = null, enteredAt } = {}) {
  if (p.delivery) throw new Error('A birth is already recorded - void it before recording another');
  if (!delivery || !validTime(delivery.time)) throw new Error('A valid time of birth is required');
  p.delivery = { ...delivery, by };
  p.newborn = newborn ? { ...newborn } : null;
  p.status = 'delivered';
  const resolved = [
    ...closeTimeAlerts(p, delivery.time, 'birth'),
    ...resolveWhere(p, a => a.source === 'obs' && LABOUR_ONLY.includes(a.code), delivery.time, 'birth'),
  ];
  const added = addAlerts(p, birthAlerts(p), 'birth', { time: delivery.time, raisedAt: enteredAt || nowISO() });
  return { added, resolved };
}

/**
 * Void a birth record: it moves to deliveryHistory with author and reason,
 * the alerts it raised resolve, and the labour stage is re-derived.
 */
export function voidDelivery(p, settings, { by = null, reason = '', at } = {}) {
  if (!p.delivery) throw new Error('No birth record to void');
  const why = String(reason || '').trim();
  if (!why) throw new Error('A reason is required to void a birth record');
  const when = at || nowISO();
  p.deliveryHistory = [...(p.deliveryHistory || []),
    { delivery: p.delivery, newborn: p.newborn, voided: { at: when, by, reason: why } }];
  p.delivery = null;
  p.newborn = null;
  const resolved = resolveWhere(p, a => a.source === 'birth', when, 'void', by);
  // labour findings the birth had closed apply again (time rules re-fire on the tick)
  const reopened = reopenWhere(p, a => a.resolvedHow === 'birth' && a.source !== 'time');
  p.status = p.referral && !p.referral.handoverAt ? 'referred' : 'latent';
  deriveStage(p, getProtocol(settings, p));
  reconcileAlerts(p, settings);
  return { status: p.status, resolved, reopened };
}
