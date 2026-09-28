// views/delivery.js — birth record, APGAR scoring, immediate newborn care
// (ENC), third stage / AMTSL, and postpartum haemorrhage watch.

import { h, segmented, field, toast, isoToLocalInput, localInputToISO, fmtDT } from '../ui.js';
import { t } from '../i18n.js';
import { S, savePatient } from '../store.js';
import { LIMITS } from '../protocol.js';
import { addAlerts } from '../alerts.js';
import { showAlertAckModal } from '../wizard.js';

const APGAR_ITEMS = [
  ['appearance', 'Appearance (colour)', ['Blue / pale', 'Body pink, limbs blue', 'Completely pink']],
  ['pulse', 'Pulse (heart rate)', ['Absent', '< 100 bpm', '≥ 100 bpm']],
  ['grimace', 'Grimace (reflex)', ['No response', 'Grimace only', 'Cry / cough / sneeze']],
  ['activity', 'Activity (tone)', ['Limp', 'Some flexion', 'Active movement']],
  ['respiration', 'Respiration', ['Absent', 'Weak / irregular', 'Strong cry']],
];

function apgarBlock(title, state) {
  const totalEl = h('div', { class: 'apgar-score' }, '—');
  const update = () => {
    const vals = APGAR_ITEMS.map(([k]) => state[k]);
    if (vals.some(v => v == null)) { totalEl.textContent = '—'; totalEl.className = 'apgar-score'; return; }
    const total = vals.reduce((a, b) => a + b, 0);
    state.total = total;
    totalEl.textContent = total + ' / 10';
    totalEl.className = 'apgar-score ' + (total >= 7 ? 'ok' : total >= 4 ? 'warn' : 'bad');
  };
  return h('div', { class: 'card' },
    h('h2', null, title),
    APGAR_ITEMS.map(([key, label, opts]) => h('div', { style: 'margin-bottom:10px' },
      h('p', { style: 'margin:0 0 4px;font-weight:600;font-size:.9rem' }, label),
      segmented(opts.map((o, i) => ({ value: i, label: `${i} · ${o}`, alert: i === 0 })), state[key], v => { state[key] = v; update(); }),
    )),
    totalEl,
  );
}

const ENC_CHECKLIST = [
  ['dried', 'Dried and stimulated immediately'],
  ['skin', 'Skin-to-skin contact with mother'],
  ['cord_delay', 'Delayed cord clamping (1–3 min)'],
  ['breastfeed', 'Breastfeeding initiated within 1 h'],
  ['vitk', 'Vitamin K given'],
  ['eye', 'TTC eye ointment applied'],
  ['chx', 'Chlorhexidine cord care'],
  ['weighed', 'Weighed and examined'],
];

const AMTSL_CHECKLIST = [
  ['oxy_amtsl', 'Oxytocin 10 IU IM within 1 minute of birth'],
  ['cct', 'Controlled cord traction'],
  ['massage', 'Uterine massage after placenta'],
];

