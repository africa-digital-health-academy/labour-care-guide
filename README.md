# Labour Care Guide

**Digital and offline-first. Implements the WHO Labour Care Guide (2020) for midwives in resource-limited settings.**

The app guides bedside recording one question at a time, draws the labour chart in the layout of the WHO sheet, raises an alert for every value in the form's Alert column and records the decision taken, supports referral, keeps the birth record and the postpartum watch, scores each case against the WHO audit tool, reports the WHO implementation indicators, and exports FHIR R4. Everything runs on the tablet, without a server.

This repository is version 2 of the project first published as [Parthograph](https://github.com/DrTemesgen/parthograph) (June 2026), rebuilt after an audit against the current WHO document set: [docs/WHO_ALIGNMENT_2026.md](docs/WHO_ALIGNMENT_2026.md). Improvements this rebuild proposes to WHO itself are in [docs/SUGGESTIONS_TO_WHO.md](docs/SUGGESTIONS_TO_WHO.md).

> **Status (1 October 2026): version 2 (2.0.1) is a public preview** at https://africa-digital-health-academy.github.io/labour-care-guide/ (published by the Africa Digital Health Academy) - for demonstration, training and review, **not for facility use** until the clinical panel has reviewed it (see [docs/GAP_REGISTER.md](docs/GAP_REGISTER.md), section 4). Milestones M0 to M6 are done: the test suite, two browser walks of the demo case, and two automated review passes by a separate AI model that checked every alert value and interval against the WHO texts. No clinician has reviewed it yet; that review is the next step. See [docs/ROADMAP.md](docs/ROADMAP.md) and [CHANGELOG.md](CHANGELOG.md). The v1 application remains live at https://drtemesgen.github.io/parthograph/ and keeps working on installed tablets.

> **Safety status: not for facility use.** Every clinical rule, and every value marked `PANEL-TO-CONFIRM` in the code, must first be reviewed by an Ethiopian obstetric and midwifery clinical panel, and any pilot needs approval by the responsible health authorities and supervision. Publishing v2.0.0 will not change this: facility use waits for the panel. This software is a decision-support and documentation aid for skilled birth attendants. It is not a certified medical device and does not replace clinical judgement, national protocols or senior consultation. It is not a WHO product and WHO does not endorse it (see [NOTICE-WHO.md](NOTICE-WHO.md)).

## What it does

| Area | Detail |
|---|---|
| Guided entry | One large-format question per screen (numpad, stepper, big buttons). Entries can be back-timed up to 60 min; nothing is locked out. The form's codes: supportive care Y / N / D, amniotic fluid I, C, M+ to M+++, B, urine Negative to ++++. Initials on every entry. |
| Protocols | WHO Labour Care Guide (2020) by default: active first stage from 5 cm, per-centimetre time limits, 12 h / 10 h active first stage by parity, second stage timed from when pushing began (P). The Ethiopian modified partograph (MOH 2021, alert and action lines) is kept as a legacy option. Each case keeps the protocol it was admitted under. |
| Schedules and ward board | Due and overdue chips with sound, at the WHO LCG intervals: FHR and contractions every 30 min (every 5 and 15 min in the second stage), vitals and vaginal examination every 4 h, supportive care hourly, oxytocin hourly while it runs. The ward board shows every woman in labour, sorted by urgency, and every mother in the postpartum watch. |
| Alerts | Every value in the WHO Alert column, plus time-based checks on a 30-second heartbeat. Each alert asks for an acknowledged decision with initials, asks again for a new abnormal value, resolves on later normal evidence, and opens a new episode if the finding returns. |
| Corrections | Entries are voided or corrected with a reason and initials, shown struck through, never deleted; the labour stage and its timers are re-derived. A birth record can be corrected and is kept in the case history. Real cases are closed, never deleted. |
| Chart and print | The chart is laid out as the WHO sheet: X for dilatation, O for descent, P for pushing, alert values circled, assessment and plan rows, a new sheet after 12 hours. Prints on A4 landscape, one page per sheet, with an appendix of notes and medication. |
| Birth and postpartum | APGAR at 1, 5 and 10 min, newborn care, third stage (uterotonic within 1 minute: oxytocin or heat-stable carbetocin; no routine uterine massage), caesarean section at hospital level, stillbirth timing. Postpartum haemorrhage per the WHO/FIGO/ICM 2025 guidelines: calibrated-drape readings, the two-level trigger, the MOTIVE first-response bundle with tranexamic acid. Postpartum watch of mother and baby for 24 h. |
| Referral | Reasons pre-selected from open danger alerts, a pre-referral bundle checklist (MgSO4 loading dose, antibiotics, IV line, call ahead), a printable and shareable note; the woman stays monitored until her departure is recorded. |
| Reports and audit | The six indicators of the WHO LCG implementation resource package (2025) per month, with the Robson table and the stillbirth split; the monthly HMIS counts; a per-case LCG audit score; CSV exports that open cleanly in Excel; JSON backup and a restore that previews changes and never overwrites newer data. |
| FHIR R4 export | One Bundle per case. Mapping in [docs/FHIR_MAPPING.md](docs/FHIR_MAPPING.md). |
| Language and calendar | English interface with a draft Amharic translation (alert texts stay in English until clinically validated). Ethiopian calendar dates beside the Gregorian; all times in East Africa Time. |

## Offline-first PWA

- Static files only: ES modules, no build step, no dependencies, no server.
- Records live in the browser's IndexedDB on the tablet. Nothing leaves the device unless someone exports a file (JSON backup, CSV, FHIR). Keep regular JSON backups: the data lives on one device.
- A versioned service worker keeps the whole app available offline. A new release downloads in the background and waits; an "Update ready" chip in the top bar lets the midwife reload when it suits her.
- Installable to the home screen of an Android tablet (Chrome menu, "Add to Home screen"). The screen stays awake while the app is open, and alarms are unlocked by the first tap.

## Run it

Requirements: any static web server; Node 20 or later for the tests. Nothing to install.

```bash
python -m http.server 8080     # or: npx http-server . -p 8080
# open http://localhost:8080, then load the demo case from Settings or from the empty ward board
```

```bash
npm test                       # the node:test suite in test/
```

Serve the folder over HTTP rather than opening `index.html` from disk: browsers do not run the app's ES modules from a `file://` address, and the service worker (offline mode, update chip) needs `localhost` or HTTPS.

When you test a new version locally, serve without browser caching (`npx http-server . -p 8080 -c-1`) or tick "Disable cache" in the browser's developer tools. The Python server sends no cache headers, so a browser may keep files of the previous version for hours on a load that the service worker does not control.

## File map

```
index.html              app shell (PWA entry point)
manifest.webmanifest    install metadata
sw.js                   service worker: versioned, atomic offline shell
css/app.css             screen styles
css/print.css           paper: A4 landscape chart sheets, notes appendix, summary
icons/                  SVG app icons
js/version.js           the single version constant (cache key, About screen)
js/app.js               boot, routing, render model, 30-second heartbeat, update chip, wake lock
js/store.js             in-memory state, the save bus, per-session initials
js/db.js                IndexedDB (cases, settings, automatic backups), JSON backup and restore
js/migrate.js           schema migration (pure, add-only) and the restore merge plan
js/protocol.js          the two protocols, schedules, limits, stage derivation, due list
js/alerts.js            alert rules, alert lifecycle, PPH trigger and bundle, emergency cards
js/record.js            record layer: entries, void and correct, events, referral, birth record
js/audit.js             per-case audit and score (WHO implementation package, Annex 8)
js/indicators.js        the six WHO indicators (Table 3), Robson groups, HMIS counts, CSV
js/wizard.js            guided entry, acknowledgement and medication dialogs
js/chart.js             the WHO LCG chart as SVG (pure chartSVG), sheets, print sheets
js/partograph.js        the Ethiopian partograph layout and the drawing kit both charts share
js/fhir.js              FHIR R4 Bundle export
js/ethiopic.js          Ethiopian calendar conversion
js/ui.js                DOM helpers, dialogs, numpad, stepper, alarms, East Africa Time
js/demo.js              the DEMO practice case
js/i18n.js              t(), core English and draft Amharic strings, merges the fragments
js/i18n/wizard.js       wizard strings (keys wz.)
js/i18n/patient.js      case view and ward board strings (keys pt.)
js/i18n/forms.js        admission, birth record and referral strings (keys fm.)
js/i18n/reports.js      reports, settings and app shell strings (keys rp.)
js/views/               dashboard, admission, patient, delivery, referral, reports, settings
test/                   node:test suite, one file per area (npm test)
docs/                   WHO alignment audit, gap register, suggestions to WHO, design, research, FHIR mapping, roadmap
NOTICE-WHO.md           attribution and licence notice for WHO material
CHANGELOG.md            changes per milestone
```

All clinical thresholds live in `js/protocol.js` and `js/alerts.js`, never in the screens, so clinicians can review them in one place and update them when national guidance changes. How it all fits together: [docs/DESIGN.md](docs/DESIGN.md).

## Evidence base

- WHO Labour Care Guide (2020) and its user's manual: thresholds, codes and monitoring frequencies.
- WHO labour care guide: implementation resource package (2025): the facility indicators and the clinical audit tool.
- WHO/FIGO/ICM consolidated guidelines on postpartum haemorrhage (2025): the PPH trigger and first-response bundle.
- WHO recommendations: intrapartum care for a positive childbirth experience (2018).
- Ethiopian MOH Obstetrics Management Protocol for Health Centers (2021), for the legacy modified partograph.
- Field lessons from ePartogram (Kenya, Zanzibar), PartoMa (Zanzibar, Ethiopia), mLabour (Tanzania) and DAKSH (India).

Summaries and links: [docs/RESEARCH.md](docs/RESEARCH.md).

## Get involved

The project is looking for clinical reviewers (obstetrics, midwifery), translators (Amharic, Afaan Oromo, Tigrinya, Somali, Afar), pilot facilities and digital-health implementers. Clinical-content changes need a citation (WHO or MOH document and page). Comments on the suggestions to WHO are welcome as issues once the repository is public.

Contact: Dr Temesgen Endalew - [linkedin.com/in/dr-temesgen-endalew](https://www.linkedin.com/in/dr-temesgen-endalew/)

## Licence

Code: [MIT](LICENSE). Material derived from WHO documents is used under their CC BY-NC-SA 3.0 IGO licence, with attribution; anyone redistributing it must respect that licence's non-commercial and share-alike terms. No WHO logo is used. See [NOTICE-WHO.md](NOTICE-WHO.md).
