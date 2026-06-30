# Supabase migrations

All production schema changes live in `supabase/migrations/` as timestamped SQL files.

## Apply to production

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

After apply, run `docs/production/sql/final_certification_checks.sql`.

## Naming rules

- Format: `YYYYMMDDHHMMSS_descriptive_name.sql`
- No nested folders or non-SQL files inside `migrations/`

## Verify inventory locally

```bash
node scripts/verify-migration-files.mjs
```

Critical trust-boundary migrations:

- `20260716120000_food_order_trust_boundary.sql`
- `20260717120000_production_hardening_p0_p1.sql`

See: `docs/production/ADMIN_MIGRATION_APPLY.md`, `docs/production/EXTERNAL_OPS_MANUAL.md`.
