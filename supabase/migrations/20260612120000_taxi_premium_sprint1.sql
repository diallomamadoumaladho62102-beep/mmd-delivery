-- Taxi Premium Sprint 1: favorite drivers, loyalty MVP, simple promotions.
-- Isolated taxi domain only.

begin;

-- ---------------------------------------------------------------------------
-- 1) Extend taxi_rides
-- ---------------------------------------------------------------------------

alter table public.taxi_rides
  add column if not exists preferred_driver_id uuid references auth.users (id) on delete set null,
  add column if not exists promotion_id uuid,
  add column if not exists promo_code text,
  add column if not exists discount_cents integer not null default 0 check (discount_cents >= 0),
  add column if not exists gross_total_cents integer check (gross_total_cents is null or gross_total_cents >= 0),
  add column if not exists loyalty_points_earned integer not null default 0 check (loyalty_points_earned >= 0),
  add column if not exists favorite_dispatch_expires_at timestamptz;

create index if not exists taxi_rides_preferred_driver_idx
  on public.taxi_rides (preferred_driver_id)
  where preferred_driver_id is not null;

create index if not exists taxi_rides_promotion_idx
  on public.taxi_rides (promotion_id)
  where promotion_id is not null;

alter table public.taxi_offers
  add column if not exists is_favorite_dispatch boolean not null default false;

-- Allow wave 0 offers for favorite-driver direct dispatch
alter table public.taxi_offers drop constraint if exists taxi_offers_wave_check;
alter table public.taxi_offers
  add constraint taxi_offers_wave_check check (wave >= 0);

-- ---------------------------------------------------------------------------
-- 2) taxi_client_favorite_drivers
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_client_favorite_drivers (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references auth.users (id) on delete cascade,
  driver_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint taxi_client_favorite_drivers_uq unique (client_user_id, driver_user_id),
  constraint taxi_client_favorite_drivers_not_self check (client_user_id <> driver_user_id)
);

create index if not exists taxi_client_favorite_drivers_client_idx
  on public.taxi_client_favorite_drivers (client_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3) taxi_loyalty_accounts + taxi_loyalty_ledger
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_loyalty_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  points_balance integer not null default 0 check (points_balance >= 0),
  lifetime_points integer not null default 0 check (lifetime_points >= 0),
  tier text not null default 'bronze'
    check (tier in ('bronze', 'silver', 'gold')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_taxi_loyalty_accounts_updated_at on public.taxi_loyalty_accounts;
create trigger trg_taxi_loyalty_accounts_updated_at
before update on public.taxi_loyalty_accounts
for each row execute function public.taxi_set_updated_at();

create table if not exists public.taxi_loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  taxi_ride_id uuid references public.taxi_rides (id) on delete set null,
  delta_points integer not null,
  balance_after integer not null check (balance_after >= 0),
  entry_type text not null check (entry_type in ('earn', 'redeem', 'admin_adjust')),
  description text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists taxi_loyalty_ledger_user_created_idx
  on public.taxi_loyalty_ledger (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4) taxi_promotions + taxi_promotion_redemptions
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_promotions (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  promotion_type text not null
    check (promotion_type in ('percent', 'fixed', 'first_ride')),
  discount_percent numeric(6, 2) check (
    discount_percent is null or (discount_percent > 0 and discount_percent <= 100)
  ),
  discount_cents integer check (discount_cents is null or discount_cents > 0),
  active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  max_redemptions_per_user integer check (
    max_redemptions_per_user is null or max_redemptions_per_user > 0
  ),
  redemption_count integer not null default 0 check (redemption_count >= 0),
  title text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint taxi_promotions_code_uq unique (code),
  constraint taxi_promotions_type_value_check check (
    (promotion_type = 'percent' and discount_percent is not null)
    or (promotion_type = 'fixed' and discount_cents is not null)
    or (promotion_type = 'first_ride' and (
      discount_percent is not null or discount_cents is not null
    ))
  )
);

drop trigger if exists trg_taxi_promotions_updated_at on public.taxi_promotions;
create trigger trg_taxi_promotions_updated_at
before update on public.taxi_promotions
for each row execute function public.taxi_set_updated_at();

create table if not exists public.taxi_promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.taxi_promotions (id) on delete restrict,
  taxi_ride_id uuid not null references public.taxi_rides (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  discount_cents integer not null check (discount_cents >= 0),
  created_at timestamptz not null default now(),
  constraint taxi_promotion_redemptions_ride_uq unique (taxi_ride_id)
);

create index if not exists taxi_promotion_redemptions_promo_idx
  on public.taxi_promotion_redemptions (promotion_id, created_at desc);

create index if not exists taxi_promotion_redemptions_user_idx
  on public.taxi_promotion_redemptions (user_id, created_at desc);

alter table public.taxi_rides
  drop constraint if exists taxi_rides_promotion_id_fkey;

alter table public.taxi_rides
  add constraint taxi_rides_promotion_id_fkey
  foreign key (promotion_id) references public.taxi_promotions (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 5) Helpers
-- ---------------------------------------------------------------------------

create or replace function public.taxi_loyalty_tier_for_lifetime(p_lifetime integer)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_lifetime, 0) >= 2000 then 'gold'
    when coalesce(p_lifetime, 0) >= 500 then 'silver'
    else 'bronze'
  end;
