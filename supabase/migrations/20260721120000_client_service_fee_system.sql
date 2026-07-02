-- Client Service Fee system: admin-configurable, disabled by default.
-- Food / Delivery / Marketplace use pricing_config; Taxi uses taxi_pricing.

begin;

-- ---------------------------------------------------------------------------
-- 1) pricing_config — service fee controls (Food, Delivery/errand, Marketplace)
-- ---------------------------------------------------------------------------

alter table public.pricing_config
  add column if not exists service_fee_enabled boolean not null default false;

alter table public.pricing_config
  add column if not exists service_fee_pct numeric(6, 2) not null default 0
    check (service_fee_pct >= 0 and service_fee_pct <= 100);

alter table public.pricing_config
  add column if not exists service_fee_fixed_cents integer not null default 0
    check (service_fee_fixed_cents >= 0);

-- Backfill from legacy columns when present
update public.pricing_config
set
  service_fee_pct = coalesce(nullif(service_fee_pct, 0), client_pct, 0),
  service_fee_fixed_cents = case
    when service_fee_fixed_cents > 0 then service_fee_fixed_cents
    when coalesce(fixed_client_fee, 0) > 0 then round(fixed_client_fee * 100)::integer
    else 0
  end
where service_fee_enabled = false;

alter table public.pricing_config
  drop constraint if exists pricing_config_order_type_check;

alter table public.pricing_config
  add constraint pricing_config_order_type_check
  check (order_type in ('food', 'errand', 'marketplace'));

insert into public.pricing_config (
  config_key,
  label,
  order_type,
  active,
  region,
  currency,
  client_pct,
  driver_pct,
  restaurant_pct,
  platform_pct,
  delivery_fee_base,
  minimum_order_amount,
  service_fee_enabled,
  service_fee_pct,
  service_fee_fixed_cents,
  notes
)
values
  (
    'marketplace_default',
    'Marketplace default pricing',
    'marketplace',
    true,
    'global',
    'USD',
    0,
    0,
    0,
    0,
    0,
    0,
    false,
    5,
    99,
    'Marketplace service fee defaults — disabled until enabled in Admin Pricing.'
  )
on conflict (config_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2) taxi_pricing — per country / vehicle class service fee
-- ---------------------------------------------------------------------------

alter table public.taxi_pricing
  add column if not exists service_fee_enabled boolean not null default false;

alter table public.taxi_pricing
  add column if not exists service_fee_pct numeric(6, 2) not null default 0
    check (service_fee_pct >= 0 and service_fee_pct <= 100);

alter table public.taxi_pricing
  add column if not exists service_fee_fixed_cents integer not null default 0
    check (service_fee_fixed_cents >= 0);

-- ---------------------------------------------------------------------------
-- 3) orders — persist charged service fee snapshot
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists service_fee numeric(12, 2) not null default 0
    check (service_fee >= 0);

alter table public.orders
  add column if not exists service_fee_cents integer not null default 0
    check (service_fee_cents >= 0);

alter table public.orders
  add column if not exists service_fee_pct numeric(6, 2) not null default 0
    check (service_fee_pct >= 0 and service_fee_pct <= 100);

alter table public.orders
  add column if not exists service_fee_enabled boolean not null default false;

alter table public.orders
  add column if not exists service_fee_fixed_cents integer not null default 0
    check (service_fee_fixed_cents >= 0);

-- ---------------------------------------------------------------------------
-- 4) delivery_requests
-- ---------------------------------------------------------------------------

alter table public.delivery_requests
  add column if not exists service_fee numeric(12, 2) not null default 0
    check (service_fee >= 0);

alter table public.delivery_requests
  add column if not exists service_fee_cents integer not null default 0
    check (service_fee_cents >= 0);

alter table public.delivery_requests
  add column if not exists service_fee_pct numeric(6, 2) not null default 0
    check (service_fee_pct >= 0 and service_fee_pct <= 100);

alter table public.delivery_requests
  add column if not exists service_fee_enabled boolean not null default false;

alter table public.delivery_requests
  add column if not exists service_fee_fixed_cents integer not null default 0
    check (service_fee_fixed_cents >= 0);

-- ---------------------------------------------------------------------------
-- 5) taxi_rides
-- ---------------------------------------------------------------------------

alter table public.taxi_rides
  add column if not exists service_fee_cents integer not null default 0
    check (service_fee_cents >= 0);

alter table public.taxi_rides
  add column if not exists service_fee_pct numeric(6, 2) not null default 0
    check (service_fee_pct >= 0 and service_fee_pct <= 100);

alter table public.taxi_rides
  add column if not exists service_fee_enabled boolean not null default false;

alter table public.taxi_rides
  add column if not exists service_fee_fixed_cents integer not null default 0
    check (service_fee_fixed_cents >= 0);

-- ---------------------------------------------------------------------------
-- 6) seller_orders (marketplace) — snapshot fields
-- ---------------------------------------------------------------------------

alter table public.seller_orders
  add column if not exists service_fee_pct numeric(6, 2) not null default 0
    check (service_fee_pct >= 0 and service_fee_pct <= 100);

alter table public.seller_orders
  add column if not exists service_fee_enabled boolean not null default false;

