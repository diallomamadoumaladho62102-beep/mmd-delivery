-- Taxi finalization: city-scoped preference rules + active-ride compliance monitoring

begin;

-- ---------------------------------------------------------------------------
-- 1) Pickup city on rides (for city > country > global rule resolution)
-- ---------------------------------------------------------------------------

alter table public.taxi_rides
  add column if not exists pickup_city text;

create index if not exists taxi_rides_country_pickup_city_idx
  on public.taxi_rides (country_code, pickup_city)
  where pickup_city is not null;

create or replace function public.normalize_taxi_city_name(p_city text)
returns text
language sql
immutable
as $$
  select nullif(
    lower(trim(regexp_replace(coalesce(p_city, ''), '\s+', ' ', 'g'))),
    ''
  );
$$;

-- ---------------------------------------------------------------------------
-- 2) Rule resolver — city > country > global (normalized match)
-- ---------------------------------------------------------------------------

create or replace function public.resolve_taxi_dispatch_preference_rules(
  p_country_code text default null,
  p_city text default null
)
returns public.taxi_dispatch_preference_rules
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rules public.taxi_dispatch_preference_rules%rowtype;
  v_city text := public.normalize_taxi_city_name(p_city);
begin
  if v_city is not null then
    select *
    into v_rules
    from public.taxi_dispatch_preference_rules r
    where r.is_active = true
      and lower(coalesce(r.country_code, '')) = lower(coalesce(p_country_code, ''))
      and public.normalize_taxi_city_name(r.city) = v_city
    limit 1;

    if found then
      return v_rules;
    end if;
  end if;

  select *
  into v_rules
  from public.taxi_dispatch_preference_rules r
  where r.is_active = true
    and lower(coalesce(r.country_code, '')) = lower(coalesce(p_country_code, ''))
    and coalesce(r.city, '') = ''
  limit 1;

  if found then
    return v_rules;
  end if;

  select *
  into v_rules
  from public.taxi_dispatch_preference_rules r
  where r.is_active = true
    and r.country_code is null
    and r.city is null
  limit 1;

  return v_rules;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Enforced preferences use ride pickup city
-- ---------------------------------------------------------------------------

