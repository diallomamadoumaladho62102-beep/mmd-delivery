-- Fix PostgreSQL format() bug (%.1f is invalid) and add server-side transport mode changes.
begin;

-- Empty-DB bootstrap: vehicle eligibility tables are created later in
-- 20260728120000; this migration historically assumed they already existed.
create table if not exists public.vehicle_category_rules (
  id uuid primary key default gen_random_uuid(),
  country_code text,
  city text,
  category text not null,
  max_vehicle_age_years integer not null default 10,
  min_passenger_seats integer not null default 4,
  requires_air_conditioning boolean not null default false,
  requires_wheelchair_equipment boolean not null default false,
  requires_wheelchair_admin_verified boolean not null default false,
  min_driver_rating numeric,
  allowed_vehicle_types text[],
  requires_inspection_approved boolean not null default true,
  requires_insurance_approved boolean not null default true,
  requires_registration_approved boolean not null default true,
  requires_admin_approval boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_code, city, category)
);

create table if not exists public.driver_vehicles (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_make text,
  vehicle_model text,
  vehicle_year integer,
  vehicle_color text,
  license_plate text,
  seats_count integer not null default 4,
  vehicle_type text,
  has_air_conditioning boolean not null default false,
  wheelchair_accessible boolean not null default false,
  wheelchair_equipment_verified boolean not null default false,
  child_seat_available boolean,
  luggage_capacity text,
  inspection_status text not null default 'pending',
  insurance_status text not null default 'pending',
  registration_status text not null default 'pending',
  vehicle_active boolean not null default true,
  admin_review_status text not null default 'pending_review',
  admin_review_notes text,
  review_requested_at timestamptz,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicle_category_eligibility (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.driver_vehicles (id) on delete cascade,
  driver_user_id uuid not null references auth.users (id) on delete cascade,
  category text not null,
  status text not null default 'not_eligible',
  reason_code text,
  reason_message text,
  admin_approved boolean not null default false,
  admin_suspended boolean not null default false,
  computed_at timestamptz not null default now(),
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vehicle_id, category)
);

create or replace function public.resolve_vehicle_category_rule(
  p_category text,
  p_country text,
  p_city text
)
returns public.vehicle_category_rules
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rule public.vehicle_category_rules;
begin
  select * into v_rule
  from public.vehicle_category_rules
  where is_active = true
    and category = p_category
    and country_code is not distinct from nullif(upper(trim(coalesce(p_country, ''))), '')
    and city is not distinct from nullif(lower(trim(coalesce(p_city, ''))), '')
  limit 1;

  if found then
    return v_rule;
  end if;

  select * into v_rule
  from public.vehicle_category_rules
  where is_active = true
    and category = p_category
    and country_code is null
    and city is null
  limit 1;

  return v_rule;
end;
$$;

-- Helpers used below; also defined in 20260720120000 (idempotent create or replace).
create or replace function public.is_active_order_for_tracking(p_status text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p_status, '')) in (
    'preparing',
    'ready',
    'dispatched',
    'picked_up',
    'in_transit',
    'out_for_delivery'
  );
$$;

create or replace function public.is_active_delivery_request_for_tracking(p_status text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p_status, '')) in (
    'dispatched',
    'picked_up',
    'in_transit'
  );
$$;

-- Stub until 20260729120000 replaces with full taxi mission check.
create or replace function public.driver_has_active_taxi_ride(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.taxi_rides tr
    where tr.driver_id = p_user_id
      and lower(coalesce(tr.status, '')) in (
        'paid', 'dispatching', 'dispatched', 'accepted',
        'in_progress', 'arriving', 'started', 'driver_arrived'
      )
  );
$$;

create or replace function public.driver_has_active_food_or_package_mission(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.orders o
    where o.driver_id = p_user_id
      and public.is_active_order_for_tracking(o.status)
  )
  or exists (
    select 1
    from public.delivery_requests dr
    where dr.driver_id = p_user_id
      and public.is_active_delivery_request_for_tracking(dr.status)
  );
$$;

create or replace function public.driver_has_active_mission(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.driver_has_active_taxi_ride(p_user_id)
    or public.driver_has_active_food_or_package_mission(p_user_id);
$$;

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
begin
  select * into v_vehicle from public.driver_vehicles where id = p_vehicle_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'vehicle_not_found'); end if;

  select coalesce(dp.rating, 0), upper(trim(coalesce(dp.state, ''))), lower(trim(coalesce(dp.city, '')))
  into v_driver_rating, v_country, v_city
  from public.driver_profiles dp
  where dp.user_id = v_vehicle.driver_user_id;

  v_age := extract(year from now())::integer - coalesce(v_vehicle.vehicle_year, 0);
  v_vehicle_type := lower(trim(coalesce(v_vehicle.vehicle_type, '')));

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
    elsif coalesce(v_vehicle.vehicle_active, false) is not true then
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

  for v_prev in
    select category, status, reason_message
    from public.vehicle_category_eligibility
    where vehicle_id = p_vehicle_id
  loop
    v_after := v_after || jsonb_build_array(jsonb_build_object(
      'category', v_prev.category,
      'status', v_prev.status,
      'reason_message', v_prev.reason_message
    ));
  end loop;

  return jsonb_build_object('ok', true, 'before', v_before, 'after', v_after);
