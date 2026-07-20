-- Fix driver ONLINE confirmation for store clients still writing is_online
-- directly to driver_profiles.
--
-- Root cause:
--   guard_driver_profiles_self_update() silently forced
--     NEW.is_online := OLD.is_online
--   for authenticated callers. The mobile update appeared to succeed but
--   RETURNING showed is_online still false →
--   "Supabase n'a pas confirmé le passage en ligne."
--
-- Fix:
-- 1) Stop freezing is_online for the profile owner.
-- 2) Enforce vehicle/service eligibility in enforce_driver_profile_online_rules
--    when going online (same rules as /api/driver/online).
-- 3) Official SECURITY DEFINER RPC set_driver_online(boolean) for clients.

begin;

drop function if exists public.driver_can_go_online(uuid);

create or replace function public.driver_can_go_online(p_driver_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_profile public.driver_profiles%rowtype;
  v_vehicle public.driver_vehicles%rowtype;
  v_mode text;
  v_requires_vehicle boolean;
  v_has_service boolean;
begin
  if p_driver_id is null then
    return false;
  end if;

  select * into v_profile
  from public.driver_profiles
  where user_id = p_driver_id;

  if not found then
    return false;
  end if;

  if lower(coalesce(v_profile.status, '')) <> 'approved' then
    return false;
  end if;

  select
    coalesce(food_delivery_enabled, false)
      or coalesce(package_delivery_enabled, false)
      or coalesce(taxi_rides_enabled, false)
  into v_has_service
  from public.driver_service_preferences
  where driver_user_id = p_driver_id;

  if coalesce(v_has_service, false) is not true then
    return false;
  end if;

  v_mode := lower(trim(coalesce(v_profile.transport_mode, '')));
  v_requires_vehicle :=
    v_mode in ('car', 'moto')
    or exists (
      select 1
      from public.driver_service_preferences p
      where p.driver_user_id = p_driver_id
        and coalesce(p.taxi_rides_enabled, false) = true
    );

  if not v_requires_vehicle then
    return true;
  end if;

  if v_profile.active_vehicle_id is null then
    return false;
  end if;

  select * into v_vehicle
  from public.driver_vehicles
  where id = v_profile.active_vehicle_id
    and driver_user_id = p_driver_id
    and deleted_at is null;

  if not found then
    return false;
  end if;

  return
    coalesce(v_vehicle.vehicle_active, false) is true
    and lower(coalesce(v_vehicle.vehicle_status, '')) = 'active'
    and lower(coalesce(v_vehicle.admin_review_status, '')) = 'approved';
end;
$$;

revoke all on function public.driver_can_go_online(uuid) from public;
grant execute on function public.driver_can_go_online(uuid) to authenticated, service_role;

create or replace function public.enforce_driver_profile_online_rules()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(lower(new.status), '') in ('suspended', 'disabled') then
    new.is_online := false;
  end if;

  if new.is_online is true and coalesce(lower(new.status), '') <> 'approved' then
    raise exception 'driver_not_eligible_for_online'
      using hint = 'Driver must be approved to go online.';
  end if;

  if new.is_online is true
     and (tg_op = 'INSERT' or new.is_online is distinct from old.is_online)
     and not public.driver_can_go_online(new.user_id) then
    raise exception 'driver_not_eligible_for_online'
      using hint = 'Enable a service and select an approved active vehicle before going online.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- Owner may change is_online; privileged columns stay frozen.
create or replace function public.guard_driver_profiles_self_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.role() is distinct from 'authenticated' then
    return new;
  end if;

  -- Only the profile owner is constrained here.
  if auth.uid() is distinct from new.user_id then
    return new;
  end if;

  new.stripe_onboarded := old.stripe_onboarded;
  new.stripe_onboarded_at := old.stripe_onboarded_at;
  new.stripe_account_id := old.stripe_account_id;
  new.payout_enabled := old.payout_enabled;
  new.vehicle_verified := old.vehicle_verified;
  new.status := old.status;
  new.rating := old.rating;
  new.rating_count := old.rating_count;
  new.active_vehicle_id := old.active_vehicle_id;
  new.acceptance_rate := old.acceptance_rate;
  new.cancellation_rate := old.cancellation_rate;
  new.total_deliveries := old.total_deliveries;
  new.transport_mode := old.transport_mode;
  -- is_online is intentionally writable for the owner.
  -- Eligibility is enforced by enforce_driver_profile_online_rules + identity gate.
  return new;
end;
$$;

-- Official RPC for authenticated drivers (and store builds after OTA).
drop function if exists public.set_driver_online(boolean);
drop function if exists public.set_driver_online(uuid, boolean);

create or replace function public.set_driver_online(p_online boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_online boolean := coalesce(p_online, false);
  v_row public.driver_profiles%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated', 'is_online', false);
  end if;

  if v_online and not public.driver_can_go_online(v_uid) then
    return jsonb_build_object(
      'ok', false,
      'error', 'driver_not_eligible_for_online',
      'is_online', false,
      'message', 'Enable a service and select an approved active vehicle before going online.'
    );
  end if;

  update public.driver_profiles
  set
    is_online = v_online,
    updated_at = now()
  where user_id = v_uid
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'driver_profile_not_found', 'is_online', false);
  end if;

  if coalesce(v_row.is_online, false) is distinct from v_online then
    return jsonb_build_object(
      'ok', false,
      'error', 'online_status_update_failed',
      'is_online', coalesce(v_row.is_online, false)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'is_online', v_row.is_online,
    'status', v_row.status,
    'transport_mode', v_row.transport_mode,
    'active_vehicle_id', v_row.active_vehicle_id
  );
end;
$$;

revoke all on function public.set_driver_online(boolean) from public;
grant execute on function public.set_driver_online(boolean) to authenticated;
grant execute on function public.set_driver_online(boolean) to service_role;

commit;
