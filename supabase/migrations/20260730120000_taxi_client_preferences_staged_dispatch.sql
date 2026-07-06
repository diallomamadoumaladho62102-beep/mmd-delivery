-- Taxi client preferences: staged dispatch widening, driver capabilities, admin rules.

-- ---------------------------------------------------------------------------
-- 1) Client preferences on rides
-- ---------------------------------------------------------------------------

alter table public.taxi_rides
  add column if not exists client_preferences jsonb not null default '{}'::jsonb,
  add column if not exists ambiance_preference text not null default 'none'
    check (ambiance_preference in ('quiet', 'music', 'conversation', 'none')),
  add column if not exists preferences_dispatch_stage integer not null default 0,
  add column if not exists preferences_stage_until timestamptz,
  add column if not exists preferences_widen_delay_seconds integer not null default 30,
  add column if not exists preferences_drop_order jsonb not null default '[]'::jsonb,
  add column if not exists preferences_unmet jsonb not null default '[]'::jsonb,
  add column if not exists preferences_widened_at timestamptz,
  add column if not exists preferences_client_message text;

comment on column public.taxi_rides.client_preferences is
  'Optional blocking client prefs: non_smoking_driver, child_seat_required, pets_allowed, large_luggage, air_conditioning_required, phone_charger_requested, prefer_quiet_vehicle, prefer_electric_or_hybrid';

-- ---------------------------------------------------------------------------
-- 2) Driver / vehicle capability flags
-- ---------------------------------------------------------------------------

alter table public.driver_profiles
  add column if not exists non_smoking boolean not null default false;

alter table public.driver_vehicles
  add column if not exists pets_allowed boolean not null default false,
  add column if not exists large_luggage boolean not null default false,
  add column if not exists phone_charger_available boolean not null default false,
  add column if not exists quiet_vehicle boolean not null default false;

-- child_seat_available and has_air_conditioning already exist on driver_vehicles

-- ---------------------------------------------------------------------------
-- 3) Admin-configurable staged dispatch rules (country / city)
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_dispatch_preference_rules (
  id uuid primary key default gen_random_uuid(),
  country_code text,
  city text,
  widen_delay_seconds integer not null default 30
    check (widen_delay_seconds >= 0 and widen_delay_seconds <= 600),
  preference_drop_order jsonb not null default '[
    "child_seat_required",
    "non_smoking_driver",
    "phone_charger_requested",
    "large_luggage",
    "pets_allowed",
    "prefer_quiet_vehicle",
    "prefer_electric_or_hybrid",
    "air_conditioning_required"
  ]'::jsonb,
  enabled_preferences jsonb not null default '{
    "non_smoking_driver": true,
    "child_seat_required": true,
    "pets_allowed": true,
    "large_luggage": true,
    "air_conditioning_required": true,
    "phone_charger_requested": true,
    "prefer_quiet_vehicle": true,
    "prefer_electric_or_hybrid": true
  }'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_code, city)
);

insert into public.taxi_dispatch_preference_rules (
  country_code, city, widen_delay_seconds, preference_drop_order, enabled_preferences
) values (
  null, null, 30,
  '[
    "child_seat_required",
    "non_smoking_driver",
    "phone_charger_requested",
    "large_luggage",
    "pets_allowed",
    "prefer_quiet_vehicle",
    "prefer_electric_or_hybrid",
    "air_conditioning_required"
  ]'::jsonb,
  '{
    "non_smoking_driver": true,
    "child_seat_required": true,
    "pets_allowed": true,
    "large_luggage": true,
    "air_conditioning_required": true,
    "phone_charger_requested": true,
    "prefer_quiet_vehicle": true,
    "prefer_electric_or_hybrid": true
  }'::jsonb
) on conflict (country_code, city) do nothing;

alter table public.taxi_dispatch_preference_rules enable row level security;

drop policy if exists taxi_dispatch_preference_rules_select_authenticated
  on public.taxi_dispatch_preference_rules;
create policy taxi_dispatch_preference_rules_select_authenticated
  on public.taxi_dispatch_preference_rules for select
  to authenticated
  using (is_active = true);

-- ---------------------------------------------------------------------------
-- 4) Statistics aggregate (daily rollup target)
-- ---------------------------------------------------------------------------

