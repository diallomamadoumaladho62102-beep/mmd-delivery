-- Minimum-pay engine (config-driven). No regulatory rates, dates, or
-- period lengths are seeded. Admin must configure before recording/calculating.
-- Does not alter order_commissions, Stripe columns, or existing payout RPCs.

begin;

-- ---------------------------------------------------------------------------
-- Operational timestamps (NOT restaurant accepted_at)
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists driver_accepted_at timestamptz;

comment on column public.orders.driver_accepted_at is
  'When the driver accepted the offer/assignment. Never use restaurant accepted_at.';

alter table public.delivery_requests
  add column if not exists driver_accepted_at timestamptz;

comment on column public.delivery_requests.driver_accepted_at is
  'When the driver accepted the offer/assignment. Never use restaurant accepted_at.';

alter table public.marketplace_delivery_jobs
  add column if not exists driver_accepted_at timestamptz;

comment on column public.marketplace_delivery_jobs.driver_accepted_at is
  'When the driver accepted the marketplace delivery assignment.';

-- ---------------------------------------------------------------------------
-- Engine settings (singleton, all business values admin-owned)
-- ---------------------------------------------------------------------------
create table if not exists public.minimum_pay_engine_settings (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'off'
    check (mode in ('off', 'shadow', 'active')),
  engine_start_at timestamptz,
  timezone text,
  period_length_days integer
    check (period_length_days is null or period_length_days > 0),
  period_start_weekday integer
    check (period_start_weekday is null or (period_start_weekday >= 0 and period_start_weekday <= 6)),
  -- 0=Sunday … 6=Saturday in settings.timezone. First period still starts at engine_start_at.
  default_jurisdiction text,
  default_currency text,
  default_method text,
  default_rounding text,
  eligible_county_codes text[] not null default '{}'::text[],
  eligible_source_types text[] not null default '{}'::text[],
  excluded_source_types text[] not null default '{}'::text[],
  wait_fee_counts boolean not null default false,
  bonus_counts boolean not null default false,
  transfers_enabled boolean not null default false,
  on_call_stale_after_seconds integer
    check (on_call_stale_after_seconds is null or on_call_stale_after_seconds > 0),
  require_change_reason boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.minimum_pay_engine_settings (singleton, mode, transfers_enabled)
values (true, 'off', false)
on conflict (singleton) do nothing;

-- ---------------------------------------------------------------------------
-- Versioned pay rules (no seed rates)
-- ---------------------------------------------------------------------------
create table if not exists public.pay_rule_versions (
  id uuid primary key default gen_random_uuid(),
  jurisdiction text not null,
  rule_name text not null,
  rule_version text not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  mpr_cents_per_hour bigint not null check (mpr_cents_per_hour > 0),
  method text not null,
  rounding text not null,
  eligible_source_types text[] not null default '{}'::text[],
  excluded_source_types text[] not null default '{}'::text[],
  wait_fee_counts boolean,
  bonus_counts boolean,
  notes text,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  source_url text,
  source_label text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint pay_rule_versions_version_uq unique (jurisdiction, rule_version),
  constraint pay_rule_versions_range_chk
    check (effective_to is null or effective_to > effective_from)
);

create index if not exists pay_rule_versions_jurisdiction_from_idx
  on public.pay_rule_versions (jurisdiction, effective_from desc);

-- ---------------------------------------------------------------------------
-- Pay periods (created at runtime from settings, never backfilled before start)
-- ---------------------------------------------------------------------------
create table if not exists public.pay_periods (
  id uuid primary key default gen_random_uuid(),
  jurisdiction text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,
  method text not null,
  rule_version_id uuid not null references public.pay_rule_versions (id) on delete restrict,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'open', 'closed', 'reconciled')),
  created_at timestamptz not null default now(),
  constraint pay_periods_range_chk check (ends_at > starts_at),
  constraint pay_periods_window_uq unique (jurisdiction, starts_at)
);

create index if not exists pay_periods_status_idx
  on public.pay_periods (jurisdiction, status, ends_at);