end;
$$;

create or replace function public.change_driver_transport_mode(
  p_user_id uuid,
  p_transport_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := lower(trim(coalesce(p_transport_mode, '')));
  v_profile public.driver_profiles%rowtype;
  v_has_license boolean := false;
  v_has_vehicle_docs boolean := false;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if v_mode not in ('bike', 'moto', 'car') then
    return jsonb_build_object('ok', false, 'error', 'invalid_transport_mode');
  end if;

  select * into v_profile
  from public.driver_profiles
  where user_id = p_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'driver_profile_not_found');
  end if;

  if lower(coalesce(v_profile.transport_mode, '')) = v_mode then
    return jsonb_build_object('ok', true, 'transport_mode', v_mode, 'unchanged', true);
  end if;

  if public.driver_has_active_mission(p_user_id) then
    return jsonb_build_object(
      'ok', false,
      'error', 'active_mission_in_progress',
      'message', 'Terminez votre mission en cours avant de changer de mode de transport.'
    );
  end if;

  select exists (
    select 1
    from public.driver_documents dd
    where dd.user_id = p_user_id
      and dd.doc_type in ('license', 'license_front', 'license_back')
      and lower(coalesce(dd.status, '')) in ('approved', 'verified', 'valid')
  )
  or (
    coalesce(v_profile.license_number, '') <> ''
    and v_profile.license_expiry is not null
    and v_profile.license_expiry >= current_date
  )
  into v_has_license;

  select exists (
    select 1
    from public.driver_documents dd
    where dd.user_id = p_user_id
      and dd.doc_type in ('registration', 'insurance', 'vehicle_registration', 'vehicle_insurance')
      and lower(coalesce(dd.status, '')) in ('approved', 'verified', 'valid')
  )
  or (
    coalesce(v_profile.plate_number, '') <> ''
    and coalesce(v_profile.vehicle_brand, '') <> ''
    and coalesce(v_profile.vehicle_model, '') <> ''
  )
  into v_has_vehicle_docs;

  if v_mode in ('moto', 'car') and not v_has_license then
    return jsonb_build_object(
      'ok', false,
      'error', 'documents_required',
      'message', 'Ce mode de transport nécessite une validation de vos documents avant d''être activé.'
    );
  end if;

  if v_mode = 'car' and not v_has_vehicle_docs then
    return jsonb_build_object(
      'ok', false,
      'error', 'documents_required',
      'message', 'Ce mode de transport nécessite une validation de vos documents avant d''être activé.'
    );
  end if;

  update public.driver_profiles
  set
    transport_mode = v_mode,
    vehicle_type = v_mode,
    vehicle_brand = case when v_mode = 'bike' then null else vehicle_brand end,
    vehicle_model = case when v_mode = 'bike' then null else vehicle_model end,
    vehicle_year = case when v_mode = 'bike' then null else vehicle_year end,
    vehicle_color = case when v_mode = 'bike' then null else vehicle_color end,
    plate_number = case when v_mode = 'bike' then null else plate_number end,
    license_number = case when v_mode = 'bike' then null else license_number end,
    license_expiry = case when v_mode = 'bike' then null else license_expiry end,
    updated_at = now()
  where user_id = p_user_id;

  insert into public.driver_service_preferences (
    driver_user_id,
    food_delivery_enabled,
    package_delivery_enabled,
    taxi_rides_enabled,
    accept_also_standard_rides,
    updated_at
  )
  values (
    p_user_id,
    true,
    true,
    case when v_mode = 'car' then coalesce(
      (select taxi_rides_enabled from public.driver_service_preferences where driver_user_id = p_user_id),
      false
    ) else false end,
    false,
    now()
  )
  on conflict (driver_user_id) do update set
    taxi_rides_enabled = case
      when v_mode = 'car' then driver_service_preferences.taxi_rides_enabled
      else false
    end,
    updated_at = now();

  if v_mode <> 'car' then
    update public.driver_service_preferences
    set taxi_rides_enabled = false, updated_at = now()
    where driver_user_id = p_user_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'transport_mode', v_mode,
    'taxi_auto_disabled', v_mode <> 'car'
  );
end;
$$;

grant execute on function public.driver_has_active_food_or_package_mission(uuid) to authenticated, service_role;
grant execute on function public.driver_has_active_mission(uuid) to authenticated, service_role;
grant execute on function public.change_driver_transport_mode(uuid, text) to service_role;

commit;