export function renderDeliveryTab(p) {
  if (p.delivery) return deliverySummary(p);

  const m = {
    time: isoToLocalInput(), mode: 'svd', outcome: 'live', sex: null, weightG: null,
    resus: 'N', resusDetail: '',
    apgar1: {}, apgar5: {}, apgar10: {},
    enc: {}, amtsl: {}, placentaComplete: 'Y', placentaTime: null,
    eblMl: null, perineum: 'intact', ppSys: null, ppDia: null, ppPulse: null,
  };

  const numInput = key => h('input', { type: 'number', oninput: e => { m[key] = e.target.value === '' ? null : +e.target.value; } });
  const checklist = (items, target) => h('div', { class: 'checklist' }, items.map(([code, label]) =>
    h('label', null, h('input', { type: 'checkbox', onchange: e => { target[code] = e.target.checked; } }), label)));

  return h('div', null,
    h('div', { class: 'card' },
      h('h2', null, '👶 Birth'),
      h('div', { class: 'grid2' },
        field('Time of birth', h('input', { type: 'datetime-local', value: m.time, oninput: e => { m.time = e.target.value; } })),
        field('Mode of birth', segmented([
          { value: 'svd', label: 'Spontaneous' }, { value: 'assisted', label: 'Assisted (vacuum)' },
          { value: 'breech', label: 'Vaginal breech' }, { value: 'other', label: 'Other' },
        ], m.mode, v => { m.mode = v; })),
      ),
      field('Outcome', segmented([
        { value: 'live', label: 'Live birth' },
        { value: 'sb_fresh', label: 'Stillbirth (fresh)', alert: true },
        { value: 'sb_macerated', label: 'Stillbirth (macerated)', alert: true },
      ], m.outcome, v => { m.outcome = v; })),
      h('div', { class: 'grid2' },
        field('Sex', segmented([{ value: 'M', label: 'Boy' }, { value: 'F', label: 'Girl' }], m.sex, v => { m.sex = v; })),
        field('Birth weight (grams)', numInput('weightG')),
      ),
      field('Resuscitation needed?', segmented([{ value: 'N', label: t('no') }, { value: 'Y', label: t('yes'), alert: true }], m.resus, v => { m.resus = v; })),
      h('label', { class: 'field' }, h('span', null, 'Resuscitation actions (if any)'),
        h('input', { type: 'text', placeholder: 'e.g. bag & mask ventilation 2 min', oninput: e => { m.resusDetail = e.target.value; } })),
    ),
    apgarBlock(t('apgar') + ' — 1 minute', m.apgar1),
    apgarBlock(t('apgar') + ' — 5 minutes', m.apgar5),
    h('div', { class: 'card' },
      h('h2', null, 'Essential newborn care'),
      checklist(ENC_CHECKLIST, m.enc),
    ),
    h('div', { class: 'card' },
      h('h2', null, 'Third stage — AMTSL'),
      checklist(AMTSL_CHECKLIST, m.amtsl),
      h('div', { class: 'grid2', style: 'margin-top:10px' },
        field('Placenta complete?', segmented([{ value: 'Y', label: t('yes') }, { value: 'N', label: t('no'), alert: true }], m.placentaComplete, v => { m.placentaComplete = v; })),
        field('Estimated blood loss (ml)', numInput('eblMl')),
        field('Perineum', segmented([
          { value: 'intact', label: 'Intact' }, { value: 'tear12', label: '1st/2nd° tear' },
          { value: 'tear34', label: '3rd/4th° tear', alert: true }, { value: 'episiotomy', label: 'Episiotomy' },
        ], m.perineum, v => { m.perineum = v; })),
      ),
      h('h3', null, 'Mother — first postpartum check'),
      h('div', { class: 'grid3' },
        field('BP systolic', numInput('ppSys')),
        field('BP diastolic', numInput('ppDia')),
        field('Pulse', numInput('ppPulse')),
      ),
    ),
    h('button', { class: 'btn big', onclick: save }, '✓ Save birth record'),
  );

  async function save() {
    if (m.apgar1.total == null || m.apgar5.total == null) {
      if (m.outcome === 'live') { toast('Record APGAR at 1 and 5 minutes', 'danger'); return; }
    }
    p.delivery = {
      time: localInputToISO(m.time), mode: m.mode, outcome: m.outcome,
      placentaComplete: m.placentaComplete, eblMl: m.eblMl, perineum: m.perineum,
      amtsl: m.amtsl, ppVitals: { sys: m.ppSys, dia: m.ppDia, pulse: m.ppPulse },
    };
    p.newborn = {
      sex: m.sex, weightG: m.weightG, resus: m.resus === 'Y', resusDetail: m.resusDetail,
      apgar1: m.apgar1.total != null ? m.apgar1 : null,
      apgar5: m.apgar5.total != null ? m.apgar5 : null,
      apgar10: null, enc: m.enc,
    };
    p.status = 'delivered';

    const drafts = [];
    if (m.outcome === 'live' && m.apgar5.total != null && m.apgar5.total < 7) {
      drafts.push({
        code: 'apgar_low', severity: 'danger', title: `APGAR ${m.apgar5.total}/10 at 5 minutes`,
        advice: ['Continue/resume newborn resuscitation per HBB', 'Score again at 10 minutes', 'Keep warm; monitor breathing, colour, feeding', 'REFER the newborn if not vigorous'],
      });
    }
    if (m.eblMl != null && m.eblMl >= LIMITS.eblAlertMl) {
      drafts.push({
        code: 'pph', severity: 'danger', title: `Estimated blood loss ${m.eblMl} ml — PPH`,
        advice: ['Massage uterus; repeat uterotonic per protocol', 'Empty bladder; check placenta and tears', 'IV fluids fast; monitor vitals every 15 min', 'REFER if bleeding continues'],
      });
    }
    if (m.placentaComplete === 'N') {
      drafts.push({
        code: 'retained_products', severity: 'danger', title: 'Placenta incomplete / retained products',
        advice: ['Risk of PPH and sepsis', 'Manual removal / MVA per BEmONC competency, or REFER', 'IV line + fluids; monitor bleeding'],
      });
    }
    if (m.outcome !== 'live') {
      drafts.push({
        code: 'stillbirth', severity: 'warn', title: 'Stillbirth — respectful supportive care',
        advice: ['Provide compassionate counselling and privacy for the family', 'Complete perinatal death notification per national surveillance', 'Review the partograph for learning (audit), not blame'],
      });
    }
    const newAlerts = addAlerts(p, drafts, 'obs');
    await savePatient(p);
    toast('Birth record saved ✓');
    if (newAlerts.length) showAlertAckModal(p, newAlerts);
    location.hash = `#/p/${p.id}/delivery`;
  }
}

