// wizard.js — the guided "record now" flow.
//
// The midwife answers one large-format question per screen (numpad / big
// buttons); the partograph is drawn automatically from the answers. Entries
// can be back-timed up to 60 min (graceful late entry — field studies show
// hard lock-outs fail on busy night shifts).

import { h, clear, openModal, numpad, stepper, segmented, toast, beep, alertBanner, minutesAgoISO } from './ui.js';
import { t } from './i18n.js';
import { LIMITS, getProtocol, stageOf } from './protocol.js';
import { evaluateObs, addAlerts } from './alerts.js';
import { S, savePatient, uid } from './store.js';

// ------------------------------------------------------------ questions ----

const YN = [{ value: 'Y', label: 'Yes' }, { value: 'N', label: 'No', alert: true }];

const STEPS = {
  baby: patient => [
    {
      key: 'fhr', q: 'Fetal heart rate (bpm)?', required: true,
      help: 'Listen for at least 1 full minute, through a contraction and 30 s after it.',
      render: (v, on) => numpad(v, on, { unit: 'bpm', maxLen: 3, alertFn: n => n < LIMITS.fhr.low || n >= LIMITS.fhr.high }),
    },
    {
      key: 'decel', q: 'Decelerations heard?', dflt: 'none',
      render: (v, on) => segmented([
        { value: 'none', label: 'None' }, { value: 'early', label: 'Early' },
        { value: 'variable', label: 'Variable' }, { value: 'late', label: 'Late', alert: true },
        { value: 'prolonged', label: 'Prolonged', alert: true },
      ], v || 'none', on, { big: true }),
    },
    {
      key: 'liquor', q: 'Amniotic fluid?', optional: true,
      help: 'Skip if membranes intact and nothing draining.',
      render: (v, on) => segmented([
        { value: 'I', label: 'Intact' }, { value: 'C', label: 'Clear' },
        { value: 'M', label: 'Meconium' }, { value: 'M3', label: 'Thick mec (+++)', alert: true },
        { value: 'B', label: 'Blood', alert: true },
      ], v, on, { big: true }),
    },
  ],

  contractions: () => [
    {
      key: 'count', q: 'Contractions in 10 minutes?', required: true,
      help: 'Palpate for a full 10 minutes.',
      render: (v, on) => stepper(v, on, { min: 0, max: 8 }),
    },
    {
      key: 'durBand', q: 'How long does each contraction last?',
      render: (v, on) => segmented([
        { value: 'lt20', label: '< 20 s', alert: true }, { value: 'b20_40', label: '20–40 s' },
        { value: 'b40_60', label: '40–60 s' }, { value: 'gt60', label: '> 60 s', alert: true },
      ], v, on, { big: true }),
    },
  ],

  pulse: () => [
    {
      key: 'pulse', q: 'Maternal pulse (bpm)?', required: true,
      render: (v, on) => numpad(v, on, { unit: 'bpm', maxLen: 3, alertFn: n => n < LIMITS.pulse.low || n >= LIMITS.pulse.high }),
    },
  ],

  vitals: () => [
    {
      key: 'sys', q: 'Blood pressure — SYSTOLIC?', required: true,
      render: (v, on) => numpad(v, on, { unit: 'mmHg', maxLen: 3, alertFn: n => n >= LIMITS.sys.high || n < LIMITS.sys.shock }),
    },
    {
      key: 'dia', q: 'Blood pressure — DIASTOLIC?', required: true,
      render: (v, on) => numpad(v, on, { unit: 'mmHg', maxLen: 3, alertFn: n => n >= LIMITS.dia.high }),
    },
    {
      key: 'temp', q: 'Temperature (°C)?', optional: true,
      render: (v, on) => numpad(v, on, { unit: '°C', decimal: true, maxLen: 4, alertFn: n => n >= LIMITS.temp.high || n < LIMITS.temp.low }),
    },
    {
      key: 'protein', q: 'Urine protein (dipstick)?', optional: true,
      help: 'Skip if no urine passed / no dipstick available.',
      render: (v, on) => segmented([
        { value: 'nil', label: 'Nil' }, { value: '+', label: '+' },
        { value: '++', label: '++', alert: true }, { value: '+++', label: '+++', alert: true },
      ], v, on, { big: true }),
    },
    {
      key: 'acetone', q: 'Urine acetone (dipstick)?', optional: true,
      render: (v, on) => segmented([
        { value: 'nil', label: 'Nil' }, { value: '+', label: '+' },
        { value: '++', label: '++', alert: true }, { value: '+++', label: '+++', alert: true },
      ], v, on, { big: true }),
    },
  ],

  exam: patient => [
    {
      key: 'dilatation', q: 'Cervical dilatation (cm)?', required: true,
      render: (v, on) => stepper(v != null ? v : lastExamValue(patient, 'dilatation'), on, { min: 0, max: 10, unit: 'cm' }),
    },
    {
      key: 'descent', q: 'Descent — fifths of head palpable above brim?',
      help: '5/5 = floating, 0/5 = fully engaged/on pelvic floor.',
      render: (v, on) => stepper(v != null ? v : lastExamValue(patient, 'descent'), on, { min: 0, max: 5, unit: '/5' }),
    },
    {
      key: 'presentation', q: 'Presentation?', dflt: 'cephalic',
      render: (v, on) => segmented([
        { value: 'cephalic', label: 'Cephalic' }, { value: 'breech', label: 'Breech', alert: true },
        { value: 'transverse', label: 'Transverse', alert: true }, { value: 'other', label: 'Other', alert: true },
      ], v || 'cephalic', on, { big: true }),
    },
    {
      key: 'position', q: 'Fetal position (if cephalic)?', optional: true,
      render: (v, on) => segmented([
        { value: 'OA', label: 'OA (anterior)' }, { value: 'OT', label: 'OT (transverse)', alert: true },
        { value: 'OP', label: 'OP (posterior)', alert: true }, { value: 'unknown', label: 'Unsure' },
      ], v, on, { big: true }),
    },
    {
      key: 'caput', q: 'Caput?', dflt: 0,
      render: (v, on) => segmented([
        { value: 0, label: 'None' }, { value: 1, label: '+' }, { value: 2, label: '++' }, { value: 3, label: '+++', alert: true },
      ], v != null ? v : 0, on, { big: true }),
    },
    {
      key: 'moulding', q: 'Moulding?', dflt: 0,
      help: '+ sutures apposed · ++ overlapped but reducible · +++ overlapped, NOT reducible',
      render: (v, on) => segmented([
        { value: 0, label: 'None' }, { value: 1, label: '+' }, { value: 2, label: '++', alert: true }, { value: 3, label: '+++', alert: true },
      ], v != null ? v : 0, on, { big: true }),
    },
    {
      key: 'liquor', q: 'Membranes / amniotic fluid?',
      render: (v, on) => segmented([
        { value: 'I', label: 'Intact' }, { value: 'C', label: 'Clear' },
        { value: 'M', label: 'Meconium' }, { value: 'M3', label: 'Thick mec (+++)', alert: true },
        { value: 'B', label: 'Blood', alert: true },
      ], v, on, { big: true }),
    },
  ],

  supportive: () => [
    {
      key: 'companion', q: 'Companion present?', dflt: 'Y',
      render: (v, on) => segmented(YN, v || 'Y', on, { big: true }),
    },
    {
      key: 'painRelief', q: 'Pain relief / comfort measures offered?', dflt: 'Y',
      render: (v, on) => segmented(YN, v || 'Y', on, { big: true }),
    },
    {
      key: 'oralFluid', q: 'Taking oral fluids?', dflt: 'Y',
      render: (v, on) => segmented(YN, v || 'Y', on, { big: true }),
    },
    {
      key: 'posture', q: 'Current position?', dflt: 'upright',
      render: (v, on) => segmented([
        { value: 'upright', label: 'Upright / mobile' }, { value: 'lateral', label: 'Lying on side' },
        { value: 'supine', label: 'Supine (on back)', alert: true },
      ], v || 'upright', on, { big: true }),
    },
  ],

  oxytocin: () => [
    {
      key: 'uL', q: 'Oxytocin concentration (units per litre)?', optional: true,
      render: (v, on) => numpad(v, on, { unit: 'U/L', maxLen: 3 }),
    },
    {
      key: 'dropsMin', q: 'Infusion rate (drops per minute)?', required: true,
      render: (v, on) => numpad(v, on, { unit: 'drops/min', maxLen: 3 }),
    },
  ],
};

