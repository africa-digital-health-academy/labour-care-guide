// The public-preview notice (2.0.2): its keys in English with an Amharic
// draft, the pure rule that decides whether it shows (first run, dismissed or
// not), the session memory of a dismissal, and the notice as the ward board,
// the case view and the About card build it. The screens are built against a
// minimal DOM stand-in (h() needs only these few calls); each test file runs
// in its own process, so the stand-in never reaches another test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EN_KEYS, t, setLang } from '../js/i18n.js';
import { mkPatient } from './helpers.mjs';

// ------------------------------------------------- minimal DOM stand-in ----

class Text {
  constructor(data) { this.nodeType = 3; this.data = data; this.parent = null; }
  get textContent() { return this.data; }
}

class El {
  constructor(tag) {
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.className = '';
    this.attrs = {}; this.children = []; this.parent = null; this.listeners = {}; this.dataset = {};
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } }
  get firstChild() { return this.children[0] || null; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); c.parent = null; return c; }
  remove() { if (this.parent) this.parent.removeChild(this); }
  get textContent() { return this.children.map(c => c.textContent).join(''); }
  click() { (this.listeners.click || []).forEach(fn => fn({ target: this })); }
}

globalThis.document ??= { createElement: tag => new El(tag), createTextNode: s => new Text(s) };
globalThis.self ??= globalThis; // settings.js loads version.js, which writes self.LCG_VERSION

/** Every element under root (root included), depth first, in document order. */
const walk = root => [root, ...root.children.filter(c => c.nodeType === 1).flatMap(walk)];
const notes = root => walk(root).filter(e => e.getAttribute('role') === 'note' && /preview-note/.test(e.className));

/** A sessionStorage stand-in; `broken` throws like a blocked store. */
function fakeStore({ broken = false } = {}) {
  const m = new Map();
  return {
    getItem(k) { if (broken) throw new Error('blocked'); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { if (broken) throw new Error('blocked'); m.set(k, String(v)); },
    clear() { m.clear(); },
  };
}
const session = fakeStore();
globalThis.sessionStorage = session;

const {
  PREVIEW_URL, PREVIEW_DISMISS_KEY, previewNoticeMode, previewDismissed, dismissPreview, previewNotice, previewSentence,
} = await import('../js/preview.js');
const { S } = await import('../js/store.js');
const { renderDashboard } = await import('../js/views/dashboard.js');
const { renderPatient } = await import('../js/views/patient.js');
const { renderSettings } = await import('../js/views/settings.js');
const { en: rpEn } = await import('../js/i18n/reports.js');

const SENTENCE = 'Public preview for demonstration, training and review - not for facility use until an '
  + 'Ethiopian obstetric and midwifery panel has reviewed it. Not a WHO product.';
const KEYS = ['preview_note', 'preview_more', 'preview_dismiss'];
const ETHIOPIC = /[\u1200-\u137F]/; // the Ethiopic block

function inLang(lang, fn) {
  setLang(lang);
  try { return fn(); } finally { setLang('en'); }
}

// ---------------------------------------------------------------- keys -----

test('the notice keys exist in English, with the owner\'s sentence word for word', () => {
  for (const k of KEYS) assert.ok(EN_KEYS.includes(k), k);
  assert.equal(t('preview_note'), SENTENCE);
  assert.equal(t('preview_more'), 'Learn more');
  assert.equal(t('preview_dismiss'), 'Dismiss');
  assert.ok(/^[\x20-\x7e]+$/.test(SENTENCE), 'the English sentence is plain ASCII (no em dash)');
});

test('every notice key has an Amharic draft in Ethiopic script that still names WHO', () => {
  inLang('am', () => {
    for (const k of KEYS) {
      setLang('en');
      const en = t(k);
      setLang('am');
      assert.notEqual(t(k), en, `${k}: no Amharic draft (falls back to English)`);
      assert.match(t(k), ETHIOPIC, k);
    }
    assert.match(t('preview_note'), /WHO/);
  });
});

// ------------------------------------------------------- the pure rule -----

test('first run: no case on the device shows the card, dismissed or not', () => {
  assert.equal(previewNoticeMode({ cases: 0, dismissed: false }), 'card');
  assert.equal(previewNoticeMode({ cases: 0, dismissed: true }), 'card', 'not dismissible until a case exists');
  assert.equal(previewNoticeMode(), 'card', 'nothing known: the safe answer is to show it');
  assert.equal(previewNoticeMode({ cases: undefined }), 'card');
});

test('with a case: the line shows until it is dismissed, then hides for the session', () => {
  assert.equal(previewNoticeMode({ cases: 1, dismissed: false }), 'line');
  assert.equal(previewNoticeMode({ cases: 12 }), 'line');
  assert.equal(previewNoticeMode({ cases: 1, dismissed: true }), null);
  assert.notEqual(previewNoticeMode({ cases: 3, dismissed: false }), null, 'a case alone never hides it');
});

// ----------------------------------------------- session memory --------

test('a dismissal is kept in sessionStorage, not in long-term storage', () => {
  const store = fakeStore();
  assert.equal(previewDismissed(store), false);
  dismissPreview(store);
  assert.equal(previewDismissed(store), true);
  assert.equal(store.getItem(PREVIEW_DISMISS_KEY), '1');
  store.clear(); // a new browser session: the notice returns, by design
  assert.equal(previewDismissed(store), false);
});

test('blocked storage never throws: the dismissal holds in memory for this page', () => {
  const broken = fakeStore({ broken: true });
  assert.equal(previewDismissed(broken), false);
  assert.doesNotThrow(() => dismissPreview(broken));
  assert.equal(previewDismissed(broken), true);
});

// ------------------------------------------------------ the notice ---------

test('the line: a note with the sentence, a Learn more link in a new tab without an opener, and Dismiss', () => {
  const parent = document.createElement('div');
  const el = previewNotice('line');
  parent.append(el);
  assert.equal(el.getAttribute('role'), 'note');
  assert.match(el.className, /\bpreview-note\b/);
  assert.match(el.className, /\bno-print\b/);
  assert.ok(el.textContent.includes(SENTENCE));
  const [link] = walk(el).filter(e => e.tagName === 'A');
  assert.equal(link.getAttribute('href'), PREVIEW_URL);
  assert.equal(PREVIEW_URL, 'https://github.com/africa-digital-health-academy/labour-care-guide#readme');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.match(link.getAttribute('rel'), /\bnoopener\b/);
  assert.equal(link.textContent, 'Learn more');
  const buttons = walk(el).filter(e => e.tagName === 'BUTTON');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].textContent, 'Dismiss');
  assert.equal(buttons[0].getAttribute('type'), 'button', 'never submits a form');

  session.clear();
  buttons[0].click();
  assert.equal(parent.children.length, 0, 'Dismiss removes the line');
  assert.equal(session.getItem(PREVIEW_DISMISS_KEY), '1', 'and remembers it for the session');
  session.clear();
});

