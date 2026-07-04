-- Driver identity verification: tables, RLS, storage, server-side gate enforcement.
begin;

-- ---------------------------------------------------------------------------
-- 1. Settings (singleton row id = 1)
-- ---------------------------------------------------------------------------
create table if not exists public.driver_identity_settings (
  id smallint primary key default 1 check (id = 1),
  random_check_enabled boolean not null default true,
  random_min_rides integer not null default 15 check (random_min_rides >= 1),
  random_max_rides integer not null default 45 check (random_max_rides >= random_min_rides),
  require_on_new_device boolean not null default true,
  require_after_inactivity_days integer not null default 30 check (require_after_inactivity_days >= 1),
  require_on_city_change boolean not null default true,
  require_on_country_change boolean not null default true,
  require_on_report boolean not null default true,
  require_on_first_online boolean not null default true,
  require_on_profile_photo_change boolean not null default true,
  require_on_phone_change boolean not null default true,
  require_after_suspension boolean not null default true,
  periodic_check_enabled boolean not null default false,
  periodic_check_days integer not null default 90 check (periodic_check_days >= 7),
  manual_review_enabled boolean not null default true,
  manual_review_risk_threshold numeric(5,2) not null default 65.00,
  verification_validity_days integer not null default 180 check (verification_validity_days >= 1),
  retention_days integer not null default 365 check (retention_days >= 30),
  default_provider text not null default 'internal',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.driver_identity_settings (id)
values (1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Per-driver gate state (server-maintained)
-- ---------------------------------------------------------------------------
create table if not exists public.driver_identity_state (
  driver_id uuid primary key references auth.users(id) on delete cascade,
  gate_status text not null default 'not_required'
    check (gate_status in (
      'not_required', 'required', 'pending', 'submitted', 'verified',
      'rejected', 'manual_review', 'expired', 'canceled'
    )),
  active_check_id uuid,
  last_verified_at timestamptz,
  last_device_id_hash text,
  last_city text,
  last_country text,
  rides_since_verification integer not null default 0,
  last_online_at timestamptz,
  next_random_ride_threshold integer,
  pending_post_suspension_check boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_driver_identity_state_gate
  on public.driver_identity_state (gate_status);

-- ---------------------------------------------------------------------------
-- 3. Checks
-- ---------------------------------------------------------------------------
create table if not exists public.driver_identity_checks (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'required'
    check (status in (
      'required', 'pending', 'submitted', 'verified', 'rejected',
      'manual_review', 'expired', 'canceled'
    )),
  trigger_type text not null
    check (trigger_type in (
      'first_online', 'new_device', 'city_change', 'country_change',
      'inactivity', 'random', 'client_report', 'suspicious_behavior',
      'phone_change', 'profile_photo_change', 'post_suspension',
      'periodic', 'admin_manual'
    )),
  reason text,
  selfie_path text,
  device_id_hash text,
  city text,
  country text,
  ip_hash text,
  confidence_score numeric(5,2),
  risk_score numeric(5,2) not null default 0,
  requires_manual_review boolean not null default false,
  provider text not null default 'internal',
  provider_reference text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  verified_at timestamptz,
  rejected_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_notes text
);

create index if not exists idx_driver_identity_checks_driver
  on public.driver_identity_checks (driver_id, created_at desc);
create index if not exists idx_driver_identity_checks_status
  on public.driver_identity_checks (status, created_at desc);

alter table public.driver_identity_state
  drop constraint if exists driver_identity_state_active_check_fkey;
alter table public.driver_identity_state
  add constraint driver_identity_state_active_check_fkey
  foreign key (active_check_id) references public.driver_identity_checks(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. Events (audit trail)
-- ---------------------------------------------------------------------------
create table if not exists public.driver_identity_events (
  id uuid primary key default gen_random_uuid(),
  check_id uuid references public.driver_identity_checks(id) on delete set null,
  driver_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_driver_identity_events_driver
  on public.driver_identity_events (driver_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. Known devices
-- ---------------------------------------------------------------------------
create table if not exists public.driver_identity_devices (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references auth.users(id) on delete cascade,
  device_id_hash text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_city text,
  last_country text,
  unique (driver_id, device_id_hash)
);

create index if not exists idx_driver_identity_devices_driver
  on public.driver_identity_devices (driver_id, last_seen_at desc);

-- ---------------------------------------------------------------------------
-- 6. Client reports
-- ---------------------------------------------------------------------------
create table if not exists public.driver_identity_reports (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references auth.users(id) on delete cascade,
  reporter_user_id uuid references auth.users(id) on delete set null,
  order_id uuid,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

create index if not exists idx_driver_identity_reports_driver
  on public.driver_identity_reports (driver_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 7. Storage bucket (private selfies)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'driver-identity-selfies',
  'driver-identity-selfies',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------------
alter table public.driver_identity_settings enable row level security;
alter table public.driver_identity_state enable row level security;
alter table public.driver_identity_checks enable row level security;
alter table public.driver_identity_events enable row level security;
alter table public.driver_identity_devices enable row level security;
alter table public.driver_identity_reports enable row level security;

-- Settings: staff read; super admin update via service role only on API
drop policy if exists driver_identity_settings_staff_select on public.driver_identity_settings;
create policy driver_identity_settings_staff_select on public.driver_identity_settings
  for select to authenticated
  using (public.is_staff_user(auth.uid()));

-- State: driver read own; staff read all
drop policy if exists driver_identity_state_select_own on public.driver_identity_state;
create policy driver_identity_state_select_own on public.driver_identity_state
  for select to authenticated
  using (driver_id = auth.uid() or public.is_staff_user(auth.uid()));

-- Checks: driver read own; staff read all; no direct insert/update from client
drop policy if exists driver_identity_checks_select on public.driver_identity_checks;
create policy driver_identity_checks_select on public.driver_identity_checks
  for select to authenticated
  using (driver_id = auth.uid() or public.is_staff_user(auth.uid()));

-- Events: driver read own events; staff read all
drop policy if exists driver_identity_events_select on public.driver_identity_events;
create policy driver_identity_events_select on public.driver_identity_events
  for select to authenticated
  using (driver_id = auth.uid() or public.is_staff_user(auth.uid()));

-- Devices: driver read own
drop policy if exists driver_identity_devices_select_own on public.driver_identity_devices;
create policy driver_identity_devices_select_own on public.driver_identity_devices
  for select to authenticated
  using (driver_id = auth.uid() or public.is_staff_user(auth.uid()));

-- Reports: reporter insert own; staff read
drop policy if exists driver_identity_reports_insert on public.driver_identity_reports;
create policy driver_identity_reports_insert on public.driver_identity_reports
  for insert to authenticated
  with check (reporter_user_id = auth.uid());

drop policy if exists driver_identity_reports_select on public.driver_identity_reports;
create policy driver_identity_reports_select on public.driver_identity_reports
  for select to authenticated
  using (reporter_user_id = auth.uid() or public.is_staff_user(auth.uid()));

-- Storage: driver upload/read own folder; staff read with staff role
drop policy if exists driver_identity_selfies_select_own on storage.objects;
create policy driver_identity_selfies_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'driver-identity-selfies'
    and (storage.foldername(name))[1] = 'drivers'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists driver_identity_selfies_select_staff on storage.objects;
create policy driver_identity_selfies_select_staff on storage.objects
  for select to authenticated
  using (
    bucket_id = 'driver-identity-selfies'
    and public.is_staff_user(auth.uid())
  );

drop policy if exists driver_identity_selfies_insert_own on storage.objects;
create policy driver_identity_selfies_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'driver-identity-selfies'
    and (storage.foldername(name))[1] = 'drivers'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists driver_identity_selfies_update_own on storage.objects;
create policy driver_identity_selfies_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'driver-identity-selfies'
    and (storage.foldername(name))[1] = 'drivers'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 9. Block going online when identity gate requires verification
-- ---------------------------------------------------------------------------
create or replace function public.enforce_driver_identity_online_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gate text;
begin
  if new.is_online is distinct from true then
    return new;
  end if;

  if old.is_online is true and new.is_online is true then
    return new;
  end if;

  select gate_status into v_gate
  from public.driver_identity_state
  where driver_id = new.user_id;

  if v_gate is null then
    return new;
  end if;

  if v_gate in ('required', 'pending', 'submitted', 'manual_review', 'rejected', 'expired') then
    raise exception 'driver_identity_verification_required'
      using errcode = 'P0001',
        hint = v_gate;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_driver_profiles_identity_online_gate on public.driver_profiles;
create trigger trg_driver_profiles_identity_online_gate
  before update of is_online on public.driver_profiles
  for each row
  execute function public.enforce_driver_identity_online_gate();

-- ---------------------------------------------------------------------------
-- 10. Helper: append identity event (service role / security definer)
-- ---------------------------------------------------------------------------
create or replace function public.driver_identity_log_event(
  p_driver_id uuid,
  p_check_id uuid,
  p_event_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.driver_identity_events (check_id, driver_id, event_type, metadata)
  values (p_check_id, p_driver_id, p_event_type, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

revoke all on function public.driver_identity_log_event(uuid, uuid, text, jsonb) from public;
grant execute on function public.driver_identity_log_event(uuid, uuid, text, jsonb) to service_role;

-- Flag identity re-check when a suspended driver is re-approved
create or replace function public.driver_identity_on_profile_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'suspended' and new.status = 'approved' then
    insert into public.driver_identity_state (driver_id, gate_status, pending_post_suspension_check, updated_at)
    values (new.user_id, 'required', true, now())
    on conflict (driver_id) do update set
      pending_post_suspension_check = true,
      updated_at = now();
  end if;

  if new.status = 'suspended' then
    insert into public.driver_identity_state (driver_id, updated_at)
    values (new.user_id, now())
    on conflict (driver_id) do update set updated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_driver_profiles_identity_status on public.driver_profiles;
create trigger trg_driver_profiles_identity_status
  after update of status on public.driver_profiles
  for each row
  execute function public.driver_identity_on_profile_status_change();

-- Retention helper (invoke via scheduled job / edge function)
create or replace function public.purge_expired_driver_identity_selfies()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_retention_days integer;
  v_cutoff timestamptz;
  v_count integer := 0;
begin
  select retention_days into v_retention_days
  from public.driver_identity_settings
  where id = 1;

  v_cutoff := now() - make_interval(days => coalesce(v_retention_days, 365));

  update public.driver_identity_checks
  set selfie_path = null
  where selfie_path is not null
    and coalesce(rejected_at, verified_at, submitted_at, created_at) < v_cutoff;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.purge_expired_driver_identity_selfies() from public;
grant execute on function public.purge_expired_driver_identity_selfies() to service_role;

commit;
