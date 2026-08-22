-- Fix: PostgREST cannot choose between reserve_order_payout overloads
-- (p_amount_cents integer vs bigint) → 500 on transfers/run.
--
-- Keep the bigint signature (eligibility + lock semantics) as the single SoT.
-- Drop the legacy integer overload introduced by 20260602230000 / 20260603130000.
-- Idempotent. No data changes.

drop function if exists public.reserve_order_payout(
  uuid, text, integer, text, text, text, text, text
);

-- Ensure bigint overload exists with current production body (create or replace).
create or replace function public.reserve_order_payout(
  p_order_id uuid,
  p_target text,
  p_amount_cents bigint,
  p_currency text,
  p_destination_account_id text,
  p_source_charge_id text,
  p_idempotency_key text,
  p_locked_by text default 'api/stripe/transfers/run'
)
returns public.order_payouts
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_target text := lower(trim(coalesce(p_target, '')));
  v_currency text := upper(trim(coalesce(p_currency, 'USD')));
  v_existing public.order_payouts%rowtype;
  v_order record;
  v_commission record;
  v_result public.order_payouts%rowtype;
  v_restaurant_eligible boolean := false;
  v_driver_eligible boolean := false;
begin
  if p_order_id is null then
    raise exception 'p_order_id is required';
  end if;

  if v_target not in ('restaurant', 'driver') then
    raise exception 'p_target must be restaurant or driver';
  end if;

  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'p_amount_cents must be > 0';
  end if;

  if coalesce(trim(p_destination_account_id), '') = '' then
    raise exception 'p_destination_account_id is required';
  end if;

  if coalesce(trim(p_source_charge_id), '') = '' then
    raise exception 'p_source_charge_id is required';
  end if;

  if coalesce(trim(p_idempotency_key), '') = '' then
    raise exception 'p_idempotency_key is required';
  end if;

  select
    o.id,
    o.status,
    o.payment_status,
    o.picked_up_at,
    o.delivered_confirmed_at,
    o.restaurant_paid_out,
    o.restaurant_transfer_id,
    o.driver_paid_out,
    o.driver_transfer_id
  into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if lower(coalesce(v_order.payment_status, '')) <> 'paid' then
    raise exception 'Order is not paid';
  end if;

  select
    oc.restaurant_release_status,
    oc.restaurant_released_at,
    oc.driver_release_status,
    oc.driver_released_at
  into v_commission
  from public.order_commissions oc
  where oc.order_id = p_order_id;

  v_restaurant_eligible :=
    v_order.picked_up_at is not null
    or lower(coalesce(v_commission.restaurant_release_status, '')) = 'released'
    or v_commission.restaurant_released_at is not null;

  v_driver_eligible :=
    lower(coalesce(v_order.status, '')) = 'delivered'
    or v_order.delivered_confirmed_at is not null
    or lower(coalesce(v_commission.driver_release_status, '')) = 'released'
    or v_commission.driver_released_at is not null;

  if v_target = 'restaurant' then
    if coalesce(v_order.restaurant_paid_out, false) = true
       or coalesce(v_order.restaurant_transfer_id, '') <> '' then
      raise exception 'Restaurant already paid out';
    end if;

    if not v_restaurant_eligible then
      raise exception 'Restaurant payout not yet eligible';
    end if;
  end if;

  if v_target = 'driver' then
    if coalesce(v_order.driver_paid_out, false) = true
       or coalesce(v_order.driver_transfer_id, '') <> '' then
      raise exception 'Driver already paid out';
    end if;

    if not v_driver_eligible then
      raise exception 'Driver payout not yet eligible';
    end if;
  end if;

  select *
  into v_existing
  from public.order_payouts
  where order_id = p_order_id
    and target = v_target
  for update;

  if found then
    if v_existing.status = 'succeeded' then
      return v_existing;
    end if;

    if v_existing.status = 'locked' then
      return v_existing;
    end if;

    update public.order_payouts
    set
      status = 'locked',
      amount_cents = p_amount_cents,
      currency = v_currency,
      destination_account_id = p_destination_account_id,
      source_charge_id = p_source_charge_id,
      idempotency_key = p_idempotency_key,
      locked_at = now(),
      locked_by = p_locked_by,
      failure_code = null,
      failure_message = null,
      last_error = null,
      failed_at = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'reserved_at', now(),
        'eligibility', jsonb_build_object(
          'restaurant', v_restaurant_eligible,
          'driver', v_driver_eligible
        )
      )
    where id = v_existing.id
    returning * into v_result;

    return v_result;
  end if;

  insert into public.order_payouts (
    order_id,
    target,
    status,
    currency,
    amount_cents,
    destination_account_id,
    source_charge_id,
    idempotency_key,
    locked_at,
    locked_by,
    metadata
  )
  values (
    p_order_id,
    v_target,
    'locked',
    v_currency,
    p_amount_cents,
    p_destination_account_id,
    p_source_charge_id,
    p_idempotency_key,
    now(),
    p_locked_by,
    jsonb_build_object(
      'reserved_at', now(),
      'eligibility', jsonb_build_object(
        'restaurant', v_restaurant_eligible,
        'driver', v_driver_eligible
      )
    )
  )
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.reserve_order_payout(
  uuid, text, bigint, text, text, text, text, text
) from public;
revoke all on function public.reserve_order_payout(
  uuid, text, bigint, text, text, text, text, text
) from anon;
revoke all on function public.reserve_order_payout(
  uuid, text, bigint, text, text, text, text, text
) from authenticated;
grant execute on function public.reserve_order_payout(
  uuid, text, bigint, text, text, text, text, text
) to service_role;
