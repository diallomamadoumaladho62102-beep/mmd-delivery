-- Taxi Globalization Sprint 1: reference countries/currencies (data-driven expansion).

begin;

-- ---------------------------------------------------------------------------
-- 1) taxi_currencies — add new currencies via INSERT only (no schema change)
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_currencies (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  name text not null,
  minor_units smallint not null default 2 check (minor_units >= 0 and minor_units <= 4),
  active boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_taxi_currencies_updated_at on public.taxi_currencies;
create trigger trg_taxi_currencies_updated_at
before update on public.taxi_currencies
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) taxi_countries — add new countries via INSERT only (no schema change)
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_countries (
  country_code text primary key check (country_code ~ '^[A-Z]{2}$'),
  name text not null,
  currency_code text not null references public.taxi_currencies (code),
  active boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists taxi_countries_active_sort_idx
  on public.taxi_countries (active, sort_order, country_code);

drop trigger if exists trg_taxi_countries_updated_at on public.taxi_countries;
create trigger trg_taxi_countries_updated_at
before update on public.taxi_countries
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) Seed currencies (idempotent — future adds = new INSERT migration)
-- ---------------------------------------------------------------------------

insert into public.taxi_currencies (code, name, minor_units, active, sort_order)
values
  ('USD', 'US Dollar', 2, true, 10),
  ('CAD', 'Canadian Dollar', 2, true, 20),
  ('GBP', 'British Pound', 2, true, 30),
  ('EUR', 'Euro', 2, true, 40),
  ('GNF', 'Guinean Franc', 0, true, 50),
  ('XOF', 'West African CFA Franc', 0, true, 60),
  ('SLE', 'Sierra Leonean Leone', 2, true, 70),
  ('MRU', 'Mauritanian Ouguiya', 2, true, 80)
on conflict (code) do update
set
  name = excluded.name,
  minor_units = excluded.minor_units,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 4) Seed countries + currency mappings
-- ---------------------------------------------------------------------------

insert into public.taxi_countries (
  country_code,
  name,
  currency_code,
  active,
  sort_order
)
values
  ('US', 'United States', 'USD', true, 10),
  ('CA', 'Canada', 'CAD', true, 20),
  ('GB', 'United Kingdom', 'GBP', true, 30),
  ('FR', 'France', 'EUR', true, 40),
  ('BE', 'Belgium', 'EUR', true, 50),
  ('GN', 'Guinea', 'GNF', true, 60),
  ('SN', 'Senegal', 'XOF', true, 70),
  ('CI', 'Côte d''Ivoire', 'XOF', true, 80),
  ('ML', 'Mali', 'XOF', true, 90),
  ('SL', 'Sierra Leone', 'SLE', true, 100),
  ('MR', 'Mauritania', 'MRU', true, 110)
on conflict (country_code) do update
set
  name = excluded.name,
  currency_code = excluded.currency_code,
  active = excluded.active,
  sort_order = excluded.sort_order,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 5) Helpers
-- ---------------------------------------------------------------------------

create or replace function public.resolve_taxi_country(p_country_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p_country_code, '')));
  v_row public.taxi_countries%rowtype;
  v_currency public.taxi_currencies%rowtype;
begin
  if v_code = '' then
    return jsonb_build_object('ok', false, 'message', 'country_code_required');
  end if;

  select *
  into v_row
  from public.taxi_countries tc
  where tc.country_code = v_code
    and tc.active = true;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'message', 'country_not_supported',
      'country_code', v_code
    );
  end if;

  select *
  into v_currency
  from public.taxi_currencies cur
  where cur.code = v_row.currency_code
    and cur.active = true;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'message', 'currency_not_supported',
      'country_code', v_row.country_code,
      'currency_code', v_row.currency_code
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'country_code', v_row.country_code,
    'country_name', v_row.name,
    'currency_code', v_currency.code,
    'currency_name', v_currency.name,
    'minor_units', v_currency.minor_units
  );
end;
$$;

create or replace function public.list_taxi_countries()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'country_code', tc.country_code,
        'name', tc.name,
        'currency_code', tc.currency_code,
        'currency_name', cur.name,
        'minor_units', cur.minor_units,
        'sort_order', tc.sort_order
      )
      order by tc.sort_order, tc.country_code
    ),
    '[]'::jsonb
  )
  from public.taxi_countries tc
  join public.taxi_currencies cur on cur.code = tc.currency_code
  where tc.active = true
    and cur.active = true;
$$;

create or replace function public.list_taxi_currencies()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'code', code,
        'name', name,
        'minor_units', minor_units,
        'sort_order', sort_order
      )
      order by sort_order, code
    ),
    '[]'::jsonb
  )
  from public.taxi_currencies
  where active = true;
$$;

-- ---------------------------------------------------------------------------
-- 6) quote_taxi_ride — validate supported country before pricing lookup
-- ---------------------------------------------------------------------------

