// views/admission.js — new admission form.
// Captures the LCG first-page items + Ethiopian risk screening. Women with
// conditions that should deliver at hospital level (CEmONC) are flagged
// immediately so referral happens BEFORE labour advances.
//
// M3: the baseline records only what was examined or asked (S4, through
// record.admissionEntries); labour onset, the presentation, the rupture time
// or U = unknown and the companion answer are asked, never assumed (F4); every
// entry carries the initials of the person admitting (F3).
//
// M5: every label goes through t() ('fm.' keys in js/i18n/forms.js). The
// stored values stay codes; the admission alert quotes the risk factors in
// English, like every alert title and advice (the alerts are not translated).

import { h, field, segmented, toast, byField, isoToLocalInput, localInputToISO } from '../ui.js';
import { t } from '../i18n.js';
import { en as formsEN } from '../i18n/forms.js';
import { S, savePatient, uid, getBy, setBy } from '../store.js';
import { getProtocol } from '../protocol.js';
import { addAlerts, admissionRiskAlerts, FLAG } from '../alerts.js';
import { admissionEntries, applyObservations, createCase } from '../record.js';
import { showAlertAckModal } from '../wizard.js';

// Country dial codes — Ethiopia (+251) first and default; neighbours and common
// diaspora destinations follow. (Flag emoji show as country letters on Windows.)
const COUNTRY_CODES = [
  ['+251', '🇪🇹', 'fm.country.ET'],
  ['+254', '🇰🇪', 'fm.country.KE'],
  ['+252', '🇸🇴', 'fm.country.SO'],
  ['+291', '🇪🇷', 'fm.country.ER'],
  ['+253', '🇩🇯', 'fm.country.DJ'],
  ['+211', '🇸🇸', 'fm.country.SS'],
  ['+249', '🇸🇩', 'fm.country.SD'],
  ['+256', '🇺🇬', 'fm.country.UG'],
  ['+255', '🇹🇿', 'fm.country.TZ'],
  ['+250', '🇷🇼', 'fm.country.RW'],
  ['+20', '🇪🇬', 'fm.country.EG'],
  ['+27', '🇿🇦', 'fm.country.ZA'],
  ['+234', '🇳🇬', 'fm.country.NG'],
  ['+971', '🇦🇪', 'fm.country.AE'],
  ['+966', '🇸🇦', 'fm.country.SA'],
  ['+1', '🇺🇸', 'fm.country.US'],
  ['+44', '🇬🇧', 'fm.country.GB'],
  ['+91', '🇮🇳', 'fm.country.IN'],
];

// [stored code, i18n key, hospital-level birth]
const RISK_FACTORS = [
  ['prior_cs', 'fm.risk.prior_cs', true],
  ['grand_multi', 'fm.risk.grand_multi', false],
  ['multiple', 'fm.risk.multiple', true],
  ['malpresentation', 'fm.risk.malpresentation', true],
  ['aph', 'fm.risk.aph', true],
  ['preeclampsia', 'fm.risk.preeclampsia', false],
  ['anaemia', 'fm.risk.anaemia', false],
  ['diabetes', 'fm.risk.diabetes', false],
  ['hiv', 'fm.risk.hiv', false],
  ['young', 'fm.risk.young', false],
  ['short', 'fm.risk.short', false],
  ['preterm', 'fm.risk.preterm', false],
];

/** A risk factor in English, for the admission alert (alerts stay English). */
function riskLabelEN(code) {
  const r = RISK_FACTORS.find(x => x[0] === code);
  return (r && formsEN[r[1]]) || code;
}

// Choice lists hold i18n keys; labelled() turns them into segmented() options
// when the page is drawn, so the labels follow the current language.
const labelled = opts => opts.map(({ key, ...o }) => ({ ...o, label: t(key) }));

// Amniotic fluid once the membranes have ruptured (manual Table 4). 'M', v1's
// ungraded meconium, is never offered; the alert marks come from the engine.
const FLUID_OPTIONS = [['C', 'fm.liquor.C'], ['M1', 'fm.liquor.M1'], ['M2', 'fm.liquor.M2'], ['M3', 'fm.liquor.M3'], ['B', 'fm.liquor.B']]
  .map(([value, key]) => ({ value, key, alert: FLAG.liquor(value) }));

