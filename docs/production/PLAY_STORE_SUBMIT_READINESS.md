# Play Store submit readiness (EAS-managed credentials)

## Enterprise configuration (current)

Android submit uses the **Google Service Account Key stored on Expo EAS servers**.

No local `google-play-service-account.json` is required for:

```bash
eas submit --platform android --profile production
```

### `eas.json` (production submit)

```json
"android": {
  "applicationId": "com.maladho2025.mmddelivery",
  "track": "internal",
  "releaseStatus": "draft"
}
```

- **Do not set** `serviceAccountKeyPath` — that forces a local JSON path and breaks automated submit.
- `applicationId` pins credentials to the production package (not legacy ids).
- `track: internal` + `releaseStatus: draft` keeps first uploads safe until Play Console listing is complete.

### Where the key lives

Expo dashboard → Project **mmd-delivery** → **Credentials** → **Android** → `com.maladho2025.mmddelivery` → **Google Service Account Key** (Submissions).

Verified on EAS:

| Field | Value |
|-------|--------|
| Package | `com.maladho2025.mmddelivery` |
| Service account | `expo-eas-submit@mmd-delivery.iam.gserviceaccount.com` |
| GCP project | `mmd-delivery` |

### One-time Google Cloud / Play Console requirements (ops)

1. Google Cloud project with **Google Play Android Developer API** enabled.
2. Service account invited in Play Console → Users and permissions (Admin / Release to testing tracks as needed).
3. App created in Play Console for `com.maladho2025.mmddelivery`.
4. Key uploaded once to EAS (already done). Rotate via dashboard if compromised — never commit JSON to git.

### Submit command

```bash
eas submit --platform android --profile production --latest
# CI / non-interactive:
eas submit --platform android --profile production --latest --non-interactive
```

### Legacy local path mode (not recommended)

Only if you temporarily set `serviceAccountKeyPath` in `eas.json`, place a gitignored JSON at repo root. Prefer EAS-managed credentials instead.
