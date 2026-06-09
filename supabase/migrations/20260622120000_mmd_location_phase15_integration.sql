-- MMD Location Core — Phase 1.5 integration (taxi + delivery + driver RLS + Guinea expansion)

begin;

-- ---------------------------------------------------------------------------
-- 1) FK columns
-- ---------------------------------------------------------------------------

alter table public.taxi_rides
  add column if not exists pickup_location_id uuid
    references public.location_points (id) on delete set null,
  add column if not exists dropoff_location_id uuid
    references public.location_points (id) on delete set null;

alter table public.delivery_requests
  add column if not exists dropoff_location_id uuid
    references public.location_points (id) on delete set null;

create index if not exists taxi_rides_pickup_location_idx
  on public.taxi_rides (pickup_location_id);

create index if not exists taxi_rides_dropoff_location_idx
  on public.taxi_rides (dropoff_location_id);

create index if not exists delivery_requests_dropoff_location_idx
  on public.delivery_requests (dropoff_location_id);

-- ---------------------------------------------------------------------------
-- 2) Driver read access helpers (active trip only)
-- ---------------------------------------------------------------------------

create or replace function public.driver_can_read_location_point(
  p_location_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_location_id is null or p_user_id is null then
    return false;
  end if;

  if exists (
    select 1
    from public.taxi_rides tr
    where tr.driver_id = p_user_id
      and lower(coalesce(tr.status, '')) in (
        'paid',
        'dispatching',
        'accepted',
        'driver_arrived',
        'in_progress'
      )
      and (
        tr.pickup_location_id = p_location_id
        or tr.dropoff_location_id = p_location_id
      )
  ) then
    return true;
  end if;

  if to_regclass('public.delivery_requests') is not null
     and exists (
       select 1
       from public.delivery_requests dr
       where dr.driver_id = p_user_id
         and lower(coalesce(dr.status, '')) in (
           'assigned',
           'accepted',
           'picked_up',
           'in_transit',
           'in_progress',
           'en_route',
           'delivering'
         )
         and dr.dropoff_location_id = p_location_id
     ) then
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.user_can_read_location_attachment(p_object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer uuid := auth.uid();
  v_owner uuid;
  v_location_id uuid;
begin
  if v_viewer is null then
    return false;
  end if;

  if public.is_staff_user(v_viewer) then
    return true;
  end if;

  v_owner := public.location_attachment_owner_from_path(p_object_name);
  v_location_id := public.location_attachment_location_id_from_path(p_object_name);

  if v_owner is null or v_location_id is null then
    return false;
  end if;

  if v_owner = v_viewer then
    return public.user_owns_location_point(v_location_id, v_viewer);
  end if;

  return public.driver_can_read_location_point(v_location_id, v_viewer);
end;
$$;

drop policy if exists location_points_select_assigned_driver on public.location_points;
create policy location_points_select_assigned_driver
  on public.location_points
  for select
  to authenticated
  using (public.driver_can_read_location_point(id, auth.uid()));

revoke all on function public.driver_can_read_location_point(uuid, uuid) from public;
grant execute on function public.driver_can_read_location_point(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Guinea prefecture zones (minimum national structure)
-- ---------------------------------------------------------------------------

insert into public.mmd_zones (
  country_code, region_name, prefecture_name, city_name, commune_name, quartier_name,
  zone_code, zone_name, is_active
) values
  ('GN', 'Kindia', 'Coyah', 'Coyah', null, null, 'gn_kindia_coyah', 'Coyah', true),
  ('GN', 'Kindia', 'Dubréka', 'Dubréka', null, null, 'gn_kindia_dubreka', 'Dubréka', true),
  ('GN', 'Kindia', 'Forécariah', 'Forécariah', null, null, 'gn_kindia_forecariah', 'Forécariah', true),
  ('GN', 'Kankan', 'Siguiri', 'Siguiri', null, null, 'gn_kankan_siguiri', 'Siguiri', true)
on conflict (zone_code) do update
set
  zone_name = excluded.zone_name,
  region_name = excluded.region_name,
  prefecture_name = excluded.prefecture_name,
  city_name = excluded.city_name,
  is_active = excluded.is_active,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 4) Base landmarks (Guinea prefectures)
-- ---------------------------------------------------------------------------

insert into public.location_landmarks (
  country_code, region_name, prefecture_name, city_name, commune_name, quartier_name,
  name, landmark_type, lat, lng, provider, status, confidence_score
) values
  ('GN', 'Kindia', 'Coyah', 'Coyah', null, null, 'Marché de Coyah', 'market', 9.7069, -13.3846, 'mmd', 'approved', 75),
  ('GN', 'Kindia', 'Dubréka', 'Dubréka', null, null, 'Station Total Dubréka', 'fuel_station', 9.7881, -13.5234, 'mmd', 'approved', 75),
  ('GN', 'Kindia', 'Forécariah', 'Forécariah', null, null, 'Rond-point Forécariah', 'roundabout', 9.4306, -13.0881, 'mmd', 'approved', 72),
  ('GN', 'Kindia', 'Kindia', 'Kindia', null, null, 'Gare routière Kindia', 'market', 10.0569, -12.8658, 'mmd', 'approved', 78),
  ('GN', 'Boké', 'Boké', 'Boké', null, null, 'Marché central Boké', 'market', 10.9422, -14.2990, 'mmd', 'approved', 75),
  ('GN', 'Labé', 'Labé', 'Labé', null, null, 'Grande mosquée de Labé', 'mosque', 11.3181, -12.2832, 'mmd', 'approved', 80),
  ('GN', 'Mamou', 'Mamou', 'Mamou', null, null, 'Station Shell Mamou', 'fuel_station', 10.3755, -12.0913, 'mmd', 'approved', 74),
  ('GN', 'Kankan', 'Kankan', 'Kankan', null, null, 'Marché de Kankan', 'market', 10.3854, -9.3056, 'mmd', 'approved', 78),
  ('GN', 'Kankan', 'Siguiri', 'Siguiri', null, null, 'Office Orange Money Siguiri', 'mobile_money', 11.4228, -9.1785, 'mmd', 'approved', 73),
  ('GN', 'N''Zérékoré', 'N''Zérékoré', 'N''Zérékoré', null, null, 'Marché de N''Zérékoré', 'market', 7.7562, -8.8179, 'mmd', 'approved', 76);

commit;
