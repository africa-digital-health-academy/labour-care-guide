# Changelog

## 2.0.0-dev (unreleased) - milestone M2, 30 September 2026

Clinical engine brought to the WHO standard. The screens are not redesigned
yet (M3); the engine is wired into the existing ones.

- Alerts re-arm (S1). Each alert is linked to the entries that raised it and
  resolves on evidence (a later normal reading), when its time rule stops
  firing, when the entries behind it are voided, or by hand. A finding after
  resolution opens a new, unacknowledged alert with the next episode number.
  Thick meconium and blood-stained fluid never auto-resolve.
- Alerts carry the observation time, not the entry time (S12). A missing
  parity uses the stricter limit and says so.
- Supportive care accepts Y, N or D (declined); N and supine are alert values,
  no longer silent notes (F1).
- Second stage: the LCG limit counts from when pushing began, the form's P;
  until pushing is recorded it counts from full dilatation (F2). A passive
  second-stage limit exists but stays off until the clinical panel sets it.
- Active first stage limit is 12 h in first labours and 10 h in later labours
  (F5, WHO 2018 recommendation 6).
- Amniotic fluid is graded M+, M++, M+++; thick meconium or blood found at a
  vaginal examination now alerts (F7).
- Contractions longer than 60 s or shorter than 20 s alert on their own, with
  a prompt to verify over another 10 minutes (F8); on oxytocin, longer than
  60 s is a danger alert.
- Urine is graded Negative, Trace, + to ++++ (F9).
- Oxytocin is due 60 min after the infusion starts and after each dose record;
  30 min on the Ethiopian partograph (F10).
- The latent-phase 8 h rule is labelled as national latent care (F11).
- New record layer, js/record.js (S5): entries are voided or corrected with an
  author and a reason and never deleted; voiding a mistyped 10 cm exam reverts
  the second stage and its timers; a birth record can be voided into
  deliveryHistory.
- Ethiopian partograph: the alert and action lines start at the first active
  dilatation, not at 4 cm (S7). The alert-line projection now waits until the
  next exam is due.
- A woman referred in labour stays monitored until her departure is recorded
  (S8), with a new "She has left the facility" button on the referral note.
  Schema 3 migration treats older referrals as departed at the referral time.
- Thresholds that lived in the screens moved into the engine (S13): admission
  risk, birth alerts, report counts, APGAR bands, numpad hints.
- Postpartum haemorrhage per the WHO/FIGO/ICM 2025 guidelines (N3): trigger at
  500 mL, or at 300 mL with pulse above 100, shock index above 1, systolic
  below 100 or diastolic below 60, within 24 h of birth. The approved plan's
  placeholder signs (pulse 120, systolic 90) were corrected to these values.
  The alert and the emergency card carry the first-response bundle with
  tranexamic acid. The third-stage checklist offers heat-stable carbetocin,
  adds a uterine tone check and drops routine uterine massage (WHO 2018
  recommendation 46).
- Postpartum watch schedule (N4, WHO 2018 recommendation 55): mother and baby
  every 15 min for 2 h, hourly to 6 h, 4-hourly to 24 h (panel to confirm);
  BP shortly after birth and again within 6 h; urine passed by 6 h; mother and
  newborn postpartum rules.
- New per-case audit, js/audit.js, translating the WHO LCG Annex 8 audit tool
  (N2), and new facility indicators, js/indicators.js (N1): the six WHO Table 3
  indicators with Robson groups and stillbirth disaggregation, HMIS counts by
  birth date with demo cases excluded, and a CSV writer with a byte-order mark
  and a formula guard.
- The chart is split into a pure chartSVG() that the tests can run; voided
  entries are never drawn.
- Tests: 240, up from 40.

## 2.0.0-dev (unreleased) - milestone M1, 28 September 2026

- Stored case records now carry a schema version (`schemaVersion`); a pure, idempotent
  migration (`js/migrate.js`) brings every older record forward on load or on restore,
  add-only so nothing already on a device is renamed or removed.
- Each case now remembers which protocol it was admitted under (`protocolId`), fixing a
  defect where changing the Settings protocol switch used to change the standard applied
  to women already in labour. `protocolOverride` is kept as a legacy fallback.
- A `backups` object store takes an automatic snapshot before a schema migration writes
  anything, and again before a restore overwrites anything - in addition to the manual
  JSON backup file, never a replacement for it.
- Restore now previews a dry-run merge (new / updated / unchanged counts) and asks for
  confirmation before writing; newer record wins by `updatedAt`, a tie keeps the local
  record.
- Fields laid down for later milestones, not yet surfaced in the UI: per-entry author
  (`by`), observation source (`admission` vs `entry`), alert `episode`, `deliveryHistory`,
  `onsetMode`, `romUnknown`.

## 2.0.0-dev (unreleased) - milestone M0, 28 September 2026

- New repository `labour-care-guide`, started from the Parthograph v1.3.0 tree (tag `v1.3.0-import`).
- WHO alignment audit (`docs/WHO_ALIGNMENT_2026.md`) and suggestions to WHO (`docs/SUGGESTIONS_TO_WHO.md`).
- Single version constant `js/version.js` used by the service worker cache key and the About screen.
- Service worker: versioned, atomic app shell (cache-first, downloaded fresh, all-or-nothing); a new release waits until the midwife taps the "Update ready" chip; hourly and on-focus update checks.
- Alarms: audio unlocked on the first tap or key press; vibration fallback; "Test sound" button.
- Screen wake lock while the app is in the foreground; persistent storage requested; a readable error screen if the local database cannot open.
- Stepper: "-" on an empty field no longer jumps to the maximum; a previous examination value is shown greyed and is not recorded until tapped.
- Settings: honest note that the protocol switch applies to every case on the device in this version (per-case protocol arrives in M1).
- Backup files are accepted from Parthograph v1 and from this application; the FHIR export filename no longer contains the patient's name.
- Tests moved to `node:test` (`npm test`): calendar, protocol, alerts (pass and fail paths), FHIR, stepper logic, and a guard that every source file is in the offline shell.

## 1.3.0 - 12 June 2026 (imported)

The last Parthograph release: https://github.com/DrTemesgen/parthograph (commit ed42d42).
