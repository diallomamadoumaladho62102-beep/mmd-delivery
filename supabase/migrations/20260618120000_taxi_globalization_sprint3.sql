-- Taxi Globalization Sprint 3: auto country config, FX, taxes, localization fields.

begin;

-- ---------------------------------------------------------------------------
-- 1) Extend taxi_countries (localization / ops config)
-- ---------------------------------------------------------------------------

alter table public.taxi_countries
  add column if not exists timezone text,
  add column if not exists phone_country_code text,
  add column if not exists default_language text not null default 'en'
    check (default_language in ('en', 'fr'));

update public.taxi_countries tc
set
  timezone = v.timezone,
  phone_country_code = v.phone_country_code,
  default_language = v.default_language,
  updated_at = now()
from (
  values
    ('US', 'America/New_York', '+1', 'en'),
    ('CA', 'America/Toronto', '+1', 'en'),
    ('GB', 'Europe/London', '+44', 'en'),
    ('FR', 'Europe/Paris', '+33', 'fr'),
    ('BE', 'Europe/Brussels', '+32', 'fr'),
    ('GN', 'Africa/Conakry', '+224', 'fr'),
    ('SN', 'Africa/Dakar', '+221', 'fr'),
    ('CI', 'Africa/Abidjan', '+225', 'fr'),
    ('ML', 'Africa/Bamako', '+223', 'fr'),
    ('SL', 'Africa/Freetown', '+232', 'en'),
    ('MR', 'Africa/Nouakchott', '+222', 'fr')
) as v(country_code, timezone, phone_country_code, default_language)
where tc.country_code = v.country_code;

-- ---------------------------------------------------------------------------
-- 2) taxi_exchange_rates
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_exchange_rates (
  id uuid primary key default gen_random_uuid(),
  from_currency text not null references public.taxi_currencies (code),
  to_currency text not null references public.taxi_currencies (code),
  rate numeric(18, 8) not null check (rate > 0),
  source text not null default 'manual',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint taxi_exchange_rates_pair_check check (from_currency <> to_currency)
);

create unique index if not exists taxi_exchange_rates_active_pair_uq
  on public.taxi_exchange_rates (from_currency, to_currency)
  where active = true;

drop trigger if exists trg_taxi_exchange_rates_updated_at on public.taxi_exchange_rates;
create trigger trg_taxi_exchange_rates_updated_at
before update on public.taxi_exchange_rates
for each row execute function public.taxi_set_updated_at();

-- MVP reference rates (admin-editable; not used for Stripe checkout conversion)
insert into public.taxi_exchange_rates (from_currency, to_currency, rate, source, active)
values
  ('USD', 'EUR', 0.92000000, 'mvp_seed', true),
  ('USD', 'GBP', 0.79000000, 'mvp_seed', true),
  ('USD', 'CAD', 1.36000000, 'mvp_seed', true),
  ('USD', 'GNF', 8600.00000000, 'mvp_seed', true),
  ('USD', 'XOF', 600.00000000, 'mvp_seed', true),
  ('USD', 'SLE', 22.50000000, 'mvp_seed', true),
  ('USD', 'MRU', 39.50000000, 'mvp_seed', true),
  ('EUR', 'USD', 1.08695652, 'mvp_seed', true),
  ('GBP', 'USD', 1.26582278, 'mvp_seed', true),
  ('CAD', 'USD', 0.73529412, 'mvp_seed', true),
  ('GNF', 'USD', 0.00011628, 'mvp_seed', true),
  ('XOF', 'USD', 0.00166667, 'mvp_seed', true),
  ('SLE', 'USD', 0.04444444, 'mvp_seed', true),
  ('MRU', 'USD', 0.02531646, 'mvp_seed', true)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3) taxi_country_taxes
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_country_taxes (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.taxi_countries (country_code),
  tax_name text not null,
  tax_rate numeric(6, 3) not null default 0 check (tax_rate >= 0 and tax_rate <= 100),
  active boolean not null default true,
  applies_to text not null default 'ride'
    check (applies_to in ('ride', 'booking_fee', 'platform_fee')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists taxi_country_taxes_country_active_idx
  on public.taxi_country_taxes (country_code, active, applies_to);

create unique index if not exists taxi_country_taxes_country_name_applies_uq
  on public.taxi_country_taxes (country_code, tax_name, applies_to);

drop trigger if exists trg_taxi_country_taxes_updated_at on public.taxi_country_taxes;
create trigger trg_taxi_country_taxes_updated_at
before update on public.taxi_country_taxes
for each row execute function public.taxi_set_updated_at();

insert into public.taxi_country_taxes (country_code, tax_name, tax_rate, active, applies_to, metadata)
values
  ('US', 'Sales tax (placeholder)', 8.000, true, 'ride', '{"type":"sales_tax","placeholder":true}'::jsonb),
  ('CA', 'GST (placeholder)', 5.000, true, 'ride', '{"type":"gst","placeholder":true}'::jsonb),
  ('GB', 'VAT (placeholder)', 20.000, true, 'ride', '{"type":"vat","placeholder":true}'::jsonb),
  ('FR', 'TVA (placeholder)', 20.000, true, 'ride', '{"type":"vat","placeholder":true}'::jsonb),
  ('BE', 'TVA (placeholder)', 21.000, true, 'ride', '{"type":"vat","placeholder":true}'::jsonb),
  ('GN', 'Taxe locale (placeholder)', 18.000, true, 'ride', '{"type":"local","placeholder":true}'::jsonb),
  ('SN', 'TVA (placeholder)', 18.000, true, 'ride', '{"type":"vat","placeholder":true}'::jsonb),
  ('CI', 'TVA (placeholder)', 18.000, true, 'ride', '{"type":"vat","placeholder":true}'::jsonb),
  ('ML', 'TVA (placeholder)', 18.000, true, 'ride', '{"type":"vat","placeholder":true}'::jsonb),
  ('SL', 'GST (placeholder)', 15.000, true, 'ride', '{"type":"gst","placeholder":true}'::jsonb),
  ('MR', 'TVA (placeholder)', 16.000, true, 'ride', '{"type":"vat","placeholder":true}'::jsonb)
on conflict (country_code, tax_name, applies_to) do update
set
  tax_rate = excluded.tax_rate,
  active = excluded.active,
  metadata = excluded.metadata,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 4) taxi_rides.tax_cents
-- ---------------------------------------------------------------------------

alter table public.taxi_rides
  add column if not exists tax_cents integer not null default 0 check (tax_cents >= 0);

-- ---------------------------------------------------------------------------
-- 5) Helpers
-- ---------------------------------------------------------------------------

