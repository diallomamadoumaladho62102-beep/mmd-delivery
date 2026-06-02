-- =============================================================================
-- MMD Driver Map Reports — v1.1 (global, ISO country_code)
-- =============================================================================
-- Supersedes: 20260602120000_driver_map_reports.sql (do NOT apply v1.0)
-- Review manually before running in Supabase SQL Editor or via CLI.
-- NOT auto-applied to production.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Country lookup (extensible via INSERT)
-- -----------------------------------------------------------------------------
create table if not exists public.driver_map_report_countries (
  code char(2) primary key,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint driver_map_report_countries_code_format check (code ~ '^[A-Z]{2}$')
);

comment on table public.driver_map_report_countries is
  'ISO-3166-1 alpha-2 countries enabled for driver map reports. Add rows to expand globally.';

insert into public.driver_map_report_countries (code, name) values
  ('US', 'United States'),
  ('GN', 'Guinea'),
  ('SN', 'Senegal'),
  ('CI', 'Côte d''Ivoire'),
  ('ML', 'Mali'),
  ('NG', 'Nigeria'),
  ('GH', 'Ghana'),
  ('SL', 'Sierra Leone'),
  ('MR', 'Mauritania'),
  ('CA', 'Canada'),
  ('FR', 'France'),
  ('BE', 'Belgium'),
  ('GB', 'United Kingdom'),
  ('DE', 'Germany')
on conflict (code) do update
set
  name = excluded.name,
  is_active = true;

-- -----------------------------------------------------------------------------
-- 2) Main reports table (single extensible table)
-- -----------------------------------------------------------------------------
create table if not exists public.driver_map_reports (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references auth.users(id) on delete cascade,

  module_type text not null default 'delivery'
    check (module_type in ('delivery', 'taxi')),

  country_code char(2) not null
    references public.driver_map_report_countries(code),

  category text not null
    check (category in (
      'accident',
      'traffic_jam',
      'road_closed',
      'hazard',
      'police',
      'bad_address',
      'other'
    )),

  latitude double precision not null,
  longitude double precision not null,
  description text,

  order_id uuid,
  source_table text
    check (source_table is null or source_table in ('orders', 'delivery_requests')),

  expires_at timestamptz not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint driver_map_reports_coords_valid check (
    latitude between -90 and 90
    and longitude between -180 and 180
    and not (latitude = 0 and longitude = 0)
  ),

  constraint driver_map_reports_country_code_format check (country_code ~ '^[A-Z]{2}$')
);

comment on table public.driver_map_reports is
  'Ephemeral driver road alerts scoped by module_type + country_code for global delivery/taxi.';

create index if not exists driver_map_reports_active_expires_idx
  on public.driver_map_reports (is_active, expires_at desc);

create index if not exists driver_map_reports_driver_created_idx
  on public.driver_map_reports (driver_id, created_at desc);

create index if not exists driver_map_reports_country_module_active_idx
  on public.driver_map_reports (country_code, module_type, is_active, expires_at desc);

create index if not exists driver_map_reports_lat_lng_idx
  on public.driver_map_reports (latitude, longitude);

-- -----------------------------------------------------------------------------
-- 3) updated_at trigger
-- -----------------------------------------------------------------------------
create or replace function public.touch_driver_map_reports_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_driver_map_reports_updated_at on public.driver_map_reports;
create trigger trg_driver_map_reports_updated_at
before update on public.driver_map_reports
for each row execute function public.touch_driver_map_reports_updated_at();

-- -----------------------------------------------------------------------------
-- 4) Auth helpers
-- -----------------------------------------------------------------------------
create or replace function public.is_authenticated_driver(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.driver_profiles dp
    where dp.user_id = p_user_id
  )
  or exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and p.role in ('livreur', 'driver', 'admin')
  );
$$;

create or replace function public.is_admin_user(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and p.role = 'admin'
  );
$$;

create or replace function public.is_supported_report_country(p_country_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.driver_map_report_countries c
    where c.code = upper(trim(p_country_code))
      and c.is_active = true
  );
$$;

