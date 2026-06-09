-- Taxi Premium Sprint 2: scheduled rides, multi-stops, advanced promos, loyalty rewards.

begin;

-- ---------------------------------------------------------------------------
-- 1) Extend taxi_rides status + columns
-- ---------------------------------------------------------------------------

alter table public.taxi_rides drop constraint if exists taxi_rides_status_check;
alter table public.taxi_rides
  add constraint taxi_rides_status_check check (
    status in (
      'draft',
      'quoted',
      'pending_payment',
      'scheduled',
      'paid',
      'dispatching',
      'accepted',
      'driver_arrived',
      'in_progress',
      'completed',
      'canceled'
    )
  );

alter table public.taxi_rides
  add column if not exists is_scheduled boolean not null default false,
  add column if not exists scheduled_pickup_at timestamptz,
  add column if not exists stop_count integer not null default 0 check (stop_count >= 0),
  add column if not exists current_stop_order integer not null default 0 check (current_stop_order >= 0),
  add column if not exists loyalty_reward_id uuid,
  add column if not exists loyalty_redemption_id uuid,
  add column if not exists loyalty_discount_cents integer not null default 0 check (loyalty_discount_cents >= 0);

create index if not exists taxi_rides_scheduled_pickup_idx
  on public.taxi_rides (scheduled_pickup_at)
  where is_scheduled = true;

-- ---------------------------------------------------------------------------
-- 2) taxi_scheduled_rides
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_scheduled_rides (
  id uuid primary key default gen_random_uuid(),
  taxi_ride_id uuid not null unique references public.taxi_rides (id) on delete cascade,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  scheduled_pickup_at timestamptz not null,
  dispatch_lead_minutes integer not null default 15 check (dispatch_lead_minutes >= 5),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'ready', 'dispatched', 'canceled')),
  dispatched_at timestamptz,
  canceled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists taxi_scheduled_rides_dispatch_idx
  on public.taxi_scheduled_rides (scheduled_pickup_at, status)
  where status = 'scheduled';

drop trigger if exists trg_taxi_scheduled_rides_updated_at on public.taxi_scheduled_rides;
create trigger trg_taxi_scheduled_rides_updated_at
before update on public.taxi_scheduled_rides
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) taxi_ride_stops
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_ride_stops (
  id uuid primary key default gen_random_uuid(),
  taxi_ride_id uuid not null references public.taxi_rides (id) on delete cascade,
  stop_order integer not null check (stop_order >= 1 and stop_order <= 3),
  address text not null,
  lat double precision not null,
  lng double precision not null,
  status text not null default 'pending'
    check (status in ('pending', 'arrived', 'completed')),
  arrived_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint taxi_ride_stops_ride_order_uq unique (taxi_ride_id, stop_order)
);

create index if not exists taxi_ride_stops_ride_idx
  on public.taxi_ride_stops (taxi_ride_id, stop_order);

drop trigger if exists trg_taxi_ride_stops_updated_at on public.taxi_ride_stops;
create trigger trg_taxi_ride_stops_updated_at
before update on public.taxi_ride_stops
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4) Advanced taxi_promotions columns
-- ---------------------------------------------------------------------------

alter table public.taxi_promotions
  add column if not exists allowed_vehicle_classes text[],
  add column if not exists min_fare_cents integer check (min_fare_cents is null or min_fare_cents >= 0),
  add column if not exists max_discount_cents integer check (max_discount_cents is null or max_discount_cents > 0),
  add column if not exists first_ride_only boolean not null default false,
  add column if not exists loyalty_tier_required text
    check (loyalty_tier_required is null or loyalty_tier_required in ('bronze', 'silver', 'gold')),
  add column if not exists country_code text,
  add column if not exists currency text;

-- ---------------------------------------------------------------------------
-- 5) taxi_loyalty_rewards + taxi_loyalty_redemptions
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  points_cost integer not null check (points_cost > 0),
  discount_cents integer not null check (discount_cents > 0),
  tier_required text check (tier_required is null or tier_required in ('bronze', 'silver', 'gold')),
  active boolean not null default true,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_taxi_loyalty_rewards_updated_at on public.taxi_loyalty_rewards;
