-- Freeze taxi_commissions amounts once a driver payout has been claimed/paid.
-- Prevents refresh_taxi_commissions from overwriting frozen ledger after payout.
-- Timestamp is migration order after 20260805120000 (not civil date).

begin;

create or replace function public.refresh_taxi_commissions(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.taxi_rides%rowtype;
  v_existing public.taxi_commissions%rowtype;
begin
  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  select *
  into v_existing
  from public.taxi_commissions
  where taxi_ride_id = p_ride_id;

  if found and (
    coalesce(v_existing.driver_paid_out, false) = true
    or nullif(btrim(coalesce(v_existing.driver_transfer_id, '')), '') is not null
  ) then
    return jsonb_build_object(
      'ok', true,
      'frozen', true,
      'taxi_ride_id', p_ride_id,
      'driver_cents', v_existing.driver_cents,
      'platform_cents', v_existing.platform_cents,
      'message', 'commission_frozen_after_payout'
    );
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
    updated_at = now()
  where
    coalesce(public.taxi_commissions.driver_paid_out, false) = false
    and nullif(btrim(coalesce(public.taxi_commissions.driver_transfer_id, '')), '') is null;

  return jsonb_build_object(
    'ok', true,
    'frozen', false,
    'taxi_ride_id', p_ride_id
  );
end;
$$;

comment on function public.refresh_taxi_commissions(uuid) is
  'Upserts taxi_commissions from ride snapshot; refuses amount overwrite after driver payout claim/transfer.';

commit;
