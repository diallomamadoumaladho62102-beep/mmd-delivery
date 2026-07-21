-- ===========================================================================
-- Driver area intelligence: count online drivers near a GPS point
-- Used by GET /api/driver/area-intelligence (service role / security definer).
-- ===========================================================================

begin;

create or replace function public.mmd_online_drivers_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_miles double precision default 5,
  p_fresh_minutes integer default 12,
  p_exclude_driver_id uuid default null
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_radius_m double precision;
begin
  if p_lat is null or p_lng is null then
    return 0;
  end if;

  if p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    return 0;
  end if;

  v_radius_m := greatest(coalesce(p_radius_miles, 5), 0.1) * 1609.344;

  select count(*)::integer
  into v_count
  from public.driver_locations dl
  inner join public.driver_profiles dp on dp.user_id = dl.driver_id
  where dp.is_online = true
    and dl.updated_at >= now() - make_interval(mins => greatest(coalesce(p_fresh_minutes, 12), 1))
    and (p_exclude_driver_id is null or dl.driver_id <> p_exclude_driver_id)
    and dl.lat is not null
    and dl.lng is not null
    -- Haversine meters (sphere R=6371000)
    and (
      6371000 * 2 * asin(
        sqrt(
          power(sin(radians(dl.lat - p_lat) / 2), 2)
          + cos(radians(p_lat)) * cos(radians(dl.lat))
            * power(sin(radians(dl.lng - p_lng) / 2), 2)
        )
      )
    ) <= v_radius_m;

  return coalesce(v_count, 0);
end;
$$;

comment on function public.mmd_online_drivers_near(double precision, double precision, double precision, integer, uuid) is
  'Count online drivers with fresh GPS within radius_miles of a point (excludes optional driver).';

revoke all on function public.mmd_online_drivers_near(double precision, double precision, double precision, integer, uuid) from public;
grant execute on function public.mmd_online_drivers_near(double precision, double precision, double precision, integer, uuid)
  to service_role, authenticated;

commit;
