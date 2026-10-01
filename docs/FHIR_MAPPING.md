# FHIR R4 mapping

`js/fhir.js` exports one **Bundle (type `collection`)** per labour case: `buildFHIRBundle(p, settings)` builds it, `downloadFHIR(p, settings)` saves it as `application/fhir+json`, `fhirFilename(p)` names the file.

There is no published WHO SMART Guidelines DAK or HL7 implementation guide for intrapartum care (as of 2026), so the mapping follows the closest precedents: the HL7 **vital-signs profiles** and the WHO **smart-anc** patterns. Codes were looked up on 1 Oct 2026: LOINC in NLM Clinical Tables, SNOMED CT in Ontoserver (International Edition, June/July 2026), and every code and display pair was then re-checked on tx.fhir.org. A sample bundle validates on the public HAPI R4 validator with no errors (warnings only: no narrative, local code systems, UCUM annotations).

## Bundle

| Item | Rule |
|---|---|
| Resource ids | A fresh random UUID per resource and per export (`crypto.randomUUID()`, with a `getRandomValues` fallback for plain-http pages). `fullUrl` = `urn:uuid:<id>`; all references use these, so they resolve inside the bundle. |
| Business identifiers | Stable across exports, so a receiver can recognise a record it already holds (conditional create): Encounter `urn:labour-care-guide:case` = the case id; every Observation, MedicationAdministration, Flag, Procedure, ServiceRequest and the newborn carry `urn:labour-care-guide:record` = `<case id>/<record key>`. |
| Bundle | `identifier` = `urn:uuid:<uuid>` (one per export), `timestamp`, `meta.tag` `urn:labour-care-guide#lcg-export`. |
| File name | `lcg-fhir-<case id>-<YYYY-MM-DD>.json` (ward date). Never the woman's name or MRN. The case id is a random uid. |
| Times | Entry times as recorded (UTC instants). Dates shown to people (the newborn's birth date) use the ward clock, East Africa Time (`APP_TZ_OFFSET`, UTC+3, no daylight saving). |

## Resources

| App data | FHIR resource |
|---|---|
| Mother | `Patient` (gender female, MRN identifier `urn:ethiopia:mrn`, name, phone, kebele). Whenever the newborn is exported, `Patient.link` (type `seealso`) points to the RelatedPerson below - the same woman in her role as mother. |
| Labour admission | `Encounter`: class IMP, type SCT 236973005 *Delivery procedure*, subject = the mother, admitting midwife as participant (v3 ParticipationType ADM). Status and end: see *Encounter status*. Only the mother's own resources reference it (`encounter`, or `context` on MedicationAdministration). |
| Each recorded value | `Observation` (one per value; see the code tables). `effectiveDateTime` = the entry time, `performer` = the initials, `category` always present. |
| Birth | `Procedure` coded by the mode of birth, performer = initials on the birth record; the birth outcome (subject: the newborn) and the blood loss at birth (subject: the mother) are Observations `partOf` it. |
| Newborn | `Patient` (identifier `<case id>/newborn`, gender, `birthDate` = East Africa Time date of birth, `_birthDate` extension `patient-birthTime` with the +03:00 time, `deceasedBoolean` true for a stillbirth). Exported with the birth record and whenever any newborn finding exists, also when the birth record is not on file (then no `birthDate`, gender `unknown`). Subject of every newborn finding: see *Mother or newborn*. |
| Mother of the newborn | `RelatedPerson` (`patient` = the newborn, relationship v3 RoleCode MTH *mother*). |
| Medicine, IV fluids, oxytocin | `MedicationAdministration` (performer = initials). Oxytocin: SCT 112115002; the LCG oxytocin row and each start/rate record carry `dosage.rateQuantity` in `{drop}/min` with the U/L in `dosage.text`; a stop record has status `stopped`. |
| Alerts (warn, danger) | `Flag`: status active/inactive, category `clinical`, code = alert code in `urn:labour-care-guide:alert` with the alert title as text, period = raised to resolved. Subject = the mother, or the newborn for a newborn alert (`nb_breathing`, `nb_cold`, `nb_hot`, `nb_feeding`, `apgar_low`). |
| Referral | `ServiceRequest`: SCT 3457005 *Patient referral*, intent order, priority urgent, requester = referring midwife and initials, performer = receiving facility, reasons, pre-referral care given and NOT done in notes. Status `active` until her departure is recorded, then `completed`. |

### Encounter status

She is an inpatient under care until she leaves or the case ends, so the stay is read from `js/protocol.js` (`isLabouring`, `inPostpartumWatch`) at the export time (`buildFHIRBundle(p, settings, { now })`).

| Case | Encounter.status | period.end |
|---|---|---|
| Latent, active or second stage | `in-progress` | - |
| Referred, departure not yet recorded (monitoring continues, S8) - in labour or after the birth | `in-progress` | - |
| Birth recorded, within the 24 h postpartum watch | `in-progress` | - |
| Referred and departed (handover recorded) | `finished`, `hospitalization.dischargeDisposition` = `other-hcf`, destination = receiving facility | the departure |
| Closed (`closedAt`) | `finished` | the closure |
| Birth recorded, 24 h watch over, case not closed | `finished` | the end of the watch (birth + 24 h) |
| Anything else (a `delivered` status with no birth record, a time of birth ahead of the export clock) | `unknown` | - |

`period.end` is set only when the status is `finished`, and it is the moment the stay became finished - the first of the departure, the closure and the end of the watch - so it does not move between exports: a case closed after its watch ran out keeps the end of the watch. A departure recorded before the time of birth does not end the stay (as in `inPostpartumWatch`). A legacy record closed without a closure time ends at the last care recorded.

### Mother or newborn: whose finding

- **Newborn findings name the newborn `Patient` as `subject`, never the mother**: birth weight, APGAR 1/5/10, the birth outcome (with the timing of a stillbirth), the postpartum baby checks (breathing, temperature, feeding) and the newborn alerts as Flags. This holds for voided (entered-in-error) entries too.
- **Birth record not on file** (voided into `deliveryHistory`, not yet recorded again): the baby checks and newborn alerts recorded before the correction still go to the newborn. The newborn `Patient` goes out with the same identifier `<case id>/newborn`, no `birthDate` and gender `unknown`, and each baby-check Observation carries the note "no birth record on file". The next export with the new birth record completes the same Patient.
- **Fetal findings in labour stay on the mother**: FHR, decelerations and amniotic fluid. Their codes name the fetus, and the fetus is not a Patient.
- **The stillbirth alert stays on the mother**: it asks for respectful supportive care of her and her family.
- **Newborn findings carry no `encounter`**: the only Encounter is the mother's labour stay, and a receiver that checks that a resource's subject matches its Encounter's subject would reject or mis-file them. No newborn Encounter is invented (an integration choice to review, below). The mother's own resources keep the Encounter.
- Essential newborn care and resuscitation are not exported yet; when they are, the same rules apply.

### Mother and newborn: why not Patient.link

FHIR R4 `Patient.link` joins two records of the **same person** (all four types - `replaced-by`, `replaces`, `refer`, `seealso` - say so). v1 linked the baby's Patient to the mother's with `seealso`, which tells a receiving master patient index that they are one person and invites a merge. v2 states the relationship instead: a `RelatedPerson` (the mother, relationship MTH) attached to the newborn, and the mother's `Patient.link` (`seealso`, a valid R4 target) to that RelatedPerson - both records of the same woman.

## Corrections and data quality

- **Voided entries are exported, not dropped**: `status: entered-in-error`, the value kept as entered, and a note `Entered in error (voided): <reason>` with the voiding initials (`authorString`) and time. Voided medication records likewise.
- **Form defaults**: a value the wizard committed without the midwife touching it (`entry.defaulted`) carries the note "Recorded as the form default, not changed by the recorder".
- **Robson group** is `preliminary` until the birth is recorded, then `final`; it is omitted when a variable is missing (`robsonGroup()` returns null).
- A birth record that was corrected stays in the case history (`deliveryHistory`) and is not exported; only the current birth record is. Baby checks recorded before the correction still go out, on the newborn (see *Mother or newborn*).

## Observation codes

Category is the HL7 `observation-category` code. **Review** marks a mapping a terminologist should confirm (list below).

| WHO LCG row / app value | Category | Code | Value |
|---|---|---|---|
| Baseline FHR | exam | LOINC **55283-6** Fetal heart rate | Quantity /min |
| FHR deceleration | exam | SCT **364364001** Characteristic of fetal heart deceleration (Review) | SCT finding (value table) |
| Amniotic fluid I, C, M+, M++, M+++, B | exam | SCT **168089007** Amniotic fluid appearance (Review) | SCT finding (value table) |
| Cervical dilatation | exam | SCT **50629008** Cervical dilatation (no active LOINC; 11881-0 is fundal height) | Quantity cm |
| Descent (fifths palpable) | exam | SCT **278067008** Proportion of fetal head above pelvic brim | Quantity `{fifths}` |
| Presentation | exam | SCT **271692001** Presentation of fetus | SCT finding |
| Fetal position | exam | SCT **364607000** Position of fetus | SCT finding |
| Caput | exam | SCT **82729001** Caput succedaneum | string none, +, ++, +++ |
| Moulding | exam | SCT **79114003** Fetal head molding | string none, +, ++, +++ |
| Contractions | exam | SCT **70514001** Uterine contraction (panel) | components below |
| - per 10 min | | SCT **364270005** Frequency of uterine contraction | Quantity `/(10.min)` |
| - duration | | SCT **364274001** Duration of uterine contraction | Range in s: the band the midwife chose (<20, 20-40, 40-60, >60 s), not the representative seconds the engine uses |
| Pushing began (P) | exam | SCT **258134007** Bearing down (Review) | boolean true at the time pushing began |
| Pulse | vital-signs | LOINC **8867-4** Heart rate | Quantity /min |
| Blood pressure | vital-signs | LOINC **85354-9** panel; **8480-6** systolic, **8462-4** diastolic | components mm[Hg]; a missing half has dataAbsentReason `unknown` |
| Temperature (mother, newborn) | vital-signs | LOINC **8310-5** Body temperature | Quantity Cel |
| Urine protein | laboratory | LOINC **20454-5** Protein [Presence] in Urine by Test strip | SCT ordinal |
| Urine acetone | laboratory | LOINC **2514-8** Ketones [Presence] in Urine by Test strip | SCT ordinal |
| Companion | survey | local `companion` (Review) | Y/N/D |
| Pain relief | survey | local `pain-relief` (Review) | Y/N/D |
| Oral fluid | survey | local `oral-fluid` (Review) | Y/N/D |
| Posture | survey | LOINC **8361-8** Body position with respect to gravity | SCT position; SP/MO in the text |
| Blood loss (drape readings, estimate at birth) | procedure | SCT **719051004** Quantity of postpartum maternal blood loss | Quantity mL (cumulative); `method` drape, weighed, estimate (local) |
| Postpartum: vaginal bleeding | exam | SCT **249212004** Quantity of lochia (Review) | normal, heavy |
| Postpartum: uterine tone | exam | SCT **364255009** Consistency of uterus | firm, soft |
| Postpartum: fundal height | exam | SCT **364253002** Fundal height of uterus | below, at, above the umbilicus |
| Postpartum: urine passed | exam | local `urine-passed` (Review) | Yes/No |
| Postpartum pulse, BP, temperature | vital-signs | as above | |
| Newborn breathing | exam | SCT **248565000** Respiratory effort | normal, difficult, none |
| Newborn feeding | exam | SCT **364652002** Infant feeding pattern | good (text only), poor |
| Birth weight | exam | LOINC **8339-4** Birth weight Measured | Quantity g |
| APGAR 1 / 5 / 10 min | survey | LOINC **9272-6 / 9274-2 / 9271-8** | Quantity `{score}`, at birth + 1, 5, 10 min |
| Birth outcome | procedure | SCT **364587008** Birth outcome | live, fresh or macerated stillbirth; stillbirths add a component, local `stillbirth-timing` (Review): antepartum, intrapartum, unknown |
| Robson group | survey | SCT **1303698009** Robson Ten Group Classification System category | local `robson-group` 1, 2a, 2b, 3, 4a, 4b, 5-10 (Review) |

Local code systems: `urn:labour-care-guide:observation` (companion, pain-relief, oral-fluid, urine-passed, stillbirth-timing), `:robson-group`, `:blood-loss-method`, `:alert`.

### Value codes (all SNOMED CT)

| Value | Code |
|---|---|
| Y / N / D (supportive care) | 373066001 Yes / 373067005 No / 443390004 Declined |
| Deceleration none / early / late / variable / prolonged | 1399254006 / 251674005 / 251675006 / 789258006 / 789259003 |
| Fluid I / C / M+ / M++ / M+++ / M (ungraded, v1) / B | 249125003 Intact membranes / 168090003 Amniotic fluid clear / 408792005, 408793000, 408794006 Meconium stained liquor grade I, II, III / 168092006 / 249134008 Bloodstained liquor |
| Presentation cephalic / breech / transverse | 1209182005 / 6096002 / 73161006 (other: text only) |
| Position OA / OT / OP | 90381008 / 249071008 Occipitolateral / 37235006 (unsure: text only) |
| Posture lateral / supine | 32185000 Lateral decubitus / 40199007 Supine (upright or mobile: text only) |
| Urine Negative / Trace / + to ++++ | 260385009 / 260405006 / 260347006, 260348001, 260349009, 260350009 |
| Bleeding normal / heavy | 289585005 Lochia normal / 289580000 Lochia heavy |
| Tone firm / soft | 289741005 Uterus contracted / 249201004 Uterus boggy |
| Fundus below / at / above umbilicus | 289628001 / 289627006 / 289629009 |
| Breathing normal / difficult / none | 1290338002 / 230145002 / 1023001 Apnea |
| Feeding poor | 276717003 Poor feeding of newborn |
| Outcome live / fresh / macerated stillbirth | 281050002 Livebirth / 237365001 / 237366000 |
| Stillbirth timing antepartum / intrapartum / unknown | 237361005 / 237362003 / 408796008 |

### Mode of birth (Procedure.code)

| delivery.mode | SNOMED CT |
|---|---|
| svd | 177184002 Normal delivery procedure |
| assisted (vacuum) | 61586001 Delivery by vacuum extraction |
| breech (vaginal) | 700000006 Vaginal delivery of fetus, text "Vaginal breech birth" (Review) |
| cs | 11466000 Cesarean section |
| other | 236973005 Delivery procedure |

## Needs terminology or integration review

1. **Local codes** with no standard code found: companion of choice, pain relief received, oral fluid taken, urine passed since birth, timing of fetal death, blood-loss method, Robson groups (SNOMED has the observable 1303698009 but no group values), alert codes.
2. **1399254006** *Fetal heart rate deceleration absent*: a SNOMED International concept from July 2026; terminology servers on older editions report it unknown (the text "None" travels with it).
3. **Amniotic fluid**: the observable 168089007 (appearance) also carries I = intact membranes; the SNOMED meconium grades I-III are taken as WHO M+ to M+++. Displays follow the June 2026 International Edition (168090003 "Amniotic fluid clear"; the Feb 2025 edition said "Amniotic fluid - clear").
4. **Deceleration** observable 364364001 (characteristic) for the LCG row; **pushing** as 258134007 *Bearing down* with a boolean (an "onset of pushing" observable may be preferred); **vaginal bleeding** as lochia quantity 249212004.
5. **Vaginal breech birth**: no active SNOMED procedure for breech delivery without saying spontaneous (177157003) or assisted (177158008); the app does not record which.
6. **Upright / mobile posture** and **feeding well** go as text only (inactive or no matching SNOMED concept).
7. The MRN identifier system `urn:ethiopia:mrn` is a placeholder until the facility or national MRN system URI is agreed.
8. **Newborn Encounter** (integration): newborn findings go out with no `encounter`, because the labour Encounter's subject is the mother. The alternative is a newborn Encounter (subject = the newborn, `partOf` the mother's labour Encounter) that the newborn findings reference; agree which one the receiving EMR expects.

