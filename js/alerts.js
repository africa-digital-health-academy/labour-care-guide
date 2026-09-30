// alerts.js - clinical alert engine: rules, alert lifecycle, PPH.
//
// Severities:
//   'info'   silent note
//   'warn'   review needed: recheck, act on the LCG plan step, alert a senior
//   'danger' act now: senior review, intervention or referral
//
// Every value in the "Alert" column of the WHO LCG raises an alert; the
// midwife acknowledges it with the action taken - the digital form of the
// form's instruction to circle the value, alert the senior midwife or doctor
// and record the assessment and action. Advice lines reflect health-centre
// (BEmONC) scope and paraphrase the WHO texts (licence note in NOTICE-WHO.md).
// All thresholds come from protocol.js (LIMITS, PROTOCOLS).
//
// Alert lifecycle (S1). v1 raised each code once per woman and never resolved
// it, so a recurrence was silent. Now:
//   - an alert is stamped with the OBSERVATION time (S12) and linked to the
//     entries that raised it;
//   - while open, a repeat finding updates it (count, lastSeen) and a worse
//     severity re-opens it for acknowledgement;
//   - it resolves on evidence (RESOLVE_ON), when its time rule stops firing,
//     when every entry behind it is voided, or by hand;
//   - a finding after resolution opens a NEW unacknowledged alert, episode + 1.
// Nothing is ever deleted.

import {
  LIMITS, getProtocol, parityKey, byParity, PARITY_LABEL, exams, timeReachedCurrentDilatation,
  lineStatus, monitoringStage, isLabouring, hoursBetween, minutesBetween, fmtMin, toMs, byTime,
  activeObs, secondStageClockStart, pushingStart, birthTime,
} from './protocol.js';
import { uid } from './db.js';

function A(code, severity, title, advice) {
  return { code, severity, title, advice };
}

const RANK = { info: 0, warn: 1, danger: 2 };
const nowISO = () => new Date().toISOString();

const REFER_PREP = 'If not resolving: arrange referral early - call the receiving hospital and the ambulance now; transport takes time.';
const SENIOR = 'Alert a senior midwife or doctor; record the assessment and the action taken';
const VERIFY_10 = 'Count again over another 10 minutes; if confirmed, alert a senior provider';
const INTRAUTERINE_RESUS = [
  'Turn the woman onto her LEFT side',
  'Give IV fluids (Normal Saline / Ringer’s Lactate)',
  'Stop oxytocin if running',
  'Re-check FHR in 5–15 minutes, listen through a contraction + 30 s after',
];
const SEVERE_HTN = [
  'Check urine protein NOW', 'Severe pre-eclampsia until proven otherwise',
  'Give MgSO₄ loading dose BEFORE referral: 4 g IV (20%) slowly over 5–20 min + 10 g IM (5 g each buttock)',
  'Give antihypertensive per protocol if available', 'REFER urgently — call ahead',
];

// ------------------------------------------------------------ value tests --

const URINE_GRADES = { nil: 0, neg: 0, negative: 0, '-': 0, trace: 0.5, '+': 1, '++': 2, '+++': 3, '++++': 4 };

/** Dipstick reading as a number: Negative/nil 0, Trace 0.5, + 1 ... ++++ 4 (manual Table 5; F9). */
export function urineGrade(s) {
  if (s == null || s === '') return null;
  const k = String(s).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(URINE_GRADES, k) ? URINE_GRADES[k] : null;
}

/** Posture is coded SP (supine) or MO (mobile) on the form; v1 stored 'supine'. */
export const isSupine = v => v === 'SP' || v === 'supine';

/**
 * The LCG "Alert" column as predicates. Rules, the chart and the wizard's
 * numpad hints all call these, so each cut-off is written once (S13).
 */
export const FLAG = {
  fhr: n => n != null && (n < LIMITS.fhr.low || n >= LIMITS.fhr.high),
  fhrSevere: n => n != null && (n < LIMITS.fhr.severeLow || n >= LIMITS.fhr.severeHigh),
  decel: d => d === 'late' || d === 'prolonged',
  liquor: l => l === 'M3' || l === 'B',
  position: pos => pos === 'OP' || pos === 'OT',
  caput: c => c != null && c >= 3,
  moulding: m => m != null && m >= 3,
  contractionCount: c => c != null && (c <= LIMITS.contractions.low || c > LIMITS.contractions.high),
  contractionDuration: s => s != null && (s < LIMITS.contractions.durLow || s > LIMITS.contractions.durHigh),
  pulse: n => n != null && (n < LIMITS.pulse.low || n >= LIMITS.pulse.high),
  sys: n => n != null && (n < LIMITS.sys.shock || n >= LIMITS.sys.high),
  dia: n => n != null && n >= LIMITS.dia.high,
  temp: t => t != null && (t < LIMITS.temp.low || t >= LIMITS.temp.high),
  urine: g => (urineGrade(g) ?? 0) >= LIMITS.urineAlertGrade,
  supportive: (key, val) => (key === 'posture' ? isSupine(val) : val === 'N'),
  bloodLoss: ml => ml != null && ml >= LIMITS.pph.volume,
};

// ------------------------------------------------------ shared rule parts --

// Amniotic fluid (manual Table 4): M+++ (thick meconium) and B (blood) are the
// alert values; M+ and M++ are recorded, not alerted. 'M' is v1's ungraded
// meconium. Checked at the FHR step AND at the vaginal exam (F7).
function liquorRule(v) {
  if (v.liquor === 'M3') {
    return [A('liquor_thick_mec', 'danger', 'Thick meconium-stained amniotic fluid (M+++)',
      [SENIOR, 'Monitor FHR every 15 min', 'Prepare newborn resuscitation equipment', 'Consider referral if combined with abnormal FHR or slow progress'])];
  }
  if (v.liquor === 'B') {
    return [A('liquor_blood', 'danger', 'Blood-stained amniotic fluid',
      ['Assess for abruption, placenta praevia, vasa praevia or uterine rupture', 'Check maternal vital signs and FHR now', 'REFER if bleeding is more than a show'])];
  }
  if (v.liquor === 'M') {
    return [A('liquor_mec', 'warn', 'Meconium-stained fluid - grade not recorded',
      ['Grade it: + non-significant, ++ medium, +++ thick (+++ is the alert value)', 'Increase FHR monitoring; prepare newborn resuscitation equipment'])];
  }
  return [];
}