// ------------------------------------------------------------- summary -----

function deliverySummary(p) {
  const d = p.delivery, n = p.newborn || {};
  const apgarChip = a => a ? h('span', {
    class: 'chip ' + (a.total >= 7 ? 'ok' : a.total >= 4 ? 'due' : 'overdue'),
  }, a.total + '/10') : '—';

  const add10 = n.apgar5 && n.apgar5.total < 7 && !n.apgar10;
  const state10 = {};

  return h('div', null,
    h('div', { class: 'card' },
      h('h2', null, '👶 Birth record'),
      kv('Born', fmtDT(d.time)),
      kv('Mode', { svd: 'Spontaneous vaginal', assisted: 'Assisted (vacuum)', breech: 'Vaginal breech', other: 'Other' }[d.mode] || d.mode),
      kv('Outcome', { live: 'Live birth', sb_fresh: 'Stillbirth (fresh)', sb_macerated: 'Stillbirth (macerated)' }[d.outcome] || d.outcome),
      n.sex ? kv('Baby', `${n.sex === 'M' ? 'Boy' : 'Girl'}${n.weightG ? ' · ' + n.weightG + ' g' : ''}`) : null,
      h('div', { class: 'kv' }, h('b', null, 'APGAR 1′ / 5′ / 10′'),
        h('span', { style: 'display:flex;gap:6px' }, apgarChip(n.apgar1), apgarChip(n.apgar5), apgarChip(n.apgar10))),
      n.resus ? kv('Resuscitation', n.resusDetail || 'Yes') : null,
      kv('Placenta', d.placentaComplete === 'Y' ? 'Complete' : '⚠ Incomplete'),
      d.eblMl != null ? kv('Blood loss', d.eblMl + ' ml' + (d.eblMl >= LIMITS.eblAlertMl ? ' ⚠' : '')) : null,
      kv('Perineum', d.perineum),
    ),
    add10 ? h('div', null,
      apgarBlock(t('apgar') + ' — 10 minutes', state10),
      h('button', {
        class: 'btn big', onclick: async () => {
          if (state10.total == null) { toast('Complete all five APGAR items', 'danger'); return; }
          p.newborn.apgar10 = state10;
          await savePatient(p);
          toast('10-minute APGAR saved ✓');
          location.hash = `#/p/${p.id}/delivery`;
        },
      }, 'Save 10-minute APGAR'),
    ) : null,
    h('div', { class: 'card' },
      h('h2', null, 'After birth — keep watching'),
      h('p', { class: 'muted' },
        'Most maternal deaths happen in the first 24 hours after birth. Check the mother every 15 min for the first 2 hours: bleeding, uterine tone, BP, pulse. Check the baby: breathing, warmth, colour, feeding.'),
    ),
  );
}

function kv(k, v) { return h('div', { class: 'kv' }, h('b', null, k), h('span', null, v)); }
