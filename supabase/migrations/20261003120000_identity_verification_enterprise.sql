-- Enterprise Identity Verification (Stripe Identity + provider-agnostic)
-- Never store identity document images. Store Stripe IDs + status + metadata only.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Policies: which subject types / features require verification
-- ---------------------------------------------------------------------------
create table if not exists public.identity_verification_policies (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null
    check (subject_type in ('driver', 'restaurant', 'seller', 'business', 'client', 'admin')),
  feature_key text not null default 'default',
  enabled boolean not null default true,
  required boolean not null default false,
  provider text not null default 'stripe_identity',
  verification_type text not null default 'document'
    check (verification_type in ('document', 'id_number')),
  require_matching_selfie boolean not null default true,
  require_live_capture boolean not null default true,
  require_id_number boolean not null default false,
  max_attempts integer not null default 5 check (max_attempts > 0),
  validity_days integer null,
  block_online boolean not null default false,
  block_payouts boolean not null default false,
  block_publish boolean not null default false,
  block_activation boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_type, feature_key)
);

create table if not exists public.identity_verifications (
  id uuid primary key default gen_random_uuid(),
  subject_user_id uuid not null references auth.users(id) on delete cascade,
  subject_type text not null
    check (subject_type in ('driver', 'restaurant', 'seller', 'business', 'client', 'admin')),
  feature_key text not null default 'default',
  provider text not null default 'stripe_identity',
  verification_status text not null default 'not_started'
    check (
      verification_status in (
        'not_started',
        'pending',
        'processing',
        'verified',
        'requires_input',
        'requires_review',
        'failed',
        'canceled',
        'expired',
        'redacted'
      )
    ),
  active_session_id text null,
  verification_id text null,
  verification_started_at timestamptz null,
  verification_completed_at timestamptz null,
  verification_failed_reason text null,
  verified_at timestamptz null,
  requires_review boolean not null default false,
  review_reason text null,
  verification_attempts integer not null default 0 check (verification_attempts >= 0),
  stripe_connect_account_id text null,
  stripe_related_person_id text null,
  last_error_code text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_user_id, subject_type, feature_key)
);

create index if not exists identity_verifications_status_idx
  on public.identity_verifications (verification_status, subject_type);

create index if not exists identity_verifications_user_idx
  on public.identity_verifications (subject_user_id);

create index if not exists identity_verifications_session_idx
  on public.identity_verifications (active_session_id)
  where active_session_id is not null;

create table if not exists public.identity_verification_attempts (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references public.identity_verifications(id) on delete cascade,
  subject_user_id uuid not null references auth.users(id) on delete cascade,
  subject_type text not null,
  provider text not null default 'stripe_identity',
  verification_session_id text not null,
  provider_verification_report_id text null,
  status text not null,
  failed_reason text null,
  error_code text null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, verification_session_id)
);

create index if not exists identity_verification_attempts_user_idx
  on public.identity_verification_attempts (subject_user_id, created_at desc);