function pulseDrafts(v, pre) {
  if (!FLAG.pulse(v.pulse)) return [];
  return [A(pre + 'pulse_abn', v.pulse >= LIMITS.pulse.severeHigh ? 'danger' : 'warn', `Maternal pulse ${v.pulse} bpm`,
    ['Check BP and temperature now', 'Assess for bleeding, dehydration, infection, pain or distress', 'Give oral or IV fluids', 'If persistent with other signs: refer'])];
}

function bpDrafts(v, pre) {
  const { sys, dia } = v;
  if (sys == null && dia == null) return [];
  const out = [];
  const bp = `${sys ?? '-'}/${dia ?? '-'}`;
  if ((sys != null && sys >= LIMITS.sys.severe) || (dia != null && dia >= LIMITS.dia.severe)) {
    out.push(A(pre + 'htn_severe', 'danger', `Severe hypertension ${bp} mmHg`, SEVERE_HTN));
  } else if ((sys != null && sys >= LIMITS.sys.high) || FLAG.dia(dia)) {
    out.push(A(pre + 'htn', 'warn', `Elevated BP ${bp} mmHg`,
      ['Re-check after 15–30 min rest', 'Check urine protein', 'If ≥140/90 persists + proteinuria: manage as pre-eclampsia and refer']));
  }
  if (sys != null && sys > 0 && sys < LIMITS.sys.shock) {
    out.push(A(pre + 'hypotension', 'danger', `Systolic BP ${sys} mmHg - possible shock`,
      ['Look for bleeding (revealed or concealed)', 'IV access ×2, run fluids fast', 'REFER NOW']));
  }
  return out;
}

function tempDrafts(v, pre) {
  const t = v.temp;
  if (t == null) return [];
  if (t >= LIMITS.temp.fever) {
    return [A(pre + 'fever', 'danger', `Temperature ${t} °C — fever`,
      ['Suspect infection (chorioamnionitis in labour, endometritis after birth)', 'Give first-dose antibiotics per protocol', 'Antipyretic + fluids', 'Monitor FHR closely if still in labour', 'REFER'])];
  }
  if (t >= LIMITS.temp.high) {
    return [A(pre + 'temp_high', 'warn', `Temperature ${t} °C`, ['Re-check within 1 h', 'Encourage oral fluids', 'Look for a source of infection'])];
  }
  if (t < LIMITS.temp.low) {
    return [A(pre + 'temp_low', 'warn', `Temperature ${t} °C — hypothermia`, ['Warm the woman, re-check', 'Assess for shock or sepsis'])];
  }
  return [];
}

// ----------------------------------------------------------- PPH (2025) ----

/**
 * First-response bundle for postpartum haemorrhage (WHO/FIGO/ICM consolidated
 * PPH guidelines, 2025 - the E-MOTIVE bundle): start every step together as
 * soon as the trigger is met. Tranexamic acid dose and repeat per the WHO 2017
 * recommendation; not started later than 3 h after birth.
 */
export const PPH_BUNDLE = [
  { code: 'massage', label: 'M - Massage the uterus' },
  { code: 'oxytocic', label: 'O - Oxytocic: oxytocin 10 IU IV or IM, then an infusion per national protocol' },
  { code: 'txa', label: 'T - Tranexamic acid 1 g IV over 10 min, within 3 h of birth; a second 1 g if bleeding continues after 30 min or restarts within 24 h' },
  { code: 'iv_fluids', label: 'I - IV fluids: crystalloid through a large-bore cannula' },
  { code: 'examine', label: 'V - Vaginal and genital tract examination: tears, retained placenta, full bladder' },
  { code: 'escalate', label: 'E - Escalate if bleeding continues: senior help, bimanual or aortic compression, referral' },
];

export const PPH_ACTIONS = [
  'Call for help - start ALL first-response steps together; do not wait for 500 mL',
  ...PPH_BUNDLE.map(b => b.label),
  REFER_PREP,
];

/**
 * Prevention in the third stage (N3). WHO 2018 recs 41-45 and the 2025 PPH
 * guidelines: a quality-assured uterotonic for every birth (oxytocin 10 IU
 * IM/IV, or heat-stable carbetocin 100 micrograms IM/IV), controlled cord
 * traction where a skilled attendant is present, and an abdominal uterine
 * tone check for early atony (rec 52). Routine sustained uterine massage is NOT
 * recommended once prophylactic oxytocin has been given (rec 46), so v1's
 * "uterine massage after placenta" item is removed. The key 'oxy_amtsl' is
 * kept so records from v1 stay comparable.
 */
export const AMTSL_STEPS = [
  ['oxy_amtsl', 'Uterotonic within 1 minute of birth: oxytocin 10 IU IM (or heat-stable carbetocin 100 micrograms IM)'],
  ['cct', 'Controlled cord traction'],
  ['tone', 'Uterine tone checked by abdominal palpation after the placenta'],
];

function inPPHWindow(p, at) {
  const t = birthTime(p);
  if (!t) return false;
  const h = hoursBetween(t, at);
  return h >= 0 && h <= LIMITS.pph.windowHours;
}

/**
 * Cumulative blood loss (mL) up to `at`: the highest drape reading (a
 * calibrated drape shows the running total, so readings are not summed) or
 * the birth record's estimate, whichever is higher.
 */
