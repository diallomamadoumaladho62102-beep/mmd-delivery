-- Taxi Sprint 1: isolated domain infrastructure (no orders / delivery_requests).
-- Tables, RPCs, RLS, storage policies for taxi_messages images.

begin;

-- ---------------------------------------------------------------------------
-- 0) Helpers
-- ---------------------------------------------------------------------------

create or replace function public.taxi_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) taxi_pricing
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_pricing (
  id uuid primary key default gen_random_uuid(),
  config_key text not null unique,
  vehicle_class text not null check (vehicle_class in ('standard', 'xl', 'premium')),
  country_code text not null default 'US',
  currency text not null default 'USD',
  active boolean not null default true,
  base_fare numeric(12, 2) not null default 0 check (base_fare >= 0),
  per_mile numeric(12, 2) not null default 0 check (per_mile >= 0),
  per_minute numeric(12, 2) not null default 0 check (per_minute >= 0),
  min_fare numeric(12, 2) not null default 0 check (min_fare >= 0),
  booking_fee numeric(12, 2) not null default 0 check (booking_fee >= 0),
  driver_share_pct numeric(6, 2) not null default 75 check (
    driver_share_pct >= 0 and driver_share_pct <= 100
  ),
  platform_share_pct numeric(6, 2) not null default 25 check (
    platform_share_pct >= 0 and platform_share_pct <= 100
  ),
  class_multiplier numeric(8, 4) not null default 1 check (class_multiplier > 0),
  max_passengers integer not null default 4 check (max_passengers > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint taxi_pricing_share_total_check check (
    driver_share_pct + platform_share_pct <= 100
  )
);

create unique index if not exists taxi_pricing_active_country_class_uq
  on public.taxi_pricing (country_code, vehicle_class)
  where active = true;

drop trigger if exists trg_taxi_pricing_updated_at on public.taxi_pricing;
create trigger trg_taxi_pricing_updated_at
before update on public.taxi_pricing
for each row execute function public.taxi_set_updated_at();

insert into public.taxi_pricing (
  config_key,
  vehicle_class,
  country_code,
  currency,
  active,
  base_fare,
  per_mile,
  per_minute,
  min_fare,
  booking_fee,
  driver_share_pct,
  platform_share_pct,
  class_multiplier,
  max_passengers,
  notes
)
values
  (
    'taxi_us_standard',
    'standard',
    'US',
    'USD',
    true,
    2.50,
    1.15,
    0.22,
    5.00,
    1.00,
    75,
    25,
    1.0,
    4,
    'Taxi US Standard MVP'
  ),
  (
    'taxi_us_xl',
    'xl',
    'US',
    'USD',
    true,
    3.50,
    1.45,
    0.28,
    7.00,
    1.50,
    75,
    25,
    1.35,
    6,
    'Taxi US XL MVP'
  ),
  (
    'taxi_us_premium',
    'premium',
    'US',
    'USD',
    true,
    5.00,
    1.85,
    0.35,
    10.00,
    2.00,
    72,
    28,
    1.75,
    4,
    'Taxi US Premium MVP'
  )
on conflict (config_key) do update
set
  vehicle_class = excluded.vehicle_class,
  country_code = excluded.country_code,
  currency = excluded.currency,
  active = excluded.active,
  base_fare = excluded.base_fare,
  per_mile = excluded.per_mile,
  per_minute = excluded.per_minute,
  min_fare = excluded.min_fare,
  booking_fee = excluded.booking_fee,
  driver_share_pct = excluded.driver_share_pct,
  platform_share_pct = excluded.platform_share_pct,
  class_multiplier = excluded.class_multiplier,
  max_passengers = excluded.max_passengers,
  notes = excluded.notes,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 2) taxi_driver_features
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_driver_features (
  user_id uuid primary key references auth.users (id) on delete cascade,
  taxi_enabled boolean not null default false,
  vehicle_class text not null default 'standard'
    check (vehicle_class in ('standard', 'xl', 'premium')),
  vehicle_make text,
  vehicle_model text,
  vehicle_year integer check (vehicle_year is null or vehicle_year >= 1980),
  vehicle_plate text,
  vehicle_color text,
  passenger_capacity integer not null default 4 check (passenger_capacity > 0),
  xl_eligible boolean not null default false,
  premium_eligible boolean not null default false,
  stripe_connect_account_id text,
  rating_taxi numeric(4, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists taxi_driver_features_enabled_class_idx
  on public.taxi_driver_features (taxi_enabled, vehicle_class)
  where taxi_enabled = true;

drop trigger if exists trg_taxi_driver_features_updated_at on public.taxi_driver_features;
create trigger trg_taxi_driver_features_updated_at
before update on public.taxi_driver_features
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) taxi_rides
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_rides (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references auth.users (id) on delete restrict,
  driver_id uuid references auth.users (id) on delete set null,
  vehicle_class text not null default 'standard'
    check (vehicle_class in ('standard', 'xl', 'premium')),
  status text not null default 'draft'
    check (
      status in (
        'draft',
        'quoted',
        'pending_payment',
        'paid',
        'dispatching',
        'accepted',
        'driver_arrived',
        'in_progress',
        'completed',
        'canceled'
      )
    ),
  pickup_address text not null,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  dropoff_address text not null,
  dropoff_lat double precision not null,
  dropoff_lng double precision not null,
  distance_miles numeric(10, 3),
  duration_minutes numeric(10, 2),
  country_code text not null default 'US',
  currency text not null default 'USD',
  pricing_snapshot_id uuid references public.taxi_pricing (id) on delete set null,
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  platform_fee_cents integer not null default 0 check (platform_fee_cents >= 0),
  driver_payout_cents integer not null default 0 check (driver_payout_cents >= 0),
  total_cents integer not null default 0 check (total_cents >= 0),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'processing', 'paid', 'refunded')),
  paid_at timestamptz,
  stripe_session_id text,
  stripe_payment_intent_id text,
  refund_status text,
  stripe_refund_id text,
  stripe_refunded_at timestamptz,
  accepted_at timestamptz,
  driver_arrived_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text check (
    cancelled_by is null
    or cancelled_by in ('client', 'driver', 'admin', 'system')
  ),
  cancel_reason text,
  client_notes text,
  passenger_count integer not null default 1 check (passenger_count > 0),
  dispatch_wave integer not null default 0 check (dispatch_wave >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists taxi_rides_client_created_idx
  on public.taxi_rides (client_user_id, created_at desc);

create index if not exists taxi_rides_driver_status_idx
  on public.taxi_rides (driver_id, status)
  where driver_id is not null;

create index if not exists taxi_rides_status_created_idx
  on public.taxi_rides (status, created_at desc);

create unique index if not exists taxi_rides_stripe_pi_uq
  on public.taxi_rides (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

drop trigger if exists trg_taxi_rides_updated_at on public.taxi_rides;
create trigger trg_taxi_rides_updated_at
before update on public.taxi_rides
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4) taxi_offers
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_offers (
  id uuid primary key default gen_random_uuid(),
  taxi_ride_id uuid not null references public.taxi_rides (id) on delete cascade,
  driver_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'expired', 'superseded')),
  wave integer not null default 1 check (wave > 0),
  distance_miles numeric(10, 3),
  vehicle_class_match boolean not null default true,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint taxi_offers_ride_driver_wave_uq unique (taxi_ride_id, driver_id, wave)
);