create or replace function public.calculate_taxi_tax_cents(
  p_country_code text,
  p_subtotal_cents integer,
  p_applies_to text default 'ride'
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    sum(round(greatest(coalesce(p_subtotal_cents, 0), 0) * t.tax_rate / 100.0))::integer,
    0
  )
  from public.taxi_country_taxes t
  where t.country_code = upper(trim(coalesce(p_country_code, '')))
    and t.active = true
    and t.applies_to = coalesce(nullif(trim(p_applies_to), ''), 'ride');
$$;

create or replace function public.get_taxi_exchange_rate(
  p_from_currency text,
  p_to_currency text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_from text := upper(trim(coalesce(p_from_currency, '')));
  v_to text := upper(trim(coalesce(p_to_currency, '')));
  v_rate numeric;
begin
  if v_from = '' or v_to = '' then
    return jsonb_build_object('ok', false, 'message', 'currency_required');
  end if;

  if v_from = v_to then
    return jsonb_build_object(
      'ok', true,
      'from_currency', v_from,
      'to_currency', v_to,
      'rate', 1,
      'source', 'identity'
    );
  end if;

  select r.rate
  into v_rate
  from public.taxi_exchange_rates r
  where r.active = true
    and r.from_currency = v_from
    and r.to_currency = v_to
  order by r.updated_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'message', 'exchange_rate_not_found',
      'from_currency', v_from,
      'to_currency', v_to
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'from_currency', v_from,
    'to_currency', v_to,
    'rate', v_rate,
    'source', (
      select r.source
      from public.taxi_exchange_rates r
      where r.active = true
        and r.from_currency = v_from
        and r.to_currency = v_to
      order by r.updated_at desc
      limit 1
    )
  );
end;
$$;

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
    'minor_units', v_currency.minor_units,
    'timezone', v_row.timezone,
    'phone_country_code', v_row.phone_country_code,
    'default_language', v_row.default_language
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
        'sort_order', tc.sort_order,
        'timezone', tc.timezone,
        'phone_country_code', tc.phone_country_code,
        'default_language', tc.default_language
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

-- ---------------------------------------------------------------------------
-- 6) quote_taxi_ride — include tax_cents in totals
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
  v_tax_cents integer;
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
  v_tax_cents := public.calculate_taxi_tax_cents(v_country, v_subtotal_cents, 'ride');
  v_platform_cents := round(v_subtotal_cents * v_pricing.platform_share_pct / 100.0)::integer;
  v_driver_cents := round(v_subtotal_cents * v_pricing.driver_share_pct / 100.0)::integer;
  v_total_cents := v_subtotal_cents + v_tax_cents;

  return jsonb_build_object(
    'ok', true,
    'pricing_id', v_pricing.id,
    'config_key', v_pricing.config_key,
    'vehicle_class', v_class,
    'country_code', v_country,
    'country_name', v_country_check->>'country_name',
    'currency', v_pricing.currency,
    'default_language', v_country_check->>'default_language',
    'subtotal_cents', v_subtotal_cents,
    'tax_cents', v_tax_cents,
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
-- 7) recalculate_taxi_ride_totals — preserve tax in gross totals
-- ---------------------------------------------------------------------------