export function bloodLossTotal(p, at) {
  const cutoff = at ? toMs(at) : Infinity;
  const d = p.delivery;
  let total = d && d.eblMl != null && toMs(d.time) <= cutoff ? Number(d.eblMl) || 0 : 0;
  for (const o of activeObs(p)) {
    if (o.type === 'bloodloss' && o.v && o.v.ml != null && toMs(o.time) <= cutoff) {
      total = Math.max(total, Number(o.v.ml) || 0);
    }
  }
  return total;
}

/** Abnormal haemodynamic signs (PPH 2025) from the latest pulse and BP taken after birth, up to `at`. */
export function haemodynamicSigns(p, at) {
  const birth = birthTime(p);
  if (!birth) return [];
  const from = toMs(birth), to = at ? toMs(at) : Infinity;
  let pulse = null, pulseT = -Infinity, sys = null, dia = null, bpT = -Infinity;
  const pv = p.delivery.ppVitals;
  if (pv && pv.pulse != null) { pulse = pv.pulse; pulseT = from; }
  if (pv && pv.sys != null) { sys = pv.sys; dia = pv.dia ?? null; bpT = from; }
  for (const o of activeObs(p)) {
    const t = toMs(o.time);
    if (t < from || t > to || !o.v) continue;
    if ((o.type === 'pulse' || o.type === 'ppMother') && o.v.pulse != null && t >= pulseT) { pulse = o.v.pulse; pulseT = t; }
    if ((o.type === 'vitals' || o.type === 'ppMother') && o.v.sys != null && t >= bpT) { sys = o.v.sys; dia = o.v.dia ?? null; bpT = t; }
  }
  const S = LIMITS.pph.signs;
  const out = [];
  if (pulse != null && pulse > S.pulseAbove) out.push(`pulse ${pulse}`);
  if (sys != null && sys < S.sbpBelow) out.push(`systolic ${sys}`);
  if (dia != null && dia < S.dbpBelow) out.push(`diastolic ${dia}`);
  if (pulse != null && sys > 0 && pulse / sys > S.shockIndexAbove) out.push(`shock index ${(pulse / sys).toFixed(1)}`);
  return out;
}

/** The 2025 PPH trigger at `at`: {level: 'volume'|'signs', totalMl, signs}, or null. */
export function pphTrigger(p, at) {
  if (!birthTime(p)) return null;
  const total = bloodLossTotal(p, at);
  if (total >= LIMITS.pph.volume) return { level: 'volume', totalMl: total, signs: haemodynamicSigns(p, at) };
  if (total >= LIMITS.pph.volumeWithSigns) {
    const signs = haemodynamicSigns(p, at);
    if (signs.length) return { level: 'signs', totalMl: total, signs };
  }
  return null;
}

function pphDrafts(p, at) {
  const t = pphTrigger(p, at);
  if (!t) return [];
  // Blood loss only ever grows, so once a PPH episode has been closed a new
  // one opens only when more bleeding is measured than at that closure.
  const closed = (p.alerts || []).filter(a => a.code === 'pph' && a.resolved && a.meta);
  const lastClosed = closed[closed.length - 1];
  if (lastClosed && t.totalMl <= lastClosed.meta.totalMl) return [];
  const title = t.level === 'volume'
    ? `PPH: blood loss ${t.totalMl} mL`
    : `PPH: ${t.totalMl} mL with ${t.signs.join(', ')}`;
  return [{ ...A('pph', 'danger', title, PPH_ACTIONS), meta: { totalMl: t.totalMl, level: t.level } }];
}

// --------------------------------------------------- observation rules ----
// Each rule receives (v, patient, proto) and returns alert drafts.

