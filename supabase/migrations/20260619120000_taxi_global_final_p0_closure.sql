-- Taxi Global Final P0 Closure
-- RLS: shared ride business admin scope + driver quality score privacy
-- SQL: zero-decimal (GNF/XOF) cent alignment — floor to major units (never overcharge)

-- ---------------------------------------------------------------------------
-- 1) Helper — floor amount_cents to whole major units for zero-decimal currencies
-- ---------------------------------------------------------------------------

create or replace function public.align_taxi_cents_for_currency(
  p_currency text,
  p_cents integer
)
returns integer
language plpgsql
immutable
as $$
declare
  v_currency text := upper(trim(coalesce(p_currency, '')));
  v_cents integer := greatest(coalesce(p_cents, 0), 0);
begin
  if v_currency in ('GNF', 'XOF') then
    return (v_cents / 100) * 100;
  end if;
  return v_cents;
end;
$$;

revoke all on function public.align_taxi_cents_for_currency(text, integer) from public;
grant execute on function public.align_taxi_cents_for_currency(text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) quote_taxi_ride — align GNF/XOF totals before returning
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
  v_country_check jsonb;
  v_distance numeric := greatest(coalesce(p_distance_miles, 0), 0);
  v_duration numeric := greatest(coalesce(p_duration_minutes, 0), 0);
  v_fare numeric;
  v_subtotal_cents integer;
  v_tax_cents integer;
  v_platform_cents integer;
  v_driver_cents integer;
  v_total_cents integer;
begin
  v_country_check := public.resolve_taxi_country(v_country);
  if coalesce((v_country_check->>'ok')::boolean, false) is not true then
    return v_country_check;
  end if;

  select *
  into v_pricing
  from public.taxi_pricing tp
  where tp.active = true
    and tp.country_code = v_country
    and tp.vehicle_class = v_class
  order by tp.updated_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'message', 'pricing_not_found',
      'country_code', v_country,
      'vehicle_class', v_class
    );
  end if;

  if upper(v_pricing.currency) <> upper(v_country_check->>'currency_code') then
    return jsonb_build_object(
      'ok', false,
      'message', 'pricing_currency_mismatch',
      'country_code', v_country,
      'expected_currency', v_country_check->>'currency_code',
      'pricing_currency', v_pricing.currency
    );
  end if;

  if v_passengers > v_pricing.max_passengers then
    return jsonb_build_object(
      'ok', false,
      'message', 'passenger_count_exceeds_vehicle_capacity',
      'max_passengers', v_pricing.max_passengers
    );
  end if;

  v_fare :=
    v_pricing.base_fare
    + (v_distance * v_pricing.per_mile)
    + (v_duration * v_pricing.per_minute);

  v_fare := v_fare * v_pricing.class_multiplier;
  v_fare := greatest(v_fare, v_pricing.min_fare);
  v_fare := v_fare + v_pricing.booking_fee;

  v_subtotal_cents := public.align_taxi_cents_for_currency(
    v_pricing.currency,
    round(v_fare * 100)::integer
  );
  v_tax_cents := public.align_taxi_cents_for_currency(
    v_pricing.currency,
    public.calculate_taxi_tax_cents(v_country, v_subtotal_cents, 'ride')
  );
  v_platform_cents := public.align_taxi_cents_for_currency(
    v_pricing.currency,
    round(v_subtotal_cents * v_pricing.platform_share_pct / 100.0)::integer
  );
  v_driver_cents := public.align_taxi_cents_for_currency(
    v_pricing.currency,
    round(v_subtotal_cents * v_pricing.driver_share_pct / 100.0)::integer
  );
  v_total_cents := v_subtotal_cents + v_tax_cents;

  return jsonb_build_object(
    'ok', true,
    'pricing_id', v_pricing.id,
    'config_key', v_pricing.config_key,
    'vehicle_class', v_class,
    'country_code', v_country,
    'country_name', v_country_check->>'country_name',
    'currency', v_pricing.currency,
    'default_language', v_country_check->>'default_language',
    'subtotal_cents', v_subtotal_cents,
    'tax_cents', v_tax_cents,
    'platform_fee_cents', v_platform_cents,
    'driver_payout_cents', v_driver_cents,
    'total_cents', v_total_cents,
    'distance_miles', v_distance,
    'duration_minutes', v_duration,
    'passenger_count', v_passengers
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) recalculate_taxi_ride_totals — align net total for GNF/XOF
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
  v_tax integer;
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

  v_tax := greatest(0, coalesce(v_ride.tax_cents, 0));

  v_gross := coalesce(
    v_ride.gross_total_cents,
    v_ride.subtotal_cents + v_tax
      + coalesce(v_ride.discount_cents, 0)
      + coalesce(v_ride.loyalty_discount_cents, 0)
      + coalesce(v_ride.shared_discount_cents, 0)
  );
  if v_gross <= 0 then
    v_gross := greatest(v_ride.total_cents, v_ride.subtotal_cents + v_tax, 0);
  end if;

  v_promo_discount := greatest(0, coalesce(v_ride.discount_cents, 0));
  v_loyalty_discount := greatest(0, coalesce(v_ride.loyalty_discount_cents, 0));
  v_shared_discount := greatest(0, coalesce(v_ride.shared_discount_cents, 0));
  v_total_discount := v_promo_discount + v_loyalty_discount + v_shared_discount;
  v_new_total := greatest(0, v_gross - v_total_discount);
  v_new_total := public.align_taxi_cents_for_currency(v_ride.currency, v_new_total);

  v_new_driver := public.align_taxi_cents_for_currency(
    v_ride.currency,
    greatest(0, round(v_new_total * v_driver_share / 100.0))::integer
  );
  v_new_platform := greatest(0, v_new_total - v_new_driver);

  update public.taxi_rides
  set
    gross_total_cents = v_gross,
    tax_cents = v_tax,
    total_cents = v_new_total,
    driver_payout_cents = v_new_driver,
    platform_fee_cents = v_new_platform,
    updated_at = now()
  where id = p_ride_id;

  return jsonb_build_object(
    'ok', true,
    'gross_total_cents', v_gross,
    'tax_cents', v_tax,
    'discount_cents', v_promo_discount,
    'loyalty_discount_cents', v_loyalty_discount,
    'shared_discount_cents', v_shared_discount,
    'total_cents', v_new_total,
    'driver_payout_cents', v_new_driver,
    'platform_fee_cents', v_new_platform
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) RLS — shared ride passengers: business managers scoped to their account
-- ---------------------------------------------------------------------------

drop policy if exists taxi_shared_passengers_select_business_admin
  on public.taxi_shared_ride_passengers;

create policy taxi_shared_passengers_select_business_admin
on public.taxi_shared_ride_passengers for select to authenticated
using (
  exists (
    select 1
    from public.taxi_business_members bm
    join public.taxi_rides tr
      on tr.business_account_id = bm.business_account_id
     and tr.id = taxi_shared_ride_passengers.taxi_ride_id
    where bm.user_id = auth.uid()
      and bm.active = true
      and bm.role in ('manager', 'admin')
  )
);

-- ---------------------------------------------------------------------------
-- 5) RLS — driver quality scores: own score or MMD staff only
-- ---------------------------------------------------------------------------

drop policy if exists taxi_driver_quality_select_authenticated
  on public.taxi_driver_quality_scores;

create policy taxi_driver_quality_select_own_or_staff
on public.taxi_driver_quality_scores for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.profiles pr
    where pr.id = auth.uid()
      and lower(coalesce(pr.role, '')) in ('admin', 'ops', 'finance', 'support')
  )
);
