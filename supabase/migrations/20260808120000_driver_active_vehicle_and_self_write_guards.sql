-- Fix set_driver_active_vehicle for service_role callers (API routes).
-- Previous signature relied on auth.uid() which is null under service_role,
-- so POST /api/driver/vehicles/active always returned not_authenticated.

begin;

create or replace function public.set_driver_active_vehicle(
  p_driver_user_id uuid,
  p_vehicle_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := p_driver_user_id;
  v_vehicle public.driver_vehicles%rowtype;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  -- Authenticated callers may only act as themselves.
  if auth.uid() is not null and auth.uid() <> v_driver_id then
    return jsonb_build_object('ok', false, 'message', 'forbidden');
  end if;

  select * into v_vehicle
  from public.driver_vehicles
  where id = p_vehicle_id
    and driver_user_id = v_driver_id
    and deleted_at is null;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'vehicle_not_found');
  end if;

  if exists (
    select 1 from public.driver_profiles dp
    where dp.user_id = v_driver_id and coalesce(dp.is_online, false) = true
  ) then
    return jsonb_build_object('ok', false, 'message', 'must_be_offline');
  end if;

  if public.driver_has_active_taxi_ride(v_driver_id) then
    return jsonb_build_object('ok', false, 'message', 'active_ride_in_progress');
  end if;

  if v_vehicle.vehicle_status <> 'active' or v_vehicle.vehicle_active is not true then
    return jsonb_build_object('ok', false, 'message', 'vehicle_not_active');
  end if;

  update public.driver_profiles
  set active_vehicle_id = p_vehicle_id, updated_at = now()
  where user_id = v_driver_id;

  perform public.log_driver_vehicle_history(
    v_driver_id, p_vehicle_id, 'active_vehicle_selected', v_driver_id,
    jsonb_build_object('license_plate', v_vehicle.license_plate)
  );

  perform public.recalculate_vehicle_category_eligibility(p_vehicle_id);

  return jsonb_build_object('ok', true, 'active_vehicle_id', p_vehicle_id);
end;
$$;

-- Keep single-arg wrapper for authenticated mobile/direct RPC callers.
create or replace function public.set_driver_active_vehicle(p_vehicle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.set_driver_active_vehicle(auth.uid(), p_vehicle_id);
end;
$$;

revoke all on function public.set_driver_active_vehicle(uuid) from public;
revoke all on function public.set_driver_active_vehicle(uuid, uuid) from public;
grant execute on function public.set_driver_active_vehicle(uuid) to authenticated;
grant execute on function public.set_driver_active_vehicle(uuid, uuid) to service_role;

-- Harden existing guard: also lock vehicle_status / deleted_at / is_primary /
-- admin fields so clients cannot self-activate or undelete vehicles.
create or replace function public.guard_driver_vehicle_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() = new.driver_user_id then
    if tg_op = 'UPDATE' then
      new.wheelchair_equipment_verified := old.wheelchair_equipment_verified;
      new.admin_review_status := old.admin_review_status;
      new.admin_review_notes := old.admin_review_notes;
      new.inspection_status := old.inspection_status;
      new.insurance_status := old.insurance_status;
      new.registration_status := old.registration_status;
      new.vehicle_active := old.vehicle_active;
      new.vehicle_status := old.vehicle_status;
      new.deleted_at := old.deleted_at;
      new.is_primary := old.is_primary;
    else
      new.wheelchair_equipment_verified := false;
      new.inspection_status := coalesce(new.inspection_status, 'pending');
      new.insurance_status := coalesce(new.insurance_status, 'pending');
      new.registration_status := coalesce(new.registration_status, 'pending');
      new.vehicle_status := coalesce(nullif(trim(new.vehicle_status), ''), 'pending_review');
      if new.vehicle_status = 'active' then
        new.vehicle_status := 'pending_review';
      end if;
      new.vehicle_active := false;
      new.deleted_at := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Soft-delete helper: clear active_vehicle_id when deleting the active vehicle.
create or replace function public.clear_active_vehicle_if_matches()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.driver_profiles
    set active_vehicle_id = null, updated_at = now()
    where user_id = new.driver_user_id
      and active_vehicle_id = new.id;

    perform public.recalculate_vehicle_category_eligibility(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clear_active_vehicle_on_soft_delete on public.driver_vehicles;
create trigger trg_clear_active_vehicle_on_soft_delete
  after update of deleted_at on public.driver_vehicles
  for each row
  execute function public.clear_active_vehicle_if_matches();

-- Prevent drivers from self-approving documents or writing review columns.
create or replace function public.guard_driver_documents_self_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only constrain the document owner writing as themselves.
  if auth.uid() is null or auth.uid() is distinct from new.user_id then
    return new;
  end if;

  new.status := 'pending';
  new.reviewed_at := null;
  new.reviewed_by := null;
  if tg_op = 'UPDATE' then
    new.review_notes := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_driver_documents_self_write on public.driver_documents;
create trigger trg_guard_driver_documents_self_write
  before insert or update on public.driver_documents
  for each row
  execute function public.guard_driver_documents_self_write();

-- Prevent client writes to financial / gate columns on driver_profiles.
create or replace function public.guard_driver_profiles_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'authenticated' then
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
  -- transport_mode / is_online must go through dedicated RPCs/APIs
  new.transport_mode := old.transport_mode;
  new.is_online := old.is_online;
  return new;
end;
$$;

drop trigger if exists trg_guard_driver_profiles_self_update on public.driver_profiles;
create trigger trg_guard_driver_profiles_self_update
  before update on public.driver_profiles
  for each row
  execute function public.guard_driver_profiles_self_update();

commit;
