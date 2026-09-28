# Roadmap

## v1.0 (this release) — pilot-ready prototype
- [x] Dual-protocol engine (WHO LCG 2020 + Ethiopian modified partograph MOH 2021)
- [x] Guided wizard, auto-drawn SVG chart, due/overdue timers, multi-patient board
- [x] Tiered alert engine with acknowledgement & decision logging
- [x] Referral decision support + pre-referral bundle + printable/shareable note
- [x] Emergencies, delivery record, APGAR 1/5/10, AMTSL, PPH watch
- [x] Reports (HMIS-aligned indicators), CSV register, JSON backup/restore
- [x] FHIR R4 export, Ethiopian calendar, draft Amharic strings, PWA offline

## v1.1 — clinical hardening (needs Ethiopian clinical partners)
- [ ] Reconcile thresholds with the **2024 National Intrapartum Care Guideline** (obtain full text via MOH/ESOG)
- [ ] Verify against a clean copy of the 2021 Health Center Obstetrics Protocol (latent-phase chart, referral wording)
- [ ] Clinical panel review of every rule in `alerts.js` (sign-off recorded in repo)
- [ ] Amharic translation review; add Afaan Oromo, Tigrinya, Somali, Afar
- [ ] In-app micro-training / job-aid cards (refresher training is the strongest known driver of partograph use, OR 5.7); link to Maternity Foundation's Safe Delivery App where appropriate
- [ ] Postpartum 2-hour watch timers (q15min mother + baby checks)

## v1.2 — connectivity (optional, offline remains first-class)
- [ ] Lightweight sync server (CouchDB/PouchDB-style or plain REST) with device pairing
- [ ] Facility/woreda **supervisor dashboard**: completion quality, alert response times, outcomes — built for the catchment-based mentorship system (supervision OR 3.2–4.5)
- [ ] DHIS2 aggregate push (monthly dataValueSets) to kill duplicate HMIS reporting
- [ ] SMS/Telegram referral pre-notification where a network exists; referral feedback capture on return

## v2 — ecosystem integration
- [ ] OpenMRS/Bahmni FHIR integration pilot (Ethiopia's EMR direction)
- [ ] Master Facility Registry IDs, NHDD concept alignment, ICD-11 coding of outcomes
- [ ] Evaluate migration to / coexistence with **OpenSRP2 (fhircore)** for national-scale deployment
- [ ] Contribute the data dictionary + alert logic toward a WHO SMART Guidelines intrapartum DAK (none exists as of mid-2026)
- [ ] Formal usability + outcome evaluation at pilot health centres (registered with MOH digital health governance; consider pairing with the PartoMa Ethiopia research group at Haramaya)

## Engineering debt / known limitations
- Amharic strings are draft; alert/advice text is English-only by design (matches training) but should be revisited with midwife input
- No authentication/user accounts (shared facility tablet model); add provider PIN + per-entry author if required by governance
- Single-device data (until v1.2 sync); mitigated by backup/restore and CSV export
- PWA icons are SVG-only (fine for Chrome/Android; add PNG fallbacks for older WebViews)
- The 10-minute APGAR prompt is manual (offered when 5-min score < 7) — could become a timed notification