-- ---------------------------------------------------------------------------
-- Trip time
-- ---------------------------------------------------------------------------
create table if not exists public.trip_time_intervals (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references auth.users (id) on delete restrict,
  entity_type text not null
    check (entity_type in ('order', 'delivery_request', 'marketplace_job')),
  entity_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  end_reason text
    check (end_reason is null or end_reason in (
      'completed', 'cancelled', 'admin_cancelled', 'inferred'
    )),
  start_source text not null default 'offer_accept',
  pickup_in_scope boolean not null default false,
  dropoff_in_scope boolean not null default false,
  eligible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_time_intervals_entity_uq unique (entity_type, entity_id),
  constraint trip_time_intervals_range_chk
    check (ended_at is null or ended_at >= started_at)
);

create index if not exists trip_time_intervals_driver_started_idx
  on public.trip_time_intervals (driver_id, started_at);

-- ---------------------------------------------------------------------------
-- On-call sessions
-- ---------------------------------------------------------------------------
create table if not exists public.on_call_sessions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references auth.users (id) on delete restrict,
  started_at timestamptz not null,
  ended_at timestamptz,
  timezone text,
  jurisdiction text,
  offer_eligible boolean not null default false,
  start_reason text not null default 'go_online',
  end_reason text,
  last_lat double precision,
  last_lng double precision,
  created_at timestamptz not null default now(),
  constraint on_call_sessions_range_chk
    check (ended_at is null or ended_at >= started_at)
);

create unique index if not exists on_call_sessions_one_open_idx
  on public.on_call_sessions (driver_id)
  where ended_at is null;

create index if not exists on_call_sessions_driver_started_idx
  on public.on_call_sessions (driver_id, started_at);

-- ---------------------------------------------------------------------------
-- Earnings classification
-- ---------------------------------------------------------------------------
create table if not exists public.earnings_lines (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references auth.users (id) on delete restrict,
  pay_period_id uuid references public.pay_periods (id) on delete set null,
  source_type text not null,
  source_id text not null,
  amount_cents bigint not null,
  currency text not null,
  counts_toward_mpr boolean not null default false,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint earnings_lines_source_uq unique (source_type, source_id)
);