function lastExamValue(patient, key) {
  const list = (patient.obs || []).filter(o => o.type === 'exam' && o.v[key] != null);
  return list.length ? list[list.length - 1].v[key] : null;
}

// --------------------------------------------------------------- wizard ----

/**
 * Open the guided recording flow.
 * types: observation types to collect, in order (e.g. from the due list).
 */
export function openRecordWizard(patient, types, onComplete) {
  if (!types.length) return;
  const plan = []; // flattened [{type, step}]
  for (const type of types) {
    const steps = (STEPS[type] || (() => []))(patient);
    steps.forEach(step => plan.push({ type, step }));
  }
  const values = {}; // type -> {key: value}
  let idx = 0;
  let obsTimeOffsetMin = 0;

  const body = h('div');
  const close = openModal(body, { locked: true });

  function header(title) {
    return [
      h('h2', null, title),
      h('div', { class: 'wizard-progress' },
        plan.map((_, i) => h('span', { class: i < idx ? 'done' : '' })),
      ),
    ];
  }

  function showTimePicker() {
    clear(body);
    let sel = 0;
    body.append(
      h('h2', null, t('record_now')),
      h('p', { class: 'wizard-q' }, 'When were these observations made?'),
      segmented([
        { value: 0, label: 'Just now' }, { value: 5, label: '5 min ago' },
        { value: 10, label: '10 min ago' }, { value: 15, label: '15 min ago' },
        { value: 30, label: '30 min ago' }, { value: 60, label: '60 min ago' },
      ], 0, v => { sel = v; }, { big: true }),
      h('div', { class: 'wizard-nav' },
        h('button', { class: 'btn secondary', onclick: () => close() }, t('cancel')),
        h('button', { class: 'btn', onclick: () => { obsTimeOffsetMin = sel; renderStep(); } }, t('next')),
      ),
    );
  }

  function renderStep() {
    if (idx >= plan.length) return finish();
    const { type, step } = plan[idx];
    values[type] = values[type] || {};
    if (values[type][step.key] == null && step.dflt !== undefined) values[type][step.key] = step.dflt;
    let current = values[type][step.key];

    clear(body);
    const errEl = h('p', { class: 'muted', style: 'color:var(--c-danger);min-height:1.2em' }, '');
    body.append(...[
      ...header(t(type)),
      h('p', { class: 'wizard-q' }, step.q),
      step.help ? h('p', { class: 'wizard-help' }, step.help) : null,
      step.render(current, v => { values[type][step.key] = v; }),
      errEl,
      h('div', { class: 'wizard-nav' },
        h('button', {
          class: 'btn secondary', onclick: () => {
            if (idx === 0) { showTimePicker(); } else { idx--; renderStep(); }
          },
        }, t('back')),
        step.optional || !step.required ? h('button', {
          class: 'btn ghost', onclick: () => { delete values[type][step.key]; idx++; renderStep(); },
        }, t('skip')) : null,
        h('button', {
          class: 'btn', onclick: () => {
            if (step.required && (values[type][step.key] == null || values[type][step.key] === '')) {
              errEl.textContent = 'This value is required.';
              return;
            }
            idx++; renderStep();
          },
        }, idx === plan.length - 1 ? t('finish') : t('next')),
      ),
    ].filter(Boolean));
  }

  async function finish() {
    close();
    const timeISO = minutesAgoISO(obsTimeOffsetMin);
    const newAlerts = await saveObservations(patient, timeISO, values);
    toast('Saved — chart updated ✓');
    if (newAlerts.length) showAlertAckModal(patient, newAlerts);
    if (onComplete) onComplete(newAlerts);
  }

  showTimePicker();
}

