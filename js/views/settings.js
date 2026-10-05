// views/settings.js - facility configuration, protocol selection, language,
// update check, sound test, and the about/disclaimer section. Screen text goes
// through t() (keys 'rp.*' in js/i18n/reports.js); the About card also carries
// the public-preview sentence (2.0.2, js/preview.js), above the disclaimer.

import '../version.js';
import { h, field, segmented, toast, beep } from '../ui.js';
import { t, getLang } from '../i18n.js';
import { en as rpEn } from '../i18n/reports.js';
import { S, saveSettings } from '../store.js';
import { PROTOCOLS } from '../protocol.js';
import { seedDemoPatient } from '../demo.js';
import { previewSentence } from '../preview.js';

const REPO_URL = 'https://github.com/africa-digital-health-academy/labour-care-guide';
// N5: where to learn more about the LCG. Links only: no WHO text is copied.
const IRP_URL = 'https://www.who.int/publications/i/item/9789240109346'; // WHO, 2025, ISBN 978-92-4-010934-6
const LRP_URL = 'https://jhpiego.org/areas-of-expertise/helping-mothers-survive/'; // holds the LCG Learning Resource Package

/**
 * The notice that the Amharic text is an unreviewed draft, as lines: the note
 * in the current UI language and, when that is not English, the English
 * original too, so the caveat never rests on the unreviewed translation alone.
 * Shown under the language choice here and behind the top-bar marker (app.js).
 */
export function amharicDraftNotice() {
  const english = rpEn['rp.am_draft_note'];
  const local = t('rp.am_draft_note');
  return local === english ? [english] : [local, english];
}

/** One line on the chosen standard; the numbers come from the protocol table. */
function protocolSummary(id) {
  if (id === 'lcg') {
    const P = PROTOCOLS.lcg;
    const limits = Object.entries(P.dilatationLagMin)
      .map(([cm, min]) => t('rp.cm_hours', { cm, h: min / 60 })).join(t('rp.list_sep'));
    return t('rp.std_lcg_desc', { name: P.name, cm: P.activeStartCm, limits });
  }
  const P = PROTOCOLS.ethiopia2021;
  return t('rp.std_eth_desc', { name: P.name, cm: P.activeStartCm, h: P.actionLineOffsetHours });
}

const extLink = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);

async function checkForUpdates() {
  if (!('serviceWorker' in navigator)) { toast(t('rp.update_needs_https')); return; }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) { toast(t('rp.update_no_sw')); return; }
    await reg.update();
    toast(t('rp.update_checked', { chip: t('rp.update_ready') }));
  } catch {
    toast(t('rp.update_offline'), 'danger');
  }
}

