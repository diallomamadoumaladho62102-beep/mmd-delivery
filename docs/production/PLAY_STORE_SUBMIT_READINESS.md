# Play Store submit readiness

## eas.json configuration

```json
"submit": {
  "production": {
    "android": {
      "serviceAccountKeyPath": "./google-play-service-account.json",
      "track": "internal"
    }
  }
}
```

| Item | Status | Type |
|------|--------|------|
| Path `./google-play-service-account.json` | **PASS** (configured) | ops |
| Track `internal` | **PASS** (safe first upload) | ops |
| File in repo | **FAIL if committed** — must stay local | security |

## Secure upload checklist

1. Create JSON key in Google Play Console → API access → service account.
2. Save as `google-play-service-account.json` at **repo root** (same level as `eas.json`).
3. Confirm file is **gitignored** (never commit).
4. Grant service account **Release manager** (or minimum required) on Play Console.
5. Run submit only after B6 device smoke:

   ```powershell
   eas submit --platform android --profile production --latest
   ```

6. Set `PLAY_SERVICE_ACCOUNT_READY=true` in `store-submission.env` after file verified.

## Risks if absent

| Risk | Impact |
|------|--------|
| No service account file | `eas submit` fails immediately |
| Wrong SHA in assetlinks | Android App Links fail (browser instead of app) |
| Committing JSON key | **Critical** — rotate key in Google Cloud |

## iOS submit

| Item | Value |
|------|-------|
| `ascAppId` | `6761693075` (in eas.json) |
| Requirement | Apple Developer account + TestFlight build |

No service account file needed for iOS.
