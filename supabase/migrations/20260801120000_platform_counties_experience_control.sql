-- County Experience Control — platform_counties under existing platform_regions (OFF by default)

begin;

-- ---------------------------------------------------------------------------
-- 1) platform_counties — commercial flags per county (under a state/region)
-- ---------------------------------------------------------------------------

create table if not exists public.platform_counties (
  id uuid primary key default gen_random_uuid(),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  region_code text not null,
  county_code text not null,
  county_name text not null,
  platform_enabled boolean not null default false,
  taxi_enabled boolean not null default false,
  delivery_enabled boolean not null default false,
  restaurant_enabled boolean not null default false,
  marketplace_enabled boolean not null default false,
  seller_enabled boolean not null default false,
  checkout_enabled boolean not null default false,
  payout_enabled boolean not null default false,
  maintenance_mode boolean not null default false,
  launch_status text not null default 'disabled'
    check (launch_status in ('enabled', 'disabled', 'maintenance')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_code, region_code, county_code),
  foreign key (country_code, region_code)
    references public.platform_regions (country_code, region_code)
    on delete cascade
);

create index if not exists platform_counties_region_idx
  on public.platform_counties (country_code, region_code, county_code);

drop trigger if exists trg_platform_counties_updated_at on public.platform_counties;
create trigger trg_platform_counties_updated_at
before update on public.platform_counties
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Seed New York counties (all commercial flags OFF — admin enables later)
-- ---------------------------------------------------------------------------

insert into public.platform_counties (
  country_code,
  region_code,
  county_code,
  county_name,
  platform_enabled,
  taxi_enabled,
  delivery_enabled,
  restaurant_enabled,
  marketplace_enabled,
  seller_enabled,
  checkout_enabled,
  payout_enabled,
  maintenance_mode,
  launch_status
)
values
  ('US', 'ny', 'nassau', 'Nassau County', false, false, false, false, false, false, false, false, false, 'disabled'),
  ('US', 'ny', 'suffolk', 'Suffolk County', false, false, false, false, false, false, false, false, false, 'disabled'),
  ('US', 'ny', 'nyc', 'New York City', false, false, false, false, false, false, false, false, false, 'disabled'),
  ('US', 'ny', 'westchester', 'Westchester County', false, false, false, false, false, false, false, false, false, 'disabled')
on conflict (country_code, region_code, county_code) do nothing;

-- ---------------------------------------------------------------------------
-- 3) SQL helper — scope feature guard (country → region → county)
-- ---------------------------------------------------------------------------

drop function if exists public.assert_platform_scope_feature(text, text, text, text, uuid);