create index if not exists taxi_offers_ride_status_idx
  on public.taxi_offers (taxi_ride_id, status);

create index if not exists taxi_offers_driver_pending_idx
  on public.taxi_offers (driver_id, expires_at)
  where status = 'pending';

drop trigger if exists trg_taxi_offers_updated_at on public.taxi_offers;
create trigger trg_taxi_offers_updated_at
before update on public.taxi_offers
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5) taxi_events
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_events (
  id uuid primary key default gen_random_uuid(),
  taxi_ride_id uuid not null references public.taxi_rides (id) on delete cascade,
  event_type text not null,
  old_status text,
  new_status text,
  actor_id uuid references auth.users (id) on delete set null,
  triggered_role text check (
    triggered_role is null
    or triggered_role in ('client', 'driver', 'admin', 'system')
  ),
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists taxi_events_ride_created_idx
  on public.taxi_events (taxi_ride_id, created_at asc);

-- ---------------------------------------------------------------------------
-- 6) taxi_messages
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_messages (
  id uuid primary key default gen_random_uuid(),
  taxi_ride_id uuid not null references public.taxi_rides (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  sender_role text check (sender_role in ('client', 'driver', 'admin')),
  target_role text check (target_role in ('client', 'driver', 'admin')),
  text text,
  image_path text,
  created_at timestamptz not null default now(),
  constraint taxi_messages_has_content check (
    coalesce(nullif(trim(text), ''), nullif(trim(image_path), '')) is not null
  )
);

create index if not exists taxi_messages_ride_created_idx
  on public.taxi_messages (taxi_ride_id, created_at asc);

-- ---------------------------------------------------------------------------
-- 7) taxi_commissions
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_commissions (
  id uuid primary key default gen_random_uuid(),
  taxi_ride_id uuid not null unique references public.taxi_rides (id) on delete cascade,
  currency text not null default 'USD',
  total_cents integer not null default 0 check (total_cents >= 0),
  platform_cents integer not null default 0 check (platform_cents >= 0),
  driver_cents integer not null default 0 check (driver_cents >= 0),
  driver_transfer_id text,
  driver_paid_out boolean not null default false,
  driver_paid_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists taxi_commissions_driver_paid_idx
  on public.taxi_commissions (driver_paid_out, created_at desc);

drop trigger if exists trg_taxi_commissions_updated_at on public.taxi_commissions;
create trigger trg_taxi_commissions_updated_at
before update on public.taxi_commissions
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 8) Helpers (after tables — required for %rowtype / relation refs)
-- ---------------------------------------------------------------------------

