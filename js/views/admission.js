// views/admission.js — new admission form.
// Captures the LCG first-page items + Ethiopian risk screening. Women with
// conditions that should deliver at hospital level (CEmONC) are flagged
// immediately so referral happens BEFORE labour advances.
//
// M3: the baseline records only what was examined or asked (S4, through
// record.admissionEntries); labour onset, the rupture time or U = unknown and
// the companion answer are asked, never assumed (F4); every entry carries the
// initials of the person admitting (F3).

import { h, field, segmented, toast, byField, isoToLocalInput, localInputToISO } from '../ui.js';
import { t } from '../i18n.js';
import { S, savePatient, uid, getBy, setBy } from '../store.js';
import { getProtocol } from '../protocol.js';
import { addAlerts, admissionRiskAlerts, FLAG } from '../alerts.js';
import { admissionEntries, applyObservations, createCase } from '../record.js';
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

// Amniotic fluid once the membranes have ruptured (manual Table 4). 'M', v1's
// ungraded meconium, is never offered; the alert marks come from the engine.
const FLUID_OPTIONS = [['C', 'Clear'], ['M1', 'M+'], ['M2', 'M++'], ['M3', 'M+++ thick'], ['B', 'Blood']]
  .map(([value, label]) => ({ value, label, alert: FLAG.liquor(value) }));

// Companion of her choice (manual Table 3): Y yes, N no (the alert value), D declines.
const COMPANION_OPTIONS = [['Y', 'Present'], ['N', 'Wanted, not present'], ['D', 'Declines']]
  .map(([value, label]) => ({ value, label, alert: FLAG.supportive('companion', value) }));

const ONSET_OPTIONS = [{ value: 'spontaneous', label: 'Spontaneous' }, { value: 'induced', label: 'Induced' }];
const MEMBRANE_OPTIONS = [{ value: 'intact', label: 'Intact' }, { value: 'ruptured', label: 'Ruptured' }];

/**
 * A labelled question with no default answer. A <label> forwards a tap on its
 * text to its first button, which would silently pick the first option.
 */
function choiceField(labelText, control) {
  return h('label', {
    class: 'field',
    onclick: e => { if (!e.target.closest('button, input, select, textarea')) e.preventDefault(); },
  }, h('span', null, labelText), control);
}

/** Segmented choice that may stay unanswered: "clear" takes it back to unset. */
function optionalChoice(opts, initial, onChange) {
  let value = initial;
  const wrap = h('div');
  const paint = () => {
    const parts = [segmented(opts, value, v => { value = v; onChange(v); paint(); })];
    if (value != null) {
      parts.push(h('button', {
        type: 'button', class: 'btn ghost', onclick: () => { value = null; onChange(null); paint(); },
      }, 'clear'));
    }
    wrap.replaceChildren(...parts);
  };
  paint();
  return wrap;
}

