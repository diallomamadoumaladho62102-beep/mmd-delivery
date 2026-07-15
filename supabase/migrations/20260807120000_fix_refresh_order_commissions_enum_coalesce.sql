-- Fix: refresh_order_commissions coalesced incompatible enums order_type + order_kind.
-- Symptom on food create INSERT: "COALESCE could not convert type order_kind to order_type"
-- Trigger path: trg_orders_commissions → upsert/refresh commissions.
--
-- Safe: CREATE OR REPLACE of same signature; behavior unchanged aside from text casts.

begin;

create or replace function public.refresh_order_commissions(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order public.orders%rowtype;
  v_cfg public.pricing_config%rowtype;
  v_order_type text;
  v_config_key text;
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
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'order_id_required');
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  -- CRITICAL: cast both enums to text before COALESCE (order_type ≠ order_kind).
  v_order_type := lower(trim(coalesce(v_order.order_type::text, v_order.kind::text, 'food')));
  v_config_key := case
    when v_order_type in ('errand', 'pickup_dropoff', 'delivery_request') then 'errand_default'
    else 'food_default'
  end;

  select *
  into v_cfg
  from public.pricing_config
  where config_key = v_config_key
    and active = true
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'pricing_config_not_found');
  end if;

  v_subtotal := greatest(coalesce(v_order.subtotal, 0), 0);
  v_delivery_fee := greatest(coalesce(v_order.delivery_fee, 0), 0);
  v_total := greatest(
    coalesce(v_order.grand_total, v_order.total, 0),
    0
  );
  v_service_fee := greatest(coalesce(v_order.service_fee, 0), 0);
  v_currency := upper(coalesce(v_order.currency, v_cfg.currency, 'USD'));
  v_restaurant_pct := coalesce(v_cfg.restaurant_pct, 0);
  v_platform_pct := coalesce(v_cfg.platform_pct, 0);
  v_delivery_driver_pct := coalesce(v_cfg.delivery_driver_pct, v_cfg.driver_pct, 80);
  v_delivery_platform_pct := coalesce(v_cfg.delivery_platform_pct, 20);

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
          + v_service_fee,
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
    order_id,
    currency,
    client_amount,
    driver_amount,
    restaurant_amount,
    platform_amount,
    client_pct,
    driver_pct,
    restaurant_pct,
    platform_pct,
    client_cents,
    driver_cents,
    restaurant_cents,
    platform_cents,
    client,
    driver,
    restaurant,
    platform,
    updated_at
  )
  values (
    p_order_id,
    v_currency,
    v_client_amount,
    v_driver_amount,
    v_restaurant_amount,
    v_platform_amount,
    coalesce(v_cfg.service_fee_pct, v_cfg.client_pct, 0),
    v_delivery_driver_pct,
    v_restaurant_pct,
    v_platform_pct,
    (round(v_client_amount * 100))::integer,
    (round(v_driver_amount * 100))::integer,
    (round(v_restaurant_amount * 100))::integer,
    (round(v_platform_amount * 100))::integer,
    v_client_amount,
    v_driver_amount,
    v_restaurant_amount,
    v_platform_amount,
    now()
  )
  on conflict (order_id) do update
  set
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

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'currency', v_currency,
    'client_amount', v_client_amount,
    'driver_amount', v_driver_amount,
    'restaurant_amount', v_restaurant_amount,
    'platform_amount', v_platform_amount,
    'service_fee', v_service_fee
  );
end;
$$;

revoke all on function public.refresh_order_commissions(uuid) from public;
revoke all on function public.refresh_order_commissions(uuid) from anon;
grant execute on function public.refresh_order_commissions(uuid) to authenticated;
grant execute on function public.refresh_order_commissions(uuid) to service_role;

commit;