const OBS_RULES = {
  // manual Table 4
  baby(v) {
    const out = [];
    if (FLAG.fhrSevere(v.fhr)) {
      out.push(A('fhr_severe', 'danger', `FHR ${v.fhr} bpm — suspected fetal distress`,
        [...INTRAUTERINE_RESUS, 'REFER NOW unless birth is imminent', REFER_PREP]));
    } else if (FLAG.fhr(v.fhr)) {
      out.push(A('fhr_abn', 'warn', `FHR ${v.fhr} bpm — outside normal range (110–159)`,
        [...INTRAUTERINE_RESUS, 'If abnormal on repeat: treat as fetal distress and refer']));
    }
    if (FLAG.decel(v.decel)) {
      out.push(A('decel', 'danger', `${v.decel === 'late' ? 'Late' : 'Prolonged'} FHR decelerations`,
        [...INTRAUTERINE_RESUS, 'Late/prolonged decelerations suggest fetal compromise — prepare referral']));
    }
    return out.concat(liquorRule(v));
  },

  // manual Table 6: <=2 or >5 per 10 min; <20 or >60 s. Each alerts on its own
  // (F8); the advice asks to verify over another 10 minutes.
  contractions(v, p) {
    const out = [];
    const c = LIMITS.contractions;
    const oxy = !!p.oxytocinRunning;
    const inLabour = monitoringStage(p) !== 'latent';
    if (v.count != null && v.count > c.high) {
      out.push(A('tachysystole', 'danger', `${v.count} contractions/10 min — uterine hyperstimulation${oxy ? ' — STOP OXYTOCIN NOW' : ''}`,
        [oxy ? 'Stop oxytocin immediately' : VERIFY_10, 'Left lateral position, IV fluids', 'Check FHR now', 'Consider referral — risk of rupture / fetal distress']));
    } else if (v.count != null && v.count <= c.low && inLabour) {
      out.push(A('weak_contractions', 'warn', `Weak contractions (${v.count}/10 min) in active labour`,
        [VERIFY_10, 'Encourage mobility, upright position, oral fluids', 'Empty bladder', 'Reassess progress at next exam — if no progress, refer (augmentation is a hospital-level decision)']));
    }
    if (v.duration != null && v.duration > c.durHigh) {
      out.push(oxy
        ? A('contraction_long', 'danger', 'Contractions longer than 60 s on oxytocin - hyperstimulation',
          ['Stop oxytocin now', 'Left lateral position, IV fluids', 'Check FHR now', 'Senior review; refer if not settling'])
        : A('contraction_long', 'warn', 'Contractions longer than 60 s',
          [VERIFY_10, 'Check FHR during and after a contraction', 'Continuous contractions are a sign of obstruction - senior review']));
    } else if (v.duration != null && v.duration < c.durLow && inLabour) {
      out.push(A('contraction_short', 'warn', 'Contractions shorter than 20 s in active labour',
        [VERIFY_10, 'Short contractions suggest inadequate uterine activity - reassess progress at the next exam']));
    }
    return out;
  },

  // manual Table 5
  pulse(v) {
    return pulseDrafts(v, '');
  },

  // manual Table 5; urine graded Negative, Trace, + to ++++ (F9)
  vitals(v) {
    const out = [...bpDrafts(v, ''), ...tempDrafts(v, '')];
    if (FLAG.urine(v.protein)) {
      out.push(A('proteinuria', 'warn', `Proteinuria ${v.protein}`,
        ['Check BP now — if hypertensive, manage as pre-eclampsia', 'If BP normal: consider infection, re-test at the next void']));
    }
    if (FLAG.urine(v.acetone)) {
      out.push(A('ketonuria', 'warn', `Ketonuria ${v.acetone}`, ['Give oral/IV fluids and calories — maternal exhaustion risk']));
    }
    return out;
  },

  // manual Tables 4 and 6
  exam(v, p, proto) {
    const out = [];
    if (FLAG.moulding(v.moulding)) {
      out.push(A('moulding3', 'danger', 'Moulding +++ (sutures overlapped, not reducible)',
        ['Suspect cephalopelvic disproportion / obstructed labour', 'Do NOT augment', 'REFER NOW for possible caesarean', REFER_PREP]));
    } else if (v.moulding === 2) {
      // v1 extra, not a WHO alert value (the manual calls 0 to ++ usually normal)
      out.push(A('moulding2', 'warn', 'Moulding ++ (sutures overlapped but reducible)',
        ['Watch closely for obstruction — combine with progress and descent', 'If progress is also slow: refer']));
    }
    if (FLAG.caput(v.caput)) {
      out.push(A('caput3', 'warn', 'Caput +++',
        [SENIOR, 'With other abnormal findings a sign of obstruction — check progress, descent and moulding', 'If progress is also slow: refer']));
    }
    if (FLAG.position(v.position)) {
      out.push(A('malposition', 'warn', `Fetal position: occiput ${v.position === 'OP' ? 'posterior' : 'transverse'}`,
        [SENIOR, 'Encourage upright/all-fours positions', 'Expect slower progress; monitor closely', 'Persistent OT/OP with arrest → refer']));
    }
    if (v.presentation && v.presentation !== 'cephalic') {
      out.push(A('malpresentation', 'danger', `Malpresentation: ${v.presentation}`,
        ['Breech/transverse/other malpresentation in labour at health-centre level', 'REFER NOW unless birth imminent', 'If cord prolapse: knee-chest position, push presenting part up, URGENT referral']));
    }
    out.push(...liquorRule(v));
    // labour progress in the active first stage
    if (v.dilatation != null && p.activeStartTime && monitoringStage(p) === 'active') {
      if (proto.alertActionLines) {
        const ls = lineStatus(proto, p, v.dilatation, v._time || nowISO());
        if (ls === 'action') {
          out.push(A('action_line', 'danger', 'Partograph: crossed the ACTION line',
            ['Full reassessment: contractions, descent, moulding, bladder, hydration', 'REFER NOW to hospital (CEmONC) unless delivery is imminent', REFER_PREP]));
        } else if (ls === 'alert') {
          out.push(A('alert_line', 'warn', 'Partograph: crossed the alert line',
            ['Reassess in 2 h or sooner', 'Support: mobility, fluids, empty bladder', 'At health centre: begin referral preparation — if action line is crossed, refer']));
        }
      } else if (proto.dilatationLagMin) {
        const reach = timeReachedCurrentDilatation(p);
        const limit = proto.dilatationLagMin[v.dilatation];
        if (reach && limit && reach.cm === v.dilatation) {
          const lag = minutesBetween(reach.since, v._time || nowISO());
          if (lag >= limit) {
            out.push(A('lcg_progress', 'danger', `No progress: ${v.dilatation} cm for ${fmtMin(lag)} (limit ${fmtMin(limit)})`,
              ['WHO LCG progress alert — assess contractions, position, descent, moulding, bladder', 'At health centre: refer for labour dystocia unless birth imminent', REFER_PREP]));
          }
        }
      }
    }
    return out;
  },

  // manual Table 3: companion, pain relief and oral fluid are coded Y, N or D
  // (declined) and N is the alert value; posture SP (supine) is the alert
  // value. All four are alert rows, not silent notes (F1).
  supportive(v) {
    const out = [];
    if (v.companion === 'N') {
      out.push(A('no_companion', 'warn', 'No labour companion present',
        ['Offer to find a companion of her choice', 'If she declines, record D and keep asking her preference as labour progresses']));
    }
    if (v.painRelief === 'N') {
      out.push(A('no_pain_relief', 'warn', 'No pain relief',
        ['Offer pain relief that matches her preference and what is available: relaxation, breathing, massage or medication', 'If she declines, record D']));
    }
    if (v.oralFluid === 'N') {
      out.push(A('no_fluids', 'warn', 'No oral fluid since the last assessment',
        ['Encourage her to drink and take a light diet as she wishes']));
    }
    if (isSupine(v.posture)) {
      out.push(A('supine', 'warn', 'Lying supine',
        ['Encourage her to walk and move freely in the first stage', 'Support her choice of position: left lateral, squatting, kneeling, standing']));
    }
    return out;
  },

  oxytocin(v) {
    if (v.dropsMin == null || v.dropsMin <= LIMITS.oxytocinMaxDropsMin) return [];
    return [A('oxy_rate', 'warn', `Oxytocin at ${v.dropsMin} drops/min`,
      ['Verify rate against protocol — do not exceed maximum', 'Check contractions and FHR every 30 min'])];
  },

  // Postpartum mother (rec 55): bleeding, tone (rec 52), and the same vital-sign
  // alert values as in labour. Fundal height is recorded, not alerted.
  ppMother(v) {
    const out = [];
    if (v.bleeding === 'heavy') {
      out.push(A('pp_bleeding', 'danger', 'Heavy vaginal bleeding after birth',
        ['Measure the blood loss now: calibrated drape, or weigh pads and linen', ...PPH_ACTIONS]));
    }
    if (v.tone === 'soft') {
      out.push(A('pp_atony', 'danger', 'Uterus soft after birth - possible atony',
        ['Massage the uterus until it is firm and give an oxytocic', 'Measure the blood loss; check pulse and BP', 'If bleeding is heavy, start the PPH first-response bundle']));
    }
    return out.concat(pulseDrafts(v, 'pp_'), bpDrafts(v, 'pp_'), tempDrafts(v, 'pp_'));
  },

  // Postpartum baby. PANEL-TO-CONFIRM: breathing, temperature and feeding cues.
  ppBaby(v) {
    const out = [];
    if (v.breathing === 'none' || v.breathing === 'difficult') {
      out.push(A('nb_breathing', 'danger', v.breathing === 'none' ? 'Baby not breathing' : 'Baby breathing with difficulty',
        ['Start or resume newborn resuscitation (Helping Babies Breathe)', 'Keep the baby warm; call for help', 'Refer the newborn if not improving']));
    }
    if (v.temp != null && v.temp < LIMITS.newbornTemp.low) {
      out.push(A('nb_cold', 'warn', `Baby temperature ${v.temp} °C - too cold`,
        ['Skin-to-skin with the mother, dry, cover the head, warm the room', 'Re-check in 30 minutes']));
    } else if (v.temp != null && v.temp >= LIMITS.newbornTemp.high) {
      out.push(A('nb_hot', 'warn', `Baby temperature ${v.temp} °C - raised`,
        ['Remove extra layers and re-check in 30 minutes', 'Fever in a newborn is a danger sign - assess for infection and refer if it persists']));
    }
    if (v.feeding === 'poor') {
      out.push(A('nb_feeding', 'warn', 'Baby not feeding well',
        ['Help with positioning and attachment', 'Poor feeding with any other sign is a danger sign - assess and refer']));
    }
    return out;
  },
};

