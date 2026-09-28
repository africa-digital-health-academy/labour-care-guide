# Changelog

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