create table if not exists public.taxi_preference_stats (
  id uuid primary key default gen_random_uuid(),
  stat_date date not null default current_date,
  country_code text,
  city text,
  rides_total integer not null default 0,
  rides_electric integer not null default 0,
  rides_hybrid integer not null default 0,
  rides_child_seat integer not null default 0,
  rides_wheelchair integer not null default 0,
  rides_large_luggage integer not null default 0,
  rides_non_smoking integer not null default 0,
  ambiance_quiet integer not null default 0,
  ambiance_music integer not null default 0,
  ambiance_conversation integer not null default 0,
  unique (stat_date, country_code, city)
);

-- ---------------------------------------------------------------------------
-- 5) Resolve admin rules
-- ---------------------------------------------------------------------------

create or replace function public.resolve_taxi_dispatch_preference_rules(
  p_country_code text default null,
  p_city text default null
)
returns public.taxi_dispatch_preference_rules
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select r.*
      from public.taxi_dispatch_preference_rules r
      where r.is_active = true
        and lower(coalesce(r.country_code, '')) = lower(coalesce(p_country_code, ''))
        and lower(coalesce(r.city, '')) = lower(coalesce(p_city, ''))
      limit 1
    ),
    (
      select r.*
      from public.taxi_dispatch_preference_rules r
      where r.is_active = true
        and lower(coalesce(r.country_code, '')) = lower(coalesce(p_country_code, ''))
        and coalesce(r.city, '') = ''
      limit 1
    ),
    (
      select r.*
      from public.taxi_dispatch_preference_rules r
      where r.is_active = true
        and r.country_code is null
        and r.city is null
      limit 1
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 6) Active enforced preferences for a ride at current stage
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

  select r.enabled_preferences into v_enabled
  from public.resolve_taxi_dispatch_preference_rules(v_ride.country_code, null) r;

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

-- ---------------------------------------------------------------------------
-- 7) Driver satisfies enforced preferences
-- ---------------------------------------------------------------------------

