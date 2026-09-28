// views/admission.js — new admission form.
// Captures the LCG first-page items + Ethiopian risk screening. Women with
// conditions that should deliver at hospital level (CEmONC) are flagged
// immediately so referral happens BEFORE labour advances.

import { h, field, segmented, toast, isoToLocalInput, localInputToISO } from '../ui.js';
import { t } from '../i18n.js';
import { S, savePatient, uid } from '../store.js';
import { getProtocol } from '../protocol.js';
import { evaluateObs, addAlerts } from '../alerts.js';
import { showAlertAckModal } from '../wizard.js';

// Country dial codes — Ethiopia (+251) first and default; neighbours and common
// diaspora destinations follow. (Flag emoji show as country letters on Windows.)
const COUNTRY_CODES = [
  ['+251', '🇪🇹', 'Ethiopia'],
  ['+254', '🇰🇪', 'Kenya'],
  ['+252', '🇸🇴', 'Somalia'],
  ['+291', '🇪🇷', 'Eritrea'],
  ['+253', '🇩🇯', 'Djibouti'],
  ['+211', '🇸🇸', 'South Sudan'],
  ['+249', '🇸🇩', 'Sudan'],
  ['+256', '🇺🇬', 'Uganda'],
  ['+255', '🇹🇿', 'Tanzania'],
  ['+250', '🇷🇼', 'Rwanda'],
  ['+20', '🇪🇬', 'Egypt'],
  ['+27', '🇿🇦', 'South Africa'],
  ['+234', '🇳🇬', 'Nigeria'],
  ['+971', '🇦🇪', 'UAE'],
  ['+966', '🇸🇦', 'Saudi Arabia'],
  ['+1', '🇺🇸', 'USA / Canada'],
  ['+44', '🇬🇧', 'UK'],
  ['+91', '🇮🇳', 'India'],
];

const RISK_FACTORS = [
  ['prior_cs', 'Previous caesarean section', true],
  ['grand_multi', 'Grand multipara (≥5 births)', false],
  ['multiple', 'Multiple pregnancy (twins+)', true],
  ['malpresentation', 'Known malpresentation', true],
  ['aph', 'Bleeding this pregnancy (APH)', true],
  ['preeclampsia', 'Pre-eclampsia / hypertension', false],
  ['anaemia', 'Anaemia', false],
  ['diabetes', 'Diabetes', false],
  ['hiv', 'HIV positive', false],
  ['young', 'Age below 18', false],
  ['short', 'Height < 150 cm', false],
  ['preterm', 'Preterm (< 37 weeks)', false],
];

