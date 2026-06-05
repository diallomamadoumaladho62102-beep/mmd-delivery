# Admin Control Center — migrations production

## Ordre d'application (obligatoire)

1. `20260604150000` — dispatch hardening (si pas déjà appliquée)
2. `20260605120000_admin_rbac_control_center.sql` — RBAC staff, RLS lecture, audit, pricing history
3. `20260606120000_admin_control_center_completion.sql` — clients, communication logs, pricing régions/taxes

## Commande Supabase CLI

```bash
supabase db push
```

Ou via le dashboard SQL : exécuter chaque fichier **dans l'ordre** ci-dessus.

## Vérifications post-migration

```sql
-- Staff helpers
select public.is_staff_user('00000000-0000-0000-0000-000000000000');

-- Tables admin
select count(*) from public.pricing_config_history;
select count(*) from public.admin_communication_logs;

-- Colonnes client
select account_status from public.profiles limit 1;

-- Pricing régions
select config_key, region, tax_enabled, tax_pct from public.pricing_config order by config_key;
```

## Rollback

Ne pas supprimer les policies staff sans plan de repli. En cas d'urgence, désactiver l'accès staff via `profiles.role` (retirer les rôles ops/finance/support/review).

## Variables d'environnement (communication sortante)

| Variable | Usage |
|----------|--------|
| `PUSH_API_KEY` | Notifications push admin |
| `TWILIO_ACCOUNT_SID` | SMS sortant |
| `TWILIO_AUTH_TOKEN` | SMS sortant |
| `TWILIO_SMS_FROM` | Numéro expéditeur SMS |
| `RESEND_API_KEY` | Email sortant (optionnel) |
| `ADMIN_EMAIL_FROM` | Adresse expéditeur email |
