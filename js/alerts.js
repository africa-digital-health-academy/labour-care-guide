// alerts.js — clinical alert engine.
//
// Severities:
//   'info'   gentle prompt (e.g. supportive care gap) — no sound
//   'warn'   review needed: recheck sooner / prepare next step
//   'danger' act now: senior review, intervention, or referral
//
// Alert text is in English, matching Ethiopian clinical training and the
// partograph form itself (both English). Advice lines reflect HEALTH-CENTER
// (BEmONC) scope: stabilise + refer for anything needing CEmONC.
// Every threshold referenced here lives in protocol.js LIMITS / PROTOCOLS.

import { LIMITS, getProtocol, parityKey, exams, timeReachedCurrentDilatation, lineStatus, stageOf, hoursBetween, fmtMin } from './protocol.js';
import { uid } from './db.js';

function A(code, severity, title, advice) {
  return { code, severity, title, advice };
}

const REFER_PREP = 'If not resolving: arrange referral early — call receiving hospital and ambulance now, transport takes time.';
const INTRAUTERINE_RESUS = [
  'Turn the woman onto her LEFT side',
  'Give IV fluids (Normal Saline / Ringer’s Lactate)',
  'Stop oxytocin if running',
  'Re-check FHR in 5–15 minutes, listen through a contraction + 30 s after',
];

// ------------------------------------------------------------------------
// Observation-triggered rules. Each receives (v, patient, proto) and returns
// an alert draft or null. Grouped by observation type.
// ------------------------------------------------------------------------

