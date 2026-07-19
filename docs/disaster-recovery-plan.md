# Disaster recovery plan

## Backups

- **Supabase:** daily automated backups (plan-dependent); Point-in-Time Recovery if enabled on project.
- **Retention:** follow Supabase project settings; document retention days in ops vault.
- **Configs:** Vercel/EAS env vars stored in provider dashboards + encrypted ops vault (never git).
- **Files:** identity docs / evidence in Supabase Storage; verify bucket versioning if enabled.

## Restore procedure (high level)

1. Freeze writes (feature flags / maintenance).
2. Restore Supabase to target PITR or backup.
3. Re-deploy last known good Vercel Preview/Production alias.
4. Replay webhooks cautiously (Stripe event log) with idempotency.
5. Run finance integrity view `v_finance_ledger_integrity` and pending source events.
6. Communicate status to Support / Finance.

## Scenarios

| Scenario | Action |
|----------|--------|
| Broken deploy | Rollback Vercel deployment; keep DB; disable risky flags |
| Stripe webhook down | Fix signature/secret; backfill from Stripe events API (Test/Live matching env) |
| DB unavailable | Supabase status; restore PITR; pause crons |
| Partial migration | Stop deploys; repair forward migration; never destructive reset on Production |
| Pricing bug | Compensating finance/marketing entries; no silent balance edits |
| Provider loss | Disable provider flag; route to fallback if configured |
| Security incident | Rotate keys; revoke sessions; audit finance/admin actions |

## Rollback notes

- **Vercel:** instant previous deployment.
- **Migrations:** prefer forward-fix; document compensatory SQL if irreversible.
- **Mobile:** previous EAS update / store build; no Production store submit in Phase 10.
- **Webhooks/crons:** disable via Vercel cron pause or auth secret rotate.
