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
// takes the woman back to the active first stage with its timers.

import { getProtocol, deriveStage, stageSnapshot, toMs } from './protocol.js';
import {
  evaluateObs, addAlerts, reconcileAlerts, birthAlerts, closeTimeAlerts, resolveWhere, unlinkObservation,
} from './alerts.js';
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

/**
 * Record one round of observations taken at `timeISO`. `values` maps an
 * observation type to its values, e.g. {baby: {fhr: 140}, exam: {...}}.
 * opts: by (initials), source ('entry' | 'admission'), defaulted ({type:
 * [keys the wizard committed without the midwife touching them]}), replaces
 * (id of the entry this one corrects), enteredAt.
 * Returns {obs, added, resolved, transitions}.
 */
export function applyObservations(p, timeISO, values, settings, opts = {}) {
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
    // fluid seen: membranes have ruptured - unless ROM was recorded with an unknown time (form code U)
    if ((type === 'baby' || type === 'exam') && v.liquor && v.liquor !== 'I' && !p.romTime && !p.romUnknown) {
      p.romTime = timeISO;
    }
  }

  deriveStage(p, proto);
  const added = [];
  for (const o of created) {
    const drafts = evaluateObs(p, o, settings);
    o.flags = drafts.map(d => d.code);
    added.push(...addAlerts(p, drafts, 'obs', { time: o.time, obsId: o.id, raisedAt: enteredAt }));
  }
  const resolved = reconcileAlerts(p, settings);
  return { obs: created, added, resolved, transitions: transitions(before, stageSnapshot(p)) };
}

/**
 * Void an entry (append-only). A reason is required. Alerts that rested only
 * on this entry resolve; alerts this entry had cleared re-open; the stage is
 * re-derived. Returns {entry, before, after, transitions, resolved, reopened}.
 */
export function voidObservation(p, obsId, settings, { by = null, reason = '', at } = {}) {
  const o = (p.obs || []).find(x => x.id === obsId);
  if (!o) throw new Error('Entry not found');
  if (o.voided) throw new Error('This entry is already voided');
  const why = String(reason || '').trim();
  if (!why) throw new Error('A reason is required to void an entry');
  const when = at || nowISO();
  const before = stageSnapshot(p);
  o.voided = { at: when, by, reason: why };
  const { resolved, reopened } = unlinkObservation(p, obsId, when, by);
  deriveStage(p, getProtocol(settings, p));
  const cleared = reconcileAlerts(p, settings);
  const after = stageSnapshot(p);
  return {
    entry: o, before, after, transitions: transitions(before, after),
    resolved: [...resolved, ...cleared], reopened: reopened.filter(a => !a.resolved),
  };
}

/** What voiding would change, without changing anything - for the confirm dialog. */
export function previewVoid(p, obsId, settings, opts = {}) {
  const copy = structuredClone(p);
  const r = voidObservation(copy, obsId, settings, { reason: 'preview', ...opts });
  return {
    before: r.before, after: r.after, transitions: r.transitions,
    resolved: r.resolved.map(a => a.title), reopened: r.reopened.map(a => a.title),
  };
}

/** Correct an entry: void it, then record the corrected values in its place. */
export function correctObservation(p, obsId, newValues, settings, { by = null, reason = 'Corrected entry', time } = {}) {
  const old = (p.obs || []).find(x => x.id === obsId);
  if (!old) throw new Error('Entry not found');
  const voided = voidObservation(p, obsId, settings, { by, reason });
  const applied = applyObservations(p, time || old.time, { [old.type]: newValues }, settings,
    { by, source: old.source || 'entry', replaces: obsId });
  return { voided, ...applied };
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
 * Record the birth. Labour clocks stop (their time alerts close) and the
 * birth rules run: APGAR, retained placenta, stillbirth, PPH trigger.
 */
export function applyBirth(p, delivery, newborn, settings, { by = null, enteredAt } = {}) {
  if (p.delivery) throw new Error('A birth is already recorded - void it before recording another');
  if (!delivery || !validTime(delivery.time)) throw new Error('A valid time of birth is required');
  p.delivery = { ...delivery, by };
  p.newborn = newborn ? { ...newborn } : null;
  p.status = 'delivered';
  const resolved = closeTimeAlerts(p, delivery.time, 'birth');
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
  p.status = p.referral && !p.referral.handoverAt ? 'referred' : 'latent';
  deriveStage(p, getProtocol(settings, p));
  return { status: p.status, resolved };
}