export function renderSettings() {
  const s = { ...S.settings };

  // Amharic is a draft: the note stays visible while Amharic is on screen,
  // and appears as soon as it is picked (before saving)
  const draftNote = h('div', {
    class: 'muted', role: 'note', style: 'border-left:4px solid var(--c-warn);padding-left:10px;margin:-4px 0 12px',
  }, amharicDraftNotice().map(line => h('div', null, line)));
  const showDraftNote = choice => { draftNote.hidden = !(choice === 'am' || getLang() === 'am'); };
  showDraftNote(s.lang);

  // Render safety (S3): from the first change until Save, the page is a form
  // in progress (data-form without data-saved), so the 30-second heartbeat or
  // another woman's save refreshes only the live parts and never drops
  // unsaved settings. Save marks it saved, so its own save rebuilds the page
  // in the new language.
  const dirty = () => { if (!page.dataset.form) page.dataset.form = 'settings'; };
  // the description follows the standard picked, before it is saved
  const protoNote = h('p', { class: 'muted' }, protocolSummary(s.protocol));

  const page = h('div', { class: 'page' },
    h('div', { class: 'card' },
      h('h2', null, '🏥 ', t('rp.facility')),
      field(t('rp.facility_name'), h('input', { type: 'text', value: s.facilityName, oninput: e => { s.facilityName = e.target.value; dirty(); } })),
      field(t('rp.facility_level'), segmented([
        { value: 'health_center', label: t('rp.level_hc') },
        { value: 'hospital', label: t('rp.level_hospital') },
      ], s.facilityLevel, v => { s.facilityLevel = v; dirty(); })),
      field(t('rp.provider_name'),
        h('input', { type: 'text', value: s.midwifeName, oninput: e => { s.midwifeName = e.target.value; dirty(); } })),
    ),
    h('div', { class: 'card' },
      h('h2', null, '📋 ', t('rp.protocol')),
      field(t('rp.standard'), segmented([
        { value: 'lcg', label: t('rp.std_lcg') },
        { value: 'ethiopia2021', label: t('rp.std_eth') },
      ], s.protocol, v => { s.protocol = v; protoNote.textContent = protocolSummary(v); dirty(); })),
      protoNote,
      h('p', { class: 'muted' }, t('rp.std_help')),
    ),
    h('div', { class: 'card' },
      h('h2', null, '🌐 ', t('rp.display')),
      // language names are shown in their own language, whatever the UI language
      field(t('rp.language'), segmented([
        { value: 'en', label: 'English' }, { value: 'am', label: t('rp.lang_am') },
      ], s.lang, v => { s.lang = v; showDraftNote(v); dirty(); })),
      draftNote,
      field(t('rp.ec_dates'), segmented([
        { value: true, label: t('yes') }, { value: false, label: t('no') },
      ], s.ethiopianDates, v => { s.ethiopianDates = v; dirty(); })),
      field(t('rp.sound'), segmented([
        { value: true, label: t('rp.on') }, { value: false, label: t('rp.off') },
      ], s.sound, v => { s.sound = v; dirty(); })),
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:8px' },
        h('button', { class: 'btn secondary', onclick: () => beep('danger') }, t('rp.test_sound')),
      ),
    ),
    h('button', {
      class: 'btn big', onclick: async () => { page.dataset.saved = '1'; await saveSettings(s); toast(t('rp.settings_saved')); },
    }, t('rp.save_settings')),

    h('div', { class: 'card', style: 'margin-top:14px' },
      h('h2', null, '🧪 ', t('rp.training')),
      h('button', { class: 'btn secondary', onclick: () => seedDemoPatient() }, t('rp.load_demo')),
      h('p', { class: 'muted' }, t('rp.demo_help')),
    ),

    h('div', { class: 'card' },
      h('h2', null, t('rp.about')),
      h('p', null, t('rp.version', { v: self.LCG_VERSION })),
      h('p', null, t('rp.about_text')),
      h('p', { class: 'muted' }, t('rp.not_who')),
      h('p', { class: 'muted', role: 'note' }, previewSentence()),
      h('p', { class: 'muted', style: 'border-left:4px solid var(--c-warn);padding-left:10px' }, t('rp.disclaimer')),
      h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin:8px 0' },
        h('button', { class: 'btn secondary', onclick: checkForUpdates }, t('rp.check_updates')),
      ),
      h('h3', null, t('rp.resources')),
      h('ul', { style: 'margin:0 0 6px;padding-left:20px' },
        h('li', null, extLink(IRP_URL, t('rp.res_irp')), ' ', h('span', { class: 'muted' }, t('rp.res_irp_note'))),
        h('li', null, extLink(LRP_URL, t('rp.res_lrp')), ' ', h('span', { class: 'muted' }, t('rp.res_lrp_note'))),
      ),
      h('p', { class: 'muted' }, t('rp.res_online')),
      sourceLine(),
    ),
  );
  return page;
}

/** "Source and documentation: <link>. Code licensed MIT; WHO-derived content under CC BY-NC-SA 3.0 IGO (see NOTICE-WHO.md)." - one sentence for translators, {link} marks the link. */
function sourceLine() {
  const [before, after] = t('rp.source_line').split('{link}');
  return h('p', { class: 'muted' }, before, extLink(REPO_URL, REPO_URL), after);
}
