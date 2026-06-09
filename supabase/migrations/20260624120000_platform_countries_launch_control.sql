-- Global Platform Launch Control — platform_countries (overlay on taxi_countries)

begin;

-- ---------------------------------------------------------------------------
-- 1) platform_countries
-- ---------------------------------------------------------------------------

create table if not exists public.platform_countries (
  id uuid primary key default gen_random_uuid(),
  country_code text not null unique check (country_code ~ '^[A-Z]{2}$'),
  country_name text not null,
  continent text,
  region text,
  platform_enabled boolean not null default false,
  taxi_enabled boolean not null default false,
  delivery_enabled boolean not null default false,
  restaurant_enabled boolean not null default false,
  checkout_enabled boolean not null default false,
  payout_enabled boolean not null default false,
  maintenance_mode boolean not null default false,
  launch_status text not null default 'disabled'
    check (launch_status in ('enabled', 'disabled', 'maintenance')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_countries_continent_idx
  on public.platform_countries (continent, country_name);

create index if not exists platform_countries_launch_idx
  on public.platform_countries (platform_enabled, launch_status, country_code);

drop trigger if exists trg_platform_countries_updated_at on public.platform_countries;
create trigger trg_platform_countries_updated_at
before update on public.platform_countries
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Seed from taxi_countries (idempotent)
-- ---------------------------------------------------------------------------

insert into public.platform_countries (
  country_code,
  country_name,
  continent,
  region,
  platform_enabled,
  taxi_enabled,
  delivery_enabled,
  restaurant_enabled,
  checkout_enabled,
  payout_enabled,
  maintenance_mode,
  launch_status
)
select
  tc.country_code,
  tc.name,
  case
    when tc.country_code in ('US', 'CA') then 'North America'
    when tc.country_code in ('GB', 'FR', 'BE') then 'Europe'
    when tc.country_code in ('GN', 'SN', 'CI', 'ML', 'SL', 'MR') then 'Africa'
    else 'Other'
  end,
  case
    when tc.country_code = 'US' then 'United States'
    when tc.country_code = 'CA' then 'Canada'
    when tc.country_code = 'GB' then 'United Kingdom'
    when tc.country_code = 'FR' then 'France'
    when tc.country_code = 'BE' then 'Belgium'
    when tc.country_code = 'GN' then 'West Africa'
    when tc.country_code in ('SN', 'CI', 'ML') then 'West Africa'
    when tc.country_code = 'SL' then 'West Africa'
    when tc.country_code = 'MR' then 'North Africa'
    else tc.name
  end,
  tc.country_code in ('US', 'CA', 'GB', 'FR', 'BE')
    and tc.launch_status = 'enabled'
    and tc.active = true,
  tc.launch_status = 'enabled' and tc.active = true,
  tc.country_code in ('US', 'CA', 'GB', 'FR', 'BE')
    and tc.launch_status = 'enabled'
    and tc.active = true,
  tc.country_code in ('US', 'CA', 'GB', 'FR', 'BE')
    and tc.launch_status = 'enabled'
    and tc.active = true,
  coalesce(tc.checkout_enabled, false),
  coalesce(tc.payout_enabled, false),
  tc.launch_status = 'maintenance',
  case
    when tc.launch_status = 'maintenance' then 'maintenance'
    when tc.launch_status = 'enabled' and tc.active = true then 'enabled'
    else 'disabled'
  end
from public.taxi_countries tc
on conflict (country_code) do update
set
  country_name = excluded.country_name,
  continent = excluded.continent,
  region = excluded.region,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 3) Auto-provision future taxi_countries rows (disabled by default)
-- ---------------------------------------------------------------------------

create or replace function public.sync_platform_country_from_taxi()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.platform_countries (
    country_code,
    country_name,
    continent,
    region,
    platform_enabled,
    taxi_enabled,
    delivery_enabled,
    restaurant_enabled,
    checkout_enabled,
    payout_enabled,
    maintenance_mode,
    launch_status
  )
  values (
    new.country_code,
    new.name,
    'Other',
    new.name,
    false,
    false,
    false,
    false,
    false,
    false,
    false,
    'disabled'
  )
  on conflict (country_code) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_taxi_countries_sync_platform on public.taxi_countries;
create trigger trg_taxi_countries_sync_platform
after insert on public.taxi_countries
for each row execute function public.sync_platform_country_from_taxi();

-- ---------------------------------------------------------------------------
-- 4) SQL helpers — platform feature guard (used by triggers + RPC)
-- ---------------------------------------------------------------------------

create or replace function public.infer_platform_country_code(
  p_currency text default null,
  p_lat double precision default null,
  p_lng double precision default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_currency text := upper(trim(coalesce(p_currency, '')));
begin
  if v_currency = 'USD' then return 'US'; end if;
  if v_currency = 'CAD' then return 'CA'; end if;
  if v_currency = 'GBP' then return 'GB'; end if;
  if v_currency = 'EUR' then return 'FR'; end if;
  if v_currency = 'GNF' then return 'GN'; end if;
  if v_currency = 'XOF' then return 'SN'; end if;
  if v_currency = 'SLE' then return 'SL'; end if;
  if v_currency = 'MRU' then return 'MR'; end if;

  return 'US';
end;
$$;

create or replace function public.assert_platform_country_feature(
  p_country_code text,
  p_vertical text,
  p_feature text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p_country_code, '')));
  v_vertical text := lower(trim(coalesce(p_vertical, '')));
  v_feature text := lower(trim(coalesce(p_feature, '')));
  v_row public.platform_countries%rowtype;
