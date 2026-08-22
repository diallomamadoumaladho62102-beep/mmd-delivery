-- Fix: stack depth limit exceeded on food order INSERT when restaurant_id is set.
--
-- Root cause (introduced in 20261118120000):
--   trg_orders_commissions (AFTER INSERT/UPDATE on orders)
--     → refresh_order_commissions()
--     → UPDATE orders SET restaurant_net_amount=..., updated_at=now()
--     → trg_orders_commissions again (infinite recursion)
--
-- Fix:
-- 1) Skip nested re-entry when already inside a trigger depth > 1.
-- 2) Only sync restaurant_net_amount when the value actually changes
--    (IS DISTINCT FROM) and do not bump updated_at in that sync path.
--
-- Money math / freeze rules unchanged from 20261118120000.
-- Does NOT drop data. No destructive clears.
-- Rollback: restore function body from 20261118120000_refresh_order_commissions_regional_food.sql

create or replace function public.refresh_order_commissions(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order public.orders%rowtype;
  v_cfg public.pricing_config%rowtype;
  v_snap public.commission_snapshots%rowtype;
  v_existing public.order_commissions%rowtype;
  v_has_snap boolean := false;
  v_has_existing boolean := false;
  v_order_type text;
  v_config_key text;
  v_currency_u text;
  v_snap_country text;
  v_is_africa boolean := false;
  v_subtotal numeric := 0;
  v_delivery_fee numeric := 0;
  v_total numeric := 0;
  v_service_fee numeric := 0;
  v_restaurant_pct numeric := 0;
  v_platform_pct numeric := 0;
  v_delivery_driver_pct numeric := 80;
  v_delivery_platform_pct numeric := 20;
  v_restaurant_amount numeric := 0;
  v_driver_amount numeric := 0;
  v_platform_amount numeric := 0;
  v_client_amount numeric := 0;
  v_currency text := 'USD';
  v_has_restaurant boolean := false;
  v_caller uuid := auth.uid();
  v_role text := coalesce(auth.role(), '');
  v_allowed boolean := false;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'order_id_required');
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  if v_role = 'service_role' then
    v_allowed := true;
  elsif v_caller is not null and public.is_staff_user(v_caller) then
    v_allowed := true;
  elsif v_caller is not null and (
    v_order.client_user_id = v_caller
    or v_order.restaurant_user_id = v_caller
    or v_order.restaurant_id = v_caller
    or v_order.driver_id = v_caller
  ) then
    v_allowed := true;
  end if;

  if not v_allowed then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select * into v_existing
  from public.order_commissions
  where order_id = p_order_id;
  v_has_existing := found;

  -- Nested call from trg_orders_commissions after our own display UPDATE:
  -- commissions row already written by the outer invocation; do not touch orders again.
  if pg_trigger_depth() > 1 and v_has_existing then
    return jsonb_build_object(
      'ok', true,
      'order_id', p_order_id,
      'currency', v_existing.currency,
      'client_amount', v_existing.client_amount,
      'driver_amount', v_existing.driver_amount,
      'restaurant_amount', v_existing.restaurant_amount,
      'platform_amount', v_existing.platform_amount,
      'nested_skip', true
    );
  end if;

  -- Hard freeze after any SCT id is recorded (prevents amount drift post-transfer).
  if v_has_existing
     and (
       nullif(trim(coalesce(v_order.restaurant_transfer_id, '')), '') is not null
       or nullif(trim(coalesce(v_order.driver_transfer_id, '')), '') is not null
     ) then
    return jsonb_build_object(
      'ok', true,
      'order_id', p_order_id,
      'currency', v_existing.currency,
      'client_amount', v_existing.client_amount,
      'driver_amount', v_existing.driver_amount,
      'restaurant_amount', v_existing.restaurant_amount,
      'platform_amount', v_existing.platform_amount,
      'frozen', true,
      'freeze_reason', 'transfer_ids_present'
    );
  end if;

  select * into v_snap
  from public.commission_snapshots
  where order_kind = 'food' and order_id = p_order_id;
  if found then
    v_has_snap := true;
  end if;

  -- Soft freeze: paid order with snapshot + existing commissions must not follow live pricing_config.
  if v_has_existing
     and v_has_snap
     and lower(trim(coalesce(v_order.payment_status::text, ''))) = 'paid' then
    return jsonb_build_object(
      'ok', true,
      'order_id', p_order_id,
      'currency', v_existing.currency,
      'client_amount', v_existing.client_amount,
      'driver_amount', v_existing.driver_amount,
      'restaurant_amount', v_existing.restaurant_amount,
      'platform_amount', v_existing.platform_amount,
      'snapshot_applied', true,
      'frozen', true,
      'freeze_reason', 'paid_with_snapshot'
    );
  end if;

  v_order_type := lower(trim(coalesce(v_order.order_type::text, v_order.kind::text, 'food')));
  v_currency_u := upper(coalesce(v_order.currency, 'USD'));
  v_snap_country := upper(trim(coalesce(v_snap.country_code, '')));

  -- Match TS AFRICA_PLATFORM_COUNTRIES: currency map OR snapshot country_code.
  v_is_africa :=
    v_currency_u in ('GNF', 'XOF', 'SLE', 'MRU')
    or v_snap_country in ('GN', 'SN', 'CI', 'ML', 'SL', 'MR');

  if v_order_type in ('errand', 'pickup_dropoff', 'delivery_request') then
    v_config_key := case when v_is_africa then 'errand_africa' else 'errand_default' end;
  else
    v_config_key := case when v_is_africa then 'food_africa' else 'food_default' end;
  end if;

  select * into v_cfg
  from public.pricing_config
  where config_key = v_config_key and active = true
  limit 1;

  -- Fallback if regional row missing (never invent rates).
  if not found then
    v_config_key := case
      when v_order_type in ('errand', 'pickup_dropoff', 'delivery_request') then 'errand_default'
      else 'food_default'
    end;
    select * into v_cfg
    from public.pricing_config
    where config_key = v_config_key and active = true
    limit 1;
  end if;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'pricing_config_not_found');
  end if;

  v_subtotal := greatest(coalesce(v_order.subtotal, 0), 0);
  v_delivery_fee := greatest(coalesce(v_order.delivery_fee, 0), 0);
  v_total := greatest(coalesce(v_order.grand_total, v_order.total, 0), 0);
  v_service_fee := greatest(coalesce(v_order.service_fee, 0), 0);
  v_currency := upper(coalesce(v_order.currency, v_cfg.currency, 'USD'));
  v_restaurant_pct := coalesce(v_cfg.restaurant_pct, 0);
  v_platform_pct := coalesce(v_cfg.platform_pct, 0);
  v_delivery_driver_pct := coalesce(v_cfg.delivery_driver_pct, v_cfg.driver_pct, 80);
  v_delivery_platform_pct := coalesce(v_cfg.delivery_platform_pct, 20);

  if v_has_snap then
    v_platform_pct := coalesce(v_snap.rate_pct, v_platform_pct);
    v_restaurant_pct := greatest(0, 100 - v_platform_pct);
  end if;

  v_has_restaurant :=
    v_order.restaurant_user_id is not null
    or v_order.restaurant_id is not null;

  if v_order_type in ('errand', 'pickup_dropoff', 'delivery_request') then
    v_driver_amount := round(
      greatest(coalesce(v_order.delivery_pay, 0), v_total * coalesce(v_cfg.driver_pct, 80) / 100.0),
      2
    );
    v_platform_amount := round(greatest(v_total - v_driver_amount - v_service_fee, 0), 2);
    v_restaurant_amount := 0;
    v_client_amount := round(v_total, 2);
  elsif v_has_restaurant then
    v_restaurant_amount := round(v_subtotal * v_restaurant_pct / 100.0, 2);
    v_driver_amount := round(
      greatest(
        coalesce(v_order.delivery_pay, 0),
        v_delivery_fee * v_delivery_driver_pct / 100.0
      ),
      2
    );
    v_platform_amount := round(
      greatest(
        v_subtotal * v_platform_pct / 100.0
          + v_delivery_fee * v_delivery_platform_pct / 100.0
          + v_service_fee
          + (case when v_has_snap then coalesce(v_snap.fixed_fee_cents, 0) / 100.0 else 0 end)
          - (case when v_has_snap then coalesce(v_snap.fee_credit_cents, 0) / 100.0 else 0 end),
        0
      ),
      2
    );
    v_client_amount := round(v_total, 2);

    if v_restaurant_amount + v_driver_amount + v_platform_amount > v_total + 0.02 then
      v_platform_amount := round(
        greatest(v_total - v_restaurant_amount - v_driver_amount, 0),
        2
      );
    end if;
  else
    v_driver_amount := round(
      greatest(coalesce(v_order.delivery_pay, 0), v_delivery_fee * v_delivery_driver_pct / 100.0),
      2
    );
    v_platform_amount := round(greatest(v_total - v_driver_amount - v_service_fee, 0), 2);
    v_restaurant_amount := 0;
    v_client_amount := round(v_total, 2);
  end if;

  insert into public.order_commissions (
    order_id, currency,
    client_amount, driver_amount, restaurant_amount, platform_amount,
    client_pct, driver_pct, restaurant_pct, platform_pct,
    client_cents, driver_cents, restaurant_cents, platform_cents,
    client, driver, restaurant, platform, updated_at
  )
  values (
    p_order_id, v_currency,
    v_client_amount, v_driver_amount, v_restaurant_amount, v_platform_amount,
    coalesce(v_cfg.service_fee_pct, v_cfg.client_pct, 0),
    v_delivery_driver_pct, v_restaurant_pct, v_platform_pct,
    (round(v_client_amount * 100))::integer,
    (round(v_driver_amount * 100))::integer,
    (round(v_restaurant_amount * 100))::integer,
    (round(v_platform_amount * 100))::integer,
    v_client_amount, v_driver_amount, v_restaurant_amount, v_platform_amount,
    now()
  )
  on conflict (order_id) do update set
    currency = excluded.currency,
    client_amount = excluded.client_amount,
    driver_amount = excluded.driver_amount,
    restaurant_amount = excluded.restaurant_amount,
    platform_amount = excluded.platform_amount,
    client_pct = excluded.client_pct,
    driver_pct = excluded.driver_pct,
    restaurant_pct = excluded.restaurant_pct,
    platform_pct = excluded.platform_pct,
    client_cents = excluded.client_cents,
    driver_cents = excluded.driver_cents,
    restaurant_cents = excluded.restaurant_cents,
    platform_cents = excluded.platform_cents,
    client = excluded.client,
    driver = excluded.driver,
    restaurant = excluded.restaurant,
    platform = excluded.platform,
    updated_at = now();

  -- Display field only; SCT amounts come from order_commissions.*_cents.
  -- Never overwrite display net after a restaurant Transfer id exists.
  -- IS DISTINCT FROM prevents trg_orders_commissions ↔ refresh recursion.
  update public.orders
  set restaurant_net_amount = v_restaurant_amount
  where id = p_order_id
    and v_has_restaurant
    and nullif(trim(coalesce(restaurant_transfer_id, '')), '') is null
    and restaurant_net_amount is distinct from v_restaurant_amount;

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'currency', v_currency,
    'config_key', v_config_key,
    'client_amount', v_client_amount,
    'driver_amount', v_driver_amount,
    'restaurant_amount', v_restaurant_amount,
    'platform_amount', v_platform_amount,
    'service_fee', v_service_fee,
    'snapshot_applied', v_has_snap,
    'frozen', false
  );
end;
$$;

revoke all on function public.refresh_order_commissions(uuid) from public;
revoke all on function public.refresh_order_commissions(uuid) from anon;
grant execute on function public.refresh_order_commissions(uuid) to authenticated;
grant execute on function public.refresh_order_commissions(uuid) to service_role;