create or replace function public.quote_taxi_ride(
  p_distance_miles numeric,
  p_duration_minutes numeric,
  p_vehicle_class text default 'standard',
  p_country_code text default 'US',
  p_passenger_count integer default 1
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_class text := lower(trim(coalesce(p_vehicle_class, 'standard')));
  v_country text := upper(trim(coalesce(p_country_code, 'US')));
  v_passengers integer := greatest(coalesce(p_passenger_count, 1), 1);
  v_pricing public.taxi_pricing%rowtype;
  v_country_check jsonb;
  v_distance numeric := greatest(coalesce(p_distance_miles, 0), 0);
  v_duration numeric := greatest(coalesce(p_duration_minutes, 0), 0);
  v_fare numeric;
  v_subtotal_cents integer;
  v_platform_cents integer;
  v_driver_cents integer;
  v_total_cents integer;
begin
  v_country_check := public.resolve_taxi_country(v_country);
  if coalesce((v_country_check->>'ok')::boolean, false) is not true then
    return v_country_check;
  end if;

  select *
  into v_pricing
  from public.taxi_pricing tp
  where tp.active = true
    and tp.country_code = v_country
    and tp.vehicle_class = v_class
  order by tp.updated_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'message', 'pricing_not_found',
      'country_code', v_country,
      'vehicle_class', v_class
    );
  end if;

  if upper(v_pricing.currency) <> upper(v_country_check->>'currency_code') then
    return jsonb_build_object(
      'ok', false,
      'message', 'pricing_currency_mismatch',
      'country_code', v_country,
      'expected_currency', v_country_check->>'currency_code',
      'pricing_currency', v_pricing.currency
    );
  end if;

  if v_passengers > v_pricing.max_passengers then
    return jsonb_build_object(
      'ok', false,
      'message', 'passenger_count_exceeds_vehicle_capacity',
      'max_passengers', v_pricing.max_passengers
    );
  end if;

  v_fare :=
    v_pricing.base_fare
    + (v_distance * v_pricing.per_mile)
    + (v_duration * v_pricing.per_minute);

  v_fare := v_fare * v_pricing.class_multiplier;
  v_fare := greatest(v_fare, v_pricing.min_fare);
  v_fare := v_fare + v_pricing.booking_fee;

  v_subtotal_cents := round(v_fare * 100)::integer;
  v_platform_cents := round(v_subtotal_cents * v_pricing.platform_share_pct / 100.0)::integer;
  v_driver_cents := round(v_subtotal_cents * v_pricing.driver_share_pct / 100.0)::integer;
  v_total_cents := v_subtotal_cents;

  return jsonb_build_object(
    'ok', true,
    'pricing_id', v_pricing.id,
    'config_key', v_pricing.config_key,
    'vehicle_class', v_class,
    'country_code', v_country,
    'country_name', v_country_check->>'country_name',
    'currency', v_pricing.currency,
    'subtotal_cents', v_subtotal_cents,
    'platform_fee_cents', v_platform_cents,
    'driver_payout_cents', v_driver_cents,
    'total_cents', v_total_cents,
    'distance_miles', v_distance,
    'duration_minutes', v_duration,
    'passenger_count', v_passengers
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) RLS — read-only reference data for clients; staff manage via service role
-- ---------------------------------------------------------------------------

alter table public.taxi_currencies enable row level security;
alter table public.taxi_countries enable row level security;

drop policy if exists taxi_currencies_select_active on public.taxi_currencies;
create policy taxi_currencies_select_active
on public.taxi_currencies for select to authenticated
using (active = true or public.is_staff_user(auth.uid()));

drop policy if exists taxi_countries_select_active on public.taxi_countries;
create policy taxi_countries_select_active
on public.taxi_countries for select to authenticated
using (active = true or public.is_staff_user(auth.uid()));

drop policy if exists taxi_currencies_write_staff on public.taxi_currencies;
create policy taxi_currencies_write_staff
on public.taxi_currencies for all to authenticated
using (public.is_staff_user(auth.uid()))
with check (public.is_staff_user(auth.uid()));

drop policy if exists taxi_countries_write_staff on public.taxi_countries;
create policy taxi_countries_write_staff
on public.taxi_countries for all to authenticated
using (public.is_staff_user(auth.uid()))
with check (public.is_staff_user(auth.uid()));

-- ---------------------------------------------------------------------------
-- 8) Grants
-- ---------------------------------------------------------------------------

revoke all on function public.resolve_taxi_country(text) from public;
revoke all on function public.list_taxi_countries() from public;
revoke all on function public.list_taxi_currencies() from public;

grant execute on function public.resolve_taxi_country(text) to authenticated;
grant execute on function public.resolve_taxi_country(text) to service_role;
grant execute on function public.list_taxi_countries() to authenticated;
grant execute on function public.list_taxi_countries() to service_role;
grant execute on function public.list_taxi_currencies() to authenticated;
grant execute on function public.list_taxi_currencies() to service_role;

commit;