export function renderAdmission() {
  const m = {
    name: '', age: null, mrn: '', phone: '', phoneCode: '+251', phoneNumber: '', kebele: '',
    gravida: null, para: null, gaWeeks: null,
    riskFactors: [],
    membranes: 'intact', romTime: null,
    laborOnsetTime: isoToLocalInput(new Date(Date.now() - 2 * 3600000).toISOString()),
    admissionTime: isoToLocalInput(),
    dilatation: null, descent: null, fhr: null, pulse: null,
    sys: null, dia: null, temp: null, presentation: 'cephalic',
    contractions: null, companion: 'Y',
  };

  const input = (key, type = 'text', attrs = {}) => h('input', Object.assign({
    type, value: m[key] ?? '',
    oninput: e => { m[key] = type === 'number' ? (e.target.value === '' ? null : +e.target.value) : e.target.value; },
  }, attrs));

  const romTimeField = h('div', { style: m.membranes === 'intact' ? 'display:none' : '' },
    field('When did membranes rupture?', h('input', {
      type: 'datetime-local', value: isoToLocalInput(),
      oninput: e => { m.romTime = e.target.value; },
    })),
  );

  // Phone: country-code selector (Ethiopia default) + number; combined into m.phone.
  function syncPhone() { m.phone = m.phoneNumber.trim() ? `${m.phoneCode} ${m.phoneNumber.trim()}` : ''; }
  const phoneCodeSelect = h('select', {
    style: 'flex:0 0 auto; width:auto; min-width:104px', 'aria-label': 'Country code',
    onchange: e => { m.phoneCode = e.target.value; syncPhone(); },
  }, COUNTRY_CODES.map(([code, flag, name]) => h('option', { value: code, title: name }, `${flag} ${code}`)));
  phoneCodeSelect.value = m.phoneCode;
  const phoneField = h('div', { style: 'display:flex; gap:8px' },
    phoneCodeSelect,
    h('input', {
      type: 'tel', inputmode: 'tel', placeholder: '912 345 678', style: 'flex:1',
      oninput: e => { m.phoneNumber = e.target.value; syncPhone(); },
    }),
  );

  const page = h('div', { class: 'page' },
    h('div', { class: 'card' },
      h('h2', null, '1 · ' + t('mother')),
      h('div', { class: 'grid2' },
        field(t('name') + ' *', input('name')),
        field(t('age'), input('age', 'number', { min: 10, max: 60 })),
        field('MRN / card number', input('mrn')),
        field('Phone', phoneField),
        field('Kebele / address', input('kebele')),
      ),
    ),
    h('div', { class: 'card' },
      h('h2', null, '2 · Obstetric history'),
      h('div', { class: 'grid3' },
        field(t('gravida') + ' *', input('gravida', 'number', { min: 1, max: 20 })),
        field(t('para') + ' *', input('para', 'number', { min: 0, max: 20 })),
        field('GA (weeks)', input('gaWeeks', 'number', { min: 20, max: 45 })),
      ),
      h('h3', null, 'Risk factors (tick all that apply)'),
      h('div', { class: 'checklist' },
        RISK_FACTORS.map(([code, label]) => h('label', null,
          h('input', {
            type: 'checkbox',
            onchange: e => {
              if (e.target.checked) m.riskFactors.push(code);
              else m.riskFactors = m.riskFactors.filter(r => r !== code);
            },
          }),
          label,
        )),
      ),
    ),
    h('div', { class: 'card' },
      h('h2', null, '3 · Labour status'),
      h('div', { class: 'grid2' },
        field('Labour onset (approx.)', h('input', { type: 'datetime-local', value: m.laborOnsetTime, oninput: e => { m.laborOnsetTime = e.target.value; } })),
        field('Admission time', h('input', { type: 'datetime-local', value: m.admissionTime, oninput: e => { m.admissionTime = e.target.value; } })),
      ),
      field('Membranes', segmented([
        { value: 'intact', label: 'Intact' }, { value: 'ruptured', label: 'Ruptured' },
      ], m.membranes, v => { m.membranes = v; romTimeField.style.display = v === 'intact' ? 'none' : ''; })),
      romTimeField,
      field(t('companion'), segmented([{ value: 'Y', label: t('yes') }, { value: 'N', label: t('no') }], m.companion, v => { m.companion = v; })),
    ),
    h('div', { class: 'card' },
      h('h2', null, '4 · Admission examination'),
      h('div', { class: 'grid3' },
        field('Cervical dilatation (cm) *', input('dilatation', 'number', { min: 0, max: 10 })),
        field('Descent (fifths palpable)', input('descent', 'number', { min: 0, max: 5 })),
        field('FHR (bpm) *', input('fhr', 'number', { min: 50, max: 220 })),
        field('Contractions /10 min', input('contractions', 'number', { min: 0, max: 8 })),
        field('Pulse (bpm)', input('pulse', 'number', { min: 30, max: 200 })),
        field('Temp (°C)', input('temp', 'number', { step: '0.1', min: 30, max: 43 })),
        field('BP systolic', input('sys', 'number', { min: 50, max: 260 })),
        field('BP diastolic', input('dia', 'number', { min: 30, max: 160 })),
      ),
      field('Presentation', segmented([
        { value: 'cephalic', label: 'Cephalic' }, { value: 'breech', label: 'Breech', alert: true },
        { value: 'transverse', label: 'Transverse', alert: true }, { value: 'other', label: 'Other', alert: true },
      ], m.presentation, v => { m.presentation = v; })),
    ),
    h('button', { class: 'btn big', onclick: save }, '✓ Admit & start monitoring'),
    h('p', { class: 'muted', style: 'text-align:center' },
      'The monitoring schedule and partograph start automatically from these values.'),
  );

  async function save() {
    if (!m.name.trim()) { toast('Name is required', 'danger'); return; }
    if (m.gravida == null || m.para == null) { toast('Gravida and Para are required', 'danger'); return; }
    if (m.dilatation == null || m.fhr == null) { toast('Admission dilatation and FHR are required', 'danger'); return; }

    const proto = getProtocol(S.settings, null);
    const admTime = localInputToISO(m.admissionTime) || new Date().toISOString();
    const p = {
      id: uid(), createdAt: new Date().toISOString(),
      name: m.name.trim(), age: m.age, mrn: m.mrn, phone: m.phone, kebele: m.kebele,
      gravida: m.gravida, para: m.para, gaWeeks: m.gaWeeks,
      riskFactors: m.riskFactors,
      laborOnsetTime: localInputToISO(m.laborOnsetTime),
      romTime: m.membranes === 'ruptured' ? (localInputToISO(m.romTime) || admTime) : null,
      admission: {
        time: admTime, dilatation: m.dilatation, descent: m.descent,
        fhr: m.fhr, pulse: m.pulse, sys: m.sys, dia: m.dia, temp: m.temp,
        presentation: m.presentation, companion: m.companion,
      },
      status: m.dilatation >= proto.activeStartCm ? 'active' : 'latent',
      activeStartTime: m.dilatation >= proto.activeStartCm ? admTime : null,
      secondStageStart: m.dilatation >= 10 ? admTime : null,
      obs: [], meds: [], alerts: [], notes: [],
      protocolOverride: null, oxytocinRunning: false,
      referral: null, delivery: null, newborn: null,
    };
    if (m.dilatation >= 10) p.status = 'second';

    // baseline observations so the chart starts populated
    const baseline = [];
    baseline.push({ type: 'baby', v: { fhr: m.fhr, decel: 'none', liquor: m.membranes === 'intact' ? 'I' : 'C' } });
    if (m.contractions != null) baseline.push({ type: 'contractions', v: { count: m.contractions } });
    if (m.pulse != null) baseline.push({ type: 'pulse', v: { pulse: m.pulse } });
    if (m.sys != null && m.dia != null) baseline.push({ type: 'vitals', v: { sys: m.sys, dia: m.dia, temp: m.temp } });
    baseline.push({
      type: 'exam',
      v: { dilatation: m.dilatation, descent: m.descent, presentation: m.presentation, liquor: m.membranes === 'intact' ? 'I' : 'C' },
    });
    baseline.push({ type: 'supportive', v: { companion: m.companion, painRelief: 'Y', oralFluid: 'Y', posture: 'upright' } });

    const newAlerts = [];
    for (const b of baseline) {
      const obs = { id: uid(), type: b.type, time: admTime, enteredAt: new Date().toISOString(), v: b.v };
      p.obs.push(obs);
      const drafts = evaluateObs(p, obs, S.settings);
      obs.flags = drafts.map(d => d.code);
      newAlerts.push(...addAlerts(p, drafts, 'obs'));
    }

    // risk factors that should deliver at hospital (CEmONC) level
    const referAtAdmission = m.riskFactors.filter(r => ['prior_cs', 'multiple', 'malpresentation', 'aph'].includes(r));
    if (m.presentation !== 'cephalic' && !referAtAdmission.includes('malpresentation')) referAtAdmission.push('malpresentation');
    if (referAtAdmission.length && S.settings.facilityLevel === 'health_center') {
      newAlerts.push(...addAlerts(p, [{
        code: 'admission_risk', severity: 'danger',
        title: 'High-risk admission — hospital-level birth recommended',
        advice: [
          'Risk factors: ' + referAtAdmission.map(r => (RISK_FACTORS.find(x => x[0] === r) || [r, r])[1]).join(', '),
          'This woman should deliver at a hospital (CEmONC) — refer now unless birth is imminent',
          'If labour is advanced, prepare for delivery AND alert the referral hospital',
        ],
      }], 'obs'));
    }

    await savePatient(p);
    toast('Admitted — monitoring schedule started ✓');
    location.hash = '#/p/' + p.id;
    if (newAlerts.length) setTimeout(() => showAlertAckModal(p, newAlerts), 300);
  }

  return page;
}
