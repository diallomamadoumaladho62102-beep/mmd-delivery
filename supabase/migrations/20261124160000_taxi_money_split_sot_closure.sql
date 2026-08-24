-- Taxi money split SoT closure:
-- 1) recalculate_taxi_ride_totals must NOT rewrite paid rides
-- 2) split must match quote_taxi_ride: shares apply to fare (subtotal) only;
--    tax is pass-through; service fee accrues to platform (MMD)
-- 3) shared-ride discount applicator skips paid rides

create or replace function public.recalculate_taxi_ride_totals(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.taxi_rides%rowtype;
  v_subtotal integer;
  v_tax integer;
  v_service integer;
  v_promo_discount integer := 0;
  v_loyalty_discount integer := 0;
  v_shared_discount integer := 0;
  v_mmd_plus_discount integer := 0;
  v_marketing_discount integer := 0;
  v_total_discount integer;
  v_fare_net integer;
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

  -- Freeze paid rides: checkout snapshot is the money truth after payment.
  if lower(coalesce(v_ride.payment_status, '')) = 'paid' then
    return jsonb_build_object(
      'ok', true,
      'frozen', true,
      'message', 'paid_ride_totals_frozen',
      'gross_total_cents', v_ride.gross_total_cents,
      'tax_cents', v_ride.tax_cents,
      'total_cents', v_ride.total_cents,
      'driver_payout_cents', v_ride.driver_payout_cents,
      'platform_fee_cents', v_ride.platform_fee_cents
    );
  end if;

  if v_ride.pricing_snapshot_id is not null then
    select tp.driver_share_pct
    into v_driver_share
    from public.taxi_pricing tp
    where tp.id = v_ride.pricing_snapshot_id;
  elsif coalesce(v_ride.subtotal_cents, 0) > 0 then
    v_driver_share :=
      (v_ride.driver_payout_cents::numeric / v_ride.subtotal_cents::numeric) * 100;
  end if;

  v_subtotal := greatest(0, coalesce(v_ride.subtotal_cents, 0));
  v_tax := greatest(0, coalesce(v_ride.tax_cents, 0));
  v_service := greatest(0, coalesce(v_ride.service_fee_cents, 0));

  v_promo_discount := greatest(0, coalesce(v_ride.discount_cents, 0));
  v_loyalty_discount := greatest(0, coalesce(v_ride.loyalty_discount_cents, 0));
  v_shared_discount := greatest(0, coalesce(v_ride.shared_discount_cents, 0));
  v_mmd_plus_discount := greatest(0, coalesce(v_ride.mmd_plus_discount_cents, 0));
  v_marketing_discount := greatest(0, coalesce(v_ride.marketing_discount_cents, 0));
  v_total_discount :=
    v_promo_discount
    + v_loyalty_discount
    + v_shared_discount
    + v_mmd_plus_discount
    + v_marketing_discount;

  -- Discounts reduce fare (subtotal) only — same SoT as splitTaxiNetCommissionCents
  -- and quote_taxi_ride (driver_share_pct of fare_net).
  v_fare_net := greatest(0, v_subtotal - v_total_discount);
  v_new_total := public.align_taxi_cents_for_currency(
    v_ride.currency,
    v_fare_net + v_tax + v_service
  );

  v_new_driver := public.align_taxi_cents_for_currency(
    v_ride.currency,
    greatest(0, round(v_fare_net * v_driver_share / 100.0))::integer
  );
  -- Cap driver to (total - tax); remainder incl. service fee → platform.
  if v_new_driver > greatest(0, v_new_total - v_tax) then
    v_new_driver := greatest(0, v_new_total - v_tax);
  end if;
  v_new_platform := greatest(0, v_new_total - v_tax - v_new_driver);

  update public.taxi_rides
  set
    gross_total_cents = coalesce(
      v_ride.gross_total_cents,
      v_subtotal + v_tax + v_service
    ),
    tax_cents = v_tax,
    total_cents = v_new_total,
    driver_payout_cents = v_new_driver,
    platform_fee_cents = v_new_platform,
    updated_at = now()
  where id = p_ride_id;

  return jsonb_build_object(
    'ok', true,
    'frozen', false,
    'gross_total_cents', coalesce(v_ride.gross_total_cents, v_subtotal + v_tax + v_service),
    'tax_cents', v_tax,
    'service_fee_cents', v_service,
    'discount_cents', v_promo_discount,
    'loyalty_discount_cents', v_loyalty_discount,
    'shared_discount_cents', v_shared_discount,
    'mmd_plus_discount_cents', v_mmd_plus_discount,
    'marketing_discount_cents', v_marketing_discount,
    'total_cents', v_new_total,
    'driver_payout_cents', v_new_driver,
    'platform_fee_cents', v_new_platform
  );
end;
$$;

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
  v_updated integer := 0;
  v_skipped_paid integer := 0;
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
    select p.*, r.gross_total_cents, r.id as ride_id, r.payment_status
    from public.taxi_shared_ride_passengers p
    join public.taxi_rides r on r.id = p.taxi_ride_id
    where p.shared_ride_id = p_shared_ride_id
      and p.status <> 'canceled'
  loop
    -- Never rewrite money on paid rides (checkout snapshot is frozen).
    if lower(coalesce(v_passenger.payment_status, '')) = 'paid' then
      v_skipped_paid := v_skipped_paid + 1;
      continue;
    end if;

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
    v_updated := v_updated + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'passenger_count', v_shared.passenger_count,
    'updated', v_updated,
    'skipped_paid', v_skipped_paid
  );
end;
$$;