$$;

create or replace function public.ensure_taxi_loyalty_account(p_user_id uuid)
returns public.taxi_loyalty_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.taxi_loyalty_accounts;
begin
  insert into public.taxi_loyalty_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select *
  into v_account
  from public.taxi_loyalty_accounts
  where user_id = p_user_id;

  return v_account;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Promotion RPCs
-- ---------------------------------------------------------------------------

create or replace function public.validate_taxi_promotion(
  p_code text,
  p_user_id uuid,
  p_total_cents integer default null,
  p_ride_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_promo public.taxi_promotions%rowtype;
  v_now timestamptz := now();
  v_user_count integer := 0;
  v_discount integer := 0;
  v_code text := upper(trim(coalesce(p_code, '')));
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'message', 'missing_user');
  end if;

  if v_code = '' then
    return jsonb_build_object('ok', false, 'message', 'missing_code');
  end if;

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

  if v_promo.promotion_type = 'first_ride' then
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

  if p_total_cents is not null and p_total_cents > 0 then
    if v_promo.promotion_type = 'percent' or (
      v_promo.promotion_type = 'first_ride' and v_promo.discount_percent is not null
    ) then
      v_discount := least(
        p_total_cents,
        round(p_total_cents * (v_promo.discount_percent / 100.0))
      );
    elsif v_promo.promotion_type = 'fixed' or (
      v_promo.promotion_type = 'first_ride' and v_promo.discount_cents is not null
    ) then
      v_discount := least(p_total_cents, v_promo.discount_cents);
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
  v_ratio numeric;
  v_gross integer;
  v_new_total integer;
  v_new_driver integer;
  v_new_platform integer;
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

  if lower(coalesce(v_ride.status, '')) not in ('quoted', 'draft', 'pending_payment') then
    return jsonb_build_object('ok', false, 'message', 'ride_not_editable');
  end if;

  v_gross := coalesce(v_ride.gross_total_cents, v_ride.total_cents);

  v_validation := public.validate_taxi_promotion(
    p_code,
    v_ride.client_user_id,
    v_gross,
    p_ride_id
  );

  if coalesce((v_validation->>'ok')::boolean, false) is not true then
    return v_validation;
  end if;

  v_discount := greatest(0, coalesce((v_validation->>'discount_cents')::integer, 0));
  v_new_total := greatest(0, v_gross - v_discount);

  if v_gross > 0 then
    v_ratio := v_new_total::numeric / v_gross::numeric;
  else
    v_ratio := 1;
  end if;

  v_new_driver := greatest(0, round(v_ride.driver_payout_cents * v_ratio));
  v_new_platform := greatest(0, v_new_total - v_new_driver);

  update public.taxi_rides
  set
    gross_total_cents = v_gross,
    discount_cents = v_discount,
    total_cents = v_new_total,
    driver_payout_cents = v_new_driver,
    platform_fee_cents = v_new_platform,
    promotion_id = (v_validation->>'promotion_id')::uuid,
    promo_code = v_validation->>'code',
    updated_at = now()
  where id = p_ride_id;

  perform public.log_taxi_event(
    p_ride_id,
    'promotion_applied',
    v_ride.status,
    v_ride.status,
    v_ride.client_user_id,
    'client',
    'Taxi promotion applied to ride',
    jsonb_build_object(
      'promotion_id', v_validation->>'promotion_id',
      'code', v_validation->>'code',
      'discount_cents', v_discount,
      'total_cents', v_new_total
    )
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', p_ride_id,
    'promotion_id', v_validation->>'promotion_id',
    'code', v_validation->>'code',
    'discount_cents', v_discount,
    'total_cents', v_new_total,
    'driver_payout_cents', v_new_driver,
    'platform_fee_cents', v_new_platform
  );
end;
$$;

