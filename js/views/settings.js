// views/settings.js — facility configuration, protocol selection, language,
// and the about/disclaimer section.

import { h, field, segmented, toast, confirmDialog } from '../ui.js';
import { S, saveSettings } from '../store.js';
import { PROTOCOLS } from '../protocol.js';
import { seedDemoPatient } from '../demo.js';

export function renderSettings() {
  const s = { ...S.settings };

  return h('div', { class: 'page' },
    h('div', { class: 'card' },
      h('h2', null, '🏥 Facility'),
      field('Facility name', h('input', { type: 'text', value: s.facilityName, oninput: e => { s.facilityName = e.target.value; } })),
      field('Facility level', segmented([
        { value: 'health_center', label: 'Health centre (BEmONC)' },
        { value: 'hospital', label: 'Hospital (CEmONC)' },
      ], s.facilityLevel, v => { s.facilityLevel = v; })),
      field('Midwife / provider name (appears on referral notes)',
        h('input', { type: 'text', value: s.midwifeName, oninput: e => { s.midwifeName = e.target.value; } })),
    ),
    h('div', { class: 'card' },
      h('h2', null, '📋 Clinical protocol'),
      field('Partograph standard', segmented([
        { value: 'lcg', label: 'WHO LCG 2020' },
        { value: 'ethiopia2021', label: 'Modified partograph (MOH 2021)' },
      ], s.protocol, v => { s.protocol = v; })),
      h('p', { class: 'muted' },
        s.protocol === 'lcg'
          ? PROTOCOLS.lcg.name + ': active phase from 5 cm; per-centimetre time limits (5→6 h, 6→5 h, 7→3 h, 8→2.5 h, 9→2 h) replace the alert/action lines.'
          : PROTOCOLS.ethiopia2021.name + ': active phase from 4 cm; alert line 1 cm/h with action line 4 h to the right, per the MOH Obstetrics Management Protocol for Health Centers (2021).'),
      h('p', { class: 'muted' },
        '⚠ Use the standard your facility is audited against. Existing cases keep the protocol they were started with.'),
    ),
    h('div', { class: 'card' },
      h('h2', null, '🌐 Display'),
      field('Language', segmented([
        { value: 'en', label: 'English' }, { value: 'am', label: 'አማርኛ (draft)' },
      ], s.lang, v => { s.lang = v; })),
      field('Show Ethiopian calendar dates', segmented([
        { value: true, label: 'Yes' }, { value: false, label: 'No' },
      ], s.ethiopianDates, v => { s.ethiopianDates = v; })),
      field('Sound alerts', segmented([
        { value: true, label: 'On' }, { value: false, label: 'Off' },
      ], s.sound, v => { s.sound = v; })),
    ),
    h('button', {
      class: 'btn big', onclick: async () => { await saveSettings(s); toast('Settings saved ✓'); },
    }, '✓ Save settings'),

    h('div', { class: 'card', style: 'margin-top:14px' },
      h('h2', null, '🧪 Training'),
      h('button', { class: 'btn secondary', onclick: () => seedDemoPatient() }, 'Load a demo labour case'),
      h('p', { class: 'muted' }, 'Creates a realistic practice case (clearly marked DEMO) so midwives can explore the wizard, chart and alerts safely.'),
    ),

    h('div', { class: 'card' },
      h('h2', null, 'ℹ About Parthograph'),
      h('p', null, 'Open-source digital partograph / WHO Labour Care Guide for midwives in resource-limited settings (customized for Ethiopia first). Offline-first: all data stays on this device.'),
      h('p', { class: 'muted', style: 'border-left:4px solid var(--c-warn);padding-left:10px' },
        'DISCLAIMER: This software is a decision-support and documentation aid for skilled birth attendants. It is not a certified medical device and does not replace clinical judgement, national protocols, or senior consultation. Pilot use must be approved by the responsible health authorities.'),
      h('p', { class: 'muted' }, 'Source & documentation: github.com — see README. Licensed MIT.'),
    ),
  );
}
