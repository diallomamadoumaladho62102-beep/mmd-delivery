-- Taxi Globalization Sprint 4 — Operations, Monitoring, Launch Control

begin;

-- ---------------------------------------------------------------------------
-- 1) Launch control columns on taxi_countries
-- ---------------------------------------------------------------------------

alter table public.taxi_countries
  add column if not exists launch_status text not null default 'disabled'
    check (launch_status in ('enabled', 'disabled', 'maintenance')),
  add column if not exists checkout_enabled boolean not null default false,
  add column if not exists payout_enabled boolean not null default false,
  add column if not exists shared_enabled boolean not null default true,
  add column if not exists business_enabled boolean not null default true,
  add column if not exists scheduled_enabled boolean not null default true,
  add column if not exists premium_enabled boolean not null default true;

-- GO conditionnel western markets
update public.taxi_countries
set
  launch_status = 'enabled',
  active = true,
  checkout_enabled = true,
  payout_enabled = true,
  shared_enabled = true,
  business_enabled = true,
  scheduled_enabled = true,
  premium_enabled = true,
  updated_at = now()
where country_code in ('US', 'CA', 'GB', 'FR', 'BE');

-- Rollout later markets
update public.taxi_countries
set
  launch_status = 'disabled',
  checkout_enabled = false,
  payout_enabled = false,
  shared_enabled = true,
  business_enabled = false,
  scheduled_enabled = false,
  premium_enabled = false,
  updated_at = now()
where country_code in ('GN', 'SN', 'CI', 'ML', 'SL', 'MR');