create or replace function public.finalize_taxi_promotion_redemption(p_ride_id uuid)
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

  if not found or v_ride.promotion_id is null then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;

  if exists (
    select 1 from public.taxi_promotion_redemptions where taxi_ride_id = p_ride_id
  ) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  insert into public.taxi_promotion_redemptions (
    promotion_id,
    taxi_ride_id,
    user_id,
    discount_cents
  )
  values (
    v_ride.promotion_id,
    p_ride_id,
    v_ride.client_user_id,
    coalesce(v_ride.discount_cents, 0)
  );

  update public.taxi_promotions
  set
    redemption_count = redemption_count + 1,
    updated_at = now()
  where id = v_ride.promotion_id;

  perform public.log_taxi_event(
    p_ride_id,
    'promotion_redeemed',
    v_ride.status,
    v_ride.status,
    v_ride.client_user_id,
    'system',
    'Taxi promotion redeemed on payment',
    jsonb_build_object(
      'promotion_id', v_ride.promotion_id,
      'discount_cents', v_ride.discount_cents
    )
  );

  return jsonb_build_object('ok', true, 'taxi_ride_id', p_ride_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Loyalty RPCs
-- ---------------------------------------------------------------------------

create or replace function public.accrue_taxi_loyalty_for_ride(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.taxi_rides%rowtype;
  v_points integer;
  v_account public.taxi_loyalty_accounts;
  v_new_balance integer;
  v_new_lifetime integer;
  v_tier text;
begin
  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if lower(coalesce(v_ride.status, '')) <> 'completed'
    or lower(coalesce(v_ride.payment_status, '')) <> 'paid' then
    return jsonb_build_object('ok', false, 'message', 'ride_not_eligible');
  end if;

  if coalesce(v_ride.loyalty_points_earned, 0) > 0 then
    return jsonb_build_object('ok', true, 'already', true, 'points', v_ride.loyalty_points_earned);
  end if;

  v_points := greatest(0, floor(coalesce(v_ride.total_cents, 0) / 100.0));

  if v_points <= 0 then
    return jsonb_build_object('ok', true, 'points', 0);
  end if;

  v_account := public.ensure_taxi_loyalty_account(v_ride.client_user_id);
  v_new_balance := v_account.points_balance + v_points;
  v_new_lifetime := v_account.lifetime_points + v_points;
  v_tier := public.taxi_loyalty_tier_for_lifetime(v_new_lifetime);

  update public.taxi_loyalty_accounts
  set
    points_balance = v_new_balance,
    lifetime_points = v_new_lifetime,
    tier = v_tier,
    updated_at = now()
  where user_id = v_ride.client_user_id;

  insert into public.taxi_loyalty_ledger (
    user_id,
    taxi_ride_id,
    delta_points,
    balance_after,
    entry_type,
    description
  )
  values (
    v_ride.client_user_id,
    p_ride_id,
    v_points,
    v_new_balance,
    'earn',
    'Points earned for completed taxi ride'
  );

  update public.taxi_rides
  set loyalty_points_earned = v_points, updated_at = now()
  where id = p_ride_id;

  perform public.log_taxi_event(
    p_ride_id,
    'loyalty_points_earned',
    v_ride.status,
    v_ride.status,
    v_ride.client_user_id,
    'system',
    'Taxi loyalty points accrued',
    jsonb_build_object('points', v_points, 'tier', v_tier)
  );

  return jsonb_build_object(
    'ok', true,
    'points', v_points,
    'balance', v_new_balance,
    'tier', v_tier
  );
end;
$$;

create or replace function public.adjust_taxi_loyalty_account(
  p_user_id uuid,
  p_delta_points integer,
  p_description text default null,
  p_admin_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.taxi_loyalty_accounts;
  v_new_balance integer;
  v_new_lifetime integer;
  v_tier text;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'message', 'missing_user');
  end if;

  if p_delta_points = 0 then
    return jsonb_build_object('ok', false, 'message', 'delta_zero');
  end if;

  v_account := public.ensure_taxi_loyalty_account(p_user_id);
  v_new_balance := v_account.points_balance + p_delta_points;

  if v_new_balance < 0 then
    return jsonb_build_object('ok', false, 'message', 'insufficient_balance');
  end if;

  v_new_lifetime := greatest(0, v_account.lifetime_points + greatest(p_delta_points, 0));
  v_tier := public.taxi_loyalty_tier_for_lifetime(v_new_lifetime);

  update public.taxi_loyalty_accounts
  set
    points_balance = v_new_balance,
    lifetime_points = v_new_lifetime,
    tier = v_tier,
    updated_at = now()
  where user_id = p_user_id;

  insert into public.taxi_loyalty_ledger (
    user_id,
    delta_points,
    balance_after,
    entry_type,
    description,
    created_by
  )
  values (
    p_user_id,
    p_delta_points,
    v_new_balance,
    'admin_adjust',
    coalesce(p_description, 'Admin loyalty adjustment'),
    p_admin_id
  );

  return jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'balance', v_new_balance,
    'tier', v_tier
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Extend mark_taxi_ride_paid + driver_complete
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

  v_old_status := v_ride.status;

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

  v_promo := public.finalize_taxi_promotion_redemption(p_ride_id);

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', p_ride_id,
    'payment_status', 'paid',
    'promotion', v_promo
  );
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
  v_loyalty jsonb;
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
  v_loyalty := public.accrue_taxi_loyalty_for_ride(p_ride_id);

  perform public.log_taxi_event(
    p_ride_id,
    'ride_completed',
    v_old_status,
    'completed',
    v_driver_id,
    'driver',
    'Taxi ride completed',
    jsonb_build_object('commissions', v_refresh, 'loyalty', v_loyalty)
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', p_ride_id,
    'status', 'completed',
    'commissions', v_refresh,
    'loyalty', v_loyalty
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) RLS
-- ---------------------------------------------------------------------------

alter table public.taxi_client_favorite_drivers enable row level security;
alter table public.taxi_loyalty_accounts enable row level security;
alter table public.taxi_loyalty_ledger enable row level security;
alter table public.taxi_promotions enable row level security;
alter table public.taxi_promotion_redemptions enable row level security;

drop policy if exists taxi_favorites_select_own on public.taxi_client_favorite_drivers;
create policy taxi_favorites_select_own
  on public.taxi_client_favorite_drivers
  for select
  to authenticated
  using (client_user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists taxi_favorites_insert_own on public.taxi_client_favorite_drivers;
create policy taxi_favorites_insert_own
  on public.taxi_client_favorite_drivers
  for insert
  to authenticated
  with check (client_user_id = auth.uid());

drop policy if exists taxi_favorites_delete_own on public.taxi_client_favorite_drivers;
create policy taxi_favorites_delete_own
  on public.taxi_client_favorite_drivers
  for delete
  to authenticated
  using (client_user_id = auth.uid());

drop policy if exists taxi_loyalty_accounts_select_own on public.taxi_loyalty_accounts;
create policy taxi_loyalty_accounts_select_own
  on public.taxi_loyalty_accounts
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists taxi_loyalty_ledger_select_own on public.taxi_loyalty_ledger;
create policy taxi_loyalty_ledger_select_own
  on public.taxi_loyalty_ledger
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists taxi_promotions_select_active on public.taxi_promotions;
create policy taxi_promotions_select_active
  on public.taxi_promotions
  for select
  to authenticated
  using (active = true or public.is_staff_user(auth.uid()));

drop policy if exists taxi_promotions_write_staff on public.taxi_promotions;
create policy taxi_promotions_write_staff
  on public.taxi_promotions
  for all
  to authenticated
  using (public.is_staff_user(auth.uid()))
  with check (public.is_staff_user(auth.uid()));

drop policy if exists taxi_promotion_redemptions_select_own on public.taxi_promotion_redemptions;
create policy taxi_promotion_redemptions_select_own
  on public.taxi_promotion_redemptions
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

-- ---------------------------------------------------------------------------
-- 10) Grants
-- ---------------------------------------------------------------------------

revoke all on function public.validate_taxi_promotion(text, uuid, integer, uuid) from public;
revoke all on function public.apply_taxi_promotion_to_ride(uuid, text) from public;
revoke all on function public.finalize_taxi_promotion_redemption(uuid) from public;
revoke all on function public.accrue_taxi_loyalty_for_ride(uuid) from public;
revoke all on function public.adjust_taxi_loyalty_account(uuid, integer, text, uuid) from public;
revoke all on function public.ensure_taxi_loyalty_account(uuid) from public;

grant execute on function public.validate_taxi_promotion(text, uuid, integer, uuid) to authenticated;
grant execute on function public.apply_taxi_promotion_to_ride(uuid, text) to service_role;
grant execute on function public.finalize_taxi_promotion_redemption(uuid) to service_role;
grant execute on function public.accrue_taxi_loyalty_for_ride(uuid) to service_role;
grant execute on function public.adjust_taxi_loyalty_account(uuid, integer, text, uuid) to service_role;
grant execute on function public.ensure_taxi_loyalty_account(uuid) to service_role;

commit;