begin
  if v_code = '' then
    return jsonb_build_object(
      'ok', false,
      'error', 'country_code_required',
      'message', 'Country code is required'
    );
  end if;

  select * into v_row from public.platform_countries where country_code = v_code;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'platform_country_not_configured',
      'message', format('Platform country %s is not configured', v_code),
      'country_code', v_code
    );
  end if;

  if v_row.maintenance_mode or v_row.launch_status = 'maintenance' then
    return jsonb_build_object(
      'ok', false,
      'error', 'platform_maintenance',
      'message', format('MMD platform in %s is under maintenance', v_code),
      'country_code', v_code
    );
  end if;

  if not v_row.platform_enabled then
    return jsonb_build_object(
      'ok', false,
      'error', 'platform_disabled',
      'message', format('MMD platform is not available in %s', v_code),
      'country_code', v_code
    );
  end if;

  if v_vertical = 'platform' and v_feature = 'active' then
    return jsonb_build_object('ok', true, 'country_code', v_code);
  end if;

  if v_vertical = 'taxi' then
    if not v_row.taxi_enabled then
      return jsonb_build_object(
        'ok', false,
        'error', 'platform_taxi_disabled',
        'message', format('Taxi is not enabled in %s', v_code),
        'country_code', v_code
      );
    end if;
  elsif v_vertical = 'delivery' then
    if not v_row.delivery_enabled then
      return jsonb_build_object(
        'ok', false,
        'error', 'platform_delivery_disabled',
        'message', format('Delivery is not enabled in %s', v_code),
        'country_code', v_code
      );
    end if;
  elsif v_vertical = 'restaurant' then
    if not v_row.restaurant_enabled then
      return jsonb_build_object(
        'ok', false,
        'error', 'platform_restaurant_disabled',
        'message', format('Restaurant is not enabled in %s', v_code),
        'country_code', v_code
      );
    end if;
  else
    return jsonb_build_object(
      'ok', false,
      'error', 'platform_vertical_invalid',
      'message', format('Invalid platform vertical: %s', v_vertical),
      'country_code', v_code
    );
  end if;

  if v_feature = 'checkout' and not v_row.checkout_enabled then
    return jsonb_build_object(
      'ok', false,
      'error', 'platform_checkout_disabled',
      'message', format('Checkout is not enabled in %s', v_code),
      'country_code', v_code
    );
  end if;

  if v_feature = 'payout' and not v_row.payout_enabled then
    return jsonb_build_object(
      'ok', false,
      'error', 'platform_payout_disabled',
      'message', format('Payouts are not enabled in %s', v_code),
      'country_code', v_code
    );
  end if;

  if v_feature not in ('active', 'checkout', 'payout') then
    return jsonb_build_object(
      'ok', false,
      'error', 'platform_feature_invalid',
      'message', format('Invalid platform feature: %s', v_feature),
      'country_code', v_code
    );
  end if;

  return jsonb_build_object('ok', true, 'country_code', v_code);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Delivery create guard (mobile direct insert)
-- ---------------------------------------------------------------------------

create or replace function public.guard_delivery_request_platform()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country text;
  v_check jsonb;
begin
  v_country := public.infer_platform_country_code(new.currency, new.pickup_lat, new.pickup_lng);
  v_check := public.assert_platform_country_feature(v_country, 'delivery', 'active');

  if coalesce((v_check->>'ok')::boolean, false) is not true then
    raise exception '%', coalesce(v_check->>'message', 'platform_delivery_disabled')
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_delivery_requests_platform_guard on public.delivery_requests;
create trigger trg_delivery_requests_platform_guard
before insert on public.delivery_requests
for each row execute function public.guard_delivery_request_platform();

-- ---------------------------------------------------------------------------
-- 6) RLS — staff only
-- ---------------------------------------------------------------------------

alter table public.platform_countries enable row level security;

drop policy if exists platform_countries_select_staff on public.platform_countries;
create policy platform_countries_select_staff
on public.platform_countries for select to authenticated
using (public.is_staff_user(auth.uid()));

drop policy if exists platform_countries_write_staff on public.platform_countries;
create policy platform_countries_write_staff
on public.platform_countries for all to authenticated
using (public.is_staff_user(auth.uid()))
with check (public.is_staff_user(auth.uid()));

revoke all on function public.infer_platform_country_code(text, double precision, double precision) from public;
revoke all on function public.assert_platform_country_feature(text, text, text) from public;
grant execute on function public.infer_platform_country_code(text, double precision, double precision) to authenticated, service_role;
grant execute on function public.assert_platform_country_feature(text, text, text) to authenticated, service_role;

commit;
