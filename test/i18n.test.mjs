// i18n completeness (M5). Every key the app asks t() for exists in English
// (EN_KEYS from js/i18n.js): the literal key of every t() call under js/, the
// area keys kept as data ('wz.x', 'pt.x', 'fm.x', 'rp.x'), and the keys built
// from a stage or a record type. Every Amharic draft answers an English key
// and keeps its {placeholders}. The Amharic coverage is reported, never
// enforced: the drafts await clinical and localization review.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EN_KEYS, amharicCoverage, t, setLang } from '../js/i18n.js';
import { WIZARD_TYPES } from '../js/wizard.js';
import { PROTOCOLS, OBS_TYPES, dueList } from '../js/protocol.js';
import { NOW, iso, mkPatient } from './helpers.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const JS = join(ROOT, 'js');
const I18N = join(JS, 'i18n');
const KEYS = new Set(EN_KEYS);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const builds = prefix => EN_KEYS.some(k => k.startsWith(prefix));

// the area fragments of the M5 contract and their prefixes
const FRAGMENTS = { wizard: 'wz.', patient: 'pt.', forms: 'fm.', reports: 'rp.' };

// Comment lines are blanked (line numbers kept) so a key named in a comment is
// not taken for a call: lines starting with //, /* or *.
const uncomment = src => src.split('\n').map(l => (/^\s*(\/\/|\/\*|\*)/.test(l) ? '' : l)).join('\n');
const lineAt = (code, i) => code.slice(0, i).split('\n').length;

/** Every .js file under js/: {file (relative, forward slashes), code (comment lines blanked)}. */
function sources(dir = JS) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    if (!e.name.endsWith('.js')) return [];
    return [{ file: relative(ROOT, path).replace(/\\/g, '/'), code: uncomment(readFileSync(path, 'utf8')) }];
  });
}
const SRC = sources();

// t('key'), t("key") or t(`key`): the first argument is a string literal. A +
// after it, or ${...} inside it, builds the key from that literal prefix.
const CALL = /(?<![\w$])t\(\s*(?:'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\]*)`)\s*(\+)?/g;

const CALLS = SRC.flatMap(({ file, code }) => [...code.matchAll(CALL)].map(m => {
  const literal = m[1] ?? m[2] ?? m[3];
  const built = m[4] !== undefined || (m[3] !== undefined && m[3].includes('${'));
  return { file, where: `${file}:${lineAt(code, m.index)}`, key: built ? literal.split('${')[0] : literal, built };
}));

test('the scan reads the t() calls of every file that imports t', () => {
  const importers = SRC.filter(s => /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*'[./]*i18n\.js'/.test(s.code)).map(s => s.file);
  assert.ok(importers.includes('js/wizard.js'));
  assert.deepEqual(importers.filter(f => !CALLS.some(c => c.file === f)), [], 'imports t but no t() call was read');
  assert.ok(CALLS.some(c => c.file === 'js/wizard.js' && c.key === 'record_now' && !c.built));
  assert.ok(CALLS.some(c => c.file === 'js/wizard.js' && c.key === 'wz.ack_repeat' && !c.built));
});

test('every t() call with a literal key names an English key', ctx => {
  const missing = CALLS.filter(c => !c.built && !KEYS.has(c.key)).map(c => `${c.where} ${c.key}`);
  assert.deepEqual(missing, []);
  const built = CALLS.filter(c => c.built).length;
  ctx.diagnostic(`${CALLS.length - built} t() calls with a literal key and ${built} building one, `
    + `read in ${new Set(CALLS.map(c => c.file)).size} files`);
});

test('every key a t() call builds from a literal prefix (stage_ + status) can exist', () => {
  const missing = CALLS.filter(c => c.built && c.key && !builds(c.key)).map(c => `${c.where} ${c.key}...`);
  assert.deepEqual(missing, []);
});

test('every area key kept as data names an English key', () => {
  const prefixes = Object.values(FRAGMENTS).map(p => p.replace('.', '\\.')).join('|');
  const AREA = new RegExp(`(['"\`])((?:${prefixes})[\\w.-]+)\\1(\\s*\\+)?`, 'g');
  const missing = [];
  for (const { file, code } of SRC.filter(s => !s.file.startsWith('js/i18n/'))) {
    for (const m of code.matchAll(AREA)) {
      const ok = m[3] ? builds(m[2]) : KEYS.has(m[2]);
      if (!ok) missing.push(`${file}:${lineAt(code, m.index)} ${m[2]}${m[3] ? '...' : ''}`);
    }
  }
  assert.deepEqual(missing, []);
});

/** The case statuses: LABOUR and TERMINAL in js/protocol.js, read from its source so a new status is checked too. */
function statuses() {
  const src = readFileSync(join(JS, 'protocol.js'), 'utf8');
  const list = name => {
    const m = src.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
    assert.ok(m, `js/protocol.js no longer declares ${name}: update this test`);
    return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  };
  return [...list('LABOUR'), ...list('TERMINAL')];
}

test('the keys the screens build from a stage or a record type exist: stage_<status> and every type label', () => {
  const stages = statuses();
  for (const s of ['latent', 'active', 'second', 'delivered', 'referred', 'closed']) assert.ok(stages.includes(s), s);
  // t(type) labels: wizard steps, observation types, events, every scheduled
  // type, and the live due list in labour and in the postpartum watch
  const types = new Set([...WIZARD_TYPES, ...OBS_TYPES, 'event', 'ppBP', 'ppVoid']);
  for (const proto of Object.values(PROTOCOLS)) {
    for (const schedule of Object.values(proto.schedules)) Object.keys(schedule).forEach(k => types.add(k));
  }
  const oxytocin = { oxytocinRunning: true, meds: [{ id: 'm1', kind: 'oxytocin', time: iso(2), action: 'start' }] };
  const cases = [
    ...['latent', 'active', 'second'].map(status => mkPatient({ status, ...oxytocin })),
    mkPatient({ status: 'delivered', delivery: { time: iso(1) } }),
  ];
  for (const p of cases) {
    for (const proto of Object.values(PROTOCOLS)) dueList(p, proto, NOW).forEach(d => types.add(d.type));
  }
  const missing = [...stages.map(s => 'stage_' + s), ...types].filter(k => !KEYS.has(k));
  assert.deepEqual(missing, []);
});

async function fragments() {
  const files = readdirSync(I18N).filter(f => f.endsWith('.js')).sort();
  return Promise.all(files.map(async f => ({
    name: f.slice(0, -3), file: `js/i18n/${f}`, ...(await import(pathToFileURL(join(I18N, f)).href)),
  })));
}

test('each area fragment keeps to its own prefix, holds text, and is merged into the English keys', async () => {
  const frags = await fragments();
  assert.deepEqual(Object.keys(FRAGMENTS).filter(n => !frags.some(f => f.name === n)), [], 'a contract fragment is missing');
  const owner = new Map();
  for (const f of frags) {
    assert.ok(f.en && f.am, `${f.file} exports en and am`);
    const keys = Object.keys(f.en);
    const prefix = FRAGMENTS[f.name] || `${(keys[0] || '').split('.')[0]}.`;
    assert.match(prefix, /^[a-z]{2,}\.$/, `${f.file}: one short prefix such as 'xx.'`);
    assert.ok(!owner.has(prefix), `${f.file} and ${owner.get(prefix)} share the prefix ${prefix}`);
    owner.set(prefix, f.file);
    assert.deepEqual(keys.filter(k => !k.startsWith(prefix) || k === prefix), [], `${f.file}: every key starts with ${prefix}`);
    assert.deepEqual(keys.filter(k => typeof f.en[k] !== 'string' || !f.en[k].trim()), [], `${f.file}: empty English text`);
    assert.deepEqual(keys.filter(k => !KEYS.has(k)), [], `${f.file} is not merged by js/i18n.js`);
  }
});

const placeholders = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]);
const sameSet = (a, b) => [...new Set(a)].sort().join() === [...new Set(b)].sort().join();

