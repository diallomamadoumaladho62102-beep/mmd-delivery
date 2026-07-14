# Mobile maps device smoke — operator checklist

Use this after an `android-smoke` EAS APK install. Mark each row PASS / FAIL / NOT_TESTABLE and paste to the agent with logs.

## Device

| Field | Value |
|---|---|
| Device / emulator | |
| Android version | |
| App version / versionCode | |
| EAS build ID | |
| Commit | |

## Scenarios

| # | Scenario | Result | Notes |
|---|---|---|---|
| 1 | App opens without crash | | |
| 2 | Login works | | |
| 3 | GPS permission grant flow | | |
| 4 | GPS permission deny → settings → retry (no infinite loader) | | |
| 5 | Taxi Home opens | | |
| 6 | Use GPS pickup + reverse geocode | | |
| 7 | Autocomplete pickup | | |
| 8 | Autocomplete destination | | |
| 9 | Add 1–2 intermediate stops | | |
| 10 | Get quote | | |
| 11 | Back / cancel before payment | | |
| 12 | Confirm no ride created before payment | | |
| 13 | Double-tap quote/pay does not duplicate create | | |
| 14 | Tracking without driver | | |
| 15 | Background → foreground tracking resumes | | |
| 16 | Package delivery map shows P/D (+ driver if any) | | |
| 17 | ETA / distance visible | | |
| 18 | Food ETA banner (no regression) | | |
| 19 | Driver taxi panel: expired offers hidden / countdown | | |
| 20 | No Mapbox / Location native crash in logcat | | |
