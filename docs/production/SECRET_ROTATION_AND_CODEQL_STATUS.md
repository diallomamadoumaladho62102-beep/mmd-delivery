# Secret rotation and CodeQL status

Generated: 2026-07-14T06:05:54.985Z

## Supabase service_role rotation

- Project ref: `sjmszohmhudayxawfows` (production `mmd_delivery`)
- Method: cut over `SUPABASE_SERVICE_ROLE_KEY` from leaked legacy JWT `service_role` to Dashboard `sb_secret_*` (`default`) **without** rotating the JWT signing secret (anon remains valid; mobile not forced to rebuild for this step).
- Updated platforms: Vercel **Production** + **Development**. GitHub Actions: no `SUPABASE_SERVICE_ROLE_KEY` present. EAS: correctly absent (anon only).
- Preview: not updated (Vercel CLI requires interactive branch selection).
- Never placed in: `EXPO_PUBLIC_*`, mobile, `app.config.ts`, `eas.json`, Git.
- Redeploy: Vercel production deployment aliased to `https://www.mmddelivery.com`.
- Validations after cutover: PostgREST `profiles` 200; `/api/cron/infra-probe` 200 (`supabase_ok`, lock acquired); `/api/cron/expire-stale-payments?dry_run=1&batch_size=1` 200; `/api/cron/taxi-payouts` dry-run 200 (no Stripe transfers); `/api/cron/marketplace-payouts` 200 `INVENTORY_ONLY`.
- Legacy JWT `service_role`: still exists in Supabase API keys until disabled in Dashboard (CLI can list, not disable).
- GitHub Secret Scanning alert #2: **leave open** until JWT is disabled, then resolve as `revoked`.

## Mapbox historical pk

- Alert #1 currently resolved as `false_positive` (historical public `pk.*`, gone from HEAD).
- Still recommended: issue a new URL/bundle-restricted `pk` token, update Vercel + EAS `EXPO_PUBLIC_MAPBOX_TOKEN` / `NEXT_PUBLIC_MAPBOX_*`, revoke old token, then set alert resolution to `revoked`.
- Keep `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` build-only.

## CodeQL

- Open alerts: **70**
- By severity: `{"warning":55,"error":15}`
- Priority shortlist: **9**

| Alert | Severity | Rule | Location | Exploitable? | Fix | Test | Status |
|---|---|---|---|---|---|---|---|
| 71 | warning | `js/remote-property-injection` | `apps/web/app/auth/reset-password/page.tsx:23` | TBD | TBD | TBD | TRIAGE_PENDING |
| 70 | warning | `js/indirect-command-line-injection` | `scripts/capture-driver-navigation-scenarios.mjs:76` | TBD | TBD | TBD | TRIAGE_PENDING |
| 69 | warning | `js/indirect-command-line-injection` | `scripts/capture-driver-navigation-qa.mjs:113` | TBD | TBD | TBD | TRIAGE_PENDING |
| 68 | error | `js/log-injection` | `apps/web/app/api/mapbox/compute-distance/route.ts:255` | Low (info leak) | Sanitize catch / generic client error | manual | FIXED |
| 22 | error | `js/system-prompt-injection` | `apps/web/src/lib/ai/aiAgent.ts:99` | Medium (prompt abuse) | Coerce history roles to user\|assistant | tsc | FIXED |
| 21 | warning | `js/xss-through-dom` | `apps/web/app/signup/restaurant/menu/page.tsx:801` | TBD | TBD | TBD | TRIAGE_PENDING |
| 20 | warning | `js/xss-through-dom` | `apps/web/app/signup/restaurant/menu/page.tsx:681` | TBD | TBD | TBD | TRIAGE_PENDING |
| 19 | warning | `js/xss-through-dom` | `apps/web/app/signup/client/page.tsx:508` | TBD | TBD | TBD | TRIAGE_PENDING |
| 18 | warning | `js/xss-through-dom` | `apps/web/app/restaurant/profile/page.tsx:675` | TBD | TBD | TBD | TRIAGE_PENDING |

## Conclusion

`SUPABASE_ROTATED_MAPBOX_PENDING`