create or replace function public.recalculate_taxi_ride_totals(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.taxi_rides%rowtype;
  v_gross integer;
  v_tax integer;
  v_promo_discount integer := 0;
  v_loyalty_discount integer := 0;
  v_shared_discount integer := 0;
  v_total_discount integer;
  v_new_total integer;
  v_new_driver integer;
  v_new_platform integer;
  v_driver_share numeric := 75;
begin
  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if v_ride.pricing_snapshot_id is not null then
    select tp.driver_share_pct
    into v_driver_share
    from public.taxi_pricing tp
    where tp.id = v_ride.pricing_snapshot_id;
  elsif v_ride.subtotal_cents > 0 then
    v_driver_share := (v_ride.driver_payout_cents::numeric / v_ride.subtotal_cents::numeric) * 100;
  end if;

  v_tax := greatest(0, coalesce(v_ride.tax_cents, 0));

  v_gross := coalesce(
    v_ride.gross_total_cents,
    v_ride.subtotal_cents + v_tax
      + coalesce(v_ride.discount_cents, 0)
      + coalesce(v_ride.loyalty_discount_cents, 0)
      + coalesce(v_ride.shared_discount_cents, 0)
  );
  if v_gross <= 0 then
    v_gross := greatest(v_ride.total_cents, v_ride.subtotal_cents + v_tax, 0);
  end if;

  v_promo_discount := greatest(0, coalesce(v_ride.discount_cents, 0));
  v_loyalty_discount := greatest(0, coalesce(v_ride.loyalty_discount_cents, 0));
  v_shared_discount := greatest(0, coalesce(v_ride.shared_discount_cents, 0));
  v_total_discount := v_promo_discount + v_loyalty_discount + v_shared_discount;
  v_new_total := greatest(0, v_gross - v_total_discount);

  v_new_driver := greatest(0, round(v_new_total * v_driver_share / 100.0));
  v_new_platform := greatest(0, v_new_total - v_new_driver);

  update public.taxi_rides
  set
    gross_total_cents = v_gross,
    tax_cents = v_tax,
    total_cents = v_new_total,
    driver_payout_cents = v_new_driver,
    platform_fee_cents = v_new_platform,
    updated_at = now()
  where id = p_ride_id;

  return jsonb_build_object(
    'ok', true,
    'gross_total_cents', v_gross,
    'tax_cents', v_tax,
    'discount_cents', v_promo_discount,
    'loyalty_discount_cents', v_loyalty_discount,
    'shared_discount_cents', v_shared_discount,
    'total_cents', v_new_total
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) RLS
-- ---------------------------------------------------------------------------

alter table public.taxi_exchange_rates enable row level security;
alter table public.taxi_country_taxes enable row level security;

drop policy if exists taxi_exchange_rates_select_active on public.taxi_exchange_rates;
create policy taxi_exchange_rates_select_active
on public.taxi_exchange_rates for select to authenticated
using (active = true or public.is_staff_user(auth.uid()));

drop policy if exists taxi_exchange_rates_write_staff on public.taxi_exchange_rates;
create policy taxi_exchange_rates_write_staff
on public.taxi_exchange_rates for all to authenticated
using (public.is_staff_user(auth.uid()))
with check (public.is_staff_user(auth.uid()));

drop policy if exists taxi_country_taxes_select_active on public.taxi_country_taxes;
create policy taxi_country_taxes_select_active
on public.taxi_country_taxes for select to authenticated
using (active = true or public.is_staff_user(auth.uid()));

drop policy if exists taxi_country_taxes_write_staff on public.taxi_country_taxes;
create policy taxi_country_taxes_write_staff
on public.taxi_country_taxes for all to authenticated
using (public.is_staff_user(auth.uid()))
with check (public.is_staff_user(auth.uid()));

-- ---------------------------------------------------------------------------
-- 9) Grants
-- ---------------------------------------------------------------------------

revoke all on function public.calculate_taxi_tax_cents(text, integer, text) from public;
revoke all on function public.get_taxi_exchange_rate(text, text) from public;

grant execute on function public.calculate_taxi_tax_cents(text, integer, text) to authenticated;
grant execute on function public.calculate_taxi_tax_cents(text, integer, text) to service_role;
grant execute on function public.get_taxi_exchange_rate(text, text) to authenticated;
grant execute on function public.get_taxi_exchange_rate(text, text) to service_role;

commit;
