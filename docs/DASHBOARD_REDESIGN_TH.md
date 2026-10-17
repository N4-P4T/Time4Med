# Time4Med — Dashboard redesign

> Test implementation only. Work is in a draft Pull Request; it has not been merged or checked against the physical cabinet.

## Navigation

- **แดชบอร์ด** (`#dashboard`): today overview, browser-local medication draft, due times, draft issues, Google Sheets ActivityLog summary. The dashboard contains *no remote lock actions*.
- **อุปกรณ์** (`#devices`): MQTT-connected device status and the preexisting remote lock controls.
- All other sidebar pages keep their own sections (`#medication`, `#inventory`, `#analytics`, `#activity`, `#camera`, `#gallery`).
- Navigation now explicitly hides all unrelated sections and respects direct `#` links.

## Truthfulness and data sources

- `medicines` comes from **this browser's localStorage**, not a confirmed ESP32 upload, cloud medical record or multi-device sync.
- "Next reminder" is the next time **in the local draft**, not a confirmed scheduled notification from firmware.
- "Passed time" is not classified as missed medication; only a clock comparison.
- "Confirmed events" counts successful `MEDICINE_CONFIRMED` entries in **the returned Google Sheets ActivityLog response, limited to 50 events**. It is not a pill counter or proof of ingestion.
- If the ActivityLog API fails, the dashboard displays **— / unavailable**, not false 0 events.
- The previous Analytics figures (100%, 86%, 92%) and prefabricated Timeline items were demo data; they have been replaced with explicit placeholders. Real adherence metrics require a validated denominator and patient-specific event mapping.

## Remaining requirements before production

1. Align `schedule-sync.js` and ESP32-S3 firmware protocol before claiming online schedule sync. See PR #4.
2. Rotate publicly embedded MQTT credentials and replace browser command authorization with a backend gateway.
3. Implement authenticated caregiver-to-patient access controls. The existing public static site/localStorage is *not* secure multi-user medical-record storage.
4. Derive confirmed/missed totals from device events and validated schedules in a server-managed database.
5. Test with staged devices, not a locked cabinet in use. Do not infer a physical lock state from the browser connection alone.

## Automated checks

The GitHub Actions `Check Time4Med Dashboard` workflow runs JavaScript syntax checks and smoke tests without installing ESP32 packages, using GitHub runners rather than the user's C: drive.