create trigger trg_taxi_loyalty_rewards_updated_at
before update on public.taxi_loyalty_rewards
for each row execute function public.taxi_set_updated_at();

create table if not exists public.taxi_loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  reward_id uuid not null references public.taxi_loyalty_rewards (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  taxi_ride_id uuid references public.taxi_rides (id) on delete set null,
  points_spent integer not null check (points_spent > 0),
  discount_cents integer not null check (discount_cents >= 0),
  status text not null default 'reserved'
    check (status in ('reserved', 'applied', 'released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists taxi_loyalty_redemptions_ride_reserved_uq
  on public.taxi_loyalty_redemptions (taxi_ride_id)
  where status in ('reserved', 'applied') and taxi_ride_id is not null;

create index if not exists taxi_loyalty_redemptions_user_idx
  on public.taxi_loyalty_redemptions (user_id, created_at desc);

drop trigger if exists trg_taxi_loyalty_redemptions_updated_at on public.taxi_loyalty_redemptions;
create trigger trg_taxi_loyalty_redemptions_updated_at
before update on public.taxi_loyalty_redemptions
for each row execute function public.taxi_set_updated_at();

alter table public.taxi_rides
  drop constraint if exists taxi_rides_loyalty_reward_id_fkey;
alter table public.taxi_rides
  add constraint taxi_rides_loyalty_reward_id_fkey
  foreign key (loyalty_reward_id) references public.taxi_loyalty_rewards (id) on delete set null;

alter table public.taxi_rides
  drop constraint if exists taxi_rides_loyalty_redemption_id_fkey;
alter table public.taxi_rides
  add constraint taxi_rides_loyalty_redemption_id_fkey
  foreign key (loyalty_redemption_id) references public.taxi_loyalty_redemptions (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 6) Helpers — recalculate totals (promo + reward)
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
    v_ride.total_cents + coalesce(v_ride.discount_cents, 0) + coalesce(v_ride.loyalty_discount_cents, 0)
  );
  if v_gross <= 0 then
    v_gross := greatest(v_ride.total_cents, 0);
  end if;

  v_promo_discount := greatest(0, coalesce(v_ride.discount_cents, 0));
  v_loyalty_discount := greatest(0, coalesce(v_ride.loyalty_discount_cents, 0));
  v_total_discount := v_promo_discount + v_loyalty_discount;
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
    'total_cents', v_new_total
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Advanced promotion validation
-- ---------------------------------------------------------------------------

drop function if exists public.validate_taxi_promotion(text, uuid, integer, uuid);

create or replace function public.validate_taxi_promotion(
  p_code text,
  p_user_id uuid,
  p_total_cents integer default null,
  p_ride_id uuid default null,
  p_vehicle_class text default null,
  p_country_code text default null,
  p_currency text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_promo public.taxi_promotions%rowtype;
  v_ride public.taxi_rides%rowtype;
  v_now timestamptz := now();
  v_user_count integer := 0;
  v_discount integer := 0;
  v_code text := upper(trim(coalesce(p_code, '')));
  v_vehicle text := lower(trim(coalesce(p_vehicle_class, '')));
  v_country text := upper(trim(coalesce(p_country_code, '')));
  v_currency text := upper(trim(coalesce(p_currency, '')));
  v_tier text := 'bronze';
  v_fare_basis integer;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'message', 'missing_user');
  end if;

  if v_code = '' then
    return jsonb_build_object('ok', false, 'message', 'missing_code');
  end if;

  if p_ride_id is not null then
    select * into v_ride from public.taxi_rides where id = p_ride_id;
    if found then
      v_vehicle := coalesce(nullif(v_vehicle, ''), lower(v_ride.vehicle_class));
      v_country := coalesce(nullif(v_country, ''), upper(v_ride.country_code));
      v_currency := coalesce(nullif(v_currency, ''), upper(v_ride.currency));
      v_fare_basis := coalesce(v_ride.gross_total_cents, v_ride.total_cents);
    end if;
  end if;

  v_fare_basis := coalesce(p_total_cents, v_fare_basis, 0);

  select *
  into v_promo
  from public.taxi_promotions
  where upper(code) = v_code;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'promotion_not_found');
  end if;

  if not v_promo.active then
    return jsonb_build_object('ok', false, 'message', 'promotion_inactive');
  end if;

  if v_promo.starts_at > v_now then
    return jsonb_build_object('ok', false, 'message', 'promotion_not_started');
  end if;

  if v_promo.ends_at is not null and v_promo.ends_at < v_now then
    return jsonb_build_object('ok', false, 'message', 'promotion_expired');
  end if;

  if v_promo.country_code is not null and v_country <> '' and upper(v_promo.country_code) <> v_country then
    return jsonb_build_object('ok', false, 'message', 'promotion_country_mismatch');
  end if;

  if v_promo.currency is not null and v_currency <> '' and upper(v_promo.currency) <> v_currency then
    return jsonb_build_object('ok', false, 'message', 'promotion_currency_mismatch');
  end if;

  if v_promo.allowed_vehicle_classes is not null
    and array_length(v_promo.allowed_vehicle_classes, 1) > 0
    and v_vehicle <> ''
    and not (v_vehicle = any (select lower(unnest(v_promo.allowed_vehicle_classes)))) then
    return jsonb_build_object('ok', false, 'message', 'promotion_vehicle_class_mismatch');
  end if;

  if v_promo.min_fare_cents is not null and v_fare_basis < v_promo.min_fare_cents then
    return jsonb_build_object('ok', false, 'message', 'promotion_min_fare_not_met');
  end if;

  if v_promo.max_redemptions is not null
    and v_promo.redemption_count >= v_promo.max_redemptions then
    return jsonb_build_object('ok', false, 'message', 'promotion_max_usage_reached');
  end if;

  select count(*)
  into v_user_count
  from public.taxi_promotion_redemptions r
  where r.promotion_id = v_promo.id
    and r.user_id = p_user_id;

  if v_promo.max_redemptions_per_user is not null
    and v_user_count >= v_promo.max_redemptions_per_user then
    return jsonb_build_object('ok', false, 'message', 'promotion_user_max_usage_reached');
  end if;

  if v_promo.promotion_type = 'first_ride' or v_promo.first_ride_only then
    if exists (
      select 1
      from public.taxi_rides tr
      where tr.client_user_id = p_user_id
        and lower(coalesce(tr.payment_status, '')) = 'paid'
        and (p_ride_id is null or tr.id <> p_ride_id)
    ) then
      return jsonb_build_object('ok', false, 'message', 'first_ride_not_eligible');
    end if;
  end if;

  if v_promo.loyalty_tier_required is not null then
    select coalesce(tla.tier, 'bronze')
    into v_tier
    from public.taxi_loyalty_accounts tla
    where tla.user_id = p_user_id;

    if v_tier is null then
      v_tier := 'bronze';
    end if;

    if v_tier <> v_promo.loyalty_tier_required
      and not (
        (v_promo.loyalty_tier_required = 'silver' and v_tier = 'gold')
        or (v_promo.loyalty_tier_required = 'bronze' and v_tier in ('silver', 'gold'))
      ) then
      return jsonb_build_object('ok', false, 'message', 'promotion_tier_not_eligible');
    end if;
  end if;

  if v_fare_basis > 0 then
    if v_promo.promotion_type = 'percent' or (
      v_promo.promotion_type = 'first_ride' and v_promo.discount_percent is not null
    ) then
      v_discount := round(v_fare_basis * (v_promo.discount_percent / 100.0));
    elsif v_promo.promotion_type = 'fixed' or (
      v_promo.promotion_type = 'first_ride' and v_promo.discount_cents is not null
    ) then
      v_discount := v_promo.discount_cents;
    end if;

    v_discount := least(v_fare_basis, greatest(0, v_discount));

    if v_promo.max_discount_cents is not null then
      v_discount := least(v_discount, v_promo.max_discount_cents);
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'promotion_id', v_promo.id,
    'code', v_promo.code,
    'promotion_type', v_promo.promotion_type,
    'discount_cents', v_discount,
    'discount_percent', v_promo.discount_percent,
    'fixed_discount_cents', v_promo.discount_cents
  );
