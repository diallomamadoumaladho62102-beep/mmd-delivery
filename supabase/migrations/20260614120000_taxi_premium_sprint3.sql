-- Taxi Premium Sprint 3: ride sharing, business accounts, premium drivers.

begin;

-- ---------------------------------------------------------------------------
-- 1) Extend taxi_rides
-- ---------------------------------------------------------------------------

alter table public.taxi_rides
  add column if not exists is_shared_ride boolean not null default false,
  add column if not exists shared_ride_id uuid,
  add column if not exists shared_ride_passenger_id uuid,
  add column if not exists shared_discount_cents integer not null default 0
    check (shared_discount_cents >= 0),
  add column if not exists premium_driver_only boolean not null default false,
  add column if not exists business_account_id uuid,
  add column if not exists business_member_id uuid,
  add column if not exists business_trip_type text not null default 'personal'
    check (business_trip_type in ('personal', 'business')),
  add column if not exists business_approval_status text not null default 'not_required'
    check (business_approval_status in ('not_required', 'pending', 'approved', 'rejected'));

create index if not exists taxi_rides_shared_ride_idx
  on public.taxi_rides (shared_ride_id)
  where is_shared_ride = true;

create index if not exists taxi_rides_business_account_idx
  on public.taxi_rides (business_account_id)
  where business_trip_type = 'business';

-- ---------------------------------------------------------------------------
-- 2) taxi_shared_rides
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_shared_rides (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'open'
    check (status in ('open', 'matching', 'locked', 'in_progress', 'completed', 'canceled')),
  max_passengers integer not null default 2 check (max_passengers >= 2 and max_passengers <= 4),
  passenger_count integer not null default 0 check (passenger_count >= 0),
  match_window_minutes integer not null default 15 check (match_window_minutes >= 5),
  discount_percent numeric(5, 2) not null default 15 check (discount_percent >= 0 and discount_percent <= 50),
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  dropoff_lat double precision not null,
  dropoff_lng double precision not null,
  window_expires_at timestamptz not null,
  primary_taxi_ride_id uuid references public.taxi_rides (id) on delete set null,
  driver_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.taxi_rides
  drop constraint if exists taxi_rides_shared_ride_id_fkey;

alter table public.taxi_rides
  add constraint taxi_rides_shared_ride_id_fkey
  foreign key (shared_ride_id) references public.taxi_shared_rides (id) on delete set null;

create index if not exists taxi_shared_rides_open_idx
  on public.taxi_shared_rides (window_expires_at, status)
  where status in ('open', 'matching');

drop trigger if exists trg_taxi_shared_rides_updated_at on public.taxi_shared_rides;
create trigger trg_taxi_shared_rides_updated_at
before update on public.taxi_shared_rides
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) taxi_shared_ride_passengers
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_shared_ride_passengers (
  id uuid primary key default gen_random_uuid(),
  shared_ride_id uuid not null references public.taxi_shared_rides (id) on delete cascade,
  taxi_ride_id uuid not null unique references public.taxi_rides (id) on delete cascade,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  pickup_address text not null,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  dropoff_address text not null,
  dropoff_lat double precision not null,
  dropoff_lng double precision not null,
  segment_order integer not null default 1 check (segment_order >= 1),
  share_discount_cents integer not null default 0 check (share_discount_cents >= 0),
  status text not null default 'waiting_payment'
    check (status in ('waiting_payment', 'paid', 'canceled')),
  created_at timestamptz not null default now()
);

alter table public.taxi_rides
  drop constraint if exists taxi_rides_shared_ride_passenger_id_fkey;

alter table public.taxi_rides
  add constraint taxi_rides_shared_ride_passenger_id_fkey
  foreign key (shared_ride_passenger_id) references public.taxi_shared_ride_passengers (id) on delete set null;

create index if not exists taxi_shared_ride_passengers_ride_idx
  on public.taxi_shared_ride_passengers (shared_ride_id, segment_order);

