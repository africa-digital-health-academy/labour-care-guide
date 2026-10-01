// i18n.js — UI strings. English is complete; Amharic (አማርኛ) covers the main
// midwife-facing labels and falls back to English elsewhere.
// NOTE: Amharic strings are draft translations and must be reviewed by an
// Ethiopian clinical/localization team before facility use. Afaan Oromo,
// Tigrinya, Somali and Afar are planned (see docs/ROADMAP.md).

import * as wz from './i18n/wizard.js';
import * as pt from './i18n/patient.js';
import * as fm from './i18n/forms.js';
import * as rp from './i18n/reports.js';

const en = {
  app_name: 'Labour Care Guide',
  dashboard: 'Labour ward',
  new_admission: 'New admission',
  reports: 'Reports',
  settings: 'Settings',
  record_now: 'Record now',
  all_done: 'All observations up to date',
  due: 'due',
  overdue: 'OVERDUE',
  min_ago: 'min ago',
  in_min: 'in {n} min',
  stage_latent: 'Latent phase',
  stage_active: 'Active labour',
  stage_second: '2nd stage',
  stage_third: '3rd stage',
  stage_delivered: 'Delivered',
  stage_referred: 'Referred',
  stage_closed: 'Closed',
  fhr: 'Fetal heart rate',
  contractions: 'Contractions',
  pulse: 'Maternal pulse',
  vitals: 'BP · Temp · Urine',
  exam: 'Vaginal exam',
  supportive: 'Supportive care',
  oxytocin: 'Oxytocin check',
  chart: 'Chart',
  entries: 'Entries',
  alerts: 'Alerts',
  delivery: 'Delivery',
  referral: 'Referral',
  save: 'Save',
  cancel: 'Cancel',
  next: 'Next',
  back: 'Back',
  skip: 'Skip',
  finish: 'Finish',
  refer_now: 'Refer now',
  emergency: 'Emergency',
  apgar: 'APGAR score',
  mother: 'Mother',
  baby: 'Baby',
  yes: 'Yes',
  no: 'No',
  name: 'Full name',
  age: 'Age (years)',
  gravida: 'Gravida',
  para: 'Para',
  companion: 'Companion present',
  alert_review: 'Review needed',
  alert_act: 'ACT NOW',
  // M3: postpartum watch items (dueList types), blood loss and events.
  // Amharic for these arrives in M5; until then they fall back to English.
  ppMother: 'Mother check',
  ppBaby: 'Baby check',
  ppBP: 'BP after birth',
  ppVoid: 'Urine passed',
  bloodloss: 'Blood loss',
  event: 'Event',
  pushing: 'Pushing began',
  postpartum_watch: 'Postpartum watch',
};

const am = {
  app_name: 'የምጥ እንክብካቤ መመሪያ',
  dashboard: 'የማዋለጃ ክፍል',
  new_admission: 'አዲስ ምዝገባ',
  reports: 'ሪፖርቶች',
  settings: 'ቅንብሮች',
  record_now: 'አሁን መዝግብ',
  all_done: 'ሁሉም ምልከታዎች ተሟልተዋል',
  due: 'ጊዜው ደርሷል',
  overdue: 'ጊዜው አልፏል',
  min_ago: 'ደቂቃ በፊት',
  stage_latent: 'ድብቅ ምዕራፍ',
  stage_active: 'ንቁ ምጥ',
  stage_second: 'ሁለተኛ ምዕራፍ',
  stage_third: 'ሦስተኛ ምዕራፍ',
  stage_delivered: 'ተወልዷል',
  stage_referred: 'ሪፈር ተደርጓል',
  stage_closed: 'ተዘግቷል',
  fhr: 'የፅንስ የልብ ምት',
  contractions: 'ምጥ (መኮማተር)',
  pulse: 'የእናት የልብ ምት',
  vitals: 'የደም ግፊት · ሙቀት · ሽንት',
  exam: 'የማኅፀን ምርመራ',
  supportive: 'ድጋፍ ሰጪ እንክብካቤ',
  oxytocin: 'ኦክሲቶሲን ክትትል',
  chart: 'ቻርት',
  entries: 'መዝገቦች',
  alerts: 'ማስጠንቀቂያዎች',
  delivery: 'ወሊድ',
  referral: 'ሪፈራል',
  save: 'አስቀምጥ',
  cancel: 'ሰርዝ',
  next: 'ቀጣይ',
  back: 'ተመለስ',
  skip: 'ዝለል',
  finish: 'ጨርስ',
  refer_now: 'አሁን ሪፈር አድርግ',
  emergency: 'ድንገተኛ አደጋ',
  apgar: 'የአፕጋር ነጥብ',
  mother: 'እናት',
  baby: 'ሕፃን',
  yes: 'አዎ',
  no: 'አይ',
  name: 'ሙሉ ስም',
  age: 'ዕድሜ (ዓመት)',
  gravida: 'ግራቪዳ (ጠቅላላ እርግዝና)',
  para: 'ፓራ (የወሊድ ብዛት)',
  companion: 'አጃቢ አለ',
  alert_review: 'ክለሳ ያስፈልጋል',
  alert_act: 'አሁኑኑ እርምጃ ውሰድ',
};

// Per-area string fragments (M5), merged into the two dictionaries. Each area
// prefixes its keys (wz. wizard, pt. patient and ward board, fm. admission /
// birth / referral forms, rp. reports and settings) so areas never collide.
for (const frag of [wz, pt, fm, rp]) {
  Object.assign(en, frag.en);
  Object.assign(am, frag.am);
}

const dicts = { en, am };
let lang = 'en';

/** Every English key (the completeness test checks each t() call against these). */
export const EN_KEYS = Object.freeze(Object.keys(en));

/** Share of English keys with an Amharic draft, 0-1 (reported by the tests). */
export function amharicCoverage() {
  const keys = Object.keys(en);
  return keys.length ? keys.filter(k => am[k]).length / keys.length : 1;
}

export function setLang(l) { lang = dicts[l] ? l : 'en'; }
export function getLang() { return lang; }

/** Translate a key; {n}-style placeholders filled from vars. Falls back en → key. */
export function t(key, vars) {
  let s = (dicts[lang] && dicts[lang][key]) || en[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.replace('{' + k + '}', vars[k]);
  return s;
}
