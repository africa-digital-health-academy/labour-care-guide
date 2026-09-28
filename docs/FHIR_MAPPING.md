# FHIR R4 mapping

`js/fhir.js` exports one **Bundle (type: collection)** per labour case. There is no published WHO SMART Guidelines DAK or HL7 IG for intrapartum care as of June 2026, so this mapping follows the closest authoritative precedents: WHO **smart-anc** patterns, HL7 **vital-signs profiles**, and codes verified against NLM Clinical Tables (LOINC) and Ontoserver (SNOMED CT).

## Resources

| App data | FHIR resource |
|---|---|
| Mother | `Patient` (gender female, MRN identifier `urn:ethiopia:mrn`) |
| Labour admission | `Encounter` (class IMP, type SCT 236973005 *Delivery procedure*) |
| Each observation | `Observation` (effectiveDateTime = obs time, linked to Encounter) |
| Medication / oxytocin / IV fluids | `MedicationAdministration` |
| Clinical alerts (warn/danger) | `Flag` (active/inactive) |
| Newborn | `Patient` (linked via `Patient.link`), birth weight + APGAR Observations |
| Referral | `ServiceRequest` (intent order, priority urgent, SCT 3457005 *Patient referral*; pre-referral bundle in `note`) |

## Observation codes

| Parameter | System | Code | Notes |
|---|---|---|---|
| Fetal heart rate | LOINC | **55283-6** | valueQuantity /min |
| Cervical dilatation | SNOMED | **50629008** | **No active LOINC code exists** (11881-0 is fundal height — a common mis-citation). valueQuantity cm |
| Fetal descent (fifths palpable) | SNOMED | **278067008** *Proportion of fetal head above pelvic brim* | matches the WHO measure exactly |
| Uterine contractions | SNOMED | **70514001** | components: frequency /10 min + duration s (**251680002** intensity-related) |
| Moulding | SNOMED | **79114003** | valueString +/++/+++ |
| Caput | SNOMED | **82729001** | valueString |
| Blood pressure | LOINC | **85354-9** panel; **8480-6** systolic, **8462-4** diastolic | components, mm[Hg] |
| Maternal pulse | LOINC | **8867-4** | /min |
| Temperature | LOINC | **8310-5** | Cel |
| Birth weight | LOINC | **8339-4** | g |
| APGAR 1 / 5 / 10 min | LOINC | **9272-6 / 9274-2 / 9271-8** | valueQuantity {score} |
| Oxytocin | SNOMED | **112115002** (substance) | as MedicationAdministration; RxNorm 7824 / ATC H01BB02 are equivalent codes |

## Integration path (Ethiopia)

1. **Now:** per-case JSON download (`application/fhir+json`) — attachable to referrals, importable by any FHIR R4 server (e.g. `POST` per resource after assigning ids, or convert to a transaction bundle).
2. **Next:** push to a facility HAPI-FHIR/OpenMRS/Bahmni endpoint when one exists (Ethiopia's HIE direction is FHIR per the Digital Health Blueprint; SmartCare→DHIS2 exchange already uses HAPI FHIR).
3. **Reporting:** the Reports view computes the monthly HMIS delivery-care indicators; DHIS2 aggregate push (dataValueSets API) is on the roadmap — patient-level FHIR is *not* the right vehicle for HMIS.
4. **Standards:** if/when WHO publishes an intrapartum DAK (L2/L3), reconcile codes and add PlanDefinition/CQL versions of the alert logic following the smart-anc architecture.