create or replace function public.get_ride_enforced_preferences(p_ride_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ride public.taxi_rides%rowtype;
  v_requested jsonb;
  v_drop_order jsonb;
  v_enabled jsonb;
  v_result jsonb := '{}'::jsonb;
  v_key text;
  v_dropped text[];
  i integer;
begin
  select * into v_ride from public.taxi_rides where id = p_ride_id;
  if not found then return '{}'::jsonb; end if;

  v_requested := coalesce(v_ride.client_preferences, '{}'::jsonb);

  if coalesce(v_ride.prefer_electric_or_hybrid, false) then
    v_requested := v_requested || jsonb_build_object('prefer_electric_or_hybrid', true);
  end if;

  v_drop_order := coalesce(v_ride.preferences_drop_order, '[]'::jsonb);

  v_enabled := (
    public.resolve_taxi_dispatch_preference_rules(v_ride.country_code, v_ride.pickup_city)
  ).enabled_preferences;

  v_dropped := array[]::text[];
  if jsonb_array_length(v_drop_order) > 0 then
    for i in 0..(least(v_ride.preferences_dispatch_stage, jsonb_array_length(v_drop_order) - 1)) loop
      v_dropped := v_dropped || jsonb_array_element_text(v_drop_order, i);
    end loop;
  end if;

  for v_key in
    select jsonb_object_keys(v_requested)
  loop
    if coalesce((v_requested->>v_key)::boolean, false) is not true then
      continue;
    end if;
    if v_enabled is not null and coalesce((v_enabled->>v_key)::boolean, true) is not true then
      continue;
    end if;
    if v_key = any(v_dropped) then
      continue;
    end if;
    v_result := v_result || jsonb_build_object(v_key, true);
  end loop;

  return v_result;
end;
$$;

create or replace function public.initialize_taxi_ride_preference_dispatch(
  p_ride_id uuid,
  p_country_code text default null,
  p_city text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rules public.taxi_dispatch_preference_rules%rowtype;
  v_city text;
begin
  select pickup_city into v_city from public.taxi_rides where id = p_ride_id;

  select * into v_rules
  from public.resolve_taxi_dispatch_preference_rules(
    p_country_code,
    coalesce(v_city, p_city)
  );

  update public.taxi_rides
  set
    preferences_dispatch_stage = 0,
    preferences_widen_delay_seconds = coalesce(v_rules.widen_delay_seconds, 30),
    preferences_drop_order = coalesce(v_rules.preference_drop_order, preferences_drop_order),
    preferences_stage_until = now() + make_interval(secs => coalesce(v_rules.widen_delay_seconds, 30)),
    preferences_unmet = '[]'::jsonb,
    preferences_client_message = null,
    updated_at = now()
  where id = p_ride_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Active ride compliance events (log only — never cancel in-progress rides)
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_ride_compliance_events (
  id uuid primary key default gen_random_uuid(),
  taxi_ride_id uuid not null references public.taxi_rides (id) on delete cascade,
  driver_user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null,
  severity text not null default 'warning'
    check (severity in ('info', 'warning', 'safety')),
  affects_future_rides boolean not null default true,
  notify_driver boolean not null default true,
  notify_client boolean not null default false,
  message_driver text,
  message_client text,
  metadata jsonb not null default '{}'::jsonb,
  driver_notified_at timestamptz,
  client_notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (taxi_ride_id, event_type)
);

create index if not exists taxi_ride_compliance_events_ride_idx
  on public.taxi_ride_compliance_events (taxi_ride_id, created_at desc);

create index if not exists taxi_ride_compliance_events_driver_idx
  on public.taxi_ride_compliance_events (driver_user_id, created_at desc);

alter table public.taxi_ride_compliance_events enable row level security;

drop policy if exists taxi_ride_compliance_events_select_participants
  on public.taxi_ride_compliance_events;
create policy taxi_ride_compliance_events_select_participants
  on public.taxi_ride_compliance_events for select
  to authenticated
  using (
    exists (
      select 1
      from public.taxi_rides tr
      where tr.id = taxi_ride_id
        and (tr.client_user_id = auth.uid() or tr.driver_id = auth.uid())
    )
  );

create or replace function public.scan_active_taxi_ride_compliance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride record;
  v_profile public.driver_profiles%rowtype;
  v_vehicle public.driver_vehicles%rowtype;
  v_identity public.driver_identity_state%rowtype;
  v_inserted integer := 0;
  v_scanned integer := 0;
  v_rowcount integer := 0;
begin
  for v_ride in
    select tr.id, tr.driver_id, tr.client_user_id, tr.vehicle_class
    from public.taxi_rides tr
    where tr.driver_id is not null
      and lower(coalesce(tr.status, '')) in (
        'accepted', 'driver_arrived', 'in_progress'
      )
  loop
    v_scanned := v_scanned + 1;

    select * into v_profile
    from public.driver_profiles dp
    where dp.user_id = v_ride.driver_id;

    if coalesce(lower(v_profile.status), '') in ('suspended', 'disabled') then
      insert into public.taxi_ride_compliance_events (
        taxi_ride_id, driver_user_id, event_type, severity,
        affects_future_rides, notify_driver, notify_client,
        message_driver, message_client, metadata
      ) values (
        v_ride.id, v_ride.driver_id, 'driver_profile_suspended', 'safety',
        true, true, true,
        'Votre compte chauffeur nécessite une régularisation. Vous pourrez terminer cette course, mais vous ne pourrez pas accepter de nouvelles courses tant que votre situation n''est pas résolue.',
        'MMD vérifie la conformité de votre chauffeur. Votre course en cours se poursuit normalement ; notre équipe interviendra si nécessaire.',
        jsonb_build_object('driver_status', v_profile.status)
      )
      on conflict (taxi_ride_id, event_type) do nothing;
      get diagnostics v_rowcount = row_count;
      v_inserted := v_inserted + v_rowcount;
    elsif coalesce(lower(v_profile.status), '') <> 'approved' then
      insert into public.taxi_ride_compliance_events (
        taxi_ride_id, driver_user_id, event_type, severity,
        affects_future_rides, notify_driver, notify_client,
        message_driver, message_client, metadata
      ) values (
        v_ride.id, v_ride.driver_id, 'driver_not_operational', 'warning',
        true, true, false,
        'Votre profil chauffeur n''est plus opérationnel. Terminez cette course puis régularisez votre dossier avant d''accepter de nouvelles demandes.',
        null,
        jsonb_build_object('driver_status', v_profile.status)
      )
      on conflict (taxi_ride_id, event_type) do nothing;
      get diagnostics v_rowcount = row_count;
      v_inserted := v_inserted + v_rowcount;
    end if;

    select dv.* into v_vehicle
    from public.driver_profiles dp
    join public.driver_vehicles dv on dv.id = dp.active_vehicle_id
    where dp.user_id = v_ride.driver_id;

    if found then
      if coalesce(v_vehicle.vehicle_active, true) is not true then
        insert into public.taxi_ride_compliance_events (
          taxi_ride_id, driver_user_id, event_type, severity,
          affects_future_rides, notify_driver, notify_client,
          message_driver, metadata
        ) values (
          v_ride.id, v_ride.driver_id, 'vehicle_suspended', 'warning',
          true, true, false,
          'Votre véhicule actif est suspendu. Terminez cette course puis mettez à jour votre véhicule avant d''accepter de nouvelles courses.',
          jsonb_build_object('vehicle_id', v_vehicle.id, 'vehicle_active', v_vehicle.vehicle_active)
        )
        on conflict (taxi_ride_id, event_type) do nothing;
        get diagnostics v_rowcount = row_count;
        v_inserted := v_inserted + v_rowcount;
      end if;

      if lower(coalesce(v_vehicle.insurance_status, '')) = 'expired' then
        insert into public.taxi_ride_compliance_events (
          taxi_ride_id, driver_user_id, event_type, severity,
          affects_future_rides, notify_driver, notify_client,
          message_driver, metadata
        ) values (
          v_ride.id, v_ride.driver_id, 'insurance_expired', 'warning',
          true, true, false,
          'L''assurance de votre véhicule a expiré. Régularisez votre dossier avant d''accepter de nouvelles courses taxi.',
          jsonb_build_object('vehicle_id', v_vehicle.id, 'insurance_status', v_vehicle.insurance_status)
        )
        on conflict (taxi_ride_id, event_type) do nothing;
        get diagnostics v_rowcount = row_count;
        v_inserted := v_inserted + v_rowcount;
      end if;

      if lower(coalesce(v_vehicle.registration_status, '')) = 'expired' then
        insert into public.taxi_ride_compliance_events (
          taxi_ride_id, driver_user_id, event_type, severity,
          affects_future_rides, notify_driver, notify_client,
          message_driver, metadata
        ) values (
          v_ride.id, v_ride.driver_id, 'registration_expired', 'warning',
          true, true, false,
          'L''immatriculation de votre véhicule a expiré. Mettez-la à jour avant d''accepter de nouvelles courses.',
          jsonb_build_object('vehicle_id', v_vehicle.id, 'registration_status', v_vehicle.registration_status)
        )
        on conflict (taxi_ride_id, event_type) do nothing;
        get diagnostics v_rowcount = row_count;
        v_inserted := v_inserted + v_rowcount;
      end if;

      if exists (
        select 1
        from public.vehicle_category_eligibility vce
        where vce.vehicle_id = v_vehicle.id
          and vce.category = public.normalize_taxi_vehicle_category(v_ride.vehicle_class)
          and (
            vce.admin_suspended is true
            or lower(coalesce(vce.status, '')) = 'suspended'
          )
      ) then
        insert into public.taxi_ride_compliance_events (
          taxi_ride_id, driver_user_id, event_type, severity,
          affects_future_rides, notify_driver, notify_client,
          message_driver, metadata
        ) values (
          v_ride.id, v_ride.driver_id, 'vehicle_category_suspended', 'warning',
          true, true, false,
          'La catégorie taxi de votre véhicule a été suspendue. Terminez cette course puis contactez le support si nécessaire.',
          jsonb_build_object('vehicle_id', v_vehicle.id, 'vehicle_class', v_ride.vehicle_class)
        )
        on conflict (taxi_ride_id, event_type) do nothing;
        get diagnostics v_rowcount = row_count;
        v_inserted := v_inserted + v_rowcount;
      end if;
    end if;

    select * into v_identity
    from public.driver_identity_state dis
    where dis.driver_id = v_ride.driver_id;

    if found and lower(coalesce(v_identity.gate_status, '')) in (
      'required', 'rejected', 'expired', 'canceled'
    ) then
      insert into public.taxi_ride_compliance_events (
        taxi_ride_id, driver_user_id, event_type, severity,
        affects_future_rides, notify_driver, notify_client,
        message_driver, metadata
      ) values (
        v_ride.id, v_ride.driver_id, 'identity_invalid', 'warning',
        true, true, false,
        'Votre vérification d''identité doit être complétée avant d''accepter de nouvelles courses.',
        jsonb_build_object('gate_status', v_identity.gate_status)
      )
      on conflict (taxi_ride_id, event_type) do nothing;
      get diagnostics v_rowcount = row_count;
      v_inserted := v_inserted + v_rowcount;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'scanned', v_scanned,
    'events_inserted', v_inserted
  );
end;
$$;

grant execute on function public.scan_active_taxi_ride_compliance() to service_role;
grant execute on function public.normalize_taxi_city_name(text) to authenticated;

commit;
