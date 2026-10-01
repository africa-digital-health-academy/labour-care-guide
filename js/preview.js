// preview.js - the public-preview notice (2.0.2). The owner's outreach links
// open the live preview directly, so the screens say what it is: a preview for
// demonstration, training and review, not for facility use until an Ethiopian
// obstetric and midwifery panel has reviewed it, and not a WHO product.
//
// Where it shows: the ward board (a card on first run, when the device holds
// no case; otherwise one line), the case view (one line, below the alert
// strip, so alerts keep their place) and the About card in Settings. It sits
// in the page flow, never over a form or the alert strip, and outside every
// data-live region, so the heartbeat never touches it. The line can be
// dismissed for the browser session (sessionStorage): it returns on the next
// open, by design. Strings are core keys of js/i18n.js ('preview_*'), with an
// Amharic draft; alert titles and advice stay English as always.

import { h } from './ui.js';
import { t } from './i18n.js';

export const PREVIEW_URL = 'https://github.com/africa-digital-health-academy/labour-care-guide#readme';
export const PREVIEW_DISMISS_KEY = 'lcg-preview-dismissed';

/**
 * Which notice the screens show. Pure: exported for the tests.
 *   'card' - first run: no case on this device (not dismissible);
 *   'line' - a case exists and the line was not dismissed this session;
 *   null   - dismissed for this session.
 */
export function previewNoticeMode({ cases = 0, dismissed = false } = {}) {
  if (!(cases > 0)) return 'card';
  return dismissed ? null : 'line';
}

// Storage blocked (some private modes): the dismissal holds until the page reloads.
let dismissedInMemory = false;

function sessionStore() {
  try { return globalThis.sessionStorage || null; } catch { return null; }
}

/** True once the line was dismissed in this browser session. */
export function previewDismissed(store = sessionStore()) {
  try {
    if (store) return store.getItem(PREVIEW_DISMISS_KEY) === '1';
  } catch { /* storage blocked: fall back to this page's memory */ }
  return dismissedInMemory;
}

/** Remember the dismissal for this browser session. */
export function dismissPreview(store = sessionStore()) {
  try {
    if (store) {
      store.setItem(PREVIEW_DISMISS_KEY, '1');
      return;
    }
  } catch { /* storage blocked: fall back to this page's memory */ }
  dismissedInMemory = true;
}

/** The sentence and its "Learn more" link (new tab, no opener), for any container. */
export function previewSentence() {
  return [
    t('preview_note'), ' ',
    h('a', { href: PREVIEW_URL, target: '_blank', rel: 'noopener noreferrer' }, t('preview_more')),
  ];
}

/**
 * The notice for a mode from previewNoticeMode(): role="note", muted text with
 * the warn edge (.preview-note in css/app.css). 'line' carries a small Dismiss
 * button that hides it for the session; 'card' is the first-run card. null for
 * null, so h() children can take the result as it is.
 */
export function previewNotice(mode) {
  if (mode !== 'line' && mode !== 'card') return null;
  const el = h('div', { class: `preview-note no-print${mode === 'card' ? ' card' : ''}`, role: 'note' },
    h('span', { class: 'preview-text' }, previewSentence()),
    mode === 'line' ? h('button', {
      type: 'button', class: 'preview-dismiss',
      onclick: () => { dismissPreview(); el.remove(); },
    }, t('preview_dismiss')) : null,
  );
  return el;
}