test('the first-run card has no Dismiss button; no mode, no notice', () => {
  const card = previewNotice('card');
  assert.match(card.className, /\bcard\b/);
  assert.ok(card.textContent.includes(SENTENCE));
  assert.equal(walk(card).filter(e => e.tagName === 'BUTTON').length, 0);
  assert.equal(previewNotice(null), null);
  assert.equal(previewNotice('banner'), null);
});

test('the notice follows the screen language; the link stays the same', () => {
  inLang('am', () => {
    const el = previewNotice('line');
    assert.ok(el.textContent.includes(t('preview_note')));
    assert.ok(!el.textContent.includes(SENTENCE));
    assert.equal(walk(el).find(e => e.tagName === 'A').getAttribute('href'), PREVIEW_URL);
  });
});

// ------------------------------------------------------- the screens -------

test('ward board, first run: the card is the first thing on the board', () => {
  session.clear();
  S.patients = [];
  const page = renderDashboard();
  assert.equal(notes(page).length, 1);
  assert.equal(page.children[0], notes(page)[0], 'first card');
  assert.match(page.children[0].className, /\bcard\b/);
  session.setItem(PREVIEW_DISMISS_KEY, '1');
  assert.equal(notes(renderDashboard()).length, 1, 'still shown on first run, even if dismissed');
  session.clear();
});

test('ward board with a case: the line opens the board until dismissed for the session', () => {
  session.clear();
  S.patients = [mkPatient({ id: 'pv1' })];
  try {
    const page = renderDashboard();
    assert.equal(page.children[0], notes(page)[0]);
    assert.doesNotMatch(page.children[0].className, /\bcard\b/);
    walk(page.children[0]).find(e => e.tagName === 'BUTTON').click();
    assert.equal(notes(page).length, 0, 'gone at once');
    assert.equal(notes(renderDashboard()).length, 0, 'and on the next rebuild (the heartbeat rebuilds the board)');
  } finally {
    S.patients = [];
    session.clear();
  }
});

test('case view: the line sits below the alert strip, outside every live region', () => {
  session.clear();
  const p = mkPatient({ id: 'pv2' });
  S.patients = [p];
  try {
    const page = renderPatient('pv2', 'alerts');
    const kids = page.children;
    const strip = kids.findIndex(e => e.getAttribute('data-live') === 'alert-strip');
    const note = kids.findIndex(e => notes(e).length);
    assert.ok(strip >= 0 && note === strip + 1, 'right after the alert strip');
    assert.equal(kids.findIndex(e => e.getAttribute('data-live') === 'patient-header'), 0, 'the header still leads');
    assert.equal(kids[note].getAttribute('data-live'), null);
    assert.ok(!walk(kids[note]).some(e => e.getAttribute('data-form') !== null), 'holds no form');
    session.setItem(PREVIEW_DISMISS_KEY, '1');
    assert.equal(notes(renderPatient('pv2', 'alerts')).length, 0, 'dismissed: not shown');
  } finally {
    S.patients = [];
    session.clear();
  }
});

test('About card: the sentence and its link, above the disclaimer, in both languages', () => {
  for (const lang of ['en', 'am']) {
    inLang(lang, () => {
      const page = renderSettings();
      const about = walk(page).find(e => e.className === 'card'
        && e.children[0] && e.children[0].tagName === 'H2' && e.children[0].textContent === t('rp.about'));
      assert.ok(about, `${lang}: About card found`);
      const paras = about.children.filter(e => e.tagName === 'P');
      const at = paras.findIndex(e => e.textContent.includes(t('preview_note')));
      const disclaimer = paras.findIndex(e => e.textContent === t('rp.disclaimer'));
      assert.ok(at >= 0, `${lang}: the sentence is in the About card`);
      assert.ok(disclaimer > at, `${lang}: above the disclaimer`);
      const link = walk(paras[at]).find(e => e.tagName === 'A');
      assert.equal(link.getAttribute('href'), PREVIEW_URL);
      assert.equal(link.getAttribute('target'), '_blank');
      assert.match(link.getAttribute('rel'), /\bnoopener\b/);
      if (lang === 'en') assert.ok(paras[at].textContent.includes(SENTENCE));
    });
  }
  assert.ok(rpEn['rp.disclaimer'], 'the existing disclaimer is still there');
});

test('previewSentence is the sentence, a space and the link', () => {
  const [text, space, link] = previewSentence();
  assert.equal(text, SENTENCE);
  assert.equal(space, ' ');
  assert.equal(link.textContent, 'Learn more');
});