-- ---------------------------------------------------------------------------
-- 2) Monitoring snapshot tables
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_system_health (
  id uuid primary key default gen_random_uuid(),
  snapshot_at timestamptz not null default now(),
  rides_created_24h integer not null default 0,
  rides_paid_24h integer not null default 0,
  dispatch_success_24h integer not null default 0,
  dispatch_failed_24h integer not null default 0,
  payout_success_24h integer not null default 0,
  payout_failed_24h integer not null default 0,
  refund_success_24h integer not null default 0,
  refund_failed_24h integer not null default 0,
  avg_dispatch_time_seconds numeric(12, 2),
  avg_pickup_time_seconds numeric(12, 2),
  active_drivers integer not null default 0,
  available_drivers integer not null default 0,
  acceptance_rate numeric(8, 4),
  revenue_today_cents bigint not null default 0,
  revenue_week_cents bigint not null default 0,
  revenue_month_cents bigint not null default 0,
  revenue_year_cents bigint not null default 0,
  drivers_premium integer not null default 0,
  drivers_xl integer not null default 0,
  clients_new_30d integer not null default 0,
  clients_returning_30d integer not null default 0,
  shared_rides_count_30d integer not null default 0,
  shared_discount_cents_30d bigint not null default 0,
  shared_seats_filled_30d integer not null default 0,
  loyalty_points_earned_30d bigint not null default 0,
  loyalty_points_redeemed_30d bigint not null default 0,
  promo_discount_cents_30d bigint not null default 0,
  promo_redemptions_30d integer not null default 0,
  open_dispatch_alerts integer not null default 0,
  open_payment_alerts integer not null default 0,
  open_payout_alerts integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists taxi_system_health_snapshot_idx
  on public.taxi_system_health (snapshot_at desc);

create table if not exists public.taxi_dispatch_metrics (
  id uuid primary key default gen_random_uuid(),
  snapshot_at timestamptz not null default now(),
  rides_dispatched_24h integer not null default 0,
  rides_dispatch_failed_24h integer not null default 0,
  avg_dispatch_time_seconds numeric(12, 2),
  avg_pickup_time_seconds numeric(12, 2),
  acceptance_rate numeric(8, 4),
  active_drivers integer not null default 0,
  available_drivers integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists taxi_dispatch_metrics_snapshot_idx
  on public.taxi_dispatch_metrics (snapshot_at desc);

create table if not exists public.taxi_payment_metrics (
  id uuid primary key default gen_random_uuid(),
  snapshot_at timestamptz not null default now(),
  checkout_started_24h integer not null default 0,
  checkout_paid_24h integer not null default 0,
  checkout_failed_24h integer not null default 0,
  refunds_24h integer not null default 0,
  refund_failed_24h integer not null default 0,
  pending_payment_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists taxi_payment_metrics_snapshot_idx
  on public.taxi_payment_metrics (snapshot_at desc);

create table if not exists public.taxi_market_metrics (
  id uuid primary key default gen_random_uuid(),
  snapshot_at timestamptz not null default now(),
  country_code text not null references public.taxi_countries (country_code) on delete cascade,
  rides_created_30d integer not null default 0,
  rides_paid_30d integer not null default 0,
  revenue_cents_30d bigint not null default 0,
  readiness_score integer not null default 0 check (readiness_score between 0 and 100),
  dispatch_readiness integer not null default 0 check (dispatch_readiness between 0 and 100),
  payment_readiness integer not null default 0 check (payment_readiness between 0 and 100),
  payout_readiness integer not null default 0 check (payout_readiness between 0 and 100),
  driver_supply integer not null default 0 check (driver_supply between 0 and 100),
  refund_readiness integer not null default 0 check (refund_readiness between 0 and 100),
  error_rate numeric(8, 4) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  constraint taxi_market_metrics_country_snapshot_uq unique (country_code, snapshot_at)
);

create index if not exists taxi_market_metrics_country_idx
  on public.taxi_market_metrics (country_code, snapshot_at desc);

-- ---------------------------------------------------------------------------
-- 3) Alert tables
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_dispatch_alerts (
  id uuid primary key default gen_random_uuid(),
  taxi_ride_id uuid not null references public.taxi_rides (id) on delete cascade,
  alert_type text not null default 'dispatch_blocked',
  status text not null default 'open' check (status in ('open', 'resolved')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists taxi_dispatch_alerts_open_ride_uq
  on public.taxi_dispatch_alerts (taxi_ride_id)
  where status = 'open';

create table if not exists public.taxi_payment_alerts (
  id uuid primary key default gen_random_uuid(),
  taxi_ride_id uuid not null references public.taxi_rides (id) on delete cascade,
  alert_type text not null default 'payment_stuck',
  status text not null default 'open' check (status in ('open', 'resolved')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists taxi_payment_alerts_open_ride_uq
  on public.taxi_payment_alerts (taxi_ride_id)
  where status = 'open';

create table if not exists public.taxi_payout_alerts (
  id uuid primary key default gen_random_uuid(),
  taxi_ride_id uuid not null references public.taxi_rides (id) on delete cascade,
  alert_type text not null default 'payout_blocked',
  status text not null default 'open' check (status in ('open', 'resolved')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists taxi_payout_alerts_open_ride_uq
  on public.taxi_payout_alerts (taxi_ride_id)
  where status = 'open';

-- ---------------------------------------------------------------------------
-- 4) RLS — staff only
-- ---------------------------------------------------------------------------

alter table public.taxi_system_health enable row level security;
alter table public.taxi_dispatch_metrics enable row level security;
alter table public.taxi_payment_metrics enable row level security;
alter table public.taxi_market_metrics enable row level security;
alter table public.taxi_dispatch_alerts enable row level security;
alter table public.taxi_payment_alerts enable row level security;
alter table public.taxi_payout_alerts enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'taxi_system_health',
    'taxi_dispatch_metrics',
    'taxi_payment_metrics',
    'taxi_market_metrics',
    'taxi_dispatch_alerts',
    'taxi_payment_alerts',
    'taxi_payout_alerts'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_staff_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_staff_user(auth.uid()))',
      t || '_staff_select',
      t
    );
    execute format('drop policy if exists %I on public.%I', t || '_staff_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_staff_user(auth.uid())) with check (public.is_staff_user(auth.uid()))',
      t || '_staff_write',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5) resolve_taxi_country + list_taxi_countries — launch control
-- ---------------------------------------------------------------------------

create or replace function public.resolve_taxi_country(p_country_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p_country_code, '')));
  v_row public.taxi_countries%rowtype;
  v_currency public.taxi_currencies%rowtype;
begin
  if v_code = '' then
    return jsonb_build_object('ok', false, 'message', 'country_code_required');
  end if;

  select *
  into v_row
  from public.taxi_countries tc
  where tc.country_code = v_code
    and tc.active = true;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'message', 'country_not_supported',
      'country_code', v_code
    );
  end if;

  if v_row.launch_status = 'maintenance' then
    return jsonb_build_object(
      'ok', false,
      'message', 'country_maintenance',
      'country_code', v_code
    );
  end if;

  if v_row.launch_status <> 'enabled' then
    return jsonb_build_object(
      'ok', false,
      'message', 'country_launch_disabled',
      'country_code', v_code
    );
  end if;

  select *
  into v_currency
  from public.taxi_currencies cur
  where cur.code = v_row.currency_code
    and cur.active = true;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'message', 'currency_not_supported',
      'country_code', v_row.country_code,
      'currency_code', v_row.currency_code
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'country_code', v_row.country_code,
    'country_name', v_row.name,
    'currency_code', v_currency.code,
    'currency_name', v_currency.name,
    'minor_units', v_currency.minor_units,
    'timezone', v_row.timezone,
    'phone_country_code', v_row.phone_country_code,
    'default_language', v_row.default_language,
    'launch_status', v_row.launch_status,
    'checkout_enabled', v_row.checkout_enabled,
    'payout_enabled', v_row.payout_enabled,
    'shared_enabled', v_row.shared_enabled,
    'business_enabled', v_row.business_enabled,
    'scheduled_enabled', v_row.scheduled_enabled,
    'premium_enabled', v_row.premium_enabled
  );
end;
$$;

create or replace function public.list_taxi_countries()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'country_code', tc.country_code,
        'name', tc.name,
        'currency_code', tc.currency_code,
        'currency_name', cur.name,
        'minor_units', cur.minor_units,
        'sort_order', tc.sort_order,
        'timezone', tc.timezone,
        'phone_country_code', tc.phone_country_code,
        'default_language', tc.default_language,
        'launch_status', tc.launch_status,
        'checkout_enabled', tc.checkout_enabled,
        'payout_enabled', tc.payout_enabled,
        'shared_enabled', tc.shared_enabled,
        'business_enabled', tc.business_enabled,
        'scheduled_enabled', tc.scheduled_enabled,
        'premium_enabled', tc.premium_enabled
      )
      order by tc.sort_order, tc.country_code
    ),
    '[]'::jsonb
  )
  from public.taxi_countries tc
  join public.taxi_currencies cur on cur.code = tc.currency_code
  where tc.active = true
    and cur.active = true
    and tc.launch_status = 'enabled';
