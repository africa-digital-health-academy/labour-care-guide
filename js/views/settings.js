// views/settings.js - facility configuration, protocol selection, language,
// update check, sound test, and the about/disclaimer section.

import '../version.js';
import { h, field, segmented, toast, beep } from '../ui.js';
import { S, saveSettings } from '../store.js';
import { PROTOCOLS } from '../protocol.js';
import { seedDemoPatient } from '../demo.js';

const REPO_URL = 'https://github.com/DrTemesgen/labour-care-guide';

async function checkForUpdates() {
  if (!('serviceWorker' in navigator)) { toast('Updates need the installed (https) version.'); return; }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) { toast('No offline installation registered yet.'); return; }
    await reg.update();
    toast('Checked. If a new version exists, an "Update ready" chip appears in the top bar.');
  } catch {
    toast('Could not check now (offline?).', 'danger');
  }
}

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
      field('Labour monitoring standard', segmented([
        { value: 'lcg', label: 'WHO Labour Care Guide (2020)' },
        { value: 'ethiopia2021', label: 'Modified partograph (MOH 2021, legacy)' },
      ], s.protocol, v => { s.protocol = v; })),
      h('p', { class: 'muted' },
        s.protocol === 'lcg'
          ? PROTOCOLS.lcg.name + ': active phase from 5 cm; per-centimetre time limits (5 cm 6 h, 6 cm 5 h, 7 cm 3 h, 8 cm 2.5 h, 9 cm 2 h) replace the alert/action lines.'
          : PROTOCOLS.ethiopia2021.name + ': active phase from 4 cm; alert line 1 cm/h with action line 4 h to the right, per the MOH Obstetrics Management Protocol for Health Centers (2021). Kept for facilities still audited on it.'),
      h('p', { class: 'muted' },
        'Use the standard your facility is audited against. Note: in this version, changing the standard applies to every case on this device; per-case protocol arrives in the next release.'),
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
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:8px' },
        h('button', { class: 'btn secondary', onclick: () => beep('danger') }, 'Test sound'),
      ),
    ),
    h('button', {
      class: 'btn big', onclick: async () => { await saveSettings(s); toast('Settings saved'); },
    }, 'Save settings'),

    h('div', { class: 'card', style: 'margin-top:14px' },
      h('h2', null, '🧪 Training'),
      h('button', { class: 'btn secondary', onclick: () => seedDemoPatient() }, 'Load a demo labour case'),
      h('p', { class: 'muted' }, 'Creates a realistic practice case (clearly marked DEMO) so midwives can explore the wizard, chart and alerts safely.'),
    ),

    h('div', { class: 'card' },
      h('h2', null, 'About Labour Care Guide'),
      h('p', null, 'Version ' + self.LCG_VERSION),
      h('p', null, 'Open-source, offline-first digital implementation of the WHO Labour Care Guide (2020) for midwives in resource-limited settings. All data stays on this device.'),
      h('p', { class: 'muted' }, 'This is not a WHO product and is not endorsed by WHO. Thresholds and codes follow the WHO Labour Care Guide user\'s manual; see NOTICE-WHO.md in the source repository.'),
      h('p', { class: 'muted', style: 'border-left:4px solid var(--c-warn);padding-left:10px' },
        'DISCLAIMER: This software is a decision-support and documentation aid for skilled birth attendants. It is not a certified medical device and does not replace clinical judgement, national protocols, or senior consultation. Pilot use must be approved by the responsible health authorities.'),
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin:8px 0' },
        h('button', { class: 'btn secondary', onclick: checkForUpdates }, 'Check for updates'),
      ),
      h('p', { class: 'muted' }, 'Source and documentation: ', h('a', { href: REPO_URL, target: '_blank', rel: 'noopener noreferrer' }, REPO_URL), '. Licensed MIT.'),
    ),
  );
}