// Companion of her choice (manual Table 3): Y yes, N no (the alert value), D declines.
const COMPANION_OPTIONS = [['Y', 'fm.companion.Y'], ['N', 'fm.companion.N'], ['D', 'fm.companion.D']]
  .map(([value, key]) => ({ value, key, alert: FLAG.supportive('companion', value) }));

const ONSET_OPTIONS = [{ value: 'spontaneous', key: 'fm.onset.spontaneous' }, { value: 'induced', key: 'fm.onset.induced' }];
const MEMBRANE_OPTIONS = [{ value: 'intact', key: 'fm.membranes.intact' }, { value: 'ruptured', key: 'fm.membranes.ruptured' }];
// any presentation other than cephalic raises the malpresentation alert
const PRESENTATION_OPTIONS = [
  { value: 'cephalic', key: 'fm.presentation.cephalic' }, { value: 'breech', key: 'fm.presentation.breech', alert: true },
  { value: 'transverse', key: 'fm.presentation.transverse', alert: true }, { value: 'other', key: 'fm.other', alert: true },
];

/**
 * A labelled question with no default answer: ui.field() makes a group of
 * buttons a named group, never a <label> (a <label> forwards a tap on its
 * text to its first button, and names only that button for screen readers).
 */
function choiceField(labelText, control) {
  return field(labelText, control);
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
      }, t('fm.adm.clear')));
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
    sys: null, dia: null, temp: null, presentation: null, // required, never assumed
    contractions: null, companion: null,                // Y | N | D, unset until asked
  };
  let by = '';
  let saving = false;

  const input = (key, type = 'text', attrs = {}) => h('input', Object.assign({
    type, value: m[key] ?? '',
    oninput: e => { m[key] = type === 'number' ? (e.target.value === '' ? null : +e.target.value) : e.target.value; },
  }, attrs));

  // Ruptured membranes: the time, or U = unknown (F4), and the fluid if seen.
  const romTimeField = field(t('fm.adm.romWhen') + ' *', h('input', {
    type: 'datetime-local', value: m.romTime, oninput: e => { m.romTime = e.target.value; },
  }));
  const romBlock = h('div', { style: 'display:none' },
    romTimeField,
    h('div', { class: 'checklist', style: 'margin-bottom:12px' }, h('label', null,
      h('input', {
        type: 'checkbox',
        onchange: e => { m.romUnknown = e.target.checked; romTimeField.style.display = m.romUnknown ? 'none' : ''; },
      }),
      t('fm.adm.romUnknown'))),
    choiceField(t('fm.adm.fluid'), optionalChoice(labelled(FLUID_OPTIONS), m.liquor, v => { m.liquor = v; })),
  );

  // Phone: country-code selector (Ethiopia default) + number; combined into m.phone.
  function syncPhone() { m.phone = m.phoneNumber.trim() ? `${m.phoneCode} ${m.phoneNumber.trim()}` : ''; }
  const phoneCodeSelect = h('select', {
    style: 'flex:0 0 auto; width:auto; min-width:104px', 'aria-label': t('fm.adm.countryCode'),
    onchange: e => { m.phoneCode = e.target.value; syncPhone(); },
  }, COUNTRY_CODES.map(([code, flag, key]) => h('option', { value: code, title: t(key) }, `${flag} ${code}`)));
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
        field(t('fm.adm.mrn'), input('mrn')),
        field(t('fm.adm.phone'), phoneField),
        field(t('fm.adm.kebele'), input('kebele')),
      ),
    ),
    h('div', { class: 'card' },
      h('h2', null, '2 · ' + t('fm.adm.history')),
      h('div', { class: 'grid3' },
        field(t('gravida') + ' *', input('gravida', 'number', { min: 1, max: 20 })),
        field(t('para') + ' *', input('para', 'number', { min: 0, max: 20 })),
        field(t('fm.adm.ga'), input('gaWeeks', 'number', { min: 20, max: 45 })),
      ),
      h('h3', null, t('fm.adm.risks')),
      h('div', { class: 'checklist' },
        RISK_FACTORS.map(([code, key]) => h('label', null,
          h('input', {
            type: 'checkbox',
            onchange: e => {
              if (e.target.checked) m.riskFactors.push(code);
              else m.riskFactors = m.riskFactors.filter(r => r !== code);
            },
          }),
          t(key),
        )),
      ),
    ),
    h('div', { class: 'card' },
      h('h2', null, '3 · ' + t('fm.adm.labourStatus')),
      choiceField(t('fm.adm.onset') + ' *', segmented(labelled(ONSET_OPTIONS), m.onsetMode, v => { m.onsetMode = v; })),
      h('p', { class: 'muted', style: 'margin-top:-6px' }, t('fm.adm.onsetHelp')),
      h('div', { class: 'grid2' },
        field(t('fm.adm.onsetTime'), h('input', { type: 'datetime-local', value: m.laborOnsetTime, oninput: e => { m.laborOnsetTime = e.target.value; } })),
        field(t('fm.adm.admissionTime'), h('input', { type: 'datetime-local', value: m.admissionTime, oninput: e => { m.admissionTime = e.target.value; } })),
      ),
      choiceField(t('fm.adm.membranes') + ' *', segmented(labelled(MEMBRANE_OPTIONS), m.membranes, v => {
        m.membranes = v;
        romBlock.style.display = v === 'ruptured' ? '' : 'none';
      })),
      romBlock,
      choiceField(t('fm.adm.companion'), optionalChoice(labelled(COMPANION_OPTIONS), m.companion, v => { m.companion = v; })),
    ),
    h('div', { class: 'card' },
      h('h2', null, '4 · ' + t('fm.adm.exam')),
      h('div', { class: 'grid3' },
        field(t('fm.adm.dilatation') + ' *', input('dilatation', 'number', { min: 0, max: 10 })),
        field(t('fm.adm.descent'), input('descent', 'number', { min: 0, max: 5 })),
        field(t('fm.adm.fhr') + ' *', input('fhr', 'number', { min: 50, max: 220 })),
        field(t('fm.adm.contractions'), input('contractions', 'number', { min: 0, max: 8 })),
        field(t('fm.adm.pulse'), input('pulse', 'number', { min: 30, max: 200 })),
        field(t('fm.adm.temp'), input('temp', 'number', { step: '0.1', min: 30, max: 43 })),
        field(t('fm.sys'), input('sys', 'number', { min: 50, max: 260 })),
        field(t('fm.dia'), input('dia', 'number', { min: 30, max: 160 })),
      ),
      choiceField(t('fm.adm.presentation') + ' *', segmented(labelled(PRESENTATION_OPTIONS), m.presentation, v => { m.presentation = v; })),
    ),
    byField(getBy(), v => { by = v; }),
    h('button', { class: 'btn big', onclick: save }, '✓ ' + t('fm.adm.admit')),
    h('p', { class: 'muted', style: 'text-align:center' }, t('fm.adm.footnote')),
  );

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
    alerts.push(...addAlerts(p, admissionRiskAlerts(p, S.settings, riskLabelEN), 'admission', { time: admTime }));
    return { p, alerts };
  }

  async function save() {
    if (saving) return; // a double tap must not admit her twice
    const why = admissionProblem(m, by);
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
      toast(t('fm.adm.saveFailed', { error: (e && e.message) || e }), 'danger');
      return;
    }
    const { p, alerts } = made;
    setBy(by);
    toast(t('fm.adm.saved'));
    location.hash = '#/p/' + p.id;
    if (alerts.length) setTimeout(() => showAlertAckModal(p, alerts), 300);
  }

  return page;
}

/**
 * The first missing or impossible answer on the admission form, or null when
 * it can be saved. m is the form state, by the initials. No DOM: exported
 * for the tests.
 */
export function admissionProblem(m, by) {
  if (!m.name.trim()) return t('fm.adm.needName');
  if (m.gravida == null || m.para == null) return t('fm.adm.needGP');
  if (!m.onsetMode) return t('fm.adm.needOnset');
  if (!m.membranes) return t('fm.adm.needMembranes');
  if (m.membranes === 'ruptured' && !m.romUnknown) {
    const rom = localInputToISO(m.romTime);
    if (!rom) return t('fm.adm.needRom');
    if (new Date(rom) > new Date()) return t('fm.adm.romFuture');
  }
  if (m.dilatation == null || m.fhr == null) return t('fm.adm.needExam');
  if (!m.presentation) return t('fm.adm.needPresentation');
  if (!by) return t('fm.needInitials');
  return null;
}