export function renderAdmission() {
  const m = {
    name: '', age: null, mrn: '', phone: '', phoneCode: '+251', phoneNumber: '', kebele: '',
    gravida: null, para: null, gaWeeks: null,
    riskFactors: [],
    onsetMode: null,                                    // 'spontaneous' | 'induced', required (F4)
    membranes: null, romTime: '', romUnknown: false, liquor: null,
    laborOnsetTime: isoToLocalInput(new Date(Date.now() - 2 * 3600000).toISOString()),
    admissionTime: isoToLocalInput(),
    dilatation: null, descent: null, fhr: null, pulse: null,
    sys: null, dia: null, temp: null, presentation: 'cephalic',
    contractions: null, companion: null,                // Y | N | D, unset until asked
  };
  let by = '';
  let saving = false;

  const input = (key, type = 'text', attrs = {}) => h('input', Object.assign({
    type, value: m[key] ?? '',
    oninput: e => { m[key] = type === 'number' ? (e.target.value === '' ? null : +e.target.value) : e.target.value; },
  }, attrs));

  // Ruptured membranes: the time, or U = unknown (F4), and the fluid if seen.
  const romTimeField = field('When did the membranes rupture? *', h('input', {
    type: 'datetime-local', value: m.romTime, oninput: e => { m.romTime = e.target.value; },
  }));
  const romBlock = h('div', { style: 'display:none' },
    romTimeField,
    h('div', { class: 'checklist', style: 'margin-bottom:12px' }, h('label', null,
      h('input', {
        type: 'checkbox',
        onchange: e => { m.romUnknown = e.target.checked; romTimeField.style.display = m.romUnknown ? 'none' : ''; },
      }),
      'Time unknown (U) - she cannot say and there is no record')),
    choiceField('Amniotic fluid (if seen)', optionalChoice(FLUID_OPTIONS, m.liquor, v => { m.liquor = v; })),
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

  const page = h('div', { class: 'page', 'data-form': 'admission' },
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
      choiceField('Labour onset *', segmented(ONSET_OPTIONS, m.onsetMode, v => { m.onsetMode = v; })),
      h('p', { class: 'muted', style: 'margin-top:-6px' },
        'Induced: labour was started by oxytocin, prostaglandins, artificial rupture of the membranes, a balloon catheter or any other artificial means.'),
      h('div', { class: 'grid2' },
        field('Labour onset time (approx.)', h('input', { type: 'datetime-local', value: m.laborOnsetTime, oninput: e => { m.laborOnsetTime = e.target.value; } })),
        field('Admission time', h('input', { type: 'datetime-local', value: m.admissionTime, oninput: e => { m.admissionTime = e.target.value; } })),
      ),
      choiceField('Membranes *', segmented(MEMBRANE_OPTIONS, m.membranes, v => {
        m.membranes = v;
        romBlock.style.display = v === 'ruptured' ? '' : 'none';
      })),
      romBlock,
      choiceField('Companion of her choice', optionalChoice(COMPANION_OPTIONS, m.companion, v => { m.companion = v; })),
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
    byField(getBy(), v => { by = v; }),
    h('button', { class: 'btn big', onclick: save }, '✓ Admit & start monitoring'),
    h('p', { class: 'muted', style: 'text-align:center' },
      'The monitoring schedule and partograph start automatically from these values.'),
  );

  /** The first missing or impossible answer, or null when the form can be saved. */
  function problem() {
    if (!m.name.trim()) return 'Name is required';
    if (m.gravida == null || m.para == null) return 'Gravida and Para are required';
    if (!m.onsetMode) return 'Labour onset: choose Spontaneous or Induced';
    if (!m.membranes) return 'Membranes: choose Intact or Ruptured';
    if (m.membranes === 'ruptured' && !m.romUnknown) {
      const rom = localInputToISO(m.romTime);
      if (!rom) return 'Enter when the membranes ruptured, or tick Time unknown (U)';
      if (new Date(rom) > new Date()) return 'The rupture time is in the future';
    }
    if (m.dilatation == null || m.fhr == null) return 'Admission dilatation and FHR are required';
    if (!by) return 'Your initials are required';
    return null;
  }

  /** The new case with its admission entries and alerts (nothing saved yet). */
  function admit() {
    const proto = getProtocol(S.settings, null);
    const admTime = localInputToISO(m.admissionTime) || new Date().toISOString();
    const ruptured = m.membranes === 'ruptured';
    const fields = {
      id: uid(), createdAt: new Date().toISOString(),
      name: m.name.trim(), age: m.age, mrn: m.mrn, phone: m.phone, kebele: m.kebele,
      gravida: m.gravida, para: m.para, gaWeeks: m.gaWeeks,
      riskFactors: m.riskFactors,
      onsetMode: m.onsetMode,
      laborOnsetTime: localInputToISO(m.laborOnsetTime),
      // U = unknown: ruptured, no time (F4); the engine then never derives one
      romUnknown: ruptured && m.romUnknown,
      romTime: ruptured && !m.romUnknown ? localInputToISO(m.romTime) : null,
      admission: {
        time: admTime, dilatation: m.dilatation, descent: m.descent,
        fhr: m.fhr, pulse: m.pulse, sys: m.sys, dia: m.dia, temp: m.temp,
        presentation: m.presentation, companion: m.companion, by,
      },
      status: 'latent', activeStartTime: null, secondStageStart: null, // derived from the admission exam below
      protocolId: proto.id,
    };
    // Y (present) and N (wanted, not present) both mean she wants one; unasked stays unknown
    if (m.companion) fields.companionWanted = m.companion !== 'D';
    // created in the current schema so a reload never re-migrates it (record.js)
    const p = createCase(fields);

    // only what was examined or asked becomes an entry (S4)
    const baseline = admissionEntries({
      fhr: m.fhr, contractions: m.contractions, pulse: m.pulse,
      sys: m.sys, dia: m.dia, temp: m.temp,
      dilatation: m.dilatation, descent: m.descent, presentation: m.presentation,
      membranes: m.membranes, liquor: ruptured ? m.liquor : null, companion: m.companion,
    });
    const alerts = [...applyObservations(p, admTime, baseline, S.settings, { by, source: 'admission' }).added];

    // risk factors that should deliver at hospital (CEmONC) level
    const labelOf = code => (RISK_FACTORS.find(x => x[0] === code) || [code, code])[1];
    alerts.push(...addAlerts(p, admissionRiskAlerts(p, S.settings, labelOf), 'admission', { time: admTime }));
    return { p, alerts };
  }

  async function save() {
    if (saving) return; // a double tap must not admit her twice
    const why = problem();
    if (why) { toast(why, 'danger'); return; }
    saving = true; // stays set once saved: the page is about to be replaced
    let made;
    try {
      made = admit();
      page.dataset.saved = '1'; // lets the app re-render: nothing left to lose
      await savePatient(made.p);
    } catch (e) {
      saving = false;
      delete page.dataset.saved;
      toast('Could not admit: ' + ((e && e.message) || e), 'danger');
      return;
    }
    const { p, alerts } = made;
    setBy(by);
    toast('Admitted — monitoring schedule started ✓');
    location.hash = '#/p/' + p.id;
    if (alerts.length) setTimeout(() => showAlertAckModal(p, alerts), 300);
  }

  return page;
}
