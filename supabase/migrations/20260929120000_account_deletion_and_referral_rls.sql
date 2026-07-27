-- Account deletion lifecycle + referral_codes RLS hardening.
-- Soft-delete keeps UUIDs for payment/tax/dispute retention; PII is anonymized.

begin;

-- ---------------------------------------------------------------------------
-- 1) profiles: deleted status + timestamps
-- ---------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_account_status_check;

alter table public.profiles
  add constraint profiles_account_status_check
  check (account_status in ('active', 'suspended', 'disabled', 'deleted'));

alter table public.profiles
  add column if not exists deleted_at timestamptz,
  add column if not exists deletion_requested_at timestamptz;

create index if not exists profiles_deleted_at_idx
  on public.profiles (deleted_at desc nulls last)
  where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- 2) Immutable deletion audit trail (service_role inserts only)
-- ---------------------------------------------------------------------------
create table if not exists public.account_deletion_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role text,
  requested_at timestamptz not null default now(),
  executed_at timestamptz not null default now(),
  requested_by uuid not null,
  ip_address text,
  user_agent text,
  retention_note text not null default
    'PII anonymized; financial/tax/dispute records retained by legal obligation',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists account_deletion_events_user_idx
  on public.account_deletion_events (user_id, executed_at desc);

alter table public.account_deletion_events enable row level security;

drop policy if exists account_deletion_events_select_staff
  on public.account_deletion_events;
create policy account_deletion_events_select_staff
  on public.account_deletion_events
  for select
  to authenticated
  using (public.is_staff_user());

-- No insert/update/delete policies for authenticated — service_role only.

-- ---------------------------------------------------------------------------
-- 3) referral_codes: align schema + enable RLS
-- ---------------------------------------------------------------------------
-- Environments diverged: some DBs have owner_user_id, others user_id.
-- Ensure BOTH exist, then keep them in sync.
alter table public.referral_codes
  add column if not exists user_id uuid references auth.users (id) on delete set null;

alter table public.referral_codes
  add column if not exists owner_user_id uuid references auth.users (id) on delete set null;

update public.referral_codes
set user_id = owner_user_id
where user_id is null and owner_user_id is not null;

update public.referral_codes
set owner_user_id = user_id
where owner_user_id is null and user_id is not null;

create or replace function public.sync_referral_codes_owner_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is null and new.owner_user_id is not null then
    new.user_id := new.owner_user_id;
  elsif new.owner_user_id is null and new.user_id is not null then
    new.owner_user_id := new.user_id;
  elsif new.user_id is distinct from new.owner_user_id then
    -- Prefer explicit user_id from client; keep both in sync.
    if tg_op = 'INSERT' then
      new.owner_user_id := coalesce(new.owner_user_id, new.user_id);
      new.user_id := coalesce(new.user_id, new.owner_user_id);
    else
      if new.user_id is distinct from old.user_id then
        new.owner_user_id := new.user_id;
      elsif new.owner_user_id is distinct from old.owner_user_id then
        new.user_id := new.owner_user_id;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_referral_codes_owner_user on public.referral_codes;
create trigger trg_sync_referral_codes_owner_user
before insert or update on public.referral_codes
for each row execute function public.sync_referral_codes_owner_user();

alter table public.referral_codes enable row level security;

drop policy if exists referral_codes_select_own on public.referral_codes;
create policy referral_codes_select_own
  on public.referral_codes
  for select
  to authenticated
  using (
    auth.uid() is not null
    and (
      owner_user_id = auth.uid()
      or user_id = auth.uid()
      or public.is_staff_user()
    )
  );

drop policy if exists referral_codes_insert_own on public.referral_codes;
create policy referral_codes_insert_own
  on public.referral_codes
  for insert
  to authenticated
  with check (
    auth.uid() is not null
    and coalesce(owner_user_id, user_id) = auth.uid()
    and coalesce(user_id, owner_user_id) = auth.uid()
  );

-- Owners may not update code / ownership after create (anti-fraud).
-- Staff may read only via select policy. Mutations go through service_role.
drop policy if exists referral_codes_update_own on public.referral_codes;
drop policy if exists referral_codes_delete_own on public.referral_codes;

-- Deny anonymous entirely (no policies for anon).

comment on table public.referral_codes is
  'Driver/client referral codes. RLS: own select/insert only; no client update/delete.';

-- ---------------------------------------------------------------------------
-- 4) Prevent unauthorized restoration of deleted accounts
-- ---------------------------------------------------------------------------
create or replace function public.guard_profiles_privilege_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(auth.role(), '')
  );
  v_is_service boolean := coalesce(v_jwt_role, '') = 'service_role';
  v_allow_restore text := coalesce(
    nullif(current_setting('mmd.allow_account_restore', true), ''),
    ''
  );
begin
  if tg_op = 'INSERT' then
    if not v_is_service then
      new.is_founder := false;
      if new.account_status is distinct from 'active' then
        new.account_status := 'active';
      end if;
      if new.role is null
         or lower(trim(coalesce(new.role::text, ''))) not in (
           'client', 'driver', 'restaurant'
         )
      then
        new.role := 'client';
      end if;
    end if;

    if new.is_founder is true then
      new.role := 'admin';
      new.account_status := 'active';
      new.is_founder := true;
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.is_founder is true then
      new.is_founder := true;
      new.role := 'admin';
      new.account_status := 'active';
      return new;
    end if;

    -- Deleted accounts stay deleted unless an explicit restore GUC is set
    -- (service_role ops only). Blocks accidental / unauthorized reactivation.
    if old.account_status = 'deleted'
       and new.account_status is distinct from 'deleted'
       and v_allow_restore <> '1'
    then
      raise exception 'deleted accounts cannot be restored without mmd.allow_account_restore';
    end if;

    if not v_is_service then
      new.role := old.role;
      new.is_founder := old.is_founder;
      if new.account_status is distinct from old.account_status then
        new.account_status := old.account_status;
      end if;
    end if;

    if new.is_founder is true and not v_is_service then
      new.is_founder := old.is_founder;
      new.role := old.role;
    end if;

    return new;
  end if;

  return new;
end;
$$;

comment on function public.guard_profiles_privilege_columns() is
  'Freeze profiles privilege columns for JWTs; block deleted-account restore unless mmd.allow_account_restore=1.';

commit;