-- ---------------------------------------------------------------------------
-- 4) taxi_shared_ride_matches
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_shared_ride_matches (
  id uuid primary key default gen_random_uuid(),
  shared_ride_id uuid not null references public.taxi_shared_rides (id) on delete cascade,
  candidate_taxi_ride_id uuid references public.taxi_rides (id) on delete set null,
  match_score numeric(8, 4) not null default 0,
  pickup_distance_miles numeric(8, 4),
  dropoff_distance_miles numeric(8, 4),
  status text not null default 'matched'
    check (status in ('matched', 'rejected', 'expired')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5) Business accounts
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_business_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  active boolean not null default true,
  stripe_customer_id text,
  billing_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.taxi_business_members (
  id uuid primary key default gen_random_uuid(),
  business_account_id uuid not null references public.taxi_business_accounts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'employee'
    check (role in ('employee', 'manager', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint taxi_business_members_account_user_uq unique (business_account_id, user_id)
);

create index if not exists taxi_business_members_user_idx
  on public.taxi_business_members (user_id)
  where active = true;

create table if not exists public.taxi_business_ride_policies (
  id uuid primary key default gen_random_uuid(),
  business_account_id uuid not null unique references public.taxi_business_accounts (id) on delete cascade,
  max_ride_cents integer check (max_ride_cents is null or max_ride_cents > 0),
  max_daily_cents integer check (max_daily_cents is null or max_daily_cents > 0),
  max_weekly_cents integer check (max_weekly_cents is null or max_weekly_cents > 0),
  allowed_start_time time,
  allowed_end_time time,
  requires_manager_approval boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.taxi_business_billing_events (
  id uuid primary key default gen_random_uuid(),
  business_account_id uuid not null references public.taxi_business_accounts (id) on delete cascade,
  taxi_ride_id uuid not null references public.taxi_rides (id) on delete cascade,
  member_user_id uuid not null references auth.users (id) on delete cascade,
  amount_cents integer not null check (amount_cents >= 0),
  event_type text not null
    check (event_type in ('ride_authorized', 'ride_paid', 'ride_refunded', 'ride_rejected')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists taxi_business_billing_events_account_idx
  on public.taxi_business_billing_events (business_account_id, created_at desc);

alter table public.taxi_rides
  drop constraint if exists taxi_rides_business_account_id_fkey;

alter table public.taxi_rides
  add constraint taxi_rides_business_account_id_fkey
  foreign key (business_account_id) references public.taxi_business_accounts (id) on delete set null;

alter table public.taxi_rides
  drop constraint if exists taxi_rides_business_member_id_fkey;

alter table public.taxi_rides
  add constraint taxi_rides_business_member_id_fkey
  foreign key (business_member_id) references public.taxi_business_members (id) on delete set null;

drop trigger if exists trg_taxi_business_accounts_updated_at on public.taxi_business_accounts;
create trigger trg_taxi_business_accounts_updated_at
before update on public.taxi_business_accounts
for each row execute function public.taxi_set_updated_at();

drop trigger if exists trg_taxi_business_ride_policies_updated_at on public.taxi_business_ride_policies;
create trigger trg_taxi_business_ride_policies_updated_at
before update on public.taxi_business_ride_policies
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 6) Premium driver quality
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_driver_quality_scores (
  user_id uuid primary key references auth.users (id) on delete cascade,
  quality_score numeric(6, 2) not null default 0,
  completed_rides integer not null default 0 check (completed_rides >= 0),
  canceled_rides integer not null default 0 check (canceled_rides >= 0),
  cancel_rate numeric(6, 4) not null default 0,
  avg_rating numeric(4, 2),
  premium_active boolean not null default false,
  premium_manual_override boolean,
  documents_ok boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.taxi_driver_quality_events (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null,
  delta_score numeric(6, 2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists taxi_driver_quality_events_driver_idx
  on public.taxi_driver_quality_events (driver_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 7) Helpers
-- ---------------------------------------------------------------------------

create or replace function public.taxi_haversine_miles(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns numeric
language sql
immutable
as $$
  select (
    3958.8 * 2 * atan2(
      sqrt(
        power(sin(radians(p_lat2 - p_lat1) / 2), 2)
        + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
      ),
      sqrt(
        1 - (
          power(sin(radians(p_lat2 - p_lat1) / 2), 2)
          + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
        )
      )
    )
  )::numeric;
$$;

create or replace function public.is_taxi_business_member(
  p_user_id uuid,
  p_business_account_id uuid,
  p_roles text[] default array['employee', 'manager', 'admin']
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.taxi_business_members m
    join public.taxi_business_accounts a on a.id = m.business_account_id
    where m.user_id = p_user_id
      and m.business_account_id = p_business_account_id
      and m.active = true
      and a.active = true
      and m.role = any (p_roles)
  );
$$;

create or replace function public.validate_taxi_business_ride(
  p_user_id uuid,
  p_business_account_id uuid,
  p_amount_cents integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_policy public.taxi_business_ride_policies%rowtype;
  v_daily_spent integer := 0;
  v_weekly_spent integer := 0;
  v_now time := (now() at time zone 'utc')::time;
begin
  if p_user_id is null or p_business_account_id is null then
    return jsonb_build_object('ok', false, 'message', 'missing_params');
  end if;

  if not public.is_taxi_business_member(p_user_id, p_business_account_id) then
    return jsonb_build_object('ok', false, 'message', 'not_a_business_member');
  end if;

  select *
  into v_policy
  from public.taxi_business_ride_policies p
  where p.business_account_id = p_business_account_id
    and p.active = true;

  if not found then
    return jsonb_build_object('ok', true, 'requires_approval', false);
  end if;

  if v_policy.max_ride_cents is not null and p_amount_cents > v_policy.max_ride_cents then
    return jsonb_build_object('ok', false, 'message', 'exceeds_max_ride_cents');
  end if;

  if v_policy.allowed_start_time is not null and v_policy.allowed_end_time is not null then
    if v_now < v_policy.allowed_start_time or v_now > v_policy.allowed_end_time then
      return jsonb_build_object('ok', false, 'message', 'outside_allowed_hours');
    end if;
  end if;

  select coalesce(sum(e.amount_cents), 0)
  into v_daily_spent
  from public.taxi_business_billing_events e
  where e.business_account_id = p_business_account_id
    and e.member_user_id = p_user_id
    and e.event_type in ('ride_authorized', 'ride_paid')
    and e.created_at >= date_trunc('day', now());

  if v_policy.max_daily_cents is not null and (v_daily_spent + p_amount_cents) > v_policy.max_daily_cents then
    return jsonb_build_object('ok', false, 'message', 'exceeds_daily_limit');
  end if;

  select coalesce(sum(e.amount_cents), 0)
  into v_weekly_spent
  from public.taxi_business_billing_events e
  where e.business_account_id = p_business_account_id
    and e.member_user_id = p_user_id
    and e.event_type in ('ride_authorized', 'ride_paid')
    and e.created_at >= date_trunc('week', now());

  if v_policy.max_weekly_cents is not null and (v_weekly_spent + p_amount_cents) > v_policy.max_weekly_cents then
    return jsonb_build_object('ok', false, 'message', 'exceeds_weekly_limit');
  end if;

  return jsonb_build_object(
    'ok', true,
    'requires_approval', coalesce(v_policy.requires_manager_approval, false)
  );
end;
$$;

create or replace function public.record_taxi_business_billing_event(
  p_business_account_id uuid,
  p_taxi_ride_id uuid,
  p_member_user_id uuid,
  p_amount_cents integer,
  p_event_type text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.taxi_business_billing_events (
    business_account_id,
    taxi_ride_id,
    member_user_id,
    amount_cents,
    event_type,
    metadata
  )
  values (
    p_business_account_id,
    p_taxi_ride_id,
    p_member_user_id,
    greatest(0, coalesce(p_amount_cents, 0)),
    p_event_type,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Shared ride RPCs
-- ---------------------------------------------------------------------------

create or replace function public.apply_taxi_shared_ride_discounts(p_shared_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shared public.taxi_shared_rides%rowtype;
  v_passenger record;
  v_discount integer;
begin
  select *
  into v_shared
  from public.taxi_shared_rides
  where id = p_shared_ride_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'shared_ride_not_found');
  end if;

  for v_passenger in
    select p.*, r.gross_total_cents, r.id as ride_id
    from public.taxi_shared_ride_passengers p
    join public.taxi_rides r on r.id = p.taxi_ride_id
    where p.shared_ride_id = p_shared_ride_id
      and p.status <> 'canceled'
  loop
    v_discount := greatest(
      0,
      round(coalesce(v_passenger.gross_total_cents, 0) * v_shared.discount_percent / 100.0)
    );

    update public.taxi_shared_ride_passengers
    set share_discount_cents = v_discount
    where id = v_passenger.id;

    update public.taxi_rides
    set
      shared_discount_cents = v_discount,
      is_shared_ride = true,
      shared_ride_id = p_shared_ride_id,
      shared_ride_passenger_id = v_passenger.id,
      updated_at = now()
    where id = v_passenger.ride_id;

    perform public.recalculate_taxi_ride_totals(v_passenger.ride_id);
  end loop;

  return jsonb_build_object('ok', true, 'passenger_count', v_shared.passenger_count);
end;
$$;

create or replace function public.create_or_join_taxi_shared_ride(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.taxi_rides%rowtype;
  v_match public.taxi_shared_rides%rowtype;
  v_shared_id uuid;
  v_passenger_id uuid;
  v_pickup_dist numeric;
  v_dropoff_dist numeric;
  v_match_score numeric;
begin
  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if v_ride.is_shared_ride and v_ride.shared_ride_id is not null then
    return jsonb_build_object('ok', true, 'shared_ride_id', v_ride.shared_ride_id, 'joined', false);
  end if;

  select sr.*
  into v_match
  from public.taxi_shared_rides sr
  where sr.status in ('open', 'matching')
    and sr.window_expires_at > now()
    and sr.passenger_count < sr.max_passengers
    and public.taxi_haversine_miles(sr.pickup_lat, sr.pickup_lng, v_ride.pickup_lat, v_ride.pickup_lng) <= 0.5
    and public.taxi_haversine_miles(sr.dropoff_lat, sr.dropoff_lng, v_ride.dropoff_lat, v_ride.dropoff_lng) <= 0.5
  order by sr.created_at asc
  limit 1
  for update skip locked;

  if found then
    v_shared_id := v_match.id;
    v_pickup_dist := public.taxi_haversine_miles(
      v_match.pickup_lat, v_match.pickup_lng, v_ride.pickup_lat, v_ride.pickup_lng
    );
    v_dropoff_dist := public.taxi_haversine_miles(
      v_match.dropoff_lat, v_match.dropoff_lng, v_ride.dropoff_lat, v_ride.dropoff_lng
    );
    v_match_score := greatest(0, 1 - ((v_pickup_dist + v_dropoff_dist) / 1.0));

    insert into public.taxi_shared_ride_matches (
      shared_ride_id,
      candidate_taxi_ride_id,
      match_score,
      pickup_distance_miles,
      dropoff_distance_miles,
      status
    )
    values (
      v_shared_id,
      p_ride_id,
      v_match_score,
      v_pickup_dist,
      v_dropoff_dist,
      'matched'
    );

    insert into public.taxi_shared_ride_passengers (
      shared_ride_id,
      taxi_ride_id,
      client_user_id,
      pickup_address,
      pickup_lat,
      pickup_lng,
      dropoff_address,
      dropoff_lat,
      dropoff_lng,
      segment_order
    )
    values (
      v_shared_id,
      p_ride_id,
      v_ride.client_user_id,
      v_ride.pickup_address,
      v_ride.pickup_lat,
      v_ride.pickup_lng,
      v_ride.dropoff_address,
      v_ride.dropoff_lat,
      v_ride.dropoff_lng,
      v_match.passenger_count + 1
    )
    returning id into v_passenger_id;

    update public.taxi_shared_rides
    set
      passenger_count = passenger_count + 1,
      status = case when passenger_count + 1 >= max_passengers then 'locked' else 'matching' end,
      updated_at = now()
    where id = v_shared_id;

    perform public.apply_taxi_shared_ride_discounts(v_shared_id);

    return jsonb_build_object(
      'ok', true,
      'shared_ride_id', v_shared_id,
      'shared_ride_passenger_id', v_passenger_id,
      'joined', true,
      'primary_taxi_ride_id', v_match.primary_taxi_ride_id
    );
  end if;

  insert into public.taxi_shared_rides (
    status,
    pickup_lat,
    pickup_lng,
    dropoff_lat,
    dropoff_lng,
    window_expires_at,
    primary_taxi_ride_id
  )
  values (
    'open',
    v_ride.pickup_lat,
    v_ride.pickup_lng,
    v_ride.dropoff_lat,
    v_ride.dropoff_lng,
    now() + interval '15 minutes',
    p_ride_id
  )
  returning id into v_shared_id;

  insert into public.taxi_shared_ride_passengers (
    shared_ride_id,
    taxi_ride_id,
    client_user_id,
    pickup_address,
    pickup_lat,
    pickup_lng,
    dropoff_address,
    dropoff_lat,
    dropoff_lng,
    segment_order
  )
  values (
    v_shared_id,
    p_ride_id,
    v_ride.client_user_id,
    v_ride.pickup_address,
    v_ride.pickup_lat,
    v_ride.pickup_lng,
    v_ride.dropoff_address,
    v_ride.dropoff_lat,
    v_ride.dropoff_lng,
    1
  )
  returning id into v_passenger_id;

  update public.taxi_shared_rides
  set passenger_count = 1
  where id = v_shared_id;

  perform public.apply_taxi_shared_ride_discounts(v_shared_id);

  return jsonb_build_object(
    'ok', true,
    'shared_ride_id', v_shared_id,
    'shared_ride_passenger_id', v_passenger_id,
    'joined', false,
    'primary_taxi_ride_id', p_ride_id
  );
end;
$$;

create or replace function public.all_taxi_shared_passengers_paid(p_shared_ride_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.taxi_shared_ride_passengers p
    join public.taxi_rides r on r.id = p.taxi_ride_id
    where p.shared_ride_id = p_shared_ride_id
      and p.status <> 'canceled'
      and lower(coalesce(r.payment_status, '')) <> 'paid'
  );
$$;

create or replace function public.sync_taxi_shared_ride_driver(
  p_primary_ride_id uuid,
  p_driver_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shared_id uuid;
  v_status text;
begin
  select shared_ride_id, status
  into v_shared_id, v_status
  from public.taxi_rides
  where id = p_primary_ride_id;

  if v_shared_id is null then
    return jsonb_build_object('ok', true, 'synced', 0);
  end if;

  update public.taxi_shared_rides
  set driver_id = p_driver_id, status = 'in_progress', updated_at = now()
  where id = v_shared_id;

  update public.taxi_rides r
  set
    driver_id = p_driver_id,
    status = case
      when lower(r.status) in ('paid', 'dispatching') then 'accepted'
      else r.status
    end,
    updated_at = now()
  from public.taxi_shared_ride_passengers p
  where p.shared_ride_id = v_shared_id
    and p.taxi_ride_id = r.id
    and r.id <> p_primary_ride_id
    and r.driver_id is null;

  return jsonb_build_object('ok', true, 'shared_ride_id', v_shared_id);
end;
$$;

create or replace function public.mark_taxi_shared_passenger_paid(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.taxi_rides%rowtype;
  v_primary_id uuid;
begin
  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id;

  if not found or v_ride.shared_ride_id is null then
    return jsonb_build_object('ok', true, 'is_shared', false);
  end if;

  update public.taxi_shared_ride_passengers
  set status = 'paid'
  where taxi_ride_id = p_ride_id;

  select primary_taxi_ride_id
  into v_primary_id
  from public.taxi_shared_rides
  where id = v_ride.shared_ride_id;

  if public.all_taxi_shared_passengers_paid(v_ride.shared_ride_id) then
    update public.taxi_shared_rides
    set status = 'locked', updated_at = now()
    where id = v_ride.shared_ride_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'is_shared', true,
    'shared_ride_id', v_ride.shared_ride_id,
    'primary_taxi_ride_id', v_primary_id,
    'all_paid', public.all_taxi_shared_passengers_paid(v_ride.shared_ride_id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) Premium driver quality
-- ---------------------------------------------------------------------------

create or replace function public.refresh_taxi_driver_quality_score(p_driver_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed integer := 0;
  v_canceled integer := 0;
  v_cancel_rate numeric := 0;
  v_features public.taxi_driver_features%rowtype;
  v_docs_ok boolean := false;
  v_premium boolean := false;
  v_score numeric := 0;
  v_existing public.taxi_driver_quality_scores%rowtype;
begin
  if p_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'missing_driver');
  end if;

  select count(*) filter (where lower(status) = 'completed'),
         count(*) filter (where lower(status) = 'canceled' and cancelled_by = 'driver')
  into v_completed, v_canceled
  from public.taxi_rides
  where driver_id = p_driver_id;

  if (v_completed + v_canceled) > 0 then
    v_cancel_rate := v_canceled::numeric / (v_completed + v_canceled)::numeric;
  end if;

  select *
  into v_features
  from public.taxi_driver_features
  where user_id = p_driver_id;

  v_docs_ok := coalesce(v_features.taxi_enabled, false)
    and exists (
      select 1
      from public.driver_profiles dp
      where dp.user_id = p_driver_id
        and lower(coalesce(dp.status, '')) = 'approved'
    );

  v_score := least(100, greatest(0,
    (least(v_completed, 500)::numeric / 5.0)
    + (case when v_cancel_rate <= 0.05 then 25 when v_cancel_rate <= 0.10 then 10 else 0 end)
    + (case when coalesce(v_features.premium_eligible, false) then 10 else 0 end)
    + (case when v_docs_ok then 10 else 0 end)
  ));

  select *
  into v_existing
  from public.taxi_driver_quality_scores
  where user_id = p_driver_id;

  if not found then
    v_existing.premium_manual_override := null;
  end if;

  if v_existing.premium_manual_override is not null then
    v_premium := v_existing.premium_manual_override;
  else
    v_premium := coalesce(v_features.premium_eligible, false)
      and v_completed >= 50
      and v_cancel_rate <= 0.08
      and v_docs_ok;
  end if;

  insert into public.taxi_driver_quality_scores (
    user_id,
    quality_score,
    completed_rides,
    canceled_rides,
    cancel_rate,
    premium_active,
    premium_manual_override,
    documents_ok,
    updated_at
  )
  values (
    p_driver_id,
    v_score,
    v_completed,
    v_canceled,
    v_cancel_rate,
    v_premium,
    v_existing.premium_manual_override,
    v_docs_ok,
    now()
  )
  on conflict (user_id) do update
  set
    quality_score = excluded.quality_score,
    completed_rides = excluded.completed_rides,
    canceled_rides = excluded.canceled_rides,
    cancel_rate = excluded.cancel_rate,
    premium_active = excluded.premium_active,
    documents_ok = excluded.documents_ok,
    updated_at = now();

  return jsonb_build_object('ok', true, 'quality_score', v_score, 'premium_active', v_premium);
end;
$$;

create or replace function public.admin_set_taxi_driver_premium(
  p_driver_id uuid,
  p_premium_active boolean,
  p_admin_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.taxi_driver_quality_scores (user_id, premium_active, premium_manual_override)
  values (p_driver_id, p_premium_active, p_premium_active)
  on conflict (user_id) do update
  set
    premium_active = p_premium_active,
    premium_manual_override = p_premium_active,
    updated_at = now();

  update public.taxi_driver_features
  set premium_eligible = p_premium_active, updated_at = now()
  where user_id = p_driver_id;

  insert into public.taxi_driver_quality_events (
    driver_user_id,
    event_type,
    delta_score,
    metadata
  )
  values (
    p_driver_id,
    case when p_premium_active then 'premium_promoted' else 'premium_demoted' end,
    0,
    jsonb_build_object('admin_id', p_admin_id)
  );

  return jsonb_build_object('ok', true, 'premium_active', p_premium_active);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10) Update is_taxi_driver_eligible for premium driver rides
-- ---------------------------------------------------------------------------

drop function if exists public.is_taxi_driver_eligible(uuid, text);

create or replace function public.is_taxi_driver_eligible(
  p_user_id uuid default auth.uid(),
  p_vehicle_class text default 'standard',
  p_require_premium_driver boolean default false
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
  v_quality public.taxi_driver_quality_scores%rowtype;
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

  if p_require_premium_driver then
    if coalesce(v_features.premium_eligible, false) is not true then
      return false;
    end if;

    select *
    into v_quality
    from public.taxi_driver_quality_scores
    where user_id = p_user_id;

    if not found or coalesce(v_quality.premium_active, false) is not true then
      return false;
    end if;
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

-- ---------------------------------------------------------------------------
-- 11) Update recalculate_taxi_ride_totals (shared discount)
-- ---------------------------------------------------------------------------

create or replace function public.recalculate_taxi_ride_totals(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.taxi_rides%rowtype;
  v_gross integer;
  v_promo_discount integer := 0;
  v_loyalty_discount integer := 0;
  v_shared_discount integer := 0;
  v_total_discount integer;
  v_new_total integer;
  v_new_driver integer;
  v_new_platform integer;
  v_driver_share numeric := 75;
begin
  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if v_ride.pricing_snapshot_id is not null then
    select tp.driver_share_pct
    into v_driver_share
    from public.taxi_pricing tp
    where tp.id = v_ride.pricing_snapshot_id;
  elsif v_ride.subtotal_cents > 0 then
    v_driver_share := (v_ride.driver_payout_cents::numeric / v_ride.subtotal_cents::numeric) * 100;
  end if;

  v_gross := coalesce(
    v_ride.gross_total_cents,
    v_ride.total_cents + coalesce(v_ride.discount_cents, 0)
      + coalesce(v_ride.loyalty_discount_cents, 0)
      + coalesce(v_ride.shared_discount_cents, 0)
  );
  if v_gross <= 0 then
    v_gross := greatest(v_ride.total_cents, 0);
  end if;

  v_promo_discount := greatest(0, coalesce(v_ride.discount_cents, 0));
  v_loyalty_discount := greatest(0, coalesce(v_ride.loyalty_discount_cents, 0));
  v_shared_discount := greatest(0, coalesce(v_ride.shared_discount_cents, 0));
  v_total_discount := v_promo_discount + v_loyalty_discount + v_shared_discount;
  v_new_total := greatest(0, v_gross - v_total_discount);

  v_new_driver := greatest(0, round(v_new_total * v_driver_share / 100.0));
  v_new_platform := greatest(0, v_new_total - v_new_driver);

  update public.taxi_rides
  set
    gross_total_cents = v_gross,
    total_cents = v_new_total,
    driver_payout_cents = v_new_driver,
    platform_fee_cents = v_new_platform,
    updated_at = now()
  where id = p_ride_id;

  return jsonb_build_object(
    'ok', true,
    'gross_total_cents', v_gross,
    'discount_cents', v_promo_discount,
    'loyalty_discount_cents', v_loyalty_discount,
    'shared_discount_cents', v_shared_discount,
    'total_cents', v_new_total
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 12) RLS
-- ---------------------------------------------------------------------------

alter table public.taxi_shared_rides enable row level security;
alter table public.taxi_shared_ride_passengers enable row level security;
alter table public.taxi_shared_ride_matches enable row level security;
alter table public.taxi_business_accounts enable row level security;
alter table public.taxi_business_members enable row level security;
alter table public.taxi_business_ride_policies enable row level security;
alter table public.taxi_business_billing_events enable row level security;
alter table public.taxi_driver_quality_scores enable row level security;
alter table public.taxi_driver_quality_events enable row level security;

create policy taxi_shared_rides_select_participant
on public.taxi_shared_rides for select to authenticated
using (
  exists (
    select 1
    from public.taxi_shared_ride_passengers p
    where p.shared_ride_id = taxi_shared_rides.id
      and p.client_user_id = auth.uid()
  )
  or exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and lower(coalesce(pr.role, '')) in ('admin', 'ops', 'finance', 'support')
  )
  or driver_id = auth.uid()
);

create policy taxi_shared_passengers_select_own
on public.taxi_shared_ride_passengers for select to authenticated
using (
  client_user_id = auth.uid()
  or exists (
    select 1 from public.taxi_shared_rides sr
    where sr.id = shared_ride_id and sr.driver_id = auth.uid()
  )
  or exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and lower(coalesce(pr.role, '')) in ('admin', 'ops', 'finance', 'support')
  )
);

create policy taxi_shared_passengers_select_business_admin
on public.taxi_shared_ride_passengers for select to authenticated
using (
  exists (
    select 1
    from public.taxi_business_members bm
    where bm.user_id = auth.uid()
      and bm.active = true
      and bm.role in ('manager', 'admin')
  )
);

create policy taxi_business_members_select_own
on public.taxi_business_members for select to authenticated
using (user_id = auth.uid());

create policy taxi_business_accounts_select_member
on public.taxi_business_accounts for select to authenticated
using (
  exists (
    select 1 from public.taxi_business_members m
    where m.business_account_id = taxi_business_accounts.id
      and m.user_id = auth.uid()
      and m.active = true
  )
  or exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and lower(coalesce(pr.role, '')) in ('admin', 'ops', 'finance', 'support')
  )
);

create policy taxi_business_billing_select_member
on public.taxi_business_billing_events for select to authenticated
using (
  member_user_id = auth.uid()
  or public.is_taxi_business_member(auth.uid(), business_account_id, array['manager', 'admin'])
  or exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and lower(coalesce(pr.role, '')) in ('admin', 'ops', 'finance', 'support')
  )
);

create policy taxi_driver_quality_select_authenticated
on public.taxi_driver_quality_scores for select to authenticated
using (true);

create policy taxi_driver_quality_events_select_own
on public.taxi_driver_quality_events for select to authenticated
using (
  driver_user_id = auth.uid()
  or exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and lower(coalesce(pr.role, '')) in ('admin', 'ops', 'finance', 'support')
  )
);

-- ---------------------------------------------------------------------------
-- 13) Grants
-- ---------------------------------------------------------------------------

revoke all on function public.is_taxi_driver_eligible(uuid, text, boolean) from public;
grant execute on function public.is_taxi_driver_eligible(uuid, text, boolean) to authenticated;

revoke all on function public.create_or_join_taxi_shared_ride(uuid) from public;
revoke all on function public.validate_taxi_business_ride(uuid, uuid, integer) from public;
revoke all on function public.refresh_taxi_driver_quality_score(uuid) from public;
revoke all on function public.admin_set_taxi_driver_premium(uuid, boolean, uuid) from public;
revoke all on function public.mark_taxi_shared_passenger_paid(uuid) from public;
revoke all on function public.sync_taxi_shared_ride_driver(uuid, uuid) from public;

-- ---------------------------------------------------------------------------
-- 14) mark_taxi_ride_paid — shared + business billing
-- ---------------------------------------------------------------------------

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
  v_ride public.taxi_rides%rowtype;
  v_old_status text;
  v_now timestamptz := now();
  v_promo jsonb;
  v_loyalty jsonb;
  v_new_status text;
  v_revalidate jsonb;
  v_shared jsonb;
begin
  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if lower(coalesce(v_ride.status, '')) in ('canceled', 'completed') then
    return jsonb_build_object('ok', false, 'message', 'ride_not_payable');
  end if;

  if lower(coalesce(v_ride.payment_status, '')) = 'paid' then
    return jsonb_build_object(
      'ok', true,
      'already', true,
      'taxi_ride_id', p_ride_id,
      'payment_status', 'paid'
    );
  end if;

  if v_ride.promo_code is not null then
    v_revalidate := public.validate_taxi_promotion(
      v_ride.promo_code,
      v_ride.client_user_id,
      coalesce(v_ride.gross_total_cents, v_ride.total_cents),
      p_ride_id,
      v_ride.vehicle_class,
      v_ride.country_code,
      v_ride.currency
    );
    if coalesce((v_revalidate->>'ok')::boolean, false) is not true then
      perform public.release_taxi_loyalty_redemption(p_ride_id);
      return v_revalidate;
    end if;
  end if;

  v_old_status := v_ride.status;
  v_new_status := case
    when v_ride.is_scheduled then 'scheduled'
    when v_old_status in ('draft', 'quoted', 'pending_payment') then 'paid'
    else v_old_status
  end;

  update public.taxi_rides
  set
    payment_status = 'paid',
    paid_at = coalesce(paid_at, v_now),
    status = v_new_status,
    stripe_session_id = coalesce(p_session_id, stripe_session_id),
    stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
    updated_at = v_now
  where id = p_ride_id;

  v_promo := public.finalize_taxi_promotion_redemption(p_ride_id);
  v_loyalty := public.finalize_taxi_loyalty_redemption(p_ride_id);

  if v_ride.business_trip_type = 'business' and v_ride.business_account_id is not null then
    perform public.record_taxi_business_billing_event(
      v_ride.business_account_id,
      p_ride_id,
      v_ride.client_user_id,
      v_ride.total_cents,
      'ride_paid',
      jsonb_build_object(
        'stripe_session_id', p_session_id,
        'stripe_payment_intent_id', p_payment_intent_id
      )
    );
  end if;

  v_shared := public.mark_taxi_shared_passenger_paid(p_ride_id);

  perform public.log_taxi_event(
    p_ride_id,
    'ride_paid',
    v_old_status,
    v_new_status,
    null,
    'system',
    'Taxi ride marked as paid',
    jsonb_build_object(
      'stripe_session_id', p_session_id,
      'stripe_payment_intent_id', p_payment_intent_id,
      'promotion', v_promo,
      'loyalty', v_loyalty,
      'is_scheduled', v_ride.is_scheduled,
      'shared', v_shared
    )
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', p_ride_id,
    'payment_status', 'paid',
    'status', v_new_status,
    'promotion', v_promo,
    'loyalty', v_loyalty,
    'is_scheduled', v_ride.is_scheduled,
    'shared', v_shared
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 15) driver_accept_taxi_offer — premium + shared sync
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
  v_sync jsonb;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  if exists (
    select 1
    from public.taxi_rides tr
    where tr.driver_id = v_driver_id
      and lower(coalesce(tr.status, '')) in (
        'accepted',
        'driver_arrived',
        'in_progress',
        'dispatching'
      )
  ) then
    return jsonb_build_object(
      'ok', false,
      'message', 'driver_already_has_active_taxi_ride'
    );
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

  if not public.is_taxi_driver_eligible(
    v_driver_id,
    v_ride.vehicle_class,
    coalesce(v_ride.premium_driver_only, false)
  ) then
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

  v_sync := public.sync_taxi_shared_ride_driver(v_ride.id, v_driver_id);

  perform public.log_taxi_event(
    v_ride.id,
    'driver_accepted',
    v_old_status,
    'accepted',
    v_driver_id,
    'driver',
    'Driver accepted taxi offer',
    jsonb_build_object('offer_id', p_offer_id, 'shared_sync', v_sync)
  );

  return jsonb_build_object('ok', true, 'taxi_ride_id', v_ride.id, 'shared_sync', v_sync);
end;
$$;

commit;