create or replace function public.taxi_ride_participant_ids(p_ride_id uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select distinct participant.user_id
  from (
    select tr.client_user_id as user_id
    from public.taxi_rides tr
    where tr.id = p_ride_id
      and tr.client_user_id is not null
    union all
    select tr.driver_id
    from public.taxi_rides tr
    where tr.id = p_ride_id
      and tr.driver_id is not null
  ) participant;
$$;

create or replace function public.is_taxi_account_active(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and coalesce(p.account_status, 'active') = 'active'
  );
$$;

create or replace function public.is_taxi_driver_eligible(
  p_user_id uuid default auth.uid(),
  p_vehicle_class text default 'standard'
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_class text := lower(trim(coalesce(p_vehicle_class, 'standard')));
  v_features public.taxi_driver_features%rowtype;
begin
  if p_user_id is null then
    return false;
  end if;

  if not public.is_taxi_account_active(p_user_id) then
    return false;
  end if;

  if to_regprocedure('public.is_driver_operational(uuid)') is not null then
    if not public.is_driver_operational(p_user_id) then
      return false;
    end if;
  else
    if not exists (
      select 1
      from public.driver_profiles dp
      where dp.user_id = p_user_id
        and lower(coalesce(dp.status, '')) = 'approved'
    ) then
      return false;
    end if;
  end if;

  select *
  into v_features
  from public.taxi_driver_features tdf
  where tdf.user_id = p_user_id;

  if not found or coalesce(v_features.taxi_enabled, false) is not true then
    return false;
  end if;

  if v_class = 'standard' then
    return true;
  end if;

  if v_class = 'xl' then
    return coalesce(v_features.xl_eligible, false) is true;
  end if;

  if v_class = 'premium' then
    return coalesce(v_features.premium_eligible, false) is true;
  end if;

  return false;
end;
$$;

create or replace function public.taxi_ride_id_from_storage_path(p_object_name text)
returns uuid
language sql
immutable
as $$
  select nullif(split_part(trim(p_object_name), '/', 1), '')::uuid;
$$;

create or replace function public.user_can_access_taxi_ride_storage(
  p_ride_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.taxi_ride_participant_ids(p_ride_id) p
    where p.user_id = p_user_id
  )
  or public.is_staff_user(p_user_id);
$$;

-- ---------------------------------------------------------------------------
-- 9) RPCs — pricing / payment / commissions
-- ---------------------------------------------------------------------------

create or replace function public.quote_taxi_ride(
  p_distance_miles numeric,
  p_duration_minutes numeric,
  p_vehicle_class text default 'standard',
  p_country_code text default 'US',
  p_passenger_count integer default 1
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_class text := lower(trim(coalesce(p_vehicle_class, 'standard')));
  v_country text := upper(trim(coalesce(p_country_code, 'US')));
  v_passengers integer := greatest(coalesce(p_passenger_count, 1), 1);
  v_pricing public.taxi_pricing%rowtype;
  v_distance numeric := greatest(coalesce(p_distance_miles, 0), 0);
  v_duration numeric := greatest(coalesce(p_duration_minutes, 0), 0);
  v_fare numeric;
  v_subtotal_cents integer;
  v_platform_cents integer;
  v_driver_cents integer;
  v_total_cents integer;
begin
  select *
  into v_pricing
  from public.taxi_pricing tp
  where tp.active = true
    and tp.country_code = v_country
    and tp.vehicle_class = v_class
  order by tp.updated_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'pricing_not_found');
  end if;

  if v_passengers > v_pricing.max_passengers then
    return jsonb_build_object(
      'ok',
      false,
      'message',
      'passenger_count_exceeds_vehicle_capacity',
      'max_passengers',
      v_pricing.max_passengers
    );
  end if;

  v_fare :=
    v_pricing.base_fare
    + (v_distance * v_pricing.per_mile)
    + (v_duration * v_pricing.per_minute);

  v_fare := v_fare * v_pricing.class_multiplier;
  v_fare := greatest(v_fare, v_pricing.min_fare);
  v_fare := v_fare + v_pricing.booking_fee;

  v_subtotal_cents := round(v_fare * 100)::integer;
  v_platform_cents := round(v_subtotal_cents * v_pricing.platform_share_pct / 100.0)::integer;
  v_driver_cents := round(v_subtotal_cents * v_pricing.driver_share_pct / 100.0)::integer;
  v_total_cents := v_subtotal_cents;

  return jsonb_build_object(
    'ok', true,
    'pricing_id', v_pricing.id,
    'config_key', v_pricing.config_key,
    'vehicle_class', v_class,
    'country_code', v_country,
    'currency', v_pricing.currency,
    'subtotal_cents', v_subtotal_cents,
    'platform_fee_cents', v_platform_cents,
    'driver_payout_cents', v_driver_cents,
    'total_cents', v_total_cents,
    'max_passengers', v_pricing.max_passengers
  );
end;
$$;

create or replace function public.log_taxi_event(
  p_ride_id uuid,
  p_event_type text,
  p_old_status text default null,
  p_new_status text default null,
  p_actor_id uuid default null,
  p_triggered_role text default null,
  p_description text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.taxi_events (
    taxi_ride_id,
    event_type,
    old_status,
    new_status,
    actor_id,
    triggered_role,
    description,
    metadata
  )
  values (
    p_ride_id,
    p_event_type,
    p_old_status,
    p_new_status,
    p_actor_id,
    p_triggered_role,
    p_description,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.mark_taxi_ride_paid(
  p_ride_id uuid,
  p_session_id text default null,
  p_payment_intent_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_old_status text;
  v_payment_status text;
begin
  select status, payment_status
  into v_old_status, v_payment_status
  from public.taxi_rides
  where id = p_ride_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if lower(coalesce(v_payment_status, '')) = 'paid' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'taxi_ride_id', p_ride_id,
      'payment_status', 'paid'
    );
  end if;

  update public.taxi_rides
  set
    payment_status = 'paid',
    paid_at = coalesce(paid_at, v_now),
    status = case
      when status in ('draft', 'quoted', 'pending_payment') then 'paid'
      else status
    end,
    stripe_session_id = coalesce(p_session_id, stripe_session_id),
    stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
    updated_at = v_now
  where id = p_ride_id;

  perform public.log_taxi_event(
    p_ride_id,
    'ride_paid',
    v_old_status,
    'paid',
    null,
    'system',
    'Taxi ride marked as paid',
    jsonb_build_object(
      'stripe_session_id', p_session_id,
      'stripe_payment_intent_id', p_payment_intent_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', p_ride_id,
    'payment_status', 'paid'
  );
end;
$$;

create or replace function public.refresh_taxi_commissions(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.taxi_rides%rowtype;
begin
  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  insert into public.taxi_commissions (
    taxi_ride_id,
    currency,
    total_cents,
    platform_cents,
    driver_cents
  )
  values (
    v_ride.id,
    coalesce(v_ride.currency, 'USD'),
    v_ride.total_cents,
    v_ride.platform_fee_cents,
    v_ride.driver_payout_cents
  )
  on conflict (taxi_ride_id) do update
  set
    currency = excluded.currency,
    total_cents = excluded.total_cents,
    platform_cents = excluded.platform_cents,
    driver_cents = excluded.driver_cents,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', p_ride_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 10) RPCs — driver lifecycle
-- ---------------------------------------------------------------------------

create or replace function public.driver_accept_taxi_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_offer public.taxi_offers%rowtype;
  v_ride public.taxi_rides%rowtype;
  v_old_status text;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  select *
  into v_offer
  from public.taxi_offers
  where id = p_offer_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'offer_not_found');
  end if;

  select *
  into v_ride
  from public.taxi_rides
  where id = v_offer.taxi_ride_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if not public.is_taxi_driver_eligible(v_driver_id, v_ride.vehicle_class) then
    return jsonb_build_object('ok', false, 'message', 'driver_not_eligible');
  end if;

  if v_offer.status <> 'pending' or v_offer.expires_at <= now() then
    return jsonb_build_object('ok', false, 'message', 'offer_not_available');
  end if;

  if lower(coalesce(v_ride.payment_status, '')) <> 'paid' then
    return jsonb_build_object('ok', false, 'message', 'ride_not_paid');
  end if;

  if v_ride.driver_id is not null and v_ride.driver_id <> v_driver_id then
    return jsonb_build_object('ok', false, 'message', 'already_assigned');
  end if;

  if lower(coalesce(v_ride.status, '')) not in ('paid', 'dispatching') then
    return jsonb_build_object('ok', false, 'message', 'ride_not_available');
  end if;

  v_old_status := v_ride.status;

  update public.taxi_rides
  set
    driver_id = v_driver_id,
    status = 'accepted',
    accepted_at = coalesce(accepted_at, now()),
    updated_at = now()
  where id = v_ride.id
    and driver_id is null
    and lower(payment_status) = 'paid'
    and lower(status) in ('paid', 'dispatching');

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_no_longer_available');
  end if;

  update public.taxi_offers
  set status = 'accepted', updated_at = now()
  where id = v_offer.id;

  update public.taxi_offers
  set status = 'superseded', updated_at = now()
  where taxi_ride_id = v_offer.taxi_ride_id
    and id <> v_offer.id
    and status = 'pending';

  perform public.log_taxi_event(
    v_ride.id,
    'driver_accepted',
    v_old_status,
    'accepted',
    v_driver_id,
    'driver',
    'Driver accepted taxi offer',
    jsonb_build_object('offer_id', p_offer_id)
  );

  return jsonb_build_object('ok', true, 'taxi_ride_id', v_ride.id);
end;
$$;

create or replace function public.driver_reject_taxi_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  update public.taxi_offers
  set status = 'rejected', updated_at = now()
  where id = p_offer_id
    and driver_id = v_driver_id
    and status = 'pending';

  if not found then
    return jsonb_build_object('ok', false, 'message', 'offer_not_available');
  end if;

  return jsonb_build_object('ok', true, 'offer_id', p_offer_id);
end;
$$;

create or replace function public.driver_arrive_taxi_pickup(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_ride public.taxi_rides%rowtype;
  v_old_status text;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if not public.is_taxi_driver_eligible(v_driver_id, v_ride.vehicle_class) then
    return jsonb_build_object('ok', false, 'message', 'driver_not_eligible');
  end if;

  if lower(coalesce(v_ride.status, '')) <> 'accepted' then
    return jsonb_build_object('ok', false, 'message', 'invalid_status');
  end if;

  v_old_status := v_ride.status;

  update public.taxi_rides
  set
    status = 'driver_arrived',
    driver_arrived_at = coalesce(driver_arrived_at, now()),
    updated_at = now()
  where id = p_ride_id
    and driver_id = v_driver_id
    and status = v_ride.status;

  perform public.log_taxi_event(
    p_ride_id,
    'driver_arrived',
    v_old_status,
    'driver_arrived',
    v_driver_id,
    'driver',
    'Driver arrived at pickup',
    '{}'::jsonb
  );

  return jsonb_build_object('ok', true, 'taxi_ride_id', p_ride_id, 'status', 'driver_arrived');
end;
$$;

create or replace function public.driver_start_taxi_ride(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_ride public.taxi_rides%rowtype;
  v_old_status text;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if not public.is_taxi_driver_eligible(v_driver_id, v_ride.vehicle_class) then
    return jsonb_build_object('ok', false, 'message', 'driver_not_eligible');
  end if;

  if lower(coalesce(v_ride.status, '')) <> 'driver_arrived' then
    return jsonb_build_object('ok', false, 'message', 'invalid_status');
  end if;

  v_old_status := v_ride.status;

  update public.taxi_rides
  set
    status = 'in_progress',
    started_at = coalesce(started_at, now()),
    updated_at = now()
  where id = p_ride_id
    and driver_id = v_driver_id
    and status = v_ride.status;

  perform public.log_taxi_event(
    p_ride_id,
    'ride_started',
    v_old_status,
    'in_progress',
    v_driver_id,
    'driver',
    'Taxi ride started',
    '{}'::jsonb
  );

  return jsonb_build_object('ok', true, 'taxi_ride_id', p_ride_id, 'status', 'in_progress');
end;
$$;

create or replace function public.driver_complete_taxi_ride(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_ride public.taxi_rides%rowtype;
  v_old_status text;
  v_refresh jsonb;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if not public.is_taxi_driver_eligible(v_driver_id, v_ride.vehicle_class) then
    return jsonb_build_object('ok', false, 'message', 'driver_not_eligible');
  end if;

  if lower(coalesce(v_ride.status, '')) <> 'in_progress' then
    return jsonb_build_object('ok', false, 'message', 'invalid_status');
  end if;

  v_old_status := v_ride.status;

  update public.taxi_rides
  set
    status = 'completed',
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
  where id = p_ride_id
    and driver_id = v_driver_id
    and status = v_ride.status;

  v_refresh := public.refresh_taxi_commissions(p_ride_id);

  perform public.log_taxi_event(
    p_ride_id,
    'ride_completed',
    v_old_status,
    'completed',
    v_driver_id,
    'driver',
    'Taxi ride completed',
    jsonb_build_object('commissions', v_refresh)
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', p_ride_id,
    'status', 'completed',
    'commissions', v_refresh
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 11) RLS
-- ---------------------------------------------------------------------------

alter table public.taxi_pricing enable row level security;
alter table public.taxi_driver_features enable row level security;
alter table public.taxi_rides enable row level security;
alter table public.taxi_offers enable row level security;
alter table public.taxi_events enable row level security;
alter table public.taxi_messages enable row level security;
alter table public.taxi_commissions enable row level security;

drop policy if exists taxi_pricing_select_active on public.taxi_pricing;
create policy taxi_pricing_select_active
  on public.taxi_pricing
  for select
  to authenticated, anon
  using (active = true);

drop policy if exists taxi_pricing_select_staff on public.taxi_pricing;
create policy taxi_pricing_select_staff
  on public.taxi_pricing
  for select
  to authenticated
  using (public.is_staff_user(auth.uid()));

drop policy if exists taxi_pricing_write_staff on public.taxi_pricing;
create policy taxi_pricing_write_staff
  on public.taxi_pricing
  for all
  to authenticated
  using (public.is_staff_user(auth.uid()))
  with check (public.is_staff_user(auth.uid()));

drop policy if exists taxi_driver_features_select_own on public.taxi_driver_features;
create policy taxi_driver_features_select_own
  on public.taxi_driver_features
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists taxi_driver_features_insert_own on public.taxi_driver_features;
create policy taxi_driver_features_insert_own
  on public.taxi_driver_features
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists taxi_driver_features_update_own on public.taxi_driver_features;
create policy taxi_driver_features_update_own
  on public.taxi_driver_features
  for update
  to authenticated
  using (user_id = auth.uid() or public.is_staff_user(auth.uid()))
  with check (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists taxi_rides_select_participants on public.taxi_rides;
create policy taxi_rides_select_participants
  on public.taxi_rides
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.taxi_ride_participant_ids(taxi_rides.id) p
      where p.user_id = auth.uid()
    )
    or public.is_staff_user(auth.uid())
  );

drop policy if exists taxi_rides_insert_client on public.taxi_rides;
create policy taxi_rides_insert_client
  on public.taxi_rides
  for insert
  to authenticated
  with check (
    client_user_id = auth.uid()
    and public.is_taxi_account_active(auth.uid())
  );

drop policy if exists taxi_offers_select_own on public.taxi_offers;
create policy taxi_offers_select_own
  on public.taxi_offers
  for select
  to authenticated
  using (
    driver_id = auth.uid()
    or public.is_staff_user(auth.uid())
    or exists (
      select 1
      from public.taxi_rides tr
      where tr.id = taxi_offers.taxi_ride_id
        and tr.client_user_id = auth.uid()
    )
  );

drop policy if exists taxi_events_select_participants on public.taxi_events;
create policy taxi_events_select_participants
  on public.taxi_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.taxi_ride_participant_ids(taxi_events.taxi_ride_id) p
      where p.user_id = auth.uid()
    )
    or public.is_staff_user(auth.uid())
  );

drop policy if exists taxi_messages_select_participants on public.taxi_messages;
create policy taxi_messages_select_participants
  on public.taxi_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.taxi_ride_participant_ids(taxi_messages.taxi_ride_id) p
      where p.user_id = auth.uid()
    )
    or public.is_staff_user(auth.uid())
  );

drop policy if exists taxi_messages_insert_participants on public.taxi_messages;
create policy taxi_messages_insert_participants
  on public.taxi_messages
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.taxi_ride_participant_ids(taxi_messages.taxi_ride_id) p
      where p.user_id = auth.uid()
    )
  );