create or replace function public.driver_satisfies_ride_preferences(
  p_user_id uuid,
  p_ride_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_enforced jsonb;
  v_vehicle_id uuid;
  v_vehicle public.driver_vehicles%rowtype;
  v_profile public.driver_profiles%rowtype;
  v_ride public.taxi_rides%rowtype;
  v_class text;
  v_comfort_requires_ac boolean := false;
begin
  if p_user_id is null or p_ride_id is null then return false; end if;

  select * into v_ride from public.taxi_rides where id = p_ride_id;
  v_enforced := public.get_ride_enforced_preferences(p_ride_id);

  if v_enforced = '{}'::jsonb then
    return true;
  end if;

  v_vehicle_id := public.get_driver_active_vehicle_id(p_user_id);
  if v_vehicle_id is null then return false; end if;

  select * into v_vehicle from public.driver_vehicles where id = v_vehicle_id;
  select * into v_profile from public.driver_profiles where user_id = p_user_id;

  v_class := public.normalize_taxi_vehicle_category(v_ride.vehicle_class);
  v_comfort_requires_ac := v_class = 'comfort';

  if coalesce((v_enforced->>'non_smoking_driver')::boolean, false) then
    if coalesce(v_profile.non_smoking, false) is not true then return false; end if;
  end if;

  if coalesce((v_enforced->>'child_seat_required')::boolean, false) then
    if coalesce(v_vehicle.child_seat_available, false) is not true then return false; end if;
  end if;

  if coalesce((v_enforced->>'pets_allowed')::boolean, false) then
    if coalesce(v_vehicle.pets_allowed, false) is not true then return false; end if;
  end if;

  if coalesce((v_enforced->>'large_luggage')::boolean, false) then
    if coalesce(v_vehicle.large_luggage, false) is not true
       and lower(coalesce(v_vehicle.luggage_capacity, '')) not in ('large', 'xl', 'extra_large') then
      return false;
    end if;
  end if;

  if coalesce((v_enforced->>'phone_charger_requested')::boolean, false) then
    if coalesce(v_vehicle.phone_charger_available, false) is not true then return false; end if;
  end if;

  if coalesce((v_enforced->>'air_conditioning_required')::boolean, false) and not v_comfort_requires_ac then
    if coalesce(v_vehicle.has_air_conditioning, false) is not true then return false; end if;
  end if;

  if coalesce((v_enforced->>'prefer_quiet_vehicle')::boolean, false) then
    if coalesce(v_vehicle.quiet_vehicle, false) is not true
       and not public.taxi_fuel_type_is_green(v_vehicle.fuel_type) then
      return false;
    end if;
  end if;

  if coalesce((v_enforced->>'prefer_electric_or_hybrid')::boolean, false) then
    if not public.taxi_fuel_type_is_green(v_vehicle.fuel_type) then return false; end if;
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Update ride-aware eligibility to include preference matching
-- ---------------------------------------------------------------------------

create or replace function public.is_taxi_driver_eligible_for_ride(
  p_user_id uuid,
  p_taxi_ride_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ride public.taxi_rides%rowtype;
  v_vehicle_id uuid;
  v_accept_standard boolean := false;
begin
  if p_user_id is null or p_taxi_ride_id is null then return false; end if;

  select * into v_ride from public.taxi_rides where id = p_taxi_ride_id;
  if not found then return false; end if;

  if not public.is_taxi_driver_eligible(
    p_user_id,
    v_ride.vehicle_class,
    coalesce(v_ride.premium_driver_only, false)
  ) then
    return false;
  end if;

  v_vehicle_id := public.get_driver_active_vehicle_id(p_user_id);
  if v_vehicle_id is null then return false; end if;

  select coalesce(dsp.accept_also_standard_rides, false)
  into v_accept_standard
  from public.driver_service_preferences dsp
  where dsp.driver_user_id = p_user_id;

  if not public.driver_matches_taxi_ride_category(
    v_vehicle_id, v_ride.vehicle_class, v_accept_standard
  ) then
    return false;
  end if;

  if not public.driver_satisfies_ride_preferences(p_user_id, p_taxi_ride_id) then
    return false;
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) Advance preference dispatch stage
-- ---------------------------------------------------------------------------

create or replace function public.advance_taxi_preference_dispatch_stage(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.taxi_rides%rowtype;
  v_drop_order jsonb;
  v_max_stage integer;
  v_new_stage integer;
  v_unmet jsonb := '[]'::jsonb;
  v_dropped_key text;
  v_message text;
begin
  select * into v_ride from public.taxi_rides where id = p_ride_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  v_drop_order := coalesce(v_ride.preferences_drop_order, '[]'::jsonb);
  v_max_stage := jsonb_array_length(v_drop_order);
  v_new_stage := v_ride.preferences_dispatch_stage + 1;

  if v_new_stage > v_max_stage then
    return jsonb_build_object('ok', true, 'advanced', false, 'stage', v_ride.preferences_dispatch_stage);
  end if;

  v_dropped_key := v_drop_order->>v_ride.preferences_dispatch_stage;
  v_unmet := coalesce(v_ride.preferences_unmet, '[]'::jsonb);
  if v_dropped_key is not null then
    v_unmet := v_unmet || to_jsonb(v_dropped_key);
  end if;

  v_message :=
    'Nous n''avons trouvé aucun véhicule correspondant à tous vos critères. '
    || 'Nous avons élargi la recherche afin de réduire votre temps d''attente.';

  update public.taxi_rides
  set
    preferences_dispatch_stage = v_new_stage,
    preferences_stage_until = now() + make_interval(secs => coalesce(v_ride.preferences_widen_delay_seconds, 30)),
    preferences_unmet = v_unmet,
    preferences_widened_at = now(),
    preferences_client_message = v_message,
    electric_search_expired = case
      when v_dropped_key = 'prefer_electric_or_hybrid' then true
      else electric_search_expired
    end,
    updated_at = now()
  where id = p_ride_id;

  return jsonb_build_object(
    'ok', true,
    'advanced', true,
    'stage', v_new_stage,
    'dropped_preference', v_dropped_key,
    'unmet', v_unmet,
    'client_message', v_message
  );
end;
$$;

revoke all on function public.advance_taxi_preference_dispatch_stage(uuid) from public;
grant execute on function public.advance_taxi_preference_dispatch_stage(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 10) Initialize preference dispatch on ride
-- ---------------------------------------------------------------------------

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
begin
  select * into v_rules from public.resolve_taxi_dispatch_preference_rules(p_country_code, p_city);

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

grant execute on function public.initialize_taxi_ride_preference_dispatch(uuid, text, text) to service_role;
grant execute on function public.get_ride_enforced_preferences(uuid) to authenticated;
grant execute on function public.driver_satisfies_ride_preferences(uuid, uuid) to authenticated;
grant execute on function public.resolve_taxi_dispatch_preference_rules(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11) Accept validation: re-check preferences
-- ---------------------------------------------------------------------------

create or replace function public.validate_taxi_offer_acceptance(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_offer public.taxi_offers%rowtype;
  v_ride public.taxi_rides%rowtype;
  v_vehicle_id uuid;
  v_accept_standard boolean := false;
  v_fuel text;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'reason_code', 'not_authenticated', 'reason_message', 'Authentification requise.');
  end if;

  select * into v_offer
  from public.taxi_offers
  where id = p_offer_id and driver_id = v_driver_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason_code', 'offer_not_found', 'reason_message', 'Offre introuvable.');
  end if;

  select * into v_ride from public.taxi_rides where id = v_offer.taxi_ride_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason_code', 'ride_not_found', 'reason_message', 'Course introuvable.');
  end if;

  if v_offer.status <> 'pending' or v_offer.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason_code', 'offer_not_available', 'reason_message', 'Offre expirée ou indisponible.');
  end if;

  if not public.is_driver_identity_verified_for_taxi(v_driver_id) then
    return jsonb_build_object('ok', false, 'reason_code', 'identity_not_verified', 'reason_message', 'Vérification d''identité requise.');
  end if;

  if not public.is_taxi_account_active(v_driver_id) then
    return jsonb_build_object('ok', false, 'reason_code', 'account_inactive', 'reason_message', 'Compte inactif.');
  end if;

  if to_regprocedure('public.is_driver_operational(uuid)') is not null then
    if not public.is_driver_operational(v_driver_id) then
      return jsonb_build_object('ok', false, 'reason_code', 'driver_not_operational', 'reason_message', 'Compte chauffeur non approuvé.');
    end if;
  end if;

  if not exists (
    select 1 from public.driver_profiles dp
    where dp.user_id = v_driver_id and coalesce(dp.is_online, false) = true
  ) then
    return jsonb_build_object('ok', false, 'reason_code', 'driver_offline', 'reason_message', 'Vous devez être en ligne pour accepter.');
  end if;

  if public.driver_has_active_taxi_ride(v_driver_id)
     and not exists (
       select 1 from public.taxi_rides tr
       where tr.id = v_ride.id and tr.driver_id = v_driver_id
     ) then
    return jsonb_build_object('ok', false, 'reason_code', 'driver_unavailable', 'reason_message', 'Vous avez déjà une course active.');
  end if;

  if not public.is_driver_service_enabled(v_driver_id, 'taxi') then
    return jsonb_build_object('ok', false, 'reason_code', 'taxi_service_disabled', 'reason_message', 'Service taxi désactivé.');
  end if;

  v_vehicle_id := public.get_driver_active_vehicle_id(v_driver_id);
  if v_vehicle_id is null then
    return jsonb_build_object('ok', false, 'reason_code', 'no_active_vehicle', 'reason_message', 'Aucun véhicule actif.');
  end if;

  if not public.driver_vehicle_documents_valid(v_vehicle_id) then
    return jsonb_build_object('ok', false, 'reason_code', 'vehicle_documents_invalid', 'reason_message', 'Documents véhicule invalides ou expirés.');
  end if;

  select coalesce(dsp.accept_also_standard_rides, false)
  into v_accept_standard
  from public.driver_service_preferences dsp
  where dsp.driver_user_id = v_driver_id;

  if not public.driver_matches_taxi_ride_category(v_vehicle_id, v_ride.vehicle_class, v_accept_standard) then
    return jsonb_build_object('ok', false, 'reason_code', 'category_not_eligible', 'reason_message', 'Catégorie véhicule incompatible avec la course.');
  end if;

  if not public.driver_satisfies_ride_preferences(v_driver_id, v_ride.id) then
    return jsonb_build_object('ok', false, 'reason_code', 'preferences_not_met', 'reason_message', 'Vous ne correspondez plus aux préférences client de cette course.');
  end if;

  if lower(coalesce(v_ride.payment_status, '')) <> 'paid' then
    return jsonb_build_object('ok', false, 'reason_code', 'ride_not_paid', 'reason_message', 'Course non payée.');
  end if;

  if v_ride.driver_id is not null and v_ride.driver_id <> v_driver_id then
    return jsonb_build_object('ok', false, 'reason_code', 'already_assigned', 'reason_message', 'Course déjà assignée.');
  end if;

  if lower(coalesce(v_ride.status, '')) not in ('paid', 'dispatching') then
    return jsonb_build_object('ok', false, 'reason_code', 'ride_not_available', 'reason_message', 'Course non disponible.');
  end if;

  select dv.fuel_type into v_fuel from public.driver_vehicles dv where dv.id = v_vehicle_id;

  return jsonb_build_object(
    'ok', true,
    'vehicle_id', v_vehicle_id,
    'fuel_type', v_fuel,
    'is_green_vehicle', public.taxi_fuel_type_is_green(v_fuel),
    'client_preferences', coalesce(v_ride.client_preferences, '{}'::jsonb),
    'ambiance_preference', v_ride.ambiance_preference
  );
end;
$$;
