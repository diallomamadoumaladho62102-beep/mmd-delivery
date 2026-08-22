-- Align legacy fee_*_cents / amount_* columns with SoT *_cents / *_amount.
--
-- Audit (Food E2E 43cafe85-...):
--   SoT used by wallet/payouts/transfers: client_cents, driver_cents,
--   restaurant_cents, platform_cents (+ *_amount dollars).
--   Legacy fee_*_cents still displayed by OrderCommission.tsx (now fixed in app
--   to prefer SoT) and can show $6.51 vs true $5.36 if left drifted.
--
-- This migration:
-- 1) Extends soft-freeze heal to also sync fee_*_cents when columns exist.
-- 2) One-shot UPDATE aligning fee_*_cents (+ amount_* if present) to SoT.
-- Does NOT DROP columns (still referenced historically / select *).
-- Idempotent. No business row deletes.

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
  v_client_cents integer := 0;
  v_driver_cents integer := 0;
  v_restaurant_cents integer := 0;
  v_platform_cents integer := 0;
  v_healed boolean := false;
  v_has_fee_cols boolean := false;
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

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'order_commissions'
      and column_name = 'fee_driver_cents'
  ) into v_has_fee_cols;

  select * into v_existing
  from public.order_commissions
  where order_id = p_order_id;
  v_has_existing := found;

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

  if v_has_existing
     and v_has_snap
     and lower(trim(coalesce(v_order.payment_status::text, ''))) = 'paid' then
    v_client_cents := greatest(0, round(coalesce(v_existing.client_amount, 0) * 100))::integer;
    v_driver_cents := greatest(0, round(coalesce(v_existing.driver_amount, 0) * 100))::integer;
    v_restaurant_cents := greatest(0, round(coalesce(v_existing.restaurant_amount, 0) * 100))::integer;
    v_platform_cents := greatest(0, round(coalesce(v_existing.platform_amount, 0) * 100))::integer;

    if v_existing.client_cents is distinct from v_client_cents
       or v_existing.driver_cents is distinct from v_driver_cents
       or v_existing.restaurant_cents is distinct from v_restaurant_cents
       or v_existing.platform_cents is distinct from v_platform_cents
       or v_existing.client is distinct from v_existing.client_amount
       or v_existing.driver is distinct from v_existing.driver_amount
       or v_existing.restaurant is distinct from v_existing.restaurant_amount
       or v_existing.platform is distinct from v_existing.platform_amount
       or (
         v_has_fee_cols and (
           v_existing.fee_client_cents is distinct from v_client_cents
           or v_existing.fee_driver_cents is distinct from v_driver_cents
           or v_existing.fee_restaurant_cents is distinct from v_restaurant_cents
           or v_existing.fee_platform_cents is distinct from v_platform_cents
         )
       )
    then
      if v_has_fee_cols then
        update public.order_commissions
        set
          client_cents = v_client_cents,
          driver_cents = v_driver_cents,
          restaurant_cents = v_restaurant_cents,
          platform_cents = v_platform_cents,
          client = coalesce(v_existing.client_amount, 0),
          driver = coalesce(v_existing.driver_amount, 0),
          restaurant = coalesce(v_existing.restaurant_amount, 0),
          platform = coalesce(v_existing.platform_amount, 0),
          fee_client_cents = v_client_cents,
          fee_driver_cents = v_driver_cents,
          fee_restaurant_cents = v_restaurant_cents,
          fee_platform_cents = v_platform_cents,
          updated_at = now()
        where order_id = p_order_id;
      else
        update public.order_commissions
        set
          client_cents = v_client_cents,
          driver_cents = v_driver_cents,
          restaurant_cents = v_restaurant_cents,
          platform_cents = v_platform_cents,
          client = coalesce(v_existing.client_amount, 0),
          driver = coalesce(v_existing.driver_amount, 0),
          restaurant = coalesce(v_existing.restaurant_amount, 0),
          platform = coalesce(v_existing.platform_amount, 0),
          updated_at = now()
        where order_id = p_order_id;
      end if;
      v_healed := true;
      select * into v_existing from public.order_commissions where order_id = p_order_id;
    end if;

    return jsonb_build_object(
      'ok', true,
      'order_id', p_order_id,
      'currency', v_existing.currency,
      'client_amount', v_existing.client_amount,
      'driver_amount', v_existing.driver_amount,
      'restaurant_amount', v_existing.restaurant_amount,
      'platform_amount', v_existing.platform_amount,
      'client_cents', v_existing.client_cents,
      'driver_cents', v_existing.driver_cents,
      'restaurant_cents', v_existing.restaurant_cents,
      'platform_cents', v_existing.platform_cents,
      'snapshot_applied', true,
      'frozen', true,
      'freeze_reason', 'paid_with_snapshot',
      'cents_healed', v_healed
    );
  end if;

  v_order_type := lower(trim(coalesce(v_order.order_type::text, v_order.kind::text, 'food')));
  v_currency_u := upper(coalesce(v_order.currency, 'USD'));
  v_snap_country := upper(trim(coalesce(v_snap.country_code, '')));

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

  v_client_cents := (round(v_client_amount * 100))::integer;
  v_driver_cents := (round(v_driver_amount * 100))::integer;
  v_restaurant_cents := (round(v_restaurant_amount * 100))::integer;
  v_platform_cents := (round(v_platform_amount * 100))::integer;

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
    v_client_cents, v_driver_cents, v_restaurant_cents, v_platform_cents,
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

  -- Keep legacy fee_* mirrored to SoT after every full recompute.
  if v_has_fee_cols then
    update public.order_commissions
    set
      fee_client_cents = v_client_cents,
      fee_driver_cents = v_driver_cents,
      fee_restaurant_cents = v_restaurant_cents,
      fee_platform_cents = v_platform_cents,
      updated_at = now()
    where order_id = p_order_id
      and (
        fee_client_cents is distinct from v_client_cents
        or fee_driver_cents is distinct from v_driver_cents
        or fee_restaurant_cents is distinct from v_restaurant_cents
        or fee_platform_cents is distinct from v_platform_cents
      );
  end if;

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
    'client_cents', v_client_cents,
    'driver_cents', v_driver_cents,
    'restaurant_cents', v_restaurant_cents,
    'platform_cents', v_platform_cents,
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

-- One-shot: mirror legacy fee_*_cents to SoT *_cents for unpaid-transfer paid rows.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'order_commissions'
      and column_name = 'fee_driver_cents'
  ) then
    update public.order_commissions oc
    set
      fee_client_cents = oc.client_cents,
      fee_driver_cents = oc.driver_cents,
      fee_restaurant_cents = oc.restaurant_cents,
      fee_platform_cents = oc.platform_cents,
      updated_at = now()
    from public.orders o
    where o.id = oc.order_id
      and lower(trim(coalesce(o.payment_status, ''))) = 'paid'
      and nullif(trim(coalesce(o.restaurant_transfer_id, '')), '') is null
      and nullif(trim(coalesce(o.driver_transfer_id, '')), '') is null
      and (
        oc.fee_client_cents is distinct from oc.client_cents
        or oc.fee_driver_cents is distinct from oc.driver_cents
        or oc.fee_restaurant_cents is distinct from oc.restaurant_cents
        or oc.fee_platform_cents is distinct from oc.platform_cents
      );
  end if;
end $$;