/** Persist collected values as observations, run the alert engine, handle stage transitions. */
export async function saveObservations(patient, timeISO, values) {
  const allNew = [];
  for (const [type, v] of Object.entries(values)) {
    if (!v || !Object.keys(v).length) continue;
    if (type === 'contractions' && v.durBand) {
      v.duration = { lt20: 15, b20_40: 30, b40_60: 50, gt60: 70 }[v.durBand];
    }
    const obs = { id: uid(), type, time: timeISO, enteredAt: new Date().toISOString(), v };
    patient.obs = patient.obs || [];
    patient.obs.push(obs);

    // stage / state transitions driven by data
    if ((type === 'baby' || type === 'exam') && v.liquor && v.liquor !== 'I' && !patient.romTime) {
      patient.romTime = timeISO;
    }
    if (type === 'exam' && v.dilatation != null) {
      const proto = getProtocol(S.settings, patient);
      if (v.dilatation >= proto.activeStartCm && stageOf(patient) === 'latent') {
        patient.status = 'active';
        patient.activeStartTime = timeISO;
        toast(`Active labour — partograph started (${proto.activeStartCm} cm reached)`);
      }
      if (v.dilatation >= 10 && stageOf(patient) !== 'second') {
        patient.status = 'second';
        patient.secondStageStart = timeISO;
        toast('Fully dilated — second stage timer started');
      }
    }

    const drafts = evaluateObs(patient, obs, S.settings);
    obs.flags = drafts.map(d => d.code);
    allNew.push(...addAlerts(patient, drafts, 'obs'));
  }
  await savePatient(patient);
  return allNew;
}

