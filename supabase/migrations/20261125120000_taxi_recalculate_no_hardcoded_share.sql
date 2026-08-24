-- Remove hardcoded 75% fallback from recalculate_taxi_ride_totals.
-- Driver share must come from pricing snapshot, ride ratio, or active taxi_pricing row.

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
  v_driver_share numeric;
begin
  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

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

  v_driver_share := null;

  if v_ride.pricing_snapshot_id is not null then
    select tp.driver_share_pct
    into v_driver_share
    from public.taxi_pricing tp
    where tp.id = v_ride.pricing_snapshot_id;
  elsif coalesce(v_ride.subtotal_cents, 0) > 0
    and coalesce(v_ride.driver_payout_cents, 0) > 0 then
    v_driver_share :=
      (v_ride.driver_payout_cents::numeric / v_ride.subtotal_cents::numeric) * 100;
  else
    select tp.driver_share_pct
    into v_driver_share
    from public.taxi_pricing tp
    where tp.active = true
      and tp.country_code = upper(coalesce(v_ride.country_code, 'US'))
      and tp.vehicle_class = lower(coalesce(v_ride.vehicle_class, 'standard'))
    order by tp.updated_at desc
    limit 1;
  end if;

  if v_driver_share is null then
    return jsonb_build_object(
      'ok', false,
      'message', 'driver_share_unresolved',
      'ride_id', p_ride_id
    );
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

  v_fare_net := greatest(0, v_subtotal - v_total_discount);
  v_new_total := public.align_taxi_cents_for_currency(
    v_ride.currency,
    v_fare_net + v_tax + v_service
  );

  v_new_driver := public.align_taxi_cents_for_currency(
    v_ride.currency,
    greatest(0, round(v_fare_net * v_driver_share / 100.0))::integer
  );

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
    'driver_share_pct', v_driver_share,
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