/**
 * Evaluate one observation; returns alert drafts (not stored). obs = {type,
 * time, v}. Any entry within 24 h of birth also re-checks the PPH trigger,
 * because a new blood-loss reading or a new pulse/BP can complete it.
 */
export function evaluateObs(patient, obs, settings) {
  const proto = getProtocol(settings, patient);
  const rule = OBS_RULES[obs.type];
  const v = Object.assign({}, obs.v, { _time: obs.time });
  const drafts = rule ? rule(v, patient, proto) || [] : [];
  if (inPPHWindow(patient, obs.time)) drafts.push(...pphDrafts(patient, obs.time));
  return drafts;
}

// ------------------------------------------------------------------------
// Time rules: run by the heartbeat tick, independent of data entry, so a busy
// night-shift midwife is still warned.
// ------------------------------------------------------------------------

export const TIME_CODES = ['latent_long', 'active_long', 'lcg_progress_due', 'alert_line_proj', 'action_line_proj',
  'second_warn', 'second_long', 'passive_second_long', 'prom_long'];

export function evaluateTime(patient, settings, now = new Date()) {
  if (!isLabouring(patient)) return [];
  const proto = getProtocol(settings, patient);
  const out = [];
  const stage = monitoringStage(patient);
  const k = parityKey(patient);
  const lcg = proto.id === 'lcg';

  if (stage === 'latent') {
    const start = patient.laborOnsetTime || (patient.admission && patient.admission.time);
    if (start && hoursBetween(start, now) >= proto.latentMaxHours) {
      out.push(A('latent_long', 'warn', `Latent phase > ${proto.latentMaxHours} h`,
        [lcg ? 'National latent-phase care rule (the WHO LCG sets no latent limit)' : 'Prolonged latent phase — full reassessment',
          'Exclude false labour; check wellbeing', 'Consider referral per protocol']));
    }
  }

  if (stage === 'active' && patient.activeStartTime) {
    const maxH = byParity(proto.activeMaxHours, k);
    if (hoursBetween(patient.activeStartTime, now) >= maxH) {
      out.push(A('active_long', 'warn', `Active first stage > ${maxH} h (${PARITY_LABEL[k]})`,
        [lcg ? 'WHO: the active first stage usually does not extend beyond 12 h in first labours and 10 h in later labours' : 'Prolonged active phase',
          'Reassess contractions, position, descent, moulding, bladder and hydration', 'At health centre: refer if not progressing']));
    }
    if (proto.dilatationLagMin) {
      // LCG: the lag limit for the current dilatation has passed - examine now
      const reach = timeReachedCurrentDilatation(patient);
      if (reach && proto.dilatationLagMin[reach.cm]) {
        const lag = minutesBetween(reach.since, now);
        if (lag >= proto.dilatationLagMin[reach.cm]) {
          out.push(A('lcg_progress_due', 'warn', `${reach.cm} cm for ${fmtMin(lag)} — progress limit reached`,
            ['Perform vaginal examination now to assess progress', 'If unchanged: manage as labour dystocia / refer']));
        }
      }
    } else if (proto.alertActionLines && exams(patient).length) {
      // Projection assumes no progress since the last exam. With the alert
      // line correctly anchored (S7) every active admission starts ON the
      // line, so the alert-line projection waits until the next exam is due;
      // the action-line projection is 4 h away by construction.
      const last = exams(patient).slice(-1)[0];
      const ls = lineStatus(proto, patient, last.v.dilatation, now.toISOString());
      const examDue = minutesBetween(last.time, now) >= proto.schedules.active.exam;
      if (ls === 'action') {
        out.push(A('action_line_proj', 'danger', 'Projected beyond ACTION line — examine now',
          ['Time alone has carried this labour past the action line', 'Examine immediately; if confirmed, REFER']));
      } else if (ls === 'alert' && examDue) {
        out.push(A('alert_line_proj', 'warn', 'Projected beyond alert line — examine soon',
          ['Based on time since last exam, progress may have crossed the alert line', 'Examine and replot']));
      }
    }
  }

  if (stage === 'second' && patient.secondStageStart) {
    const pushing = pushingStart(patient, patient.secondStageStart);
    const clock = secondStageClockStart(patient, proto);
    const since = proto.secondStageClock === 'pushing' && pushing ? 'since pushing began' : 'since full dilatation';
    const mins = minutesBetween(clock, now);
    if (mins >= byParity(proto.secondStageLimitMin, k)) {
      out.push(A('second_long', 'danger', `Second stage ${fmtMin(mins)} ${since} (${PARITY_LABEL[k]})`,
        ['Prolonged second stage', 'At health centre: REFER unless birth is imminent', 'Prepare newborn resuscitation', REFER_PREP]));
    } else if (mins >= byParity(proto.secondStageWarnMin, k)) {
      out.push(A('second_warn', 'warn', `Second stage ${fmtMin(mins)} ${since}`,
        ['Check descent, FHR every 5 min, contractions', 'Encourage upright positioning and effective pushing', 'Begin referral preparation if no descent']));
    }
    const passiveMax = proto.secondStagePassiveMaxMin;
    if (passiveMax && !pushing && minutesBetween(patient.secondStageStart, now) >= passiveMax) {
      out.push(A('passive_second_long', 'warn', `Fully dilated ${fmtMin(minutesBetween(patient.secondStageStart, now))} without pushing`,
        [SENIOR, 'Check descent, contractions and the urge to push']));
    }
  }

  if (patient.romTime && hoursBetween(patient.romTime, now) >= LIMITS.romMaxHours) {
    out.push(A('prom_long', 'warn', `Membranes ruptured > ${LIMITS.romMaxHours} h`,
      ['Risk of infection — give prophylactic antibiotics per protocol', 'Check temperature and FHR now', 'Refer if signs of infection']));
  }

  return out;
}