drop policy if exists taxi_commissions_select_driver on public.taxi_commissions;
create policy taxi_commissions_select_driver
  on public.taxi_commissions
  for select
  to authenticated
  using (
    public.is_staff_user(auth.uid())
    or exists (
      select 1
      from public.taxi_rides tr
      where tr.id = taxi_commissions.taxi_ride_id
        and tr.driver_id = auth.uid()
    )
    or exists (
      select 1
      from public.taxi_rides tr
      where tr.id = taxi_commissions.taxi_ride_id
        and tr.client_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 12) Storage — taxi-images bucket for taxi_messages attachments
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('taxi-images', 'taxi-images', false)
on conflict (id) do update
set public = excluded.public;

drop policy if exists taxi_images_select_participants on storage.objects;
create policy taxi_images_select_participants
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'taxi-images'
    and public.user_can_access_taxi_ride_storage(
      public.taxi_ride_id_from_storage_path(name),
      auth.uid()
    )
  );

drop policy if exists taxi_images_insert_participants on storage.objects;
create policy taxi_images_insert_participants
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'taxi-images'
    and public.user_can_access_taxi_ride_storage(
      public.taxi_ride_id_from_storage_path(name),
      auth.uid()
    )
  );

drop policy if exists taxi_images_delete_participants on storage.objects;
create policy taxi_images_delete_participants
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'taxi-images'
    and public.user_can_access_taxi_ride_storage(
      public.taxi_ride_id_from_storage_path(name),
      auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 13) Grants
