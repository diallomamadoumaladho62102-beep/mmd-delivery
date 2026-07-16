-- Driver vehicle / online gate hardening for real-device chauffeur phase.
-- 1) Keep recalculate payload with driver_user_id and fix invalid printf-style format specifiers.
-- 2) Treat deleted / rejected / suspended vehicles as inactive for eligibility.
-- 3) Taxi category eligibility must use active_vehicle_id (not only is_primary).
-- 4) Active vehicle selection requires admin_review_status = approved.

begin;

create or replace function public.recalculate_vehicle_category_eligibility(p_vehicle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle public.driver_vehicles%rowtype;
  v_driver_rating numeric;
  v_country text;
  v_city text;
  v_category text;
  v_rule public.vehicle_category_rules;
  v_age integer;
  v_status text;
  v_reason_code text;
  v_reason_message text;
  v_vehicle_type text;
  v_before jsonb := '[]'::jsonb;
  v_after jsonb := '[]'::jsonb;
  v_prev record;
  v_operational boolean;
begin
  select * into v_vehicle from public.driver_vehicles where id = p_vehicle_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'vehicle_not_found');
  end if;

  select coalesce(dp.rating, 0), upper(trim(coalesce(dp.state, ''))), lower(trim(coalesce(dp.city, '')))
  into v_driver_rating, v_country, v_city
  from public.driver_profiles dp
  where dp.user_id = v_vehicle.driver_user_id;

  v_age := extract(year from now())::integer - coalesce(v_vehicle.vehicle_year, 0);
  v_vehicle_type := lower(trim(coalesce(v_vehicle.vehicle_type, '')));
  v_operational :=
    v_vehicle.deleted_at is null
    and coalesce(v_vehicle.vehicle_active, false) is true
    and lower(coalesce(v_vehicle.vehicle_status, '')) = 'active'
    and lower(coalesce(v_vehicle.admin_review_status, '')) = 'approved';

  for v_prev in
    select category, status, reason_message
    from public.vehicle_category_eligibility
    where vehicle_id = p_vehicle_id
  loop
    v_before := v_before || jsonb_build_array(jsonb_build_object(
      'category', v_prev.category,
      'status', v_prev.status,
      'reason_message', v_prev.reason_message
    ));
  end loop;

  foreach v_category in array array['standard','comfort','xl','wheelchair_accessible'] loop
    select * into v_rule
    from public.resolve_vehicle_category_rule(v_category, v_country, v_city);

    if v_rule.id is null then
      v_status := 'not_eligible';
      v_reason_code := 'no_rule';
      v_reason_message := 'No category rule configured';
    elsif not v_operational then
      v_status := 'not_eligible';
      v_reason_code := 'vehicle_inactive';
      v_reason_message := 'Vehicle is not active';
    elsif v_age > v_rule.max_vehicle_age_years then
      v_status := 'expired_age';
      v_reason_code := 'vehicle_too_old';
      v_reason_message := format('Vehicle exceeds %s year limit', v_rule.max_vehicle_age_years);
    elsif coalesce(v_vehicle.seats_count, 0) < v_rule.min_passenger_seats then
      v_status := 'insufficient_seats';
      v_reason_code := 'insufficient_seats';
      v_reason_message := format('Minimum %s passenger seats required', v_rule.min_passenger_seats);
    elsif v_rule.requires_air_conditioning and coalesce(v_vehicle.has_air_conditioning, false) is not true then
      v_status := 'not_eligible';
      v_reason_code := 'air_conditioning_required';
      v_reason_message := 'Air conditioning required for this category';
    elsif v_rule.requires_wheelchair_equipment and coalesce(v_vehicle.wheelchair_accessible, false) is not true then
      v_status := 'wheelchair_not_verified';
      v_reason_code := 'wheelchair_equipment_missing';
      v_reason_message := 'Wheelchair accessible equipment required';
    elsif v_rule.requires_wheelchair_admin_verified and coalesce(v_vehicle.wheelchair_equipment_verified, false) is not true then
      v_status := 'wheelchair_not_verified';
      v_reason_code := 'wheelchair_not_verified';
      v_reason_message := 'Wheelchair equipment must be verified by admin';
    elsif v_rule.min_driver_rating is not null and coalesce(v_driver_rating, 0) < v_rule.min_driver_rating then
      v_status := 'not_eligible';
      v_reason_code := 'driver_rating_too_low';
      v_reason_message := format(
        'Minimum driver rating %s required',
        to_char(v_rule.min_driver_rating, 'FM999.0')
      );
    elsif v_rule.allowed_vehicle_types is not null
      and array_length(v_rule.allowed_vehicle_types, 1) > 0
      and not (v_vehicle_type = any (v_rule.allowed_vehicle_types)) then
      v_status := 'not_eligible';
      v_reason_code := 'vehicle_type_not_allowed';
      v_reason_message := 'Vehicle type not allowed for this category';
    elsif (v_rule.requires_inspection_approved and lower(v_vehicle.inspection_status) <> 'approved')
      or (v_rule.requires_insurance_approved and lower(v_vehicle.insurance_status) <> 'approved')
      or (v_rule.requires_registration_approved and lower(v_vehicle.registration_status) <> 'approved') then
      v_status := 'missing_documents';
      v_reason_code := 'missing_documents';
      v_reason_message := 'Required vehicle documents not approved';
    elsif v_rule.requires_admin_approval then
      v_status := 'pending_review';
      v_reason_code := 'pending_admin_review';
      v_reason_message := 'Awaiting admin approval for this category';
    else
      v_status := 'eligible';
      v_reason_code := null;
      v_reason_message := null;
    end if;

    insert into public.vehicle_category_eligibility (
      vehicle_id, driver_user_id, category, status, reason_code, reason_message, computed_at
    ) values (
      p_vehicle_id, v_vehicle.driver_user_id, v_category, v_status, v_reason_code, v_reason_message, now()
    )
    on conflict (vehicle_id, category) do update set
      status = excluded.status,
      reason_code = excluded.reason_code,
      reason_message = excluded.reason_message,
      computed_at = now(),
      admin_approved = case
        when excluded.status = 'pending_review' then vehicle_category_eligibility.admin_approved
        when excluded.status = 'eligible' then vehicle_category_eligibility.admin_approved
        else false
      end;
  end loop;

  update public.vehicle_category_eligibility vce
  set status = case
    when vce.admin_suspended then 'suspended'
    when vce.admin_approved and vce.status in ('pending_review', 'eligible') then 'eligible'
    else vce.status
  end
  where vce.vehicle_id = p_vehicle_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'category', category,
    'status', status,
    'reason_message', reason_message
  )), '[]'::jsonb)
  into v_after
  from public.vehicle_category_eligibility
  where vehicle_id = p_vehicle_id;

  return jsonb_build_object(
    'ok', true,
    'vehicle_id', p_vehicle_id,
    'driver_user_id', v_vehicle.driver_user_id,
    'before', v_before,
    'after', v_after
  );
end;
$$;

create or replace function public.is_driver_taxi_category_eligible(
  p_user_id uuid,
  p_vehicle_class text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.driver_profiles dp
    join public.driver_vehicles dv
      on dv.id = dp.active_vehicle_id
     and dv.driver_user_id = dp.user_id
    join public.vehicle_category_eligibility vce
      on vce.vehicle_id = dv.id
    where dp.user_id = p_user_id
      and dv.deleted_at is null
      and coalesce(dv.vehicle_active, false) = true
      and lower(coalesce(dv.vehicle_status, '')) = 'active'
      and lower(coalesce(dv.admin_review_status, '')) = 'approved'
      and vce.category = public.normalize_taxi_vehicle_category(p_vehicle_class)
      and vce.status = 'eligible'
  );
$$;

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

  if v_vehicle.vehicle_status <> 'active'
     or v_vehicle.vehicle_active is not true
     or lower(coalesce(v_vehicle.admin_review_status, '')) <> 'approved' then
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
grant execute on function public.recalculate_vehicle_category_eligibility(uuid) to service_role;
grant execute on function public.is_driver_taxi_category_eligible(uuid, text) to authenticated, service_role;

commit;