// ------------------------------------------------- rules outside the wizard --

// Conditions that should give birth at hospital (CEmONC) level: at health-
// centre level they are flagged for referral at admission (v1 rule, moved out
// of the admission view - S13).
export const REFER_AT_ADMISSION = ['prior_cs', 'multiple', 'malpresentation', 'aph'];

export function admissionRiskAlerts(p, settings, labelOf = code => code) {
  if (!settings || settings.facilityLevel !== 'health_center') return [];
  const risks = (p.riskFactors || []).filter(r => REFER_AT_ADMISSION.includes(r));
  const pres = p.admission && p.admission.presentation;
  if (pres && pres !== 'cephalic' && !risks.includes('malpresentation')) risks.push('malpresentation');
  if (!risks.length) return [];
  return [A('admission_risk', 'danger', 'High-risk admission — hospital-level birth recommended', [
    'Risk factors: ' + risks.map(labelOf).join(', '),
    'This woman should deliver at a hospital (CEmONC) — refer now unless birth is imminent',
    'If labour is advanced, prepare for delivery AND alert the referral hospital',
  ])];
}

/** Alerts raised by the birth record (moved out of the delivery view - S13). */
export function birthAlerts(p) {
  const d = p.delivery;
  if (!d) return [];
  const n = p.newborn || {};
  const out = [];
  if (d.outcome === 'live' && n.apgar5 && n.apgar5.total != null && n.apgar5.total < LIMITS.apgarLow) {
    out.push(A('apgar_low', 'danger', `APGAR ${n.apgar5.total}/10 at 5 minutes`,
      ['Continue/resume newborn resuscitation per HBB', 'Score again at 10 minutes', 'Keep warm; monitor breathing, colour, feeding', 'REFER the newborn if not vigorous']));
  }
  if (d.placentaComplete === 'N') {
    out.push(A('retained_products', 'danger', 'Placenta incomplete / retained products',
      ['Risk of PPH and sepsis', 'Manual removal / MVA per BEmONC competency, or REFER', 'IV line + fluids; monitor bleeding']));
  }
  if (d.outcome && d.outcome !== 'live') {
    out.push(A('stillbirth', 'warn', 'Stillbirth — respectful supportive care',
      ['Provide compassionate counselling and privacy for the family', 'Complete perinatal death notification per national surveillance', 'Review the labour record for learning (audit), not blame']));
  }
  return out.concat(pphDrafts(p, d.time));
}

// ------------------------------------------------------------------------
// Alert lifecycle
// ------------------------------------------------------------------------

/**
 * Store drafts as alerts. An open alert of the same code is updated rather
 * than stacked (alert fatigue); a worse severity re-opens it for
 * acknowledgement. Otherwise a new alert opens with the next episode number.
 * opts.time is the observation time the alert is stamped with (S12).
 */