const OBS_RULES = {
  baby(v, patient) {
    const out = [];
    if (v.fhr != null) {
      if (v.fhr < LIMITS.fhr.severeLow || v.fhr >= LIMITS.fhr.severeHigh) {
        out.push(A('fhr_severe', 'danger', `FHR ${v.fhr} bpm — suspected fetal distress`,
          [...INTRAUTERINE_RESUS, 'REFER NOW unless birth is imminent', REFER_PREP]));
      } else if (v.fhr < LIMITS.fhr.low || v.fhr >= LIMITS.fhr.high) {
        out.push(A('fhr_abn', 'warn', `FHR ${v.fhr} bpm — outside normal range (110–159)`,
          [...INTRAUTERINE_RESUS, 'If abnormal on repeat: treat as fetal distress and refer']));
      }
    }
    if (v.decel === 'late' || v.decel === 'prolonged') {
      out.push(A('decel', 'danger', `${v.decel === 'late' ? 'Late' : 'Prolonged'} FHR decelerations`,
        [...INTRAUTERINE_RESUS, 'Late/prolonged decelerations suggest fetal compromise — prepare referral']));
    }
    if (v.liquor === 'M3') {
      out.push(A('liquor_thick_mec', 'danger', 'Thick meconium-stained liquor (M+++)',
        ['Monitor FHR every 15 min', 'Prepare newborn resuscitation equipment', 'Consider referral if combined with abnormal FHR or slow progress']));
    } else if (v.liquor === 'B') {
      out.push(A('liquor_blood', 'danger', 'Blood-stained liquor',
        ['Assess for antepartum haemorrhage / abruption / uterine rupture', 'Check maternal vitals and FHR now', 'REFER if bleeding more than show']));
    } else if (v.liquor === 'M') {
      out.push(A('liquor_mec', 'warn', 'Meconium-stained liquor',
        ['Increase FHR monitoring frequency', 'Prepare newborn resuscitation equipment']));
    }
    return out;
  },

  contractions(v, patient) {
    const out = [];
    const c = LIMITS.contractions;
    if (v.count > c.high || (v.duration != null && v.duration > c.durHigh && v.count >= c.high)) {
      const oxy = patient.oxytocinRunning ? ' — STOP OXYTOCIN NOW' : '';
      out.push(A('tachysystole', 'danger', `${v.count} contractions/10 min — uterine hyperstimulation${oxy}`,
        ['Stop oxytocin immediately if running', 'Left lateral position, IV fluids', 'Check FHR now', 'Consider referral — risk of rupture / fetal distress']));
    } else if (stageOf(patient) !== 'latent' && (v.count <= c.low || (v.duration != null && v.duration < c.durLow))) {
      out.push(A('weak_contractions', 'warn', `Weak contractions (${v.count}/10 min${v.duration != null ? ', ' + v.duration + ' s' : ''}) in active labour`,
        ['Encourage mobility, upright position, oral fluids', 'Empty bladder', 'Reassess progress at next exam — if no progress, refer (augmentation is a hospital-level decision)']));
    }
    return out;
  },

  pulse(v) {
    const out = [];
    if (v.pulse != null && (v.pulse < LIMITS.pulse.low || v.pulse >= LIMITS.pulse.high)) {
      out.push(A('pulse_abn', v.pulse >= 140 ? 'danger' : 'warn', `Maternal pulse ${v.pulse} bpm`,
        ['Check BP and temperature now', 'Assess for bleeding, dehydration, infection, distress', 'Give oral/IV fluids', 'If persistent ≥120 with other signs: refer']));
    }
    return out;
  },

  vitals(v) {
    const out = [];
    if (v.sys != null && v.dia != null) {
      if (v.sys >= LIMITS.sys.severe || v.dia >= LIMITS.dia.severe) {
        out.push(A('htn_severe', 'danger', `Severe hypertension ${v.sys}/${v.dia} mmHg`,
          ['Check urine protein NOW', 'Severe pre-eclampsia until proven otherwise',
           'Give MgSO₄ loading dose BEFORE referral: 4 g IV (20%) slowly over 5–20 min + 10 g IM (5 g each buttock)',
           'Give antihypertensive per protocol if available', 'REFER urgently — call ahead']));
      } else if (v.sys >= LIMITS.sys.high || v.dia >= LIMITS.dia.high) {
        out.push(A('htn', 'warn', `Elevated BP ${v.sys}/${v.dia} mmHg`,
          ['Re-check after 15–30 min rest', 'Check urine protein', 'If ≥140/90 persists + proteinuria: manage as pre-eclampsia and refer']));
      }
      if (v.sys < LIMITS.sys.shock && v.sys > 0) {
        out.push(A('hypotension', 'danger', `Systolic BP ${v.sys} mmHg — possible shock`,
          ['Look for bleeding (revealed or concealed)', 'IV access ×2, run fluids fast', 'REFER NOW']));
      }
    }
    if (v.temp != null) {
      if (v.temp >= LIMITS.temp.fever) {
        out.push(A('fever', 'danger', `Temperature ${v.temp} °C — fever in labour`,
          ['Suspect chorioamnionitis / infection', 'Give first-dose antibiotics per protocol', 'Antipyretic + fluids', 'Monitor FHR closely (fetal tachycardia)', 'REFER']));
      } else if (v.temp >= LIMITS.temp.high) {
        out.push(A('temp_high', 'warn', `Temperature ${v.temp} °C`,
          ['Re-check within 1 h', 'Encourage oral fluids', 'Look for infection source; check FHR']));
      } else if (v.temp < LIMITS.temp.low) {
        out.push(A('temp_low', 'warn', `Temperature ${v.temp} °C — hypothermia`, ['Warm the woman, re-check', 'Assess for shock/sepsis']));
      }
    }
    if (v.protein === '++' || v.protein === '+++') {
      out.push(A('proteinuria', 'warn', `Proteinuria ${v.protein}`,
        ['Check BP now — if hypertensive, manage as pre-eclampsia', 'If BP normal: consider infection, re-test']));
    }
    if (v.acetone === '++' || v.acetone === '+++') {
      out.push(A('ketonuria', 'warn', `Ketonuria ${v.acetone}`, ['Give oral/IV fluids and calories — maternal exhaustion risk']));
    }
    return out;
  },

  exam(v, patient, proto) {
    const out = [];
    if (v.moulding >= 3) {
      out.push(A('moulding3', 'danger', 'Moulding +++ (sutures overlapped, not reducible)',
        ['Suspect cephalopelvic disproportion / obstructed labour', 'Do NOT augment', 'REFER NOW for possible caesarean', REFER_PREP]));
    } else if (v.moulding === 2 || v.caput >= 3) {
      out.push(A('moulding_caput', 'warn', `Moulding ${'+'.repeat(v.moulding || 0)} / Caput ${'+'.repeat(v.caput || 0)}`,
        ['Watch closely for obstruction — combine with progress and descent', 'If progress is also slow: refer']));
    }
    if (v.position === 'OP' || v.position === 'OT') {
      out.push(A('malposition', 'warn', `Fetal position: occiput ${v.position === 'OP' ? 'posterior' : 'transverse'}`,
        ['Encourage upright/all-fours positions', 'Expect slower progress; monitor closely', 'Persistent OT/OP with arrest → refer']));
    }
    if (v.presentation && v.presentation !== 'cephalic') {
      out.push(A('malpresentation', 'danger', `Malpresentation: ${v.presentation}`,
        ['Breech/transverse/other malpresentation in labour at health-centre level', 'REFER NOW unless birth imminent', 'If cord prolapse: knee-chest position, push presenting part up, URGENT referral']));
    }
    // labour progress
    if (v.dilatation != null && patient.activeStartTime && stageOf(patient) === 'active') {
      if (proto.alertActionLines) {
        const ls = lineStatus(proto, patient, v.dilatation, v._time || new Date().toISOString());
        if (ls === 'action') {
          out.push(A('action_line', 'danger', 'Partograph: crossed the ACTION line',
            ['Full reassessment: contractions, descent, moulding, bladder, hydration', 'REFER NOW to hospital (CEmONC) unless delivery is imminent', REFER_PREP]));
        } else if (ls === 'alert') {
          out.push(A('alert_line', 'warn', 'Partograph: crossed the alert line',
            ['Reassess in 2 h or sooner', 'Support: mobility, fluids, empty bladder', 'At health centre: begin referral preparation — if action line is crossed, refer']));
        }
      } else if (proto.dilatationLagMin) {
        const reach = timeReachedCurrentDilatation(patient);
        const limit = proto.dilatationLagMin[v.dilatation];
        if (reach && limit && reach.cm === v.dilatation) {
          const lag = (new Date(v._time || Date.now()) - new Date(reach.since)) / 60000;
          if (lag >= limit) {
            out.push(A('lcg_progress', 'danger', `No progress: ${v.dilatation} cm for ${fmtMin(lag)} (limit ${fmtMin(limit)})`,
              ['WHO LCG progress alert — assess contractions, position, descent, moulding, bladder', 'At health centre: refer for labour dystocia unless birth imminent', REFER_PREP]));
          }
        }
      }
    }
    return out;
  },

  supportive(v) {
    const out = [];
    if (v.companion === 'N') out.push(A('no_companion', 'info', 'No labour companion present', ['Invite and encourage a companion of her choice — improves outcomes']));
    if (v.posture === 'supine') out.push(A('supine', 'info', 'Woman lying supine', ['Encourage upright positions or left-lateral — supine position reduces placental blood flow']));
    if (v.oralFluid === 'N') out.push(A('no_fluids', 'info', 'No oral fluids taken', ['Offer fluids/light food — prevents ketosis and exhaustion']));
    return out;
  },

  oxytocin(v, patient) {
    const out = [];
    if (v.dropsMin != null && v.dropsMin > 60) {
      out.push(A('oxy_rate', 'warn', `Oxytocin at ${v.dropsMin} drops/min`, ['Verify rate against protocol — do not exceed maximum', 'Check contractions and FHR every 30 min']));
    }
    return out;
  },
};

