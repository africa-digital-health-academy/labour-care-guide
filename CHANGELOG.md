# Changelog

## 2.0.0-dev (unreleased) - milestone M5, 1 October 2026

FHIR export to the plan, every screen in draft Amharic, the M4 review
follow-ups, and the documentation for v2.

- FHIR export (plan 6.6): every resource has a fresh UUID and every reference
  resolves inside the bundle; the midwife's initials become the performer;
  voided entries and medicines are exported as entered-in-error with the
  reason; every Observation has a category. Now exported as well: amniotic
  fluid, decelerations, supportive care and posture, the pushing mark, blood
  loss, the postpartum checks, the birth (mode, outcome, stillbirth timing)
  and the Robson group. The encounter stays in progress through labour, the
  24-hour postpartum watch and a referral not yet departed, and is finished
  after the closure, her departure or the end of the watch; the newborn's
  birth date is the East Africa Time date, and every newborn finding is
  exported on the newborn, also when the birth record was voided, without
  the mother's encounter. The baby is no longer linked to the mother as the
  same person, which invited a record merge; the mother is recorded as the
  baby's related person. Contraction duration carried the code for
  intensity; corrected. Codes were checked on public terminology servers with
  code-only queries and a synthetic bundle (no case data); eight items are
  listed for terminology or integration review in docs/FHIR_MAPPING.md.
- Amharic: every screen goes through the translation layer and 880 of the
  881 keys have an Amharic draft, not yet reviewed; the oxytocin scope
  instruction stays English. Alert titles and advice, drug doses and the
  chart stay in English until the clinical panel validates a translation,
  and every stored or shared record (referral note, reasons, checklist,
  acknowledgement notes) stays in English. The Amharic Cancel button no
  longer uses the word for "delete" next to a void. A "draft" marker in the
  top bar and a note in Settings say so. Ethiopian dates in Amharic use the
  Amharic era abbreviation. A completeness test fails on any missing key or
  on an Amharic draft whose placeholders differ from the English.
- Placeholders are filled in one pass: a "$&" typed in a reason or a name is
  no longer rewritten.
- An alert asked again after an acknowledgement, or a new episode of an alert
  acknowledged before, shows its repeat or episode number and the last
  acknowledgement. The dialog has no default action any more: it starts on
  the earlier action only when every alert in it is a repeat that shared that
  action; otherwise the midwife must tap one. Later episodes and closed
  alerts are labelled, and a void that opens alerts opens the dialog.
  Acknowledgement notes no longer count as shared decisions in the audit.
- Every entry is judged as the case stood at its own time, when it is
  recorded and again whenever a back-timed exam, a void or a correction moves
  a stage start: a contraction finding that now falls in the latent phase
  closes its alert ("restaged"), and one that now falls in active labour
  raises its alert. An exam added, voided or corrected re-judges the exams
  after it, so a forgotten earlier exam raises the progress alert it implies.
  A void or a correction runs the time rules in the same save, and its
  confirmation lists every alert that will open or close, a time limit
  labelled as such. A labour entry corrected after the birth or her departure
  never opens a labour alert on a woman no longer in labour.
- The companion indicator shows the first and the second stage apart; the
  second counts women with a documented second stage and reports how many
  who wanted a companion were left out.
- The referral note and its shared text write risk factors, transport, what
  was given and the medication in words, not codes, with the oxytocin rate,
  and leave out a voided medicine. The MgSO4 loading dose has one source in
  the engine, shared by the severe-BP alert, the eclampsia card and the
  pre-referral checklist, now with the 50% IM strength (panel to confirm).
- Chart and print write acknowledgement actions and risk factors in words;
  on the Ethiopian partograph a contraction bar is red only where an alert
  was raised (none in the latent phase).
- Settings are protected like the other forms: the 30-second heartbeat no
  longer drops unsaved settings, and the protocol description follows the
  choice before saving. The page language follows the screen language, and
  the Amharic draft marker sits beside the clock so the title keeps its room
  at phone width.
- The Ethiopian partograph moved out of the chart module into
  js/partograph.js (chart.js from 1,236 to 800 lines; output byte-identical on
  113 test fixtures).
- Contrast: the due chip and the amber button now meet WCAG AA.
- About: links to the WHO LCG implementation resource package (2025) and the
  Jhpiego / MOMENTUM LCG learning resource package.
- Documentation: DESIGN (render model, correction model, alert lifecycle,
  audit and indicators, release process), RESEARCH (implementation package,
  PPH guidelines 2025), ROADMAP (v2.1) and the README for the new name.
- Independent clinical review, two passes, and two browser walks. Pass 1
  found no critical issue and four to fix before facility use, all fixed:
  progress alerts that depend on earlier exams were not re-judged; a
  back-timed entry was judged against the current stage; one preselected
  action could be written to a mixed batch of alerts; a newborn check could
  be exported with the mother as subject. Pass 2 verified them and found one
  more, fixed: a correction after the birth could open a labour alert.
- Tests: 445, up from 345.

## 2.0.0-dev (unreleased) - milestone M4, 1 October 2026

