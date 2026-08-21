-- Allow assigned taxi drivers (and clients) to read counterpart profiles
-- for active rides only — mirrors order/delivery participant visibility.
-- Does NOT grant blanket profiles SELECT.

create or replace function public.profiles_visible_to_auth_user(p_profile_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer uuid := auth.uid();
begin
  if v_viewer is null or p_profile_id is null then
    return false;
  end if;

  if p_profile_id = v_viewer then
    return true;
  end if;

  if exists (
    select 1
    from public.orders o
    where exists (
      select 1 from public.order_participant_ids(o.id) p where p.user_id = v_viewer
    )
    and exists (
      select 1 from public.order_participant_ids(o.id) p where p.user_id = p_profile_id
    )
  ) then
    return true;
  end if;

  if to_regclass('public.delivery_requests') is not null
     and exists (
       select 1
       from public.delivery_requests dr
       where exists (
         select 1 from public.delivery_request_participant_ids(dr.id) p where p.user_id = v_viewer
       )
       and exists (
         select 1 from public.delivery_request_participant_ids(dr.id) p where p.user_id = p_profile_id
       )
     ) then
    return true;
  end if;

  -- Taxi: only while ride is assigned and still active (not completed/canceled).
  if to_regclass('public.taxi_rides') is not null
     and exists (
       select 1
       from public.taxi_rides tr
       where tr.status in ('accepted', 'driver_arrived', 'in_progress')
         and (
           (tr.driver_id = v_viewer and tr.client_user_id = p_profile_id)
           or (tr.client_user_id = v_viewer and tr.driver_id = p_profile_id)
         )
     ) then
    return true;
  end if;

  return false;
end;
$$;

comment on function public.profiles_visible_to_auth_user(uuid) is
  'True when viewer may SELECT a profile as self or as a participant on a shared order, delivery_request, or active taxi_ride.';

revoke all on function public.profiles_visible_to_auth_user(uuid) from public;
grant execute on function public.profiles_visible_to_auth_user(uuid) to authenticated;