/**
 * Evaluate one observation. Returns alert drafts (not yet stored).
 * obs = {type, time, v}
 */
export function evaluateObs(patient, obs, settings) {
  const proto = getProtocol(settings, patient);
  const rule = OBS_RULES[obs.type];
  if (!rule) return [];
  const v = Object.assign({}, obs.v, { _time: obs.time });
  return rule(v, patient, proto) || [];
}

// ------------------------------------------------------------------------
// Time-based checks — run periodically (dashboard tick), independent of data
// entry, so a busy night-shift midwife is still warned.
// ------------------------------------------------------------------------

export function evaluateTime(patient, settings, now = new Date()) {
  const proto = getProtocol(settings, patient);
  const out = [];
  const stage = stageOf(patient);

  if (stage === 'latent') {
    const start = patient.laborOnsetTime || (patient.admission && patient.admission.time);
    if (start && hoursBetween(start, now) >= LIMITS.latentMaxHours) {
      out.push(A('latent_long', 'warn', `Latent phase > ${LIMITS.latentMaxHours} h`,
        ['Prolonged latent phase — full reassessment', 'Exclude false labour; check wellbeing', 'Consider referral per protocol']));
    }
  }

  if (stage === 'active' && patient.activeStartTime) {
    if (hoursBetween(patient.activeStartTime, now) >= LIMITS.activeMaxHours) {
      out.push(A('active_long', 'warn', `Active first stage > ${LIMITS.activeMaxHours} h`,
        ['Prolonged active phase — reassess and refer if not progressing']));
    }
    // LCG: progress-limit reached since last exam → prompt examination
    if (proto.dilatationLagMin) {
      const reach = timeReachedCurrentDilatation(patient);
      if (reach && proto.dilatationLagMin[reach.cm]) {
        const lag = (now - new Date(reach.since)) / 60000;
        if (lag >= proto.dilatationLagMin[reach.cm]) {
          out.push(A('lcg_progress_due', 'warn', `${reach.cm} cm for ${fmtMin(lag)} — progress limit reached`,
            ['Perform vaginal examination now to assess progress', 'If unchanged: manage as labour dystocia / refer']));
        }
      }
    } else if (proto.alertActionLines && exams(patient).length) {
      const last = exams(patient).slice(-1)[0];
      const ls = lineStatus(proto, patient, last.v.dilatation, now.toISOString());
      if (ls === 'action') {
        out.push(A('action_line_proj', 'danger', 'Projected beyond ACTION line — examine now',
          ['Time alone has carried this labour past the action line', 'Examine immediately; if confirmed, REFER']));
      } else if (ls === 'alert') {
        out.push(A('alert_line_proj', 'warn', 'Projected beyond alert line — examine soon',
          ['Based on time since last exam, progress may have crossed the alert line', 'Examine and replot']));
      }
    }
  }

  if (stage === 'second' && patient.secondStageStart) {
    const mins = (now - new Date(patient.secondStageStart)) / 60000;
    const k = parityKey(patient);
    if (mins >= proto.secondStageLimitMin[k]) {
      out.push(A('second_long', 'danger', `Second stage ${fmtMin(mins)} (${k === 'nulli' ? 'first birth' : 'multipara'})`,
        ['Prolonged second stage', 'At health centre: REFER unless birth is imminent', 'Prepare newborn resuscitation', REFER_PREP]));
    } else if (mins >= proto.secondStageWarnMin[k]) {
      out.push(A('second_warn', 'warn', `Second stage ${fmtMin(mins)}`,
        ['Check descent, FHR every 5 min, contractions', 'Encourage upright positioning and effective pushing', 'Begin referral preparation if no descent']));
    }
  }

  if (patient.romTime && isWet(patient) && hoursBetween(patient.romTime, now) >= LIMITS.romMaxHours) {
    out.push(A('prom_long', 'warn', `Membranes ruptured > ${LIMITS.romMaxHours} h`,
      ['Risk of infection — give prophylactic antibiotics per protocol', 'Check temperature and FHR now', 'Refer if signs of infection']));
  }

  return out;
}