-- ---------------------------------------------------------------------------

revoke all on function public.taxi_ride_participant_ids(uuid) from public;
revoke all on function public.is_taxi_account_active(uuid) from public;
revoke all on function public.is_taxi_driver_eligible(uuid, text) from public;
revoke all on function public.taxi_ride_id_from_storage_path(text) from public;
revoke all on function public.user_can_access_taxi_ride_storage(uuid, uuid) from public;
revoke all on function public.quote_taxi_ride(numeric, numeric, text, text, integer) from public;
revoke all on function public.log_taxi_event(uuid, text, text, text, uuid, text, text, jsonb) from public;
revoke all on function public.mark_taxi_ride_paid(uuid, text, text) from public;
revoke all on function public.refresh_taxi_commissions(uuid) from public;
revoke all on function public.driver_accept_taxi_offer(uuid) from public;
revoke all on function public.driver_reject_taxi_offer(uuid) from public;
revoke all on function public.driver_arrive_taxi_pickup(uuid) from public;
revoke all on function public.driver_start_taxi_ride(uuid) from public;
revoke all on function public.driver_complete_taxi_ride(uuid) from public;

grant execute on function public.taxi_ride_participant_ids(uuid) to authenticated;
grant execute on function public.is_taxi_account_active(uuid) to authenticated;
grant execute on function public.is_taxi_driver_eligible(uuid, text) to authenticated;
grant execute on function public.quote_taxi_ride(numeric, numeric, text, text, integer) to authenticated;
grant execute on function public.driver_accept_taxi_offer(uuid) to authenticated;
grant execute on function public.driver_reject_taxi_offer(uuid) to authenticated;
grant execute on function public.driver_arrive_taxi_pickup(uuid) to authenticated;
grant execute on function public.driver_start_taxi_ride(uuid) to authenticated;
grant execute on function public.driver_complete_taxi_ride(uuid) to authenticated;

grant execute on function public.log_taxi_event(uuid, text, text, text, uuid, text, text, jsonb) to service_role;
grant execute on function public.mark_taxi_ride_paid(uuid, text, text) to service_role;
grant execute on function public.refresh_taxi_commissions(uuid) to service_role;

commit;