The chart reads like the WHO Labour Care Guide sheet, prints, and the
reports show the WHO implementation indicators.

- Chart laid out as the WHO sheet (F13, F14): sections in the form's order
  with the ALERT column generated from the engine's thresholds; 12 columns of
  active first stage plus a 3-hour second-stage panel and a latent/admission
  panel with real time spans; X for dilatation and O for descent on its own
  row; P where pushing began (F2); WHO codes SP/MO, Y/N/D, urine grades and
  fluid M+ to M+++ (F12); assessment and plan row from the notes; nothing
  drawn after the birth or from voided entries; FHR beyond the scale labelled.
- Every alert value is circled in red; a circle turns dashed grey only when
  the alert was acknowledged after that value was recorded.
- A repeat abnormal value after an acknowledgement now asks for
  acknowledgement again, as the WHO form requires for every alert value (the
  PPH running total asks again only on new bleeding or a new sign).
- Continuation (F6): a new 12-hour sheet when the active first stage passes
  12 h, with sheet buttons on screen.
- Print: A4 landscape, one page per sheet with a header, plus an appendix with
  every note and medication in full; the rest of the app is hidden on paper.
- Reports (N1, N2): month picker with the Ethiopian dates, the six WHO
  indicators with a Robson table and the stillbirth split, the HMIS counts,
  and two CSV exports (indicators, birth register with protocol, Robson group,
  LCG score, voided entries and total blood loss) that open cleanly in Excel.
- A corrected birth can no longer be timed after a postpartum check already
  recorded; closing a case is rule-checked and tested.
- Independent clinical review, two passes, and a browser walk of chart, print,
  continuation, the Ethiopian partograph and reports.
- Tests: 344, up from 297.

## 2.0.0-dev (unreleased) - milestone M3, 30 September 2026

The screens now feed the M2 engine and keep what the midwife types.

- Safe rendering (S3): a background save (the 30-second heartbeat, another
  woman's alert) no longer rebuilds a page with a form in progress; only the
  case header, the alert strip and the chart refresh. Forms mark themselves in
  progress and saved.
- Honest admission (S4, F4): only what was examined or asked is recorded - no
  invented "clear fluid", "no decelerations" or "yes" to pain relief, fluid and
  mobility; a temperature without a BP is kept. New: labour onset
  (spontaneous or induced, required), rupture time "unknown" (the form's U),
  fluid colour when ruptured, companion present / wanted / declines. Tapping a
  question's label text no longer selects its first answer.
- Initials on every entry (F3): the wizard, acknowledgements, medication,
  notes, emergencies, voids, corrections, resolutions, referral, departure,
  admission and birth record all ask for the midwife's initials, kept for her
  session on a shared tablet.
- Void, correct and resolve (S5): entries can be voided or corrected with a
  reason and initials, shown struck through, never deleted; the confirmation
  says what the stage and the alerts will do; alerts can be resolved by hand;
  only demo cases can be deleted, real cases are closed.
- WHO codes in the wizard (F1, F9): supportive care Yes / No / Declined, fluid
  I, C, M+, M++, M+++, B, urine Negative, Trace, + to ++++; untouched defaults
  are stored as such for the audit.
- Second stage (F2): a "Pushing began" button starts the WHO clock.
- Birth record: caesarean section at hospital level, stillbirth timing,
  correct-a-birth-record, initials.
- Postpartum haemorrhage card (N3): running measured total against the 2025
  thresholds, drape readings, the trigger banner and the first-response bundle
  checklist with time and initials.
- Postpartum watch (N4): mother, baby and blood-loss checks in the wizard, due
  chips on the case and a "Postpartum watch" section on the ward board; no
  baby checks after a stillbirth.
- The ward board and the alert strip count only open alerts; closed alerts
  still awaiting acknowledgement are shown apart.
- Phone width: every screen fits 360 px without sideways scrolling.
- Independent clinical review, two passes. Pass 1 found no critical issue and
  three to fix before facility use, all fixed: the birth record saved
  untouched "placenta complete", "perineum intact" and "no resuscitation" as
  facts; admission recorded an unexamined cephalic presentation; postpartum
  checks timed before the recorded birth dropped out of the watch. Pass 2
  verified them and added a remedy note for a birth recorded late, and voided
  admission entries now clear the admission record.
- Tests: 297, up from 264.

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
- Independent clinical review, pass 1, found and this milestone fixed: new
  cases were saved without a schema version, so a reload could mark a
  referred woman as departed and stop her monitoring (cases are now created
  in the current schema and referrals start as "not yet left"); voiding a
  postpartum entry could close a PPH raised by the birth record; a closed PPH
  did not re-open on new abnormal signs; the ROM time did not follow a voided
  entry; labour-only findings stayed open after birth; a pushing mark just
  before the 10 cm exam was ignored; the audit skipped the last cell before
  birth.
- Review pass 2 verified those fixes and found one more, also fixed: a PPH
  closed because its readings were voided kept the voided total as its
  re-open bar, so a voided 6500 mL typo would have silenced a real bleed
  below 6500 mL.
- Tests: 264, up from 40.

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
