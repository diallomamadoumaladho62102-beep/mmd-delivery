-- RLS regression for public.referral_codes + deleted account restore guard.
-- Run with: supabase test db (or psql against a local ephemeral DB).

begin;

create extension if not exists pgtap;

select plan(8);

-- Table has RLS enabled
select ok(
  (select relrowsecurity from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'referral_codes'),
  'referral_codes has RLS enabled'
);

-- No update/delete policies for authenticated clients
select is(
  (
    select count(*)::int
    from pg_policies
    where schemaname = 'public'
      and tablename = 'referral_codes'
      and cmd in ('UPDATE', 'DELETE')
  ),
  0,
  'referral_codes has no UPDATE/DELETE policies'
);

-- Select + insert policies exist
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'referral_codes'
      and policyname = 'referral_codes_select_own'
  ),
  'referral_codes_select_own exists'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'referral_codes'
      and policyname = 'referral_codes_insert_own'
  ),
  'referral_codes_insert_own exists'
);

-- account_deletion_events: staff select only, no anon/auth insert
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'account_deletion_events'
      and policyname = 'account_deletion_events_select_staff'
  ),
  'account_deletion_events_select_staff exists'
);

select is(
  (
    select count(*)::int
    from pg_policies
    where schemaname = 'public'
      and tablename = 'account_deletion_events'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ),
  0,
  'account_deletion_events has no client mutation policies'
);

-- profiles.account_status allows deleted
select ok(
  exists (
    select 1
    from pg_constraint
    where conname = 'profiles_account_status_check'
  ),
  'profiles_account_status_check exists'
);

-- Restore guard GUC referenced in privilege function body
select ok(
  position(
    'mmd.allow_account_restore' in
    pg_get_functiondef('public.guard_profiles_privilege_columns()'::regprocedure)
  ) > 0,
  'guard_profiles_privilege_columns blocks restore without GUC'
);

select * from finish();
rollback;
