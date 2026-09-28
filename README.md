# Labour Care Guide - digital, offline-first

**An open-source, offline-first tablet implementation of the WHO Labour Care Guide (2020) for midwives in resource-limited settings: guided entry, an auto-drawn labour chart, clinical alerts, referral support, birth record and FHIR export.**

This repository is **version 2** of the project first published as [parthograph](https://github.com/DrTemesgen/parthograph) (June 2026). It was started from the v1 tree after a full audit against the current WHO document set. The audit and its verdict are in [docs/WHO_ALIGNMENT_2026.md](docs/WHO_ALIGNMENT_2026.md); the improvements this rebuild proposes to WHO itself are in [docs/SUGGESTIONS_TO_WHO.md](docs/SUGGESTIONS_TO_WHO.md).

> **Status (September 2026): version 2 is in development.** The v1 application remains live at https://drtemesgen.github.io/parthograph/ and keeps working on installed tablets. The v2 application will be published from this repository when the clinical engine, chart and reports have passed their tests and review (milestone M6 below).

> **Disclaimer.** This software is a decision-support and documentation aid for skilled birth attendants. It is **not a certified medical device** and does not replace clinical judgement, national protocols, or senior consultation. It is not a WHO product and is not endorsed by WHO (see [NOTICE-WHO.md](NOTICE-WHO.md)). Facility use requires approval by the responsible health authorities and supervised piloting.

## Why a version 2

The WHO Labour Care Guide form and user's manual have not changed since 2020, and the v1 engine matches every threshold on the form. What changed is the guidance around it and what a digital tool is expected to do:

- **WHO labour care guide: implementation resource package (September 2025)** - a facility indicator set (LCG completed, FHR and BP on admission, companion of choice, caesarean rate by Robson group, institutional stillbirths), a clinical audit tool, and a five-level maturity model. Ethiopia was one of its seven pilot countries.
- **WHO/FIGO/ICM consolidated postpartum haemorrhage guidelines (October 2025)** - a new action trigger (300 mL with abnormal signs, or 500 mL), calibrated-drape measurement and the MOTIVE first-response bundle.
- Fourteen fidelity gaps against the form itself (declined codes, the pushing marker, initials, labour onset, parity-specific limits, sheet continuation) and thirteen safety-grade defects found by two independent code reviews of v1.

## What v2 delivers (programme)

| Milestone | Content | Status |
|---|---|---|
| M0 | New repository, WHO alignment audit, suggestions to WHO, release plumbing (single version constant, atomic offline updates with an "Update ready" chip, alarm unlock, screen wake lock, persistent storage), Node test suite | done |
| M1 | Schema v2 with migration, per-case protocol, restore that never overwrites newer data | planned |
| M2 | Clinical engine to the WHO standard: declined codes, pushing marker, parity-specific limits, alert lifecycle (recurrence re-alerts), append-only corrections, PPH 2025 trigger and bundle, postpartum watch, audit score, indicators | planned |
| M3 | Safe rendering (forms are never wiped by background refresh), admission that records only what was entered, initials per entry, correction flows | planned |
| M4 | Chart and print that mirror the WHO sheet (12-hour sheet with continuation, second-stage panel, descent row, alert circles), facility reports with the six WHO indicators | planned |
| M5 | FHIR fixes, Amharic coverage, documentation | planned |
| M6 | Verification walk, review, publication of the v2 app | planned |

The full gap register (F1-F14, N1-N5, S1-S13) is in the audit document.

## What it does today (v1 feature set, carried over)

| Feature | Detail |
|---|---|
| Guided wizard | One large-format question per screen (numpad / big buttons). Entries can be back-timed up to 60 min; no lock-outs. |
| Dual protocol engine | WHO LCG 2020 (active phase from 5 cm, per-centimetre time limits) or the Ethiopian modified partograph (MOH 2021, alert/action lines), kept as a legacy option. |
| Schedule timers | FHR and contractions every 30 min (every 5/15 min in the second stage), vitals and examination every 4 h, supportive care hourly; due/overdue chips per woman, with sound. |
| Ward board | Every woman in labour sorted by urgency, built for one midwife covering several labours at night. |
| Alert engine | WHO LCG thresholds for FHR, decelerations, liquor, contractions, BP, temperature, pulse, urine, moulding/caput, progress, second-stage duration and prolonged rupture of membranes; tiered (review vs act now); every alert acknowledged with a recorded decision. |
| Referral support | Reasons pre-selected from active alerts; pre-referral bundle checklist (IV line, MgSO4 loading dose, first-dose antibiotics, call-ahead, transport); printable and shareable note. |
| Emergency cards | Eclampsia, cord prolapse, APH, shoulder dystocia, uterine rupture, PPH. |
| Birth record | APGAR 1/5/10, essential newborn care checklist, third stage, blood loss with PPH alert. |
| Reports | Monthly facility indicators, CSV birth register, JSON backup and restore. |
| FHIR R4 export | One Bundle per case (Patient, Encounter, Observations with LOINC/SNOMED codes, MedicationAdministration, Flags, ServiceRequest). See [docs/FHIR_MAPPING.md](docs/FHIR_MAPPING.md). |
| Ethiopian calendar | Ge'ez date beside the Gregorian date; draft Amharic interface strings. |
| Offline-first | 100 percent client-side: IndexedDB plus a service worker. Installable as a PWA on Android tablets. |

## Quick start

No build step, no dependencies.

```bash
python -m http.server 8080      # or: npx http-server .
# open http://localhost:8080 - then Settings > Load a demo labour case
```

```bash
npm test                        # Node 20+; runs the test suite in test/
```

Install on a tablet: open the hosted URL in Chrome on Android, menu, "Add to Home screen". The app then works fully offline and shows an "Update ready" chip in the top bar when a new release has been downloaded.

## Project structure

```
index.html            app shell (PWA)
sw.js                 service worker: versioned, atomic offline shell
js/
  version.js          the single version constant (cache key + About screen)
  protocol.js         clinical engine: protocols, schedules, thresholds
  alerts.js           alert rules (observation- and time-triggered), emergencies
  wizard.js           guided entry flow, alert acknowledgement, medications
  chart.js            SVG chart renderer
  ethiopic.js         Ethiopian calendar conversion (tested)
  fhir.js             FHIR R4 Bundle export
  db.js / store.js    IndexedDB persistence, backup/restore
  i18n.js             English + draft Amharic strings
  views/              dashboard, admission, patient, delivery, referral, reports, settings
test/                 node:test suite (npm test)
docs/                 WHO alignment audit, suggestions to WHO, design, research, FHIR mapping, roadmap
```

All clinical thresholds live in `js/protocol.js` and `js/alerts.js`, never in view code, so they can be reviewed by clinicians and updated when national guidance changes.

## Evidence base

- WHO Labour Care Guide (2020) and its user's manual: all thresholds and monitoring frequencies.
- WHO labour care guide: implementation resource package (2025): indicators, audit tool, maturity model.
- WHO/FIGO/ICM consolidated guidelines on postpartum haemorrhage (2025).
- WHO recommendations: intrapartum care for a positive childbirth experience (2018).
- Ethiopian MOH Obstetrics Management Protocol for Health Centers (2021), for the legacy modified partograph.
- Field lessons from ePartogram (Kenya, Zanzibar), PartoMa (Zanzibar, Ethiopia), mLabour (Tanzania) and DAKSH (India): see [docs/RESEARCH.md](docs/RESEARCH.md).

## Get involved

This project is looking for clinical reviewers (obstetrics, midwifery), translators (Amharic, Afaan Oromo, Tigrinya, Somali, Afar), pilot facilities and digital-health implementers. Clinical-content changes require a citation (WHO or MOH document and page). Comments on the suggestions to WHO are welcome as issues on this repository.

Contact: Dr Temesgen Endalew - [linkedin.com/in/dr-temesgen-endalew](https://www.linkedin.com/in/dr-temesgen-endalew/)

## Licence

Code: [MIT](LICENSE). WHO-derived content is used under the WHO CC BY-NC-SA 3.0 IGO licence with attribution; see [NOTICE-WHO.md](NOTICE-WHO.md).