create index if not exists earnings_lines_driver_occurred_idx
  on public.earnings_lines (driver_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Adjustments + audits
-- ---------------------------------------------------------------------------
create table if not exists public.minimum_pay_calculation_audits (
  id uuid primary key default gen_random_uuid(),
  pay_period_id uuid references public.pay_periods (id) on delete set null,
  driver_id uuid,
  mode text not null,
  inputs jsonb not null default '{}'::jsonb,
  outputs jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  actor text not null default 'cron'
);

create table if not exists public.minimum_pay_adjustments (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references auth.users (id) on delete restrict,
  pay_period_id uuid not null references public.pay_periods (id) on delete restrict,
  rule_version_id uuid not null references public.pay_rule_versions (id) on delete restrict,
  kind text not null
    check (kind in ('individual', 'fleet_allocation')),
  required_cents bigint not null default 0,
  eligible_cents bigint not null default 0,
  adjustment_cents bigint not null default 0,
  status text not null default 'computed'
    check (status in (
      'computed', 'shadowed', 'transfer_pending', 'transferred', 'void'
    )),
  stripe_transfer_id text,
  idempotency_key text not null,
  calculation_audit_id uuid references public.minimum_pay_calculation_audits (id)
    on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint minimum_pay_adjustments_unique
    unique (driver_id, pay_period_id, rule_version_id, kind),
  constraint minimum_pay_adjustments_idem_uq unique (idempotency_key)
);

create index if not exists minimum_pay_adjustments_period_idx
  on public.minimum_pay_adjustments (pay_period_id, status);

-- ---------------------------------------------------------------------------
-- Recording gate (no history before engine_start_at)
-- ---------------------------------------------------------------------------
create or replace function public.minimum_pay_engine_is_recording()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    exists (
      select 1
      from public.minimum_pay_engine_settings s
      where s.singleton = true
        and s.mode in ('shadow', 'active')
        and s.engine_start_at is not null
        and now() >= s.engine_start_at
    );
$$;

-- ---------------------------------------------------------------------------
-- Stamp driver_accepted_at (operational; always, never uses restaurant accepted_at)
-- ---------------------------------------------------------------------------
create or replace function public.minimum_pay_stamp_order_driver_accepted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- First assignment: always server clock. Ignore any client-supplied timestamp.
  if new.driver_id is not null
     and (tg_op = 'INSERT'
          or old.driver_id is null
          or old.driver_id is distinct from new.driver_id) then
    new.driver_accepted_at := now();
    return new;
  end if;
  -- Once stamped, a later client UPDATE cannot rewrite the clock.
  if tg_op = 'UPDATE'
     and old.driver_accepted_at is not null
     and new.driver_accepted_at is distinct from old.driver_accepted_at then
    new.driver_accepted_at := old.driver_accepted_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_minimum_pay_stamp_order_driver_accepted on public.orders;
create trigger trg_minimum_pay_stamp_order_driver_accepted
  before insert or update of driver_id, driver_accepted_at on public.orders
  for each row
  execute function public.minimum_pay_stamp_order_driver_accepted();

create or replace function public.minimum_pay_stamp_dr_driver_accepted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.driver_id is not null
     and (tg_op = 'INSERT'
          or old.driver_id is null
          or old.driver_id is distinct from new.driver_id) then
    new.driver_accepted_at := now();
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.driver_accepted_at is not null
     and new.driver_accepted_at is distinct from old.driver_accepted_at then
    new.driver_accepted_at := old.driver_accepted_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_minimum_pay_stamp_dr_driver_accepted on public.delivery_requests;
create trigger trg_minimum_pay_stamp_dr_driver_accepted
  before insert or update of driver_id, driver_accepted_at on public.delivery_requests
  for each row
  execute function public.minimum_pay_stamp_dr_driver_accepted();

create or replace function public.minimum_pay_stamp_mkt_driver_accepted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.assigned_driver_id is not null
     and (tg_op = 'INSERT'
          or old.assigned_driver_id is null
          or old.assigned_driver_id is distinct from new.assigned_driver_id) then
    new.driver_accepted_at := now();
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.driver_accepted_at is not null
     and new.driver_accepted_at is distinct from old.driver_accepted_at then
    new.driver_accepted_at := old.driver_accepted_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_minimum_pay_stamp_mkt_driver_accepted on public.marketplace_delivery_jobs;
create trigger trg_minimum_pay_stamp_mkt_driver_accepted
  before insert or update of assigned_driver_id, driver_accepted_at
  on public.marketplace_delivery_jobs
  for each row
  execute function public.minimum_pay_stamp_mkt_driver_accepted();

-- ---------------------------------------------------------------------------
-- Trip intervals (only after engine_start_at + shadow/active)
-- ---------------------------------------------------------------------------
create or replace function public.minimum_pay_sync_trip_interval(
  p_entity_type text,
  p_entity_id uuid,
  p_driver_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_end_reason text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_driver_id is null or p_started_at is null then
    return;
  end if;
  if not public.minimum_pay_engine_is_recording() then
    return;
  end if;
  if exists (
    select 1
    from public.minimum_pay_engine_settings s
    where s.singleton = true
      and s.engine_start_at is not null
      and p_started_at < s.engine_start_at
  ) then
    return;
  end if;

  insert into public.trip_time_intervals (
    driver_id, entity_type, entity_id, started_at, ended_at, end_reason, start_source
  )
  values (
    p_driver_id, p_entity_type, p_entity_id, p_started_at, p_ended_at, p_end_reason, 'offer_accept'
  )
  on conflict (entity_type, entity_id) do update
  set
    ended_at = coalesce(public.trip_time_intervals.ended_at, excluded.ended_at),
    end_reason = coalesce(public.trip_time_intervals.end_reason, excluded.end_reason),
    updated_at = now();
  -- started_at is never rewritten after the first insert.
end;
$$;

create or replace function public.minimum_pay_sync_order_trip()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_end timestamptz;
  v_reason text;
begin
  if new.driver_accepted_at is null or new.driver_id is null then
    return new;
  end if;
  -- Consume existing order timestamps (server-written). Delivered wins over cancelled.
  if new.delivered_at is not null or new.delivered_confirmed_at is not null then
    v_end := coalesce(new.delivered_at, new.delivered_confirmed_at);
    v_reason := 'completed';
  elsif new.cancelled_at is not null or lower(coalesce(new.status, '')) in ('canceled', 'cancelled') then
    v_end := coalesce(new.cancelled_at, now());
    v_reason := 'cancelled';
  end if;
  perform public.minimum_pay_sync_trip_interval(
    'order', new.id, new.driver_id, new.driver_accepted_at, v_end, v_reason
  );
  return new;
end;
$$;

drop trigger if exists trg_minimum_pay_sync_order_trip on public.orders;
create trigger trg_minimum_pay_sync_order_trip
  after insert or update of driver_id, driver_accepted_at, delivered_at,
    delivered_confirmed_at, cancelled_at, status
  on public.orders
  for each row
  execute function public.minimum_pay_sync_order_trip();

create or replace function public.minimum_pay_sync_dr_trip()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_end timestamptz;
  v_reason text;
begin
  if new.driver_accepted_at is null or new.driver_id is null then
    return new;
  end if;
  if new.delivered_at is not null then
    v_end := new.delivered_at;
    v_reason := 'completed';
  elsif new.cancelled_at is not null or lower(coalesce(new.status, '')) in ('canceled', 'cancelled') then
    v_end := coalesce(new.cancelled_at, now());
    v_reason := 'cancelled';
  end if;
  perform public.minimum_pay_sync_trip_interval(
    'delivery_request', new.id, new.driver_id, new.driver_accepted_at, v_end, v_reason
  );
  return new;
end;
$$;

drop trigger if exists trg_minimum_pay_sync_dr_trip on public.delivery_requests;
create trigger trg_minimum_pay_sync_dr_trip
  after insert or update of driver_id, driver_accepted_at, delivered_at, cancelled_at, status
  on public.delivery_requests
  for each row
  execute function public.minimum_pay_sync_dr_trip();

create or replace function public.minimum_pay_sync_mkt_trip()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_end timestamptz;
  v_reason text;
begin
  if new.driver_accepted_at is null or new.assigned_driver_id is null then
    return new;
  end if;
  if lower(coalesce(new.status, '')) = 'delivered' then
    v_end := coalesce(new.updated_at, now());
    v_reason := 'completed';
  elsif lower(coalesce(new.status, '')) = 'cancelled' then
    v_end := coalesce(new.updated_at, now());
    v_reason := 'cancelled';
  end if;
  perform public.minimum_pay_sync_trip_interval(
    'marketplace_job', new.id, new.assigned_driver_id, new.driver_accepted_at, v_end, v_reason
  );
  return new;
end;
$$;

drop trigger if exists trg_minimum_pay_sync_mkt_trip on public.marketplace_delivery_jobs;
create trigger trg_minimum_pay_sync_mkt_trip
  after insert or update of assigned_driver_id, driver_accepted_at, status, updated_at
  on public.marketplace_delivery_jobs
  for each row
  execute function public.minimum_pay_sync_mkt_trip();

-- ---------------------------------------------------------------------------
-- On-call from is_online (no historical invent)
-- ---------------------------------------------------------------------------
create or replace function public.minimum_pay_sync_on_call()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tz text;
begin
  if not public.minimum_pay_engine_is_recording() then
    return new;
  end if;

  select timezone into v_tz
  from public.minimum_pay_engine_settings
  where singleton = true;

  if new.is_online is true and coalesce(old.is_online, false) is not true then
    update public.on_call_sessions
    set ended_at = now(), end_reason = 'recompute_split'
    where driver_id = new.user_id and ended_at is null;

    insert into public.on_call_sessions (
      driver_id, started_at, timezone, start_reason, offer_eligible
    )
    values (new.user_id, now(), v_tz, 'go_online', true);
  elsif new.is_online is not true and coalesce(old.is_online, false) is true then
    update public.on_call_sessions
    set ended_at = now(), end_reason = 'go_offline'
    where driver_id = new.user_id and ended_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_minimum_pay_sync_on_call on public.driver_profiles;
create trigger trg_minimum_pay_sync_on_call
  after update of is_online on public.driver_profiles
  for each row
  execute function public.minimum_pay_sync_on_call();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.minimum_pay_engine_settings enable row level security;
alter table public.pay_rule_versions enable row level security;
alter table public.pay_periods enable row level security;
alter table public.trip_time_intervals enable row level security;
alter table public.on_call_sessions enable row level security;
alter table public.earnings_lines enable row level security;
alter table public.minimum_pay_adjustments enable row level security;
alter table public.minimum_pay_calculation_audits enable row level security;

drop policy if exists minimum_pay_settings_staff_read on public.minimum_pay_engine_settings;
create policy minimum_pay_settings_staff_read
  on public.minimum_pay_engine_settings for select
  using (public.is_staff_user(auth.uid()));

drop policy if exists pay_rule_versions_staff_read on public.pay_rule_versions;
create policy pay_rule_versions_staff_read
  on public.pay_rule_versions for select
  using (public.is_staff_user(auth.uid()));

drop policy if exists pay_periods_staff_read on public.pay_periods;
create policy pay_periods_staff_read
  on public.pay_periods for select
  using (public.is_staff_user(auth.uid()));

drop policy if exists trip_time_intervals_read on public.trip_time_intervals;
create policy trip_time_intervals_read
  on public.trip_time_intervals for select
  using (driver_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists on_call_sessions_read on public.on_call_sessions;
create policy on_call_sessions_read
  on public.on_call_sessions for select
  using (driver_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists earnings_lines_read on public.earnings_lines;
create policy earnings_lines_read
  on public.earnings_lines for select
  using (driver_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists minimum_pay_adjustments_read on public.minimum_pay_adjustments;
create policy minimum_pay_adjustments_read
  on public.minimum_pay_adjustments for select
  using (driver_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists minimum_pay_audits_staff_read on public.minimum_pay_calculation_audits;
create policy minimum_pay_audits_staff_read
  on public.minimum_pay_calculation_audits for select
  using (public.is_staff_user(auth.uid()));

grant select on public.minimum_pay_engine_settings to authenticated;
grant select on public.pay_rule_versions to authenticated;
grant select on public.pay_periods to authenticated;
grant select on public.trip_time_intervals to authenticated;
grant select on public.on_call_sessions to authenticated;
grant select on public.earnings_lines to authenticated;
grant select on public.minimum_pay_adjustments to authenticated;
grant select on public.minimum_pay_calculation_audits to authenticated;

-- Triggers run as definer. Drivers must not call these RPCs with their own timestamps.
revoke all on function public.minimum_pay_engine_is_recording() from public, anon, authenticated;
revoke all on function public.minimum_pay_sync_trip_interval(text, uuid, uuid, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function public.minimum_pay_stamp_order_driver_accepted() from public, anon, authenticated;
revoke all on function public.minimum_pay_stamp_dr_driver_accepted() from public, anon, authenticated;
revoke all on function public.minimum_pay_stamp_mkt_driver_accepted() from public, anon, authenticated;
revoke all on function public.minimum_pay_sync_order_trip() from public, anon, authenticated;
revoke all on function public.minimum_pay_sync_dr_trip() from public, anon, authenticated;
revoke all on function public.minimum_pay_sync_mkt_trip() from public, anon, authenticated;
revoke all on function public.minimum_pay_sync_on_call() from public, anon, authenticated;

commit;