-- -----------------------------------------------------------------------------
-- 5) Submit RPC
-- -----------------------------------------------------------------------------
create or replace function public.driver_submit_map_report(
  p_category text,
  p_latitude double precision,
  p_longitude double precision,
  p_country_code text,
  p_description text default null,
  p_order_id uuid default null,
  p_source_table text default null,
  p_module_type text default 'delivery'
)
returns public.driver_map_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_recent_count integer;
  v_country_code char(2);
  v_row public.driver_map_reports;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  if not public.is_authenticated_driver(v_user_id) then
    raise exception 'not_a_driver';
  end if;

  v_country_code := upper(trim(p_country_code));

  if v_country_code is null or v_country_code !~ '^[A-Z]{2}$' then
    raise exception 'invalid_country_code';
  end if;

  if not public.is_supported_report_country(v_country_code) then
    raise exception 'unsupported_country_code';
  end if;

  if p_category not in (
    'accident', 'traffic_jam', 'road_closed', 'hazard', 'police', 'bad_address', 'other'
  ) then
    raise exception 'invalid_category';
  end if;

  if p_module_type not in ('delivery', 'taxi') then
    raise exception 'invalid_module_type';
  end if;

  if p_source_table is not null and p_source_table not in ('orders', 'delivery_requests') then
    raise exception 'invalid_source_table';
  end if;

  if p_latitude is null or p_longitude is null
     or p_latitude < -90 or p_latitude > 90
     or p_longitude < -180 or p_longitude > 180
     or (p_latitude = 0 and p_longitude = 0) then
    raise exception 'invalid_coordinates';
  end if;

  select count(*) into v_recent_count
  from public.driver_map_reports r
  where r.driver_id = v_user_id
    and r.created_at > now() - interval '1 hour';

  if v_recent_count >= 6 then
    raise exception 'rate_limit_exceeded';
  end if;

  insert into public.driver_map_reports (
    driver_id,
    module_type,
    country_code,
    category,
    latitude,
    longitude,
    description,
    order_id,
    source_table,
    expires_at,
    is_active
  ) values (
    v_user_id,
    p_module_type,
    v_country_code,
    p_category,
    p_latitude,
    p_longitude,
    nullif(trim(p_description), ''),
    p_order_id,
    p_source_table,
    now() + interval '25 minutes',
    true
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6) Fetch nearby RPC (country-scoped)
-- -----------------------------------------------------------------------------
create or replace function public.driver_fetch_active_map_reports(
  p_latitude double precision,
  p_longitude double precision,
  p_country_code text,
  p_radius_meters integer default 5000,
  p_module_type text default null
)
returns setof public.driver_map_reports
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      upper(trim(p_country_code)) as country_code,
      greatest(500, least(coalesce(p_radius_meters, 5000), 20000)) as radius_m,
      case when p_latitude between -90 and 90 then p_latitude else null end as lat,
      case when p_longitude between -180 and 180 then p_longitude else null end as lng
  )
  select r.*
  from public.driver_map_reports r
  cross join params p
  where public.is_authenticated_driver(auth.uid())
    and public.is_supported_report_country(p.country_code)
    and r.country_code = p.country_code
    and r.is_active = true
    and r.expires_at > now()
    and p.lat is not null
    and p.lng is not null
    and (p_module_type is null or r.module_type = p_module_type)
    and r.latitude between p.lat - (p.radius_m / 111000.0) and p.lat + (p.radius_m / 111000.0)
    and r.longitude between p.lng - (p.radius_m / 111000.0) and p.lng + (p.radius_m / 111000.0)
  order by r.created_at desc
  limit 50;
$$;

-- -----------------------------------------------------------------------------
-- 7) Grants
-- -----------------------------------------------------------------------------
grant execute on function public.driver_submit_map_report(
  text, double precision, double precision, text, text, uuid, text, text
) to authenticated;

grant execute on function public.driver_fetch_active_map_reports(
  double precision, double precision, text, integer, text
) to authenticated;

-- -----------------------------------------------------------------------------
-- 8) RLS
-- -----------------------------------------------------------------------------
alter table public.driver_map_report_countries enable row level security;
alter table public.driver_map_reports enable row level security;

drop policy if exists driver_map_report_countries_select on public.driver_map_report_countries;
create policy driver_map_report_countries_select
on public.driver_map_report_countries
for select
to authenticated
using (public.is_authenticated_driver(auth.uid()) or public.is_admin_user(auth.uid()));

drop policy if exists driver_map_reports_select_active on public.driver_map_reports;
create policy driver_map_reports_select_active
on public.driver_map_reports
for select
to authenticated
using (
  public.is_authenticated_driver(auth.uid())
  and is_active = true
  and expires_at > now()
);

drop policy if exists driver_map_reports_insert_own on public.driver_map_reports;
create policy driver_map_reports_insert_own
on public.driver_map_reports
for insert
to authenticated
with check (
  driver_id = auth.uid()
  and public.is_authenticated_driver(auth.uid())
);

drop policy if exists driver_map_reports_update_own on public.driver_map_reports;
create policy driver_map_reports_update_own
on public.driver_map_reports
for update
to authenticated
using (driver_id = auth.uid() or public.is_admin_user(auth.uid()))
with check (driver_id = auth.uid() or public.is_admin_user(auth.uid()));

drop policy if exists driver_map_reports_delete_own_or_admin on public.driver_map_reports;
create policy driver_map_reports_delete_own_or_admin
on public.driver_map_reports
for delete
to authenticated
using (driver_id = auth.uid() or public.is_admin_user(auth.uid()));