$$;

-- ---------------------------------------------------------------------------
-- 6) Market readiness helper
-- ---------------------------------------------------------------------------

create or replace function public.compute_taxi_market_readiness(p_country_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p_country_code, '')));
  v_country public.taxi_countries%rowtype;
  v_paid_30d integer := 0;
  v_with_driver_30d integer := 0;
  v_failed_30d integer := 0;
  v_total_30d integer := 0;
  v_payout_ok integer := 0;
  v_payout_total integer := 0;
  v_dispatch_readiness integer := 0;
  v_payment_readiness integer := 0;
  v_payout_readiness integer := 0;
  v_driver_supply integer := 0;
  v_refund_readiness integer := 90;
  v_error_rate numeric := 0;
  v_readiness integer := 0;
begin
  select * into v_country from public.taxi_countries where country_code = v_code;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'country_not_found');
  end if;

  select
    count(*) filter (where payment_status = 'paid'),
    count(*) filter (where payment_status = 'paid' and driver_id is not null),
    count(*) filter (where status in ('canceled', 'refunded') and payment_status = 'paid'),
    count(*)
  into v_paid_30d, v_with_driver_30d, v_failed_30d, v_total_30d
  from public.taxi_rides
  where country_code = v_code
    and created_at >= now() - interval '30 days';

  select
    count(*) filter (where tc.driver_paid_out = true),
    count(*)
  into v_payout_ok, v_payout_total
  from public.taxi_commissions tc
  join public.taxi_rides tr on tr.id = tc.taxi_ride_id
  where tr.country_code = v_code
    and tr.status = 'completed'
    and tr.payment_status = 'paid'
    and tr.completed_at >= now() - interval '30 days';

  if v_paid_30d > 0 then
    v_dispatch_readiness := least(100, round((v_with_driver_30d::numeric / v_paid_30d) * 100));
  elsif v_country.launch_status = 'enabled' then
    v_dispatch_readiness := 70;
  else
    v_dispatch_readiness := 20;
  end if;

  v_payment_readiness := case
    when v_country.checkout_enabled and v_country.launch_status = 'enabled' then 90
    when v_country.launch_status = 'maintenance' then 40
    else 25
  end;

  v_payout_readiness := case
    when v_country.payout_enabled and v_payout_total > 0 then
      least(100, round((v_payout_ok::numeric / v_payout_total) * 100))
    when v_country.payout_enabled then 75
    else 15
  end;

  select least(100, count(*) * 5)
  into v_driver_supply
  from public.taxi_driver_features df
  where df.taxi_enabled = true;

  if v_total_30d > 0 then
    v_error_rate := round((v_failed_30d::numeric / v_total_30d), 4);
    v_refund_readiness := greatest(0, least(100, round(100 - (v_error_rate * 100))));
  end if;

  v_readiness := round(
    (
      v_dispatch_readiness
      + v_payment_readiness
      + v_payout_readiness
      + v_driver_supply
      + v_refund_readiness
    ) / 5.0
  );

  return jsonb_build_object(
    'ok', true,
    'country_code', v_code,
    'readiness_score', v_readiness,
    'dispatch_readiness', v_dispatch_readiness,
    'payment_readiness', v_payment_readiness,
    'payout_readiness', v_payout_readiness,
    'driver_supply', v_driver_supply,
    'refund_readiness', v_refund_readiness,
    'error_rate', v_error_rate
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Monitoring snapshot + alert detection RPC
-- ---------------------------------------------------------------------------

create or replace function public.refresh_taxi_monitoring_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_health_id uuid;
  v_dispatch_id uuid;
  v_payment_id uuid;
  v_ride record;
begin
  -- Detect dispatch alerts: paid, no driver, > 5 minutes
  insert into public.taxi_dispatch_alerts (taxi_ride_id, alert_type, metadata)
  select
    tr.id,
    'dispatch_blocked',
    jsonb_build_object(
      'paid_at', tr.paid_at,
      'status', tr.status,
      'country_code', tr.country_code
    )
  from public.taxi_rides tr
  where tr.payment_status = 'paid'
    and tr.driver_id is null
    and tr.status in ('paid', 'dispatching', 'quoted', 'pending_payment')
    and coalesce(tr.paid_at, tr.updated_at) < v_now - interval '5 minutes'
    and not exists (
      select 1 from public.taxi_dispatch_alerts da
      where da.taxi_ride_id = tr.id and da.status = 'open'
    );

  -- Payment stuck: pending_payment > 15 minutes
  insert into public.taxi_payment_alerts (taxi_ride_id, alert_type, metadata)
  select
    tr.id,
    'payment_stuck',
    jsonb_build_object('status', tr.status, 'updated_at', tr.updated_at)
  from public.taxi_rides tr
  where tr.status = 'pending_payment'
    and tr.payment_status <> 'paid'
    and tr.updated_at < v_now - interval '15 minutes'
    and not exists (
      select 1 from public.taxi_payment_alerts pa
      where pa.taxi_ride_id = tr.id and pa.status = 'open'
    );

  -- Payout blocked: completed + paid + not paid out > 24h
  insert into public.taxi_payout_alerts (taxi_ride_id, alert_type, metadata)
  select
    tr.id,
    'payout_blocked',
    jsonb_build_object(
      'completed_at', tr.completed_at,
      'driver_paid_out', tc.driver_paid_out
    )
  from public.taxi_rides tr
  join public.taxi_commissions tc on tc.taxi_ride_id = tr.id
  where tr.status = 'completed'
    and tr.payment_status = 'paid'
    and tc.driver_paid_out = false
    and coalesce(tr.completed_at, tr.updated_at) < v_now - interval '24 hours'
    and not exists (
      select 1 from public.taxi_payout_alerts pa
      where pa.taxi_ride_id = tr.id and pa.status = 'open'
    );

  insert into public.taxi_system_health (
    snapshot_at,
    rides_created_24h,
    rides_paid_24h,
    dispatch_success_24h,
    dispatch_failed_24h,
    payout_success_24h,
    payout_failed_24h,
    refund_success_24h,
    refund_failed_24h,
    avg_dispatch_time_seconds,
    avg_pickup_time_seconds,
    active_drivers,
    available_drivers,
    acceptance_rate,
    revenue_today_cents,
    revenue_week_cents,
    revenue_month_cents,
    revenue_year_cents,
    drivers_premium,
    drivers_xl,
    clients_new_30d,
    clients_returning_30d,
    shared_rides_count_30d,
    shared_discount_cents_30d,
    shared_seats_filled_30d,
    loyalty_points_earned_30d,
    loyalty_points_redeemed_30d,
    promo_discount_cents_30d,
    promo_redemptions_30d,
    open_dispatch_alerts,
    open_payment_alerts,
    open_payout_alerts
  )
  values (
    v_now,
    (select count(*) from public.taxi_rides where created_at >= v_now - interval '24 hours'),
    (select count(*) from public.taxi_rides where payment_status = 'paid' and paid_at >= v_now - interval '24 hours'),
    (select count(*) from public.taxi_events where event_type = 'dispatch_success' and created_at >= v_now - interval '24 hours'),
    (select count(*) from public.taxi_events where event_type in ('dispatch_failed', 'dispatch_secret_missing') and created_at >= v_now - interval '24 hours'),
    (select count(*) from public.taxi_events where event_type = 'driver_payout' and created_at >= v_now - interval '24 hours'),
    (select count(*) from public.taxi_events where event_type = 'driver_payout_failed' and created_at >= v_now - interval '24 hours'),
    (select count(*) from public.taxi_rides where payment_status = 'refunded' and updated_at >= v_now - interval '24 hours'),
    0,
    (
      select avg(extract(epoch from (e.created_at - tr.paid_at)))
      from public.taxi_rides tr
      join public.taxi_events e on e.taxi_ride_id = tr.id and e.event_type = 'dispatch_success'
      where tr.paid_at >= v_now - interval '7 days'
    ),
    (
      select avg(extract(epoch from (tr.started_at - tr.paid_at)))
      from public.taxi_rides tr
      where tr.started_at is not null
        and tr.paid_at >= v_now - interval '7 days'
    ),
    (select count(*) from public.taxi_driver_features where taxi_enabled = true),
    (select count(distinct dl.driver_id) from public.driver_locations dl where dl.updated_at >= v_now - interval '20 minutes'),
    (
      select case when count(*) = 0 then null
        else round(count(*) filter (where status = 'accepted')::numeric / count(*), 4) end
      from public.taxi_offers where created_at >= v_now - interval '7 days'
    ),
    coalesce((select sum(total_cents) from public.taxi_rides where payment_status = 'paid' and paid_at >= date_trunc('day', v_now)), 0),
    coalesce((select sum(total_cents) from public.taxi_rides where payment_status = 'paid' and paid_at >= v_now - interval '7 days'), 0),
    coalesce((select sum(total_cents) from public.taxi_rides where payment_status = 'paid' and paid_at >= v_now - interval '30 days'), 0),
    coalesce((select sum(total_cents) from public.taxi_rides where payment_status = 'paid' and paid_at >= date_trunc('year', v_now)), 0),
    (select count(*) from public.taxi_driver_features where premium_eligible = true),
    (select count(*) from public.taxi_driver_features where xl_eligible = true),
    (select count(distinct client_user_id) from public.taxi_rides where created_at >= v_now - interval '30 days'),
    (
      select count(distinct t.client_user_id)
      from public.taxi_rides t
      where t.created_at >= v_now - interval '30 days'
        and exists (
          select 1 from public.taxi_rides prev
          where prev.client_user_id = t.client_user_id
            and prev.created_at < t.created_at - interval '1 day'
        )
    ),
    (select count(*) from public.taxi_shared_rides where created_at >= v_now - interval '30 days'),
    coalesce((select sum(shared_discount_cents) from public.taxi_rides where created_at >= v_now - interval '30 days'), 0),
    (select count(*) from public.taxi_shared_ride_passengers where status = 'paid' and created_at >= v_now - interval '30 days'),
    coalesce((select sum(delta_points) from public.taxi_loyalty_ledger where delta_points > 0 and created_at >= v_now - interval '30 days'), 0),
    coalesce((select sum(abs(delta_points)) from public.taxi_loyalty_ledger where delta_points < 0 and created_at >= v_now - interval '30 days'), 0),
    coalesce((select sum(discount_cents) from public.taxi_rides where created_at >= v_now - interval '30 days'), 0),
    (select count(*) from public.taxi_promotion_redemptions where created_at >= v_now - interval '30 days'),
    (select count(*) from public.taxi_dispatch_alerts where status = 'open'),
    (select count(*) from public.taxi_payment_alerts where status = 'open'),
    (select count(*) from public.taxi_payout_alerts where status = 'open')
  )
  returning id into v_health_id;

  insert into public.taxi_dispatch_metrics (
    snapshot_at,
    rides_dispatched_24h,
    rides_dispatch_failed_24h,
    avg_dispatch_time_seconds,
    avg_pickup_time_seconds,
    acceptance_rate,
    active_drivers,
    available_drivers
  )
  select
    v_now,
    (select count(*) from public.taxi_events where event_type = 'dispatch_success' and created_at >= v_now - interval '24 hours'),
    (select count(*) from public.taxi_events where event_type in ('dispatch_failed', 'dispatch_secret_missing') and created_at >= v_now - interval '24 hours'),
    (select avg_dispatch_time_seconds from public.taxi_system_health where id = v_health_id),
    (select avg_pickup_time_seconds from public.taxi_system_health where id = v_health_id),
    (select acceptance_rate from public.taxi_system_health where id = v_health_id),
    (select active_drivers from public.taxi_system_health where id = v_health_id),
    (select available_drivers from public.taxi_system_health where id = v_health_id)
  returning id into v_dispatch_id;

  insert into public.taxi_payment_metrics (
    snapshot_at,
    checkout_started_24h,
    checkout_paid_24h,
    checkout_failed_24h,
    refunds_24h,
    refund_failed_24h,
    pending_payment_count
  )
  values (
    v_now,
    (select count(*) from public.taxi_events where event_type = 'checkout_started' and created_at >= v_now - interval '24 hours'),
    (select count(*) from public.taxi_rides where payment_status = 'paid' and paid_at >= v_now - interval '24 hours'),
    (select count(*) from public.taxi_events where event_type = 'checkout_failed' and created_at >= v_now - interval '24 hours'),
    (select count(*) from public.taxi_rides where payment_status = 'refunded' and updated_at >= v_now - interval '24 hours'),
    0,
    (select count(*) from public.taxi_rides where status = 'pending_payment' and payment_status <> 'paid')
  )
  returning id into v_payment_id;

  for v_ride in
    select country_code from public.taxi_countries order by sort_order, country_code
  loop
    insert into public.taxi_market_metrics (
      snapshot_at,
      country_code,
      rides_created_30d,
      rides_paid_30d,
      revenue_cents_30d,
      readiness_score,
      dispatch_readiness,
      payment_readiness,
      payout_readiness,
      driver_supply,
      refund_readiness,
      error_rate
    )
    select
      v_now,
      v_ride.country_code,
      (select count(*) from public.taxi_rides where country_code = v_ride.country_code and created_at >= v_now - interval '30 days'),
      (select count(*) from public.taxi_rides where country_code = v_ride.country_code and payment_status = 'paid' and paid_at >= v_now - interval '30 days'),
      coalesce((select sum(total_cents) from public.taxi_rides where country_code = v_ride.country_code and payment_status = 'paid' and paid_at >= v_now - interval '30 days'), 0),
      (public.compute_taxi_market_readiness(v_ride.country_code)->>'readiness_score')::integer,
      (public.compute_taxi_market_readiness(v_ride.country_code)->>'dispatch_readiness')::integer,
      (public.compute_taxi_market_readiness(v_ride.country_code)->>'payment_readiness')::integer,
      (public.compute_taxi_market_readiness(v_ride.country_code)->>'payout_readiness')::integer,
      (public.compute_taxi_market_readiness(v_ride.country_code)->>'driver_supply')::integer,
      (public.compute_taxi_market_readiness(v_ride.country_code)->>'refund_readiness')::integer,
      (public.compute_taxi_market_readiness(v_ride.country_code)->>'error_rate')::numeric
    on conflict (country_code, snapshot_at) do update set
      rides_created_30d = excluded.rides_created_30d,
      rides_paid_30d = excluded.rides_paid_30d,
      revenue_cents_30d = excluded.revenue_cents_30d,
      readiness_score = excluded.readiness_score,
      dispatch_readiness = excluded.dispatch_readiness,
      payment_readiness = excluded.payment_readiness,
      payout_readiness = excluded.payout_readiness,
      driver_supply = excluded.driver_supply,
      refund_readiness = excluded.refund_readiness,
      error_rate = excluded.error_rate;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'snapshot_at', v_now,
    'system_health_id', v_health_id,
    'dispatch_metrics_id', v_dispatch_id,
    'payment_metrics_id', v_payment_id
  );
