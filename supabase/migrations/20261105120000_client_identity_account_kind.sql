-- Client identity + account classification (safe, reversible, no deletes).
-- Adds account_kind, phone verification columns, and non-destructive backfill.

alter table public.profiles
  add column if not exists account_kind text not null default 'real';

alter table public.profiles
  add column if not exists phone_verified_at timestamptz null;

alter table public.profiles
  add column if not exists phone_e164 text null;

alter table public.profiles
  drop constraint if exists profiles_account_kind_check;

alter table public.profiles
  add constraint profiles_account_kind_check
  check (account_kind in ('real', 'demo', 'test', 'certification'));

comment on column public.profiles.account_kind is
  'Account classification: real|demo|test|certification. Defaults to real; no automatic deletes.';

comment on column public.profiles.phone_verified_at is
  'Set when Twilio Verify (or equivalent) confirms the phone for this profile.';

comment on column public.profiles.phone_e164 is
  'Normalized E.164 phone used for uniqueness among verified active clients.';

-- Unique verified phone among active clients only (partial index).
drop index if exists profiles_client_phone_e164_verified_uidx;
create unique index profiles_client_phone_e164_verified_uidx
  on public.profiles (phone_e164)
  where phone_e164 is not null
    and phone_verified_at is not null
    and role = 'client'
    and account_status = 'active';

create index if not exists profiles_account_kind_idx
  on public.profiles (account_kind);

create index if not exists profiles_role_kind_status_idx
  on public.profiles (role, account_kind, account_status);

-- Non-destructive backfill heuristics for test/cert accounts.
update public.profiles
set account_kind = 'certification'
where account_kind = 'real'
  and (
    lower(coalesce(email, '')) like '%+cert-%@%'
    or lower(coalesce(email, '')) like '%certification%'
    or lower(coalesce(email, '')) like 'e2e.enterprise-cert%@%'
    or lower(coalesce(full_name, '')) like 'cert %'
  );

update public.profiles
set account_kind = 'test'
where account_kind = 'real'
  and (
    lower(coalesce(email, '')) like '%@mmd.test'
    or lower(coalesce(email, '')) like 'e2e.%@%'
    or lower(coalesce(email, '')) like '%+test%@%'
    or lower(coalesce(email, '')) like 'test.%@%'
    or lower(coalesce(full_name, '')) like 'test %'
  );

update public.profiles
set account_kind = 'demo'
where account_kind = 'real'
  and (
    lower(coalesce(email, '')) like '%+demo%@%'
    or lower(coalesce(email, '')) like 'demo.%@%'
    or lower(coalesce(full_name, '')) like 'demo %'
  );