// ------------------------------------------------- alert acknowledgement ----

export function showAlertAckModal(patient, alerts) {
  const real = alerts.filter(a => a.severity !== 'info');
  if (!real.length) return;
  if (real.some(a => a.severity === 'danger') && S.settings.sound) beep('danger');
  else if (S.settings.sound) beep('due');

  let action = 'monitoring';
  const body = h('div', null,
    h('h2', null, '⚠ ' + (real.length === 1 ? real[0].title : `${real.length} alerts`)),
    real.map(a => alertBanner(a)),
    h('h3', null, 'Action taken / decision (recorded on the chart):'),
    segmented([
      { value: 'monitoring', label: 'Continue close monitoring' },
      { value: 'senior', label: 'Senior/colleague called' },
      { value: 'intervention', label: 'Intervention given' },
      { value: 'referral', label: 'Referral started', alert: true },
    ], action, v => { action = v; }),
    h('div', { class: 'wizard-nav' },
      h('button', {
        class: 'btn', onclick: async () => {
          const now = new Date().toISOString();
          for (const a of real) { a.ack = true; a.action = action; a.actionTime = now; }
          patient.notes = patient.notes || [];
          patient.notes.push({
            time: now,
            text: `Alerts acknowledged: ${real.map(a => a.title).join('; ')}`,
            plan: action,
          });
          await savePatient(patient);
          closeFn();
          if (action === 'referral') location.hash = `#/p/${patient.id}/referral`;
        },
      }, 'Acknowledge & record'),
    ),
  );
  const closeFn = openModal(body, { locked: true });
}

// ----------------------------------------------------- medication modal ----

export function openMedicationModal(patient) {
  let kind = 'medicine', detail = '', oxyUL = null, oxyDrops = null;
  const detailInput = h('input', { type: 'text', placeholder: 'e.g. Ampicillin 2 g IV', oninput: e => { detail = e.target.value; } });
  const oxySection = h('div', { style: 'display:none' },
    h('p', { class: 'muted' }, '⚠ Oxytocin augmentation in labour is a hospital-level decision in Ethiopia. At health-centre level use oxytocin for AMTSL/PPH only, per MOH protocol.'),
    h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', null, 'Units per litre'), h('input', { type: 'number', oninput: e => { oxyUL = +e.target.value || null; } })),
      h('label', { class: 'field' }, h('span', null, 'Drops/min'), h('input', { type: 'number', oninput: e => { oxyDrops = +e.target.value || null; } })),
    ),
  );
  const body = h('div', null,
    h('h2', null, 'Medication / IV fluids'),
    segmented([
      { value: 'medicine', label: 'Medicine' }, { value: 'ivfluid', label: 'IV fluids' },
      { value: 'oxytocin', label: 'Oxytocin', alert: true },
    ], kind, v => { kind = v; oxySection.style.display = v === 'oxytocin' ? '' : 'none'; }, { big: true }),
    h('div', { style: 'margin-top:12px' }, h('label', { class: 'field' }, h('span', null, 'Details (drug, dose, route)'), detailInput)),
    oxySection,
    h('div', { class: 'wizard-nav' },
      h('button', { class: 'btn secondary', onclick: () => closeFn() }, t('cancel')),
      h('button', {
        class: 'btn', onclick: async () => {
          patient.meds = patient.meds || [];
          patient.meds.push({ id: uid(), time: new Date().toISOString(), kind, detail, oxyUL, oxyDrops });
          if (kind === 'oxytocin') patient.oxytocinRunning = true;
          await savePatient(patient);
          toast('Recorded ✓');
          closeFn();
        },
      }, t('save')),
    ),
    patient.oxytocinRunning ? h('button', {
      class: 'btn ghost', style: 'margin-top:8px', onclick: async () => {
        patient.oxytocinRunning = false;
        patient.meds.push({ id: uid(), time: new Date().toISOString(), kind: 'oxytocin', detail: 'Oxytocin STOPPED' });
        await savePatient(patient);
        toast('Oxytocin marked as stopped');
        closeFn();
      },
    }, '■ Stop oxytocin infusion') : null,
  );
  const closeFn = openModal(body);
}