create or replace function public.assert_platform_scope_feature(
  p_country_code text,
  p_vertical text,
  p_feature text,
  p_region_code text default null,
  p_mmd_zone_id uuid default null,
  p_county_code text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_country text := upper(trim(coalesce(p_country_code, '')));
  v_region text := lower(trim(coalesce(p_region_code, '')));
  v_county text := lower(trim(coalesce(p_county_code, '')));
  v_vertical text := lower(trim(coalesce(p_vertical, '')));
  v_feature text := lower(trim(coalesce(p_feature, '')));
  v_country_row public.platform_countries%rowtype;
  v_region_row public.platform_regions%rowtype;
  v_county_row public.platform_counties%rowtype;
  v_use_region boolean := false;
  v_use_county boolean := false;
  v_scope_level text := 'country';
begin
  if v_country = '' then
    return jsonb_build_object(
      'ok', false,
      'error', 'country_code_required',
      'message', 'Country code is required'
    );
  end if;

  select * into v_country_row from public.platform_countries where country_code = v_country;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'platform_country_not_configured',
      'message', format('Platform country %s is not configured', v_country),
      'country_code', v_country
    );
  end if;

  if p_mmd_zone_id is not null then
    select * into v_region_row
    from public.platform_regions
    where mmd_zone_id = p_mmd_zone_id
    limit 1;
    v_use_region := found;
  elsif v_region <> '' then
    select * into v_region_row
    from public.platform_regions
    where country_code = v_country and region_code = v_region;
    v_use_region := found;
  end if;

  if not v_country_row.platform_enabled then
    return jsonb_build_object(
      'ok', false,
      'error', 'platform_disabled',
      'message', format('MMD platform is not available in %s', v_country),
      'country_code', v_country,
      'scope_level', 'country'
    );
  end if;

  if v_use_region then
    v_scope_level := case when v_region_row.mmd_zone_id is null then 'region' else 'zone' end;

    if v_region_row.maintenance_mode or v_region_row.launch_status = 'maintenance' then
      return jsonb_build_object(
        'ok', false,
        'error', 'platform_maintenance',
        'message', format('MMD platform in %s/%s is under maintenance', v_country, v_region_row.region_code),
        'country_code', v_country,
        'region_code', v_region_row.region_code,
        'scope_level', v_scope_level
      );
    end if;

    if not v_region_row.platform_enabled then
      return jsonb_build_object(
        'ok', false,
        'error', 'platform_disabled',
        'message', format('MMD platform is not available in %s/%s', v_country, v_region_row.region_code),
        'country_code', v_country,
        'region_code', v_region_row.region_code,
        'scope_level', v_scope_level
      );
    end if;

    if v_county <> '' then
      select * into v_county_row
      from public.platform_counties
      where country_code = v_country
        and region_code = v_region_row.region_code
        and county_code = v_county;
      v_use_county := found;
    end if;

    if v_use_county then
      v_scope_level := 'county';

      if v_county_row.maintenance_mode or v_county_row.launch_status = 'maintenance' then
        return jsonb_build_object(
          'ok', false,
          'error', 'platform_maintenance',
          'message', format('MMD platform in %s/%s/%s is under maintenance', v_country, v_region_row.region_code, v_county_row.county_code),
          'country_code', v_country,
          'region_code', v_region_row.region_code,
          'county_code', v_county_row.county_code,
          'scope_level', 'county'
        );
      end if;

      if not v_county_row.platform_enabled then
        return jsonb_build_object(
          'ok', false,
          'error', 'platform_disabled',
          'message', format('MMD platform is not available in %s/%s/%s', v_country, v_region_row.region_code, v_county_row.county_code),
          'country_code', v_country,
          'region_code', v_region_row.region_code,
          'county_code', v_county_row.county_code,
          'scope_level', 'county'
        );
      end if;

      if v_vertical = 'platform' and v_feature = 'active' then
        return jsonb_build_object(
          'ok', true,
          'country_code', v_country,
          'region_code', v_region_row.region_code,
          'county_code', v_county_row.county_code,
          'scope_level', 'county'
        );
      end if;

      if v_vertical = 'taxi' and not v_county_row.taxi_enabled then
        return jsonb_build_object('ok', false, 'error', 'platform_taxi_disabled', 'message', format('Taxi is not enabled in %s/%s/%s', v_country, v_region_row.region_code, v_county_row.county_code), 'country_code', v_country, 'region_code', v_region_row.region_code, 'county_code', v_county_row.county_code);
      elsif v_vertical = 'delivery' and not v_county_row.delivery_enabled then
        return jsonb_build_object('ok', false, 'error', 'platform_delivery_disabled', 'message', format('Delivery is not enabled in %s/%s/%s', v_country, v_region_row.region_code, v_county_row.county_code), 'country_code', v_country, 'region_code', v_region_row.region_code, 'county_code', v_county_row.county_code);
      elsif v_vertical = 'restaurant' and not v_county_row.restaurant_enabled then
        return jsonb_build_object('ok', false, 'error', 'platform_restaurant_disabled', 'message', format('Restaurant is not enabled in %s/%s/%s', v_country, v_region_row.region_code, v_county_row.county_code), 'country_code', v_country, 'region_code', v_region_row.region_code, 'county_code', v_county_row.county_code);
      elsif v_vertical = 'marketplace' and not v_county_row.marketplace_enabled then
        return jsonb_build_object('ok', false, 'error', 'platform_marketplace_disabled', 'message', format('Marketplace is not enabled in %s/%s/%s', v_country, v_region_row.region_code, v_county_row.county_code), 'country_code', v_country, 'region_code', v_region_row.region_code, 'county_code', v_county_row.county_code);
      end if;

      if v_feature = 'checkout' and not v_county_row.checkout_enabled then
        return jsonb_build_object('ok', false, 'error', 'platform_checkout_disabled', 'message', format('Checkout is not enabled in %s/%s/%s', v_country, v_region_row.region_code, v_county_row.county_code), 'country_code', v_country, 'region_code', v_region_row.region_code, 'county_code', v_county_row.county_code);
      end if;

      if v_feature = 'payout' and not v_county_row.payout_enabled then
        return jsonb_build_object('ok', false, 'error', 'platform_payout_disabled', 'message', format('Payouts are not enabled in %s/%s/%s', v_country, v_region_row.region_code, v_county_row.county_code), 'country_code', v_country, 'region_code', v_region_row.region_code, 'county_code', v_county_row.county_code);
      end if;

      return jsonb_build_object(
        'ok', true,
        'country_code', v_country,
        'region_code', v_region_row.region_code,
        'county_code', v_county_row.county_code,
        'scope_level', 'county'
      );
    end if;

    if v_vertical = 'platform' and v_feature = 'active' then
      return jsonb_build_object(
        'ok', true,
        'country_code', v_country,
        'region_code', v_region_row.region_code,
        'scope_level', v_scope_level
      );
    end if;

    if v_vertical = 'taxi' and not v_region_row.taxi_enabled then
      return jsonb_build_object('ok', false, 'error', 'platform_taxi_disabled', 'message', format('Taxi is not enabled in %s/%s', v_country, v_region_row.region_code), 'country_code', v_country, 'region_code', v_region_row.region_code);
    elsif v_vertical = 'delivery' and not v_region_row.delivery_enabled then
      return jsonb_build_object('ok', false, 'error', 'platform_delivery_disabled', 'message', format('Delivery is not enabled in %s/%s', v_country, v_region_row.region_code), 'country_code', v_country, 'region_code', v_region_row.region_code);
    elsif v_vertical = 'restaurant' and not v_region_row.restaurant_enabled then
      return jsonb_build_object('ok', false, 'error', 'platform_restaurant_disabled', 'message', format('Restaurant is not enabled in %s/%s', v_country, v_region_row.region_code), 'country_code', v_country, 'region_code', v_region_row.region_code);
    end if;

    if v_feature = 'checkout' and not v_region_row.checkout_enabled then
      return jsonb_build_object('ok', false, 'error', 'platform_checkout_disabled', 'message', format('Checkout is not enabled in %s/%s', v_country, v_region_row.region_code), 'country_code', v_country, 'region_code', v_region_row.region_code);
    end if;

    if v_feature = 'payout' and not v_region_row.payout_enabled then
      return jsonb_build_object('ok', false, 'error', 'platform_payout_disabled', 'message', format('Payouts are not enabled in %s/%s', v_country, v_region_row.region_code), 'country_code', v_country, 'region_code', v_region_row.region_code);
    end if;

    return jsonb_build_object(
      'ok', true,
      'country_code', v_country,
      'region_code', v_region_row.region_code,
      'scope_level', v_scope_level
    );
  end if;

  return public.assert_platform_country_feature(v_country, v_vertical, v_feature);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) RLS — staff only
-- ---------------------------------------------------------------------------

alter table public.platform_counties enable row level security;

drop policy if exists platform_counties_select_staff on public.platform_counties;
create policy platform_counties_select_staff
on public.platform_counties for select to authenticated
using (public.is_staff_user(auth.uid()));

drop policy if exists platform_counties_write_staff on public.platform_counties;
create policy platform_counties_write_staff
on public.platform_counties for all to authenticated
using (public.is_staff_user(auth.uid()))
with check (public.is_staff_user(auth.uid()));

revoke all on function public.assert_platform_scope_feature(text, text, text, text, uuid, text) from public;
grant execute on function public.assert_platform_scope_feature(text, text, text, text, uuid, text) to authenticated, service_role;

commit;