function isWet(patient) {
  return ['latent', 'active', 'second'].includes(stageOf(patient));
}

// ------------------------------------------------------------------------
// Adding alerts to the patient record (with de-duplication so the same
// condition does not stack endlessly — alert-fatigue lesson from the field).
// ------------------------------------------------------------------------

export function addAlerts(patient, drafts, source = 'obs') {
  const added = [];
  patient.alerts = patient.alerts || [];
  for (const d of drafts) {
    const existing = patient.alerts.find(a => a.code === d.code && !a.resolved);
    if (existing) {
      existing.lastSeen = new Date().toISOString();
      existing.count = (existing.count || 1) + 1;
      // escalate severity if it got worse
      if (d.severity === 'danger' && existing.severity !== 'danger') {
        existing.severity = 'danger';
        existing.title = d.title;
        existing.ack = false;
        added.push(existing);
      }
      continue;
    }
    const alert = {
      id: uid(), time: new Date().toISOString(),
      code: d.code, severity: d.severity, title: d.title, advice: d.advice,
      source, ack: false, resolved: false, action: null,
    };
    patient.alerts.push(alert);
    added.push(alert);
  }
  return added;
}

// ------------------------------------------------------------------------
// Emergency quick-actions (manual buttons): immediate management at
// health-centre level + referral. Sources: MOH Obstetrics Management
// Protocol for Health Centers 2021 / BEmONC.
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
    advice: ['Call for help; massage uterus', 'Oxytocin 10 IU IM (repeat per protocol)', 'Empty bladder; check placenta and tears',
      'Bimanual compression / aortic compression if severe', 'IV fluids fast; REFER if not controlled'],
  },
];