## Corrected from v1

- Contraction duration was coded 251680002, which is *Uterine contraction intensity*; now 364274001 *Duration of uterine contraction*, and the frequency component has its own code 364270005 (v1 reused the panel code). The duration is the recorded band, not a made-up number of seconds.
- Displays aligned to the code systems (e.g. 278067008 has no "palpable"; 85354-9 is the full LOINC name).
- ids were `<case>-<n>` strings under `urn:uuid:` (invalid); now real UUIDs.
- The newborn birth date was the UTC date (a birth at 01:30 was dated the day before); now the East Africa Time date.
- Encounter was `finished` only for referrals; now by the stay as above (in-progress through labour, a pending referral and the 24 h postpartum watch).
- The baby was declared the same person as the mother (Patient.link); now RelatedPerson.
- Added: performer from initials, entered-in-error for voided entries, categories, amniotic fluid, decelerations, presentation and position, urine, supportive care, pushing, blood loss, postpartum mother and baby checks, birth outcome and mode (incl. caesarean), Robson group, oxytocin infusion rows, a moulding or caput of none (v1 skipped zero).

## Not exported yet

Assessment and plan notes; AMTSL checklist, placenta, perineum, essential newborn care and resuscitation details; onset of labour, rupture of membranes, gravida, para and gestational age as Observations (they feed the Robson group); alert acknowledgements; corrected birth records in the case history; admission values of v1 records that never had admission entries.

## Integration path (Ethiopia)

1. **Now:** per-case JSON download, attachable to a referral and importable by any FHIR R4 server - POST each resource, or convert to a transaction bundle using the `urn:labour-care-guide:record` identifiers for conditional creates (`ifNoneExist`) so a second export does not duplicate.
2. **Next:** push to a facility HAPI FHIR, OpenMRS or Bahmni endpoint when one exists (Ethiopia's HIE direction is FHIR per the Digital Health Blueprint; SmartCare to DHIS2 exchange already uses HAPI FHIR).
3. **Reporting:** the Reports view computes the monthly HMIS and WHO LCG indicators; DHIS2 aggregate push (dataValueSets API) is on the roadmap. Patient-level FHIR is not the vehicle for HMIS.
4. **Standards:** if WHO publishes an intrapartum DAK, reconcile the codes (above all the local ones) and add PlanDefinition/CQL versions of the alert logic following the smart-anc architecture.