create table if not exists public.identity_verification_events (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid null references public.identity_verifications(id) on delete set null,
  attempt_id uuid null references public.identity_verification_attempts(id) on delete set null,
  subject_user_id uuid null references auth.users(id) on delete set null,
  event_source text not null default 'system',
  event_type text not null,
  provider text null,
  provider_event_id text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists identity_verification_events_created_idx
  on public.identity_verification_events (created_at desc);

create unique index if not exists identity_verification_events_provider_event_uidx
  on public.identity_verification_events (provider, provider_event_id)
  where provider_event_id is not null;

create or replace function public.set_identity_verification_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_identity_verifications_updated_at on public.identity_verifications;
create trigger trg_identity_verifications_updated_at
before update on public.identity_verifications
for each row execute function public.set_identity_verification_updated_at();

drop trigger if exists trg_identity_verification_policies_updated_at on public.identity_verification_policies;
create trigger trg_identity_verification_policies_updated_at
before update on public.identity_verification_policies
for each row execute function public.set_identity_verification_updated_at();

-- Default policies
insert into public.identity_verification_policies as p (
  subject_type, feature_key, enabled, required, provider,
  require_matching_selfie, require_live_capture,
  block_online, block_payouts, block_publish, block_activation
) values
  -- required=false until Stripe Identity is enabled in Dashboard; Founder flips to true.
  ('driver', 'default', true, false, 'stripe_identity', true, true, true, false, false, false),
  ('restaurant', 'default', true, false, 'stripe_identity', true, true, false, false, false, true),
  ('seller', 'default', true, false, 'stripe_identity', true, true, false, false, true, true),
  ('business', 'default', true, false, 'stripe_identity', true, true, false, false, false, true),
  ('client', 'default', true, false, 'stripe_identity', true, true, false, false, false, false),
  ('client', 'wallet_high_risk', true, false, 'stripe_identity', true, true, false, false, false, false),
  ('admin', 'default', true, false, 'stripe_identity', true, true, false, false, false, false)
on conflict (subject_type, feature_key) do update set
  updated_at = now();

alter table public.identity_verification_policies enable row level security;
alter table public.identity_verifications enable row level security;
alter table public.identity_verification_attempts enable row level security;
alter table public.identity_verification_events enable row level security;

-- Subjects can read their own verification state / attempts
drop policy if exists identity_verifications_select_own on public.identity_verifications;
create policy identity_verifications_select_own
  on public.identity_verifications
  for select
  to authenticated
  using (subject_user_id = auth.uid());

drop policy if exists identity_verification_attempts_select_own on public.identity_verification_attempts;
create policy identity_verification_attempts_select_own
  on public.identity_verification_attempts
  for select
  to authenticated
  using (subject_user_id = auth.uid());

drop policy if exists identity_verification_policies_select_authenticated on public.identity_verification_policies;
create policy identity_verification_policies_select_authenticated
  on public.identity_verification_policies
  for select
  to authenticated
  using (true);

-- No direct client writes — service role / security definer APIs only
drop policy if exists identity_verifications_no_client_write on public.identity_verifications;
create policy identity_verifications_no_client_write
  on public.identity_verifications
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists identity_verification_attempts_no_client_write on public.identity_verification_attempts;
create policy identity_verification_attempts_no_client_write
  on public.identity_verification_attempts
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists identity_verification_events_no_client_write on public.identity_verification_events;
create policy identity_verification_events_no_client_write
  on public.identity_verification_events
  for all
  to authenticated
  using (false)
  with check (false);

drop policy if exists identity_verification_policies_no_client_write on public.identity_verification_policies;
create policy identity_verification_policies_no_client_write
  on public.identity_verification_policies
  for all
  to authenticated
  using (false)
  with check (false);

-- Helper used by API / SQL gates
create or replace function public.is_identity_verified(
  p_user_id uuid,
  p_subject_type text,
  p_feature_key text default 'default'
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_policy public.identity_verification_policies%rowtype;
  v_row public.identity_verifications%rowtype;
begin
  select * into v_policy
  from public.identity_verification_policies
  where subject_type = p_subject_type
    and feature_key = p_feature_key
  limit 1;

  if not found or v_policy.enabled is not true or v_policy.required is not true then
    return true;
  end if;

  select * into v_row
  from public.identity_verifications
  where subject_user_id = p_user_id
    and subject_type = p_subject_type
    and feature_key = p_feature_key
  limit 1;

  if not found then
    return false;
  end if;

  if v_row.verification_status <> 'verified' then
    return false;
  end if;

  if v_policy.validity_days is not null
     and v_row.verified_at is not null
     and v_row.verified_at < (now() - make_interval(days => v_policy.validity_days)) then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function public.is_identity_verified(uuid, text, text) from public;
grant execute on function public.is_identity_verified(uuid, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