end;
$$;

create or replace function public.apply_taxi_promotion_to_ride(
  p_ride_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.taxi_rides%rowtype;
  v_validation jsonb;
  v_discount integer;
begin
  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if lower(coalesce(v_ride.payment_status, '')) <> 'unpaid' then
    return jsonb_build_object('ok', false, 'message', 'ride_not_editable');
  end if;

  if lower(coalesce(v_ride.status, '')) not in ('quoted', 'draft', 'pending_payment', 'scheduled') then
    return jsonb_build_object('ok', false, 'message', 'ride_not_editable');
  end if;

  v_validation := public.validate_taxi_promotion(
    p_code,
    v_ride.client_user_id,
    coalesce(v_ride.gross_total_cents, v_ride.total_cents),
    p_ride_id,
    v_ride.vehicle_class,
    v_ride.country_code,
    v_ride.currency
  );

  if coalesce((v_validation->>'ok')::boolean, false) is not true then
    return v_validation;
  end if;

  v_discount := greatest(0, coalesce((v_validation->>'discount_cents')::integer, 0));

  update public.taxi_rides
  set
    gross_total_cents = coalesce(gross_total_cents, total_cents + discount_cents + loyalty_discount_cents),
    discount_cents = v_discount,
    promotion_id = (v_validation->>'promotion_id')::uuid,
    promo_code = v_validation->>'code',
    updated_at = now()
  where id = p_ride_id;

  perform public.recalculate_taxi_ride_totals(p_ride_id);

  perform public.log_taxi_event(
    p_ride_id,
    'promotion_applied',
    v_ride.status,
    v_ride.status,
    v_ride.client_user_id,
    'client',
    'Taxi promotion applied to ride',
    v_validation
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', p_ride_id,
    'promotion_id', v_validation->>'promotion_id',
    'code', v_validation->>'code',
    'discount_cents', v_discount
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Loyalty rewards RPCs
-- ---------------------------------------------------------------------------

create or replace function public.apply_taxi_loyalty_reward_to_ride(
  p_ride_id uuid,
  p_reward_id uuid,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.taxi_rides%rowtype;
  v_reward public.taxi_loyalty_rewards%rowtype;
  v_account public.taxi_loyalty_accounts;
  v_user_id uuid := coalesce(p_user_id, auth.uid());
  v_redemption_id uuid;
  v_new_balance integer;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if v_ride.client_user_id <> v_user_id then
    return jsonb_build_object('ok', false, 'message', 'forbidden');
  end if;

  if lower(coalesce(v_ride.payment_status, '')) <> 'unpaid' then
    return jsonb_build_object('ok', false, 'message', 'ride_not_editable');
  end if;

  select *
  into v_reward
  from public.taxi_loyalty_rewards
  where id = p_reward_id;

  if not found or not v_reward.active then
    return jsonb_build_object('ok', false, 'message', 'reward_not_available');
  end if;

  if v_reward.max_redemptions is not null
    and v_reward.redemption_count >= v_reward.max_redemptions then
    return jsonb_build_object('ok', false, 'message', 'reward_max_usage_reached');
  end if;

  v_account := public.ensure_taxi_loyalty_account(v_user_id);

  if v_reward.tier_required is not null then
    if v_account.tier <> v_reward.tier_required
      and not (
        v_reward.tier_required = 'bronze'
        and v_account.tier in ('silver', 'gold')
      )
      and not (
        v_reward.tier_required = 'silver' and v_account.tier = 'gold'
      ) then
      return jsonb_build_object('ok', false, 'message', 'reward_tier_not_eligible');
    end if;
  end if;

  if v_account.points_balance < v_reward.points_cost then
    return jsonb_build_object('ok', false, 'message', 'insufficient_points');
  end if;

  if exists (
    select 1
    from public.taxi_loyalty_redemptions tlr
    where tlr.taxi_ride_id = p_ride_id
      and tlr.status in ('reserved', 'applied')
  ) then
    return jsonb_build_object('ok', false, 'message', 'reward_already_applied');
  end if;

  v_new_balance := v_account.points_balance - v_reward.points_cost;

  update public.taxi_loyalty_accounts
  set
    points_balance = v_new_balance,
    updated_at = now()
  where user_id = v_user_id;

  insert into public.taxi_loyalty_redemptions (
    reward_id,
    user_id,
    taxi_ride_id,
    points_spent,
    discount_cents,
    status
  )
  values (
    p_reward_id,
    v_user_id,
    p_ride_id,
    v_reward.points_cost,
    v_reward.discount_cents,
    'reserved'
  )
  returning id into v_redemption_id;

  insert into public.taxi_loyalty_ledger (
    user_id,
    taxi_ride_id,
    delta_points,
    balance_after,
    entry_type,
    description
  )
  values (
    v_user_id,
    p_ride_id,
    -v_reward.points_cost,
    v_new_balance,
    'redeem',
    'Taxi loyalty reward reserved'
  );

  update public.taxi_rides
  set
    gross_total_cents = coalesce(gross_total_cents, total_cents + discount_cents + loyalty_discount_cents),
    loyalty_reward_id = p_reward_id,
    loyalty_redemption_id = v_redemption_id,
    loyalty_discount_cents = v_reward.discount_cents,
    updated_at = now()
  where id = p_ride_id;

  perform public.recalculate_taxi_ride_totals(p_ride_id);

  perform public.log_taxi_event(
    p_ride_id,
    'loyalty_reward_applied',
    v_ride.status,
    v_ride.status,
    v_user_id,
    'client',
    'Taxi loyalty reward reserved on ride',
    jsonb_build_object(
      'reward_id', p_reward_id,
      'redemption_id', v_redemption_id,
      'discount_cents', v_reward.discount_cents
    )
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', p_ride_id,
    'reward_id', p_reward_id,
    'redemption_id', v_redemption_id,
    'loyalty_discount_cents', v_reward.discount_cents,
    'points_balance', v_new_balance
  );
end;
$$;

create or replace function public.release_taxi_loyalty_redemption(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_redemption public.taxi_loyalty_redemptions%rowtype;
  v_account public.taxi_loyalty_accounts;
  v_new_balance integer;
begin
  select *
  into v_redemption
  from public.taxi_loyalty_redemptions
  where taxi_ride_id = p_ride_id
    and status = 'reserved'
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;

  v_account := public.ensure_taxi_loyalty_account(v_redemption.user_id);
  v_new_balance := v_account.points_balance + v_redemption.points_spent;

  update public.taxi_loyalty_accounts
  set points_balance = v_new_balance, updated_at = now()
  where user_id = v_redemption.user_id;

  update public.taxi_loyalty_redemptions
  set status = 'released', updated_at = now()
  where id = v_redemption.id;

  insert into public.taxi_loyalty_ledger (
    user_id,
    taxi_ride_id,
    delta_points,
    balance_after,
    entry_type,
    description
  )
  values (
    v_redemption.user_id,
    p_ride_id,
    v_redemption.points_spent,
    v_new_balance,
    'admin_adjust',
    'Taxi loyalty reward released after payment failure'
  );

  update public.taxi_rides
  set
    loyalty_reward_id = null,
    loyalty_redemption_id = null,
    loyalty_discount_cents = 0,
    updated_at = now()
  where id = p_ride_id;

  perform public.recalculate_taxi_ride_totals(p_ride_id);

  return jsonb_build_object('ok', true, 'released', true);
end;
$$;

create or replace function public.finalize_taxi_loyalty_redemption(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_redemption public.taxi_loyalty_redemptions%rowtype;
begin
  select *
  into v_redemption
  from public.taxi_loyalty_redemptions
  where taxi_ride_id = p_ride_id
    and status = 'reserved'
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;

  update public.taxi_loyalty_redemptions
  set status = 'applied', updated_at = now()
  where id = v_redemption.id;

  update public.taxi_loyalty_rewards
  set redemption_count = redemption_count + 1, updated_at = now()
  where id = v_redemption.reward_id;

  perform public.log_taxi_event(
    p_ride_id,
    'loyalty_reward_redeemed',
    null,
    null,
    v_redemption.user_id,
    'system',
    'Taxi loyalty reward finalized on payment',
    jsonb_build_object('redemption_id', v_redemption.id)
  );

  return jsonb_build_object('ok', true, 'redemption_id', v_redemption.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) Scheduled dispatch + mark paid + multi-stop driver RPCs
-- ---------------------------------------------------------------------------

create or replace function public.dispatch_due_taxi_scheduled_ride(p_scheduled_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scheduled public.taxi_scheduled_rides%rowtype;
  v_ride public.taxi_rides%rowtype;
begin
  select *
  into v_scheduled
  from public.taxi_scheduled_rides
  where id = p_scheduled_id
    and status = 'scheduled'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'scheduled_not_found');
  end if;

  select *
  into v_ride
  from public.taxi_rides
  where id = v_scheduled.taxi_ride_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if lower(coalesce(v_ride.payment_status, '')) <> 'paid' then
    return jsonb_build_object('ok', false, 'message', 'ride_not_paid');
  end if;

  if v_ride.driver_id is not null then
    return jsonb_build_object('ok', false, 'message', 'already_assigned');
  end if;

  update public.taxi_rides
  set
    status = 'paid',
    updated_at = now()
  where id = v_ride.id
    and status = 'scheduled';

  update public.taxi_scheduled_rides
  set
    status = 'dispatched',
    dispatched_at = now(),
    updated_at = now()
  where id = p_scheduled_id;

  perform public.log_taxi_event(
    v_ride.id,
    'scheduled_dispatch_ready',
    'scheduled',
    'paid',
    null,
    'system',
    'Scheduled taxi ride ready for dispatch',
    jsonb_build_object('scheduled_id', p_scheduled_id)
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', v_ride.id,
    'scheduled_id', p_scheduled_id
  );
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
  v_ride public.taxi_rides%rowtype;
  v_old_status text;
  v_now timestamptz := now();
  v_promo jsonb;
  v_loyalty jsonb;
  v_new_status text;
  v_revalidate jsonb;
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
      'is_scheduled', v_ride.is_scheduled
    )
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', p_ride_id,
    'payment_status', 'paid',
    'status', v_new_status,
    'promotion', v_promo,
    'loyalty', v_loyalty,
    'is_scheduled', v_ride.is_scheduled
  );
end;
$$;

create or replace function public.driver_arrive_taxi_stop(
  p_ride_id uuid,
  p_stop_order integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_ride public.taxi_rides%rowtype;
  v_stop public.taxi_ride_stops%rowtype;
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

  if lower(coalesce(v_ride.status, '')) not in ('in_progress', 'driver_arrived', 'accepted') then
    return jsonb_build_object('ok', false, 'message', 'invalid_status');
  end if;

  select *
  into v_stop
  from public.taxi_ride_stops
  where taxi_ride_id = p_ride_id
    and stop_order = p_stop_order
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'stop_not_found');
  end if;

  update public.taxi_ride_stops
  set
    status = 'arrived',
    arrived_at = coalesce(arrived_at, now()),
    updated_at = now()
  where id = v_stop.id;

  update public.taxi_rides
  set current_stop_order = p_stop_order, updated_at = now()
  where id = p_ride_id;

  perform public.log_taxi_event(
    p_ride_id,
    'driver_arrived_stop',
    v_ride.status,
    v_ride.status,
    v_driver_id,
    'driver',
    'Driver arrived at taxi stop',
    jsonb_build_object('stop_order', p_stop_order)
  );

  return jsonb_build_object('ok', true, 'stop_order', p_stop_order, 'status', 'arrived');
end;
$$;

create or replace function public.driver_complete_taxi_stop(
  p_ride_id uuid,
  p_stop_order integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_ride public.taxi_rides%rowtype;
  v_stop public.taxi_ride_stops%rowtype;
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

  select *
  into v_stop
  from public.taxi_ride_stops
  where taxi_ride_id = p_ride_id
    and stop_order = p_stop_order
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'stop_not_found');
  end if;

  if v_stop.status <> 'arrived' then
    return jsonb_build_object('ok', false, 'message', 'stop_not_arrived');
  end if;

  update public.taxi_ride_stops
  set
    status = 'completed',
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
  where id = v_stop.id;

  perform public.log_taxi_event(
    p_ride_id,
    'driver_completed_stop',
    v_ride.status,
    v_ride.status,
    v_driver_id,
    'driver',
    'Driver completed taxi stop',
    jsonb_build_object('stop_order', p_stop_order)
  );

  return jsonb_build_object('ok', true, 'stop_order', p_stop_order, 'status', 'completed');
end;
$$;

-- ---------------------------------------------------------------------------
-- 10) RLS
-- ---------------------------------------------------------------------------

alter table public.taxi_scheduled_rides enable row level security;
alter table public.taxi_ride_stops enable row level security;
alter table public.taxi_loyalty_rewards enable row level security;
alter table public.taxi_loyalty_redemptions enable row level security;

drop policy if exists taxi_scheduled_select_own on public.taxi_scheduled_rides;
create policy taxi_scheduled_select_own
  on public.taxi_scheduled_rides
  for select
  to authenticated
  using (client_user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists taxi_scheduled_insert_own on public.taxi_scheduled_rides;
create policy taxi_scheduled_insert_own
  on public.taxi_scheduled_rides
  for insert
  to authenticated
  with check (client_user_id = auth.uid());

drop policy if exists taxi_scheduled_update_own on public.taxi_scheduled_rides;
create policy taxi_scheduled_update_own
  on public.taxi_scheduled_rides
  for update
  to authenticated
  using (client_user_id = auth.uid() or public.is_staff_user(auth.uid()))
  with check (client_user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists taxi_stops_select_participants on public.taxi_ride_stops;
create policy taxi_stops_select_participants
  on public.taxi_ride_stops
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.taxi_rides tr
      where tr.id = taxi_ride_id
        and (
          tr.client_user_id = auth.uid()
          or tr.driver_id = auth.uid()
          or public.is_staff_user(auth.uid())
        )
    )
  );

drop policy if exists taxi_loyalty_rewards_select_active on public.taxi_loyalty_rewards;
create policy taxi_loyalty_rewards_select_active
  on public.taxi_loyalty_rewards
  for select
  to authenticated
  using (active = true or public.is_staff_user(auth.uid()));

drop policy if exists taxi_loyalty_rewards_write_staff on public.taxi_loyalty_rewards;
create policy taxi_loyalty_rewards_write_staff
  on public.taxi_loyalty_rewards
  for all
  to authenticated
  using (public.is_staff_user(auth.uid()))
  with check (public.is_staff_user(auth.uid()));

drop policy if exists taxi_loyalty_redemptions_select_own on public.taxi_loyalty_redemptions;
create policy taxi_loyalty_redemptions_select_own
  on public.taxi_loyalty_redemptions
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

-- ---------------------------------------------------------------------------
-- 11) Grants
-- ---------------------------------------------------------------------------

revoke all on function public.recalculate_taxi_ride_totals(uuid) from public;
revoke all on function public.apply_taxi_loyalty_reward_to_ride(uuid, uuid, uuid) from public;
revoke all on function public.release_taxi_loyalty_redemption(uuid) from public;
revoke all on function public.finalize_taxi_loyalty_redemption(uuid) from public;
revoke all on function public.dispatch_due_taxi_scheduled_ride(uuid) from public;
revoke all on function public.driver_arrive_taxi_stop(uuid, integer) from public;
revoke all on function public.driver_complete_taxi_stop(uuid, integer) from public;

grant execute on function public.validate_taxi_promotion(text, uuid, integer, uuid, text, text, text) to authenticated;
grant execute on function public.recalculate_taxi_ride_totals(uuid) to service_role;
grant execute on function public.apply_taxi_loyalty_reward_to_ride(uuid, uuid, uuid) to service_role;
grant execute on function public.release_taxi_loyalty_redemption(uuid) to service_role;
grant execute on function public.finalize_taxi_loyalty_redemption(uuid) to service_role;
grant execute on function public.dispatch_due_taxi_scheduled_ride(uuid) to service_role;
grant execute on function public.driver_arrive_taxi_stop(uuid, integer) to authenticated;
grant execute on function public.driver_complete_taxi_stop(uuid, integer) to authenticated;

commit;