test('every Amharic draft answers an English key of its fragment, holds text, and keeps the placeholders', async () => {
  const problems = [];
  for (const f of await fragments()) {
    for (const [k, v] of Object.entries(f.am)) {
      if (!own(f.en, k)) problems.push(`${f.file} ${k}: no English key`);
      else if (typeof v !== 'string' || !v.trim()) problems.push(`${f.file} ${k}: empty`);
      else if (!sameSet(placeholders(v), placeholders(f.en[k]))) {
        problems.push(`${f.file} ${k}: {${placeholders(v)}} against {${placeholders(f.en[k])}}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('in both languages every string names each placeholder once and keeps the English ones (t() fills the first only)', () => {
  const problems = [];
  try {
    for (const k of EN_KEYS) {
      setLang('en');
      const en = t(k);
      setLang('am');
      const am = t(k);
      for (const [lang, s] of [['en', en], ['am', am]]) {
        const p = placeholders(s);
        if (new Set(p).size !== p.length) problems.push(`${lang} ${k}: a repeated placeholder`);
      }
      if (!sameSet(placeholders(am), placeholders(en))) problems.push(`am ${k}: {${placeholders(am)}} against {${placeholders(en)}}`);
    }
  } finally {
    setLang('en');
  }
  assert.deepEqual(problems, []);
});

test('Amharic coverage is reported, not enforced (the drafts await review)', async ctx => {
  const share = amharicCoverage();
  assert.ok(share >= 0 && share <= 1);
  const pct = (a, b) => `${b ? Math.round((1000 * a) / b) / 10 : 100}%`;
  const total = EN_KEYS.length;
  const drafted = Math.round(share * total);
  ctx.diagnostic(`Amharic draft coverage: ${drafted} of ${total} keys (${pct(drafted, total)})`);
  let areaKeys = 0, areaDrafts = 0;
  for (const f of await fragments()) {
    const n = Object.keys(f.en).length;
    const a = Object.keys(f.am).filter(k => own(f.en, k) && f.am[k]).length;
    areaKeys += n;
    areaDrafts += a;
    ctx.diagnostic(`  ${FRAGMENTS[f.name] || f.name} ${a} of ${n} (${pct(a, n)})`);
  }
  ctx.diagnostic(`  core ${drafted - areaDrafts} of ${total - areaKeys} (${pct(drafted - areaDrafts, total - areaKeys)})`);
});
