# Roadmap

## v1 (Parthograph, June 2026) - done

Published as [DrTemesgen/parthograph](https://github.com/DrTemesgen/parthograph), last release v1.3.0 (12 June 2026), live at https://drtemesgen.github.io/parthograph/: dual-protocol engine (WHO LCG 2020 and the Ethiopian modified partograph, MOH 2021), guided wizard, auto-drawn SVG chart, due timers and ward board, tiered alerts with acknowledgement, referral support with a pre-referral bundle and a printable note, emergency cards, birth record with APGAR, reports, CSV and JSON backup, FHIR R4 export, Ethiopian calendar, draft Amharic, offline PWA. The audit of v1 against the current WHO documents is [WHO_ALIGNMENT_2026.md](WHO_ALIGNMENT_2026.md).

## v2.0 (this repository) - released as a public preview, 1 October 2026

Started on 28 September 2026 from the v1.3.0 tree. One branch and one pull request per milestone; details per milestone in [CHANGELOG.md](../CHANGELOG.md).

| Milestone | Content | Status |
|---|---|---|
| M0 | New repository, WHO alignment audit, suggestions to WHO, release plumbing (single version constant, atomic offline updates with an "Update ready" chip, alarm unlock, wake lock, persistent storage), `node:test` suite | done, 28 Sep 2026 |
| M1 | Schema version and migration, per-case protocol, restore that never overwrites newer data | done, 28 Sep 2026 |
| M2 | Clinical engine aligned with the WHO LCG form and manual: WHO codes, pushing marker, parity-specific limits, alert lifecycle, append-only record layer, PPH 2025 trigger and bundle, postpartum watch, per-case audit, facility indicators | done, 30 Sep 2026 |
| M3 | Safe rendering, admission that records only what was entered, initials on every entry, void, correct and resolve flows, PPH card, postpartum watch screens | done, 30 Sep 2026 |
| M4 | Chart and print laid out as the WHO sheet, continuation sheets, reports with the six WHO indicators and CSV exports | done, 1 Oct 2026 |
| M5 | FHIR export fixes, Amharic draft coverage of the screens, the Ethiopian partograph split out of the chart module, documentation | done, 1 Oct 2026 |
| M6 | Verification and review: `npm test`, browser walk of the demo case (phone width, offline reload, update chip after a version bump), hardening of the M5 follow-ups, two automated review passes, independent of the build, against the WHO texts, and the clinical tick list [GAP_REGISTER.md](GAP_REGISTER.md). Then, only on the owner's go: repository made public, GitHub Pages enabled, tag v2.0.0, a "superseded by v2" line on the Parthograph README | done; v2.0.0 public preview published 1 Oct 2026 on the owner's go; the "superseded" line on the Parthograph README waits for the clinical panel |

## v2.1 - next

- **Afaan Oromo and Tigrinya.** Interface strings in both languages, built on the reviewed Amharic set and checked by native-speaking midwives before release. Somali and Afar follow.
- **Sync server** (optional; offline stays first-class). A lightweight server with device pairing, so a facility's records outlive a single tablet and a supervisor can see them. Patient data leaves a device for the first time here, so hosting, consent and data governance under Ethiopian health-data rules are decided before any build.
- **DHIS2 push.** Monthly aggregate data values (the HMIS counts and the six WHO indicators) sent to Ethiopia's DHIS2, mapped to its data elements, to end duplicate reporting.
- **Ethiopian national adaptation slot.** Once the 2024 National Intrapartum Care Guideline (MoH with ESOG) is obtained, its adaptations of the LCG go into `js/protocol.js` as a reviewed overlay or a third protocol. The pure WHO LCG and the 2021 partograph stay selectable.
- **Ethiopian-calendar reporting months: built (2.0.0), questions open.** The Reports screen has a calendar button, Gregorian | Both | Ethiopian (Both by default, kept per device). Ethiopian and Both count by Ethiopian month, midnight to midnight East Africa Time, with Pagume as the 13th month; Gregorian counts by Gregorian month for WHO or partner reporting (see [DESIGN.md](DESIGN.md) section 9). Still to settle with an HMIS focal person: which DHIS2 period Pagume's five or six days are reported in, whether some facilities close the month on a fixed day, and how the counts map to DHIS2 data elements (see the DHIS2 push above). The first two change only the month range function.
- **Clinical panel sign-off, recorded in the repository**, by an Ethiopian obstetric and midwifery panel, using the tick list in [GAP_REGISTER.md](GAP_REGISTER.md):
  - every value marked `PANEL-TO-CONFIRM` in the code: the passive second-stage limit (`secondStagePassiveMaxMin`, off until set); the postpartum watch intervals (every 15 min to 2 h, hourly to 6 h, every 4 h to 24 h) and the first postpartum BP at 15 min (`POSTPARTUM`); the newborn temperature range 36.5 to 37.5 C (`LIMITS.newbornTemp`) and the postpartum baby cues (breathing, temperature, feeding); the MgSO4 loading-dose wording and IV duration (`MGSO4_LOADING` in `js/alerts.js`); the audit's 15-minute acknowledgement window and section weights (`LIMITS.audit`); and the definition of a completed LCG behind the LCG-use indicator (`js/audit.js`);
  - every rule in `js/protocol.js` and `js/alerts.js`, including the rules kept from v1 that are not WHO alert values (the severe FHR, pulse, BP and temperature tiers, moulding ++, the second-stage early warning, prolonged rupture of membranes at 18 h, the oxytocin rate limit, the 8-hour national latent-phase rule);
  - the acknowledgement load of the re-asking rule (up to 12 an hour for a persistent abnormal FHR in the second stage);
  - the Amharic drafts, and the translation of alert titles and advice, which stay in English until the panel validates them.

## Later

- Facility and woreda **supervisor dashboard** (completion quality, alert response times, outcomes) for the catchment-based mentorship system (supervision OR 3.2 to 4.5 for partograph use).
- SMS or Telegram referral pre-notification where a network exists; referral feedback captured on return.
- In-app micro-training and job-aid cards (refresher training is the strongest known driver of partograph use, OR 5.7).
- **OpenMRS / Bahmni** FHIR integration pilot (Ethiopia's EMR direction); Master Facility Registry IDs, NHDD concept alignment, ICD-11 coding of outcomes.
- Evaluate migration to, or coexistence with, **OpenSRP 2 (fhircore)** for national-scale deployment.
- Contribute the data dictionary and the alert logic toward a WHO SMART Guidelines intrapartum digital adaptation kit (WHO reported one under development in 2025).
- Formal usability and outcome evaluation at pilot health centres, registered with MoH digital-health governance (consider pairing with the PartoMa Ethiopia group at Haramaya).

## Engineering debt and known limitations

- Amharic strings are drafts; alert and advice text is English-only by design until the panel validates a translation.
- No user accounts: the model is a shared facility tablet. Initials are recorded on every entry and kept for the browser session, with the Settings name as a fallback. Add a provider PIN if governance requires it.
- Single-device data until a sync server exists; mitigated by JSON backup and restore with a dry-run preview, automatic snapshots before a migration or a restore, and CSV exports.
- Medication entries and notes can be voided from the screens (M6) but not corrected: a wrong one is voided and entered again.
- IV fluids and other medicines are recorded only when given; the WHO form's hourly N (none given) is not recorded, and the audit's medication section covers oxytocin only (gap F10, partly done).
- PWA icons are SVG only: fine for Chrome on Android; add PNG fallbacks for older WebViews.
- The 10-minute APGAR is a form offered after a low 5-minute score, not a timed notification.