end;
$$;

create or replace function public.resolve_taxi_alert(
  p_alert_table text,
  p_alert_id uuid,
  p_resolved_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  if p_alert_table = 'dispatch' then
    update public.taxi_dispatch_alerts
    set status = 'resolved', resolved_at = now(), resolved_by = p_resolved_by
    where id = p_alert_id and status = 'open';
    get diagnostics v_updated = row_count;
  elsif p_alert_table = 'payment' then
    update public.taxi_payment_alerts
    set status = 'resolved', resolved_at = now(), resolved_by = p_resolved_by
    where id = p_alert_id and status = 'open';
    get diagnostics v_updated = row_count;
  elsif p_alert_table = 'payout' then
    update public.taxi_payout_alerts
    set status = 'resolved', resolved_at = now(), resolved_by = p_resolved_by
    where id = p_alert_id and status = 'open';
    get diagnostics v_updated = row_count;
  else
    return jsonb_build_object('ok', false, 'message', 'invalid_alert_table');
  end if;

  if v_updated = 0 then
    return jsonb_build_object('ok', false, 'message', 'alert_not_found_or_already_resolved');
  end if;

  return jsonb_build_object('ok', true, 'alert_id', p_alert_id);
end;
$$;

revoke all on function public.compute_taxi_market_readiness(text) from public;
grant execute on function public.compute_taxi_market_readiness(text) to service_role;
revoke all on function public.refresh_taxi_monitoring_snapshot() from public;
grant execute on function public.refresh_taxi_monitoring_snapshot() to service_role;
revoke all on function public.resolve_taxi_alert(text, uuid, uuid) from public;
grant execute on function public.resolve_taxi_alert(text, uuid, uuid) to service_role;

commit;