export function addAlerts(patient, drafts, source = 'obs', opts = {}) {
  const at = opts.time || nowISO();
  const raisedAt = opts.raisedAt || nowISO();
  const obsId = opts.obsId || null;
  patient.alerts = patient.alerts || [];
  const added = [];
  for (const d of drafts) {
    const open = patient.alerts.find(a => a.code === d.code && !a.resolved);
    if (open) {
      if (!open.lastSeen || toMs(at) > toMs(open.lastSeen)) open.lastSeen = at;
      if (source !== 'time') open.count = (open.count || 1) + 1; // a time rule re-fires every tick
      if (obsId) open.obsIds = [...new Set([...linkedObs(open), obsId])];
      if (d.meta) open.meta = d.meta;
      if (RANK[d.severity] > RANK[open.severity]) {
        Object.assign(open, { severity: d.severity, title: d.title, advice: d.advice, ack: false, escalatedAt: raisedAt });
        added.push(open);
      }
      continue;
    }
    const episode = 1 + patient.alerts.filter(a => a.code === d.code).reduce((m, a) => Math.max(m, a.episode || 1), 0);
    const alert = {
      id: uid(), time: at, raisedAt, lastSeen: at,
      code: d.code, severity: d.severity, title: d.title, advice: d.advice,
      source, obsId, obsIds: obsId ? [obsId] : [],
      ack: false, resolved: false, action: null, episode, count: 1,
    };
    if (d.meta) alert.meta = d.meta;
    patient.alerts.push(alert);
    added.push(alert);
  }
  return added;
}

function linkedObs(a) {
  return a.obsIds || (a.obsId ? [a.obsId] : []);
}

function markResolved(a, at, how, by = null, obsId = null) {
  Object.assign(a, { resolved: true, resolvedAt: at, resolvedHow: how, resolvedBy: by });
  if (obsId) a.resolvedByObs = obsId;
  return a;
}

function reopen(a) {
  a.resolved = false;
  delete a.resolvedAt; delete a.resolvedHow; delete a.resolvedBy; delete a.resolvedByObs;
  return a;
}

const FHR = ['fhr_abn', 'fhr_severe'];
const BP = ['htn', 'htn_severe'];
const TEMP = ['fever', 'temp_high', 'temp_low'];
const MOULD = ['moulding2', 'moulding3'];
const LINES = ['alert_line', 'action_line'];
const pp = list => list.map(c => 'pp_' + c);
const R = (types, fields, family) => ({ types, fields, family });

/**
 * Evidence that clears an open alert: a LATER, non-voided observation of one
 * of `types` that carries every one of `fields` and did not itself raise any
 * code of the family. Codes not listed never auto-resolve and close only by
 * hand: time rules (they clear on the tick), manual and emergency alerts,
 * birth and admission alerts, PPH, and findings whose meaning lasts until
 * birth - thick meconium and blood-stained fluid.
 */
export const RESOLVE_ON = Object.freeze({
  fhr_abn: R(['baby'], ['fhr'], FHR),
  fhr_severe: R(['baby'], ['fhr'], FHR),
  decel: R(['baby'], ['decel'], ['decel']),
  liquor_mec: R(['baby', 'exam'], ['liquor'], ['liquor_mec']),
  tachysystole: R(['contractions'], ['count'], ['tachysystole']),
  weak_contractions: R(['contractions'], ['count'], ['weak_contractions']),
  contraction_long: R(['contractions'], ['duration'], ['contraction_long']),
  contraction_short: R(['contractions'], ['duration'], ['contraction_short']),
  pulse_abn: R(['pulse'], ['pulse'], ['pulse_abn']),
  htn: R(['vitals'], ['sys', 'dia'], BP),
  htn_severe: R(['vitals'], ['sys', 'dia'], BP),
  hypotension: R(['vitals'], ['sys'], ['hypotension']),
  fever: R(['vitals'], ['temp'], TEMP),
  temp_high: R(['vitals'], ['temp'], TEMP),
  temp_low: R(['vitals'], ['temp'], TEMP),
  proteinuria: R(['vitals'], ['protein'], ['proteinuria']),
  ketonuria: R(['vitals'], ['acetone'], ['ketonuria']),
  moulding2: R(['exam'], ['moulding'], MOULD),
  moulding3: R(['exam'], ['moulding'], MOULD),
  caput3: R(['exam'], ['caput'], ['caput3']),
  moulding_caput: R(['exam'], ['moulding', 'caput'], ['moulding_caput', ...MOULD, 'caput3']), // v1 code
  malposition: R(['exam'], ['position'], ['malposition']),
  malpresentation: R(['exam'], ['presentation'], ['malpresentation']),
  lcg_progress: R(['exam'], ['dilatation'], ['lcg_progress']),
  alert_line: R(['exam'], ['dilatation'], LINES),
  action_line: R(['exam'], ['dilatation'], LINES),
  no_companion: R(['supportive'], ['companion'], ['no_companion']),
  no_pain_relief: R(['supportive'], ['painRelief'], ['no_pain_relief']),
  no_fluids: R(['supportive'], ['oralFluid'], ['no_fluids']),
  supine: R(['supportive'], ['posture'], ['supine']),
  oxy_rate: R(['oxytocin'], ['dropsMin'], ['oxy_rate']),
  pp_bleeding: R(['ppMother'], ['bleeding'], ['pp_bleeding']),
  pp_atony: R(['ppMother'], ['tone'], ['pp_atony']),
  pp_pulse_abn: R(['ppMother'], ['pulse'], ['pp_pulse_abn']),
  pp_htn: R(['ppMother'], ['sys', 'dia'], pp(BP)),
  pp_htn_severe: R(['ppMother'], ['sys', 'dia'], pp(BP)),
  pp_hypotension: R(['ppMother'], ['sys'], ['pp_hypotension']),
  pp_fever: R(['ppMother'], ['temp'], pp(TEMP)),
  pp_temp_high: R(['ppMother'], ['temp'], pp(TEMP)),
  pp_temp_low: R(['ppMother'], ['temp'], pp(TEMP)),
  nb_breathing: R(['ppBaby'], ['breathing'], ['nb_breathing']),
  nb_cold: R(['ppBaby'], ['temp'], ['nb_cold', 'nb_hot']),
  nb_hot: R(['ppBaby'], ['temp'], ['nb_cold', 'nb_hot']),
  nb_feeding: R(['ppBaby'], ['feeding'], ['nb_feeding']),
});