alter table public.seller_orders
  add column if not exists service_fee_fixed_cents integer not null default 0
    check (service_fee_fixed_cents >= 0);

-- ---------------------------------------------------------------------------
-- 7) Financial update guards — block client tampering of service fee fields
-- ---------------------------------------------------------------------------

create or replace function public.guard_orders_client_financial_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if v_role = 'service_role' or session_user = 'service_role' then
    return NEW;
  end if;

  if public.is_staff_user(auth.uid()) then
    return NEW;
  end if;

  if NEW.subtotal is distinct from OLD.subtotal then
    raise exception 'orders_financial_update_forbidden: subtotal';
  end if;
  if NEW.tax is distinct from OLD.tax then
    raise exception 'orders_financial_update_forbidden: tax';
  end if;
  if NEW.total is distinct from OLD.total then
    raise exception 'orders_financial_update_forbidden: total';
  end if;
  if NEW.grand_total is distinct from OLD.grand_total then
    raise exception 'orders_financial_update_forbidden: grand_total';
  end if;
  if NEW.total_cents is distinct from OLD.total_cents then
    raise exception 'orders_financial_update_forbidden: total_cents';
  end if;
  if upper(coalesce(NEW.currency, '')) is distinct from upper(coalesce(OLD.currency, '')) then
    raise exception 'orders_financial_update_forbidden: currency';
  end if;
  if NEW.delivery_fee is distinct from OLD.delivery_fee then
    raise exception 'orders_financial_update_forbidden: delivery_fee';
  end if;
  if NEW.service_fee is distinct from OLD.service_fee then
    raise exception 'orders_financial_update_forbidden: service_fee';
  end if;
  if NEW.service_fee_cents is distinct from OLD.service_fee_cents then
    raise exception 'orders_financial_update_forbidden: service_fee_cents';
  end if;
  if NEW.service_fee_pct is distinct from OLD.service_fee_pct then
    raise exception 'orders_financial_update_forbidden: service_fee_pct';
  end if;
  if NEW.service_fee_enabled is distinct from OLD.service_fee_enabled then
    raise exception 'orders_financial_update_forbidden: service_fee_enabled';
  end if;
  if NEW.service_fee_fixed_cents is distinct from OLD.service_fee_fixed_cents then
    raise exception 'orders_financial_update_forbidden: service_fee_fixed_cents';
  end if;
  if lower(coalesce(NEW.payment_status, '')) is distinct from lower(coalesce(OLD.payment_status, '')) then
    raise exception 'orders_financial_update_forbidden: payment_status';
  end if;

  return NEW;
end;
$$;

create or replace function public.guard_delivery_requests_client_financial_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if v_role = 'service_role' or session_user = 'service_role' then
    return NEW;
  end if;

  if public.is_staff_user(auth.uid()) then
    return NEW;
  end if;

  if NEW.subtotal is distinct from OLD.subtotal then
    raise exception 'delivery_requests_financial_update_forbidden: subtotal';
  end if;
  if NEW.tax is distinct from OLD.tax then
    raise exception 'delivery_requests_financial_update_forbidden: tax';
  end if;
  if NEW.total is distinct from OLD.total then
    raise exception 'delivery_requests_financial_update_forbidden: total';
  end if;
  if NEW.total_cents is distinct from OLD.total_cents then
    raise exception 'delivery_requests_financial_update_forbidden: total_cents';
  end if;
  if upper(coalesce(NEW.currency, '')) is distinct from upper(coalesce(OLD.currency, '')) then
    raise exception 'delivery_requests_financial_update_forbidden: currency';
  end if;
  if NEW.delivery_fee is distinct from OLD.delivery_fee then
    raise exception 'delivery_requests_financial_update_forbidden: delivery_fee';
  end if;
  if NEW.service_fee is distinct from OLD.service_fee then
    raise exception 'delivery_requests_financial_update_forbidden: service_fee';
  end if;
  if NEW.service_fee_cents is distinct from OLD.service_fee_cents then
    raise exception 'delivery_requests_financial_update_forbidden: service_fee_cents';
  end if;
  if NEW.service_fee_pct is distinct from OLD.service_fee_pct then
    raise exception 'delivery_requests_financial_update_forbidden: service_fee_pct';
  end if;
  if NEW.service_fee_enabled is distinct from OLD.service_fee_enabled then
    raise exception 'delivery_requests_financial_update_forbidden: service_fee_enabled';
  end if;
  if NEW.service_fee_fixed_cents is distinct from OLD.service_fee_fixed_cents then
    raise exception 'delivery_requests_financial_update_forbidden: service_fee_fixed_cents';
  end if;
  if lower(coalesce(NEW.payment_status, '')) is distinct from lower(coalesce(OLD.payment_status, '')) then
    raise exception 'delivery_requests_financial_update_forbidden: payment_status';
  end if;

  return NEW;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) refresh_order_commissions — credit platform with client service fee
-- ---------------------------------------------------------------------------

create or replace function public.refresh_order_commissions(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
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

  v_order_type := lower(trim(coalesce(v_order.order_type, v_order.kind, 'food')));
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

commit;
