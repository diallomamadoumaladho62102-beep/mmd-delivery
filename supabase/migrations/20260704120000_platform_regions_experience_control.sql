-- Country + Region Experience Control — platform_regions (additive, OFF by default)

begin;

-- ---------------------------------------------------------------------------
-- 1) Extend platform_countries — marketplace / seller flags
-- ---------------------------------------------------------------------------

alter table public.platform_countries
  add column if not exists marketplace_enabled boolean not null default false,
  add column if not exists seller_enabled boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2) platform_regions — commercial flags per region/state/zone
-- ---------------------------------------------------------------------------

create table if not exists public.platform_regions (
  id uuid primary key default gen_random_uuid(),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  region_code text not null,
  region_name text not null,
  region_type text not null default 'region'
    check (region_type in ('state', 'province', 'region', 'prefecture', 'commune', 'city', 'quartier')),
  mmd_zone_id uuid null references public.mmd_zones (id) on delete set null,
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
  unique (country_code, region_code)
);

create index if not exists platform_regions_country_idx
  on public.platform_regions (country_code, region_code);

create index if not exists platform_regions_mmd_zone_idx
  on public.platform_regions (mmd_zone_id)
  where mmd_zone_id is not null;

drop trigger if exists trg_platform_regions_updated_at on public.platform_regions;
create trigger trg_platform_regions_updated_at
before update on public.platform_regions
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) Seed sparse US states (all commercial flags OFF — admin enables later)
-- ---------------------------------------------------------------------------

insert into public.platform_regions (
  country_code,
  region_code,
  region_name,
  region_type,
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
  ('US', 'ny', 'New York', 'state', false, false, false, false, false, false, false, false, false, 'disabled'),
  ('US', 'nj', 'New Jersey', 'state', false, false, false, false, false, false, false, false, false, 'disabled'),
  ('US', 'pa', 'Pennsylvania', 'state', false, false, false, false, false, false, false, false, false, 'disabled'),
  ('US', 'fl', 'Florida', 'state', false, false, false, false, false, false, false, false, false, 'disabled'),
  ('US', 'ca', 'California', 'state', false, false, false, false, false, false, false, false, false, 'disabled'),
  ('US', 'tx', 'Texas', 'state', false, false, false, false, false, false, false, false, false, 'disabled')
on conflict (country_code, region_code) do nothing;

-- ---------------------------------------------------------------------------
-- 4) Seed GN commercial zones linked to mmd_zones (OFF by default)
-- ---------------------------------------------------------------------------

insert into public.platform_regions (
  country_code,
  region_code,
  region_name,
  region_type,
  mmd_zone_id,
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
select
  'GN',
  z.zone_code,
  z.zone_name,
  case
    when z.quartier_name is not null then 'quartier'
    when z.commune_name is not null then 'commune'
    when z.prefecture_name is not null then 'prefecture'
    else 'city'
  end,
  z.id,
  false,
  false,
  false,
  false,
  false,
  false,
  false,
  false,
  false,
  'disabled'
from public.mmd_zones z
where z.zone_code in (
  'gn_conakry',
  'gn_labe',
  'gn_kankan',
  'gn_kindia',
  'gn_mamou',
  'gn_boke',
  'gn_faranah',
  'gn_nzerekore',
  'gn_labe_mali_prefecture',
  'gn_labe_mali_dougountouny'
)
on conflict (country_code, region_code) do nothing;

-- ---------------------------------------------------------------------------
-- 5) SQL helper — scope feature guard (country floor + region override)
-- ---------------------------------------------------------------------------

create or replace function public.assert_platform_scope_feature(
  p_country_code text,
  p_region_code text default null,
  p_mmd_zone_id uuid default null,
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
  v_country text := upper(trim(coalesce(p_country_code, '')));
  v_region text := lower(trim(coalesce(p_region_code, '')));
  v_vertical text := lower(trim(coalesce(p_vertical, '')));
  v_feature text := lower(trim(coalesce(p_feature, '')));
  v_country_row public.platform_countries%rowtype;
  v_region_row public.platform_regions%rowtype;
  v_use_region boolean := false;
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
    if v_region_row.maintenance_mode or v_region_row.launch_status = 'maintenance' then
      return jsonb_build_object(
        'ok', false,
        'error', 'platform_maintenance',
        'message', format('MMD platform in %s/%s is under maintenance', v_country, v_region_row.region_code),
        'country_code', v_country,
        'region_code', v_region_row.region_code,
        'scope_level', case when v_region_row.mmd_zone_id is null then 'region' else 'zone' end
      );
    end if;

    if not v_region_row.platform_enabled then
      return jsonb_build_object(
        'ok', false,
        'error', 'platform_disabled',
        'message', format('MMD platform is not available in %s/%s', v_country, v_region_row.region_code),
        'country_code', v_country,
        'region_code', v_region_row.region_code,
        'scope_level', case when v_region_row.mmd_zone_id is null then 'region' else 'zone' end
      );
    end if;

    if v_vertical = 'platform' and v_feature = 'active' then
      return jsonb_build_object(
        'ok', true,
        'country_code', v_country,
        'region_code', v_region_row.region_code,
        'scope_level', case when v_region_row.mmd_zone_id is null then 'region' else 'zone' end
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
      'scope_level', case when v_region_row.mmd_zone_id is null then 'region' else 'zone' end
    );
  end if;

  return public.assert_platform_country_feature(v_country, v_vertical, v_feature);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) RLS — staff only
-- ---------------------------------------------------------------------------

alter table public.platform_regions enable row level security;

drop policy if exists platform_regions_select_staff on public.platform_regions;
create policy platform_regions_select_staff
on public.platform_regions for select to authenticated
using (public.is_staff_user(auth.uid()));

drop policy if exists platform_regions_write_staff on public.platform_regions;
create policy platform_regions_write_staff
on public.platform_regions for all to authenticated
using (public.is_staff_user(auth.uid()))
with check (public.is_staff_user(auth.uid()));

revoke all on function public.assert_platform_scope_feature(text, text, uuid, text, text) from public;
grant execute on function public.assert_platform_scope_feature(text, text, uuid, text, text) to authenticated, service_role;

commit;
