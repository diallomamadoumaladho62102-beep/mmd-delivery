-- Zero-defect RC hotfix:
-- change_driver_transport_mode compared driver_documents.doc_type (enum driver_doc_type)
-- against invalid labels 'license', 'vehicle_registration', 'vehicle_insurance'.
-- That raises: invalid input value for enum driver_doc_type: "license"
-- Valid labels: driver_license, license_front, license_back, insurance, registration.

begin;

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
      and dd.doc_type in (
        'driver_license'::public.driver_doc_type,
        'license_front'::public.driver_doc_type,
        'license_back'::public.driver_doc_type
      )
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
      and dd.doc_type in (
        'registration'::public.driver_doc_type,
        'insurance'::public.driver_doc_type
      )
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

notify pgrst, 'reload schema';

commit;
