-- Production hardening: real order_commissions + refresh_order_commissions (replaces noop stub).
-- Safe to apply on production (idempotent).

begin;

-- ---------------------------------------------------------------------------
-- 1) pricing_config: delivery split columns (used by food commission math)
-- ---------------------------------------------------------------------------

alter table public.pricing_config
  add column if not exists delivery_platform_pct numeric(6, 2) not null default 20;

alter table public.pricing_config
  add column if not exists delivery_driver_pct numeric(6, 2) not null default 80;

update public.pricing_config
set
  delivery_platform_pct = coalesce(delivery_platform_pct, 20),
  delivery_driver_pct = coalesce(delivery_driver_pct, 80)
where config_key in ('food_default', 'errand_default');

-- ---------------------------------------------------------------------------
-- 2) order_commissions table (create if missing from legacy schema)
-- ---------------------------------------------------------------------------

create table if not exists public.order_commissions (
  order_id uuid primary key references public.orders (id) on delete cascade,
  currency text not null default 'USD',
  client_amount numeric(12, 2) not null default 0,
  driver_amount numeric(12, 2) not null default 0,
  restaurant_amount numeric(12, 2) not null default 0,
  platform_amount numeric(12, 2) not null default 0,
  client_pct numeric(6, 2),
  driver_pct numeric(6, 2),
  restaurant_pct numeric(6, 2),
  platform_pct numeric(6, 2),
  client_cents integer not null default 0,
  driver_cents integer not null default 0,
  restaurant_cents integer not null default 0,
  platform_cents integer not null default 0,
  client numeric(12, 2) not null default 0,
  driver numeric(12, 2) not null default 0,
  restaurant numeric(12, 2) not null default 0,
  platform numeric(12, 2) not null default 0,
  restaurant_release_status text default 'pending',
  driver_release_status text default 'pending',
  platform_release_status text default 'pending',
  restaurant_released_at timestamptz,
  driver_released_at timestamptz,
  platform_released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.order_commissions
  add column if not exists client_cents integer not null default 0;

alter table public.order_commissions
  add column if not exists driver_cents integer not null default 0;

alter table public.order_commissions
  add column if not exists restaurant_cents integer not null default 0;

alter table public.order_commissions
  add column if not exists platform_cents integer not null default 0;

alter table public.order_commissions
  add column if not exists client_amount numeric(12, 2) not null default 0;

alter table public.order_commissions
  add column if not exists driver_amount numeric(12, 2) not null default 0;

alter table public.order_commissions
  add column if not exists restaurant_amount numeric(12, 2) not null default 0;

alter table public.order_commissions
  add column if not exists platform_amount numeric(12, 2) not null default 0;

-- ---------------------------------------------------------------------------
-- 3) refresh_order_commissions — always recompute from order + pricing_config
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

  v_order_type := lower(trim(coalesce(v_order.order_type::text, v_order.kind::text, 'food')));

  if v_order_type in ('errand', 'pickup_dropoff', 'delivery_request') then
    v_config_key := 'errand_default';
  else
    v_config_key := 'food_default';
  end if;

  select *
  into v_cfg
  from public.pricing_config
  where config_key = v_config_key
    and active = true
  limit 1;

  if v_cfg.id is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'pricing_config_missing',
      'config_key', v_config_key
    );
  end if;

  v_subtotal := greatest(coalesce(v_order.subtotal, 0), 0);
  v_delivery_fee := greatest(
    coalesce(v_order.delivery_fee, v_order.delivery_fee_est, 0),
    0
  );
  v_total := greatest(
    coalesce(v_order.grand_total, v_order.total, 0),
    coalesce(v_order.total_cents, 0)::numeric / 100.0,
    0
  );
  v_currency := upper(trim(coalesce(v_order.currency, v_cfg.currency, 'USD')));

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
    v_platform_amount := round(greatest(v_total - v_driver_amount, 0), 2);
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
        v_subtotal * v_platform_pct / 100.0 + v_delivery_fee * v_delivery_platform_pct / 100.0,
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
    v_platform_amount := round(greatest(v_total - v_driver_amount, 0), 2);
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
    coalesce(v_cfg.client_pct, 0),
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
    'order_id', p_order_id::text,
    'refreshed', true,
    'restaurant_cents', (round(v_restaurant_amount * 100))::integer,
    'driver_cents', (round(v_driver_amount * 100))::integer,
    'platform_cents', (round(v_platform_amount * 100))::integer
  );
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'error', 'refresh_order_commissions_failed',
      'message', sqlerrm
    );
end;
$$;

create or replace function public.refresh_order_commissions_rpc(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.refresh_order_commissions(p_order_id);
end;
$$;

create or replace function public.refresh_order_commissions_for_range(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_count integer := 0;
begin
  for v_order_id in
    select o.id
    from public.orders o
    where o.created_at >= coalesce(p_from, '-infinity'::timestamptz)
      and o.created_at < coalesce(p_to, 'infinity'::timestamptz)
  loop
    perform public.refresh_order_commissions(v_order_id);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'refreshed', true,
    'count', v_count,
    'from', p_from,
    'to', p_to
  );
end;
$$;

revoke all on function public.refresh_order_commissions(uuid) from public;
revoke all on function public.refresh_order_commissions_rpc(uuid) from public;
revoke all on function public.refresh_order_commissions_for_range(timestamptz, timestamptz) from public;

grant execute on function public.refresh_order_commissions(uuid) to service_role;
grant execute on function public.refresh_order_commissions_rpc(uuid) to service_role;
grant execute on function public.refresh_order_commissions_for_range(timestamptz, timestamptz) to service_role;

commit;
