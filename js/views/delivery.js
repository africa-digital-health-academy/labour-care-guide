// views/delivery.js — birth record, APGAR scoring, immediate newborn care
// (ENC), third stage / AMTSL, and postpartum haemorrhage watch.

import { h, segmented, field, toast, isoToLocalInput, localInputToISO, fmtDT } from '../ui.js';
import { t } from '../i18n.js';
import { S, savePatient } from '../store.js';
import { LIMITS } from '../protocol.js';
import { AMTSL_STEPS, FLAG } from '../alerts.js';
import { applyBirth } from '../record.js';
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
    totalEl.className = 'apgar-score ' + (total >= LIMITS.apgarLow ? 'ok' : total >= LIMITS.apgarSevere ? 'warn' : 'bad');
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
      checklist(AMTSL_STEPS, m.amtsl),
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
    const delivery = {
      time: localInputToISO(m.time), mode: m.mode, outcome: m.outcome,
      placentaComplete: m.placentaComplete, eblMl: m.eblMl, perineum: m.perineum,
      amtsl: m.amtsl, ppVitals: { sys: m.ppSys, dia: m.ppDia, pulse: m.ppPulse },
    };
    const newborn = {
      sex: m.sex, weightG: m.weightG, resus: m.resus === 'Y', resusDetail: m.resusDetail,
      apgar1: m.apgar1.total != null ? m.apgar1 : null,
      apgar5: m.apgar5.total != null ? m.apgar5 : null,
      apgar10: null, enc: m.enc,
    };
    // the birth rules (APGAR, retained placenta, stillbirth, PPH trigger) live in the engine (S13)
    let result;
    try {
      result = applyBirth(p, delivery, newborn, S.settings, { by: S.settings.midwifeName || null });
    } catch (e) {
      toast(e.message, 'danger');
      return;
    }
    await savePatient(p);
    toast('Birth record saved ✓');
    if (result.added.length) showAlertAckModal(p, result.added);
    location.hash = `#/p/${p.id}/delivery`;
  }
}

// ------------------------------------------------------------- summary -----

function deliverySummary(p) {
  const d = p.delivery, n = p.newborn || {};
  const apgarChip = a => a ? h('span', {
    class: 'chip ' + (a.total >= LIMITS.apgarLow ? 'ok' : a.total >= LIMITS.apgarSevere ? 'due' : 'overdue'),
  }, a.total + '/10') : '—';

  const add10 = n.apgar5 && n.apgar5.total < LIMITS.apgarLow && !n.apgar10;
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
      d.eblMl != null ? kv('Blood loss', d.eblMl + ' ml' + (FLAG.bloodLoss(d.eblMl) ? ' ⚠' : '')) : null,
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