function flagsOf(p, o, settings) {
  return Array.isArray(o.flags) ? o.flags : evaluateObs(p, o, settings).map(d => d.code);
}

/**
 * Resolve every open alert whose evidence rule is met by a later entry.
 * Idempotent and order-independent, so batches and back-timed entries behave
 * the same. Returns the alerts it resolved.
 */
export function reconcileAlerts(p, settings) {
  const resolved = [];
  const obs = activeObs(p).slice().sort(byTime);
  for (const a of p.alerts || []) {
    const rule = RESOLVE_ON[a.code];
    if (a.resolved || !rule) continue;
    const since = toMs(a.lastSeen || a.time);
    const ev = obs.find(o => rule.types.includes(o.type) && toMs(o.time) > since
      && rule.fields.every(f => o.v && o.v[f] != null && o.v[f] !== '')
      && !flagsOf(p, o, settings).some(c => rule.family.includes(c)));
    if (ev) resolved.push(markResolved(a, ev.time, 'evidence', null, ev.id));
  }
  return resolved;
}

/**
 * Time rules: add what fires now, and resolve open time alerts that no longer
 * fire (the condition cleared - e.g. a new exam showed progress).
 */
export function refreshTimeAlerts(p, settings, now = new Date()) {
  const at = now.toISOString();
  const drafts = evaluateTime(p, settings, now);
  const added = addAlerts(p, drafts, 'time', { time: at, raisedAt: at });
  const live = new Set(drafts.map(d => d.code));
  const resolved = (p.alerts || []).filter(a => !a.resolved && a.source === 'time' && !live.has(a.code))
    .map(a => markResolved(a, at, 'cleared'));
  return { added, resolved };
}

/** Close open time-rule alerts at birth or handover: their clocks have stopped. */
export function closeTimeAlerts(p, at, how) {
  return (p.alerts || []).filter(a => !a.resolved && a.source === 'time').map(a => markResolved(a, at, how));
}

/** Resolve open alerts matching a test (used when a birth record is voided). */
export function resolveWhere(p, test, at, how, by = null) {
  return (p.alerts || []).filter(a => !a.resolved && test(a)).map(a => markResolved(a, at, how, by));
}

/** Manual resolution (the Resolve button). Returns the alert, or null. */
export function resolveAlert(p, alertId, { by = null, reason = '', at } = {}) {
  const a = (p.alerts || []).find(x => x.id === alertId);
  if (!a || a.resolved) return null;
  markResolved(a, at || nowISO(), 'manual', by);
  if (reason) a.resolveReason = reason;
  return a;
}

/**
 * An entry was voided: detach it from the alerts it raised (an alert that no
 * other entry supports resolves) and re-open alerts it had resolved as
 * evidence - a mistyped normal value must not keep a real finding closed.
 */
export function unlinkObservation(p, obsId, at, by = null) {
  const resolved = [], reopened = [];
  for (const a of p.alerts || []) {
    const ids = linkedObs(a);
    if (ids.includes(obsId)) {
      a.obsIds = ids.filter(id => id !== obsId);
      if (!a.resolved && !a.obsIds.length) resolved.push(markResolved(a, at, 'void', by));
    }
    if (a.resolved && a.resolvedByObs === obsId) reopened.push(reopen(a));
  }
  return { resolved, reopened };
}

// ------------------------------------------------------------------------
// Emergency quick-actions (manual buttons): immediate management at
// health-centre level + referral. Sources: MOH Obstetrics Management
// Protocol for Health Centers 2021 / BEmONC; PPH per the 2025 WHO/FIGO/ICM
// guidelines.
// ------------------------------------------------------------------------

export const EMERGENCIES = [
  {
    code: 'eclampsia', label: 'Convulsion / Eclampsia',
    advice: ['Protect from injury; left-lateral; airway', 'MgSO₄ loading: 4 g IV (20%) over 5–20 min + 10 g IM (5 g each buttock with 1 ml lidocaine 2%)',
      'Control severe BP per protocol', 'Catheterise; monitor', 'REFER URGENTLY with escort'],
  },
  {
    code: 'cord_prolapse', label: 'Cord prolapse',
    advice: ['Knee–chest or deep Trendelenburg position', 'Push presenting part OFF the cord with gloved hand — keep hand in place during transport',
      'Keep cord warm/moist; do NOT push cord back', 'URGENT referral for caesarean'],
  },
  {
    code: 'aph', label: 'Heavy vaginal bleeding (APH)',
    advice: ['Do NOT perform vaginal examination', 'IV access ×2, run crystalloids fast', 'Monitor vitals + FHR', 'REFER URGENTLY — suspect placenta praevia/abruption'],
  },
  {
    code: 'shoulder_dystocia', label: 'Shoulder dystocia',
    advice: ['Call for help; note the time', 'McRoberts manoeuvre (hyperflex hips) + suprapubic pressure', 'Consider episiotomy; internal manoeuvres per training', 'Prepare newborn resuscitation'],
  },
  {
    code: 'rupture', label: 'Suspected uterine rupture',
    advice: ['Sudden pain, contractions stop, fetal parts palpable, shock, bleeding', 'IV access ×2, fluids fast', 'URGENT referral for laparotomy — minutes matter'],
  },
  {
    code: 'pph', label: 'Postpartum haemorrhage',
    advice: PPH_ACTIONS,
  },
];
