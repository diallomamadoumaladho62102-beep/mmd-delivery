-- Taxi international finalization: multi-vehicle, accept-time verification,
-- category downgrade, electric preference, audit history.

-- ---------------------------------------------------------------------------
-- 1) Schema extensions
-- ---------------------------------------------------------------------------

alter table public.driver_service_preferences
  add column if not exists accept_also_standard_rides boolean not null default false;

alter table public.driver_profiles
  add column if not exists active_vehicle_id uuid references public.driver_vehicles (id) on delete set null;

alter table public.driver_vehicles
  add column if not exists fuel_type text not null default 'gasoline'
    check (fuel_type in ('gasoline', 'diesel', 'hybrid', 'electric', 'plug_in_hybrid')),
  add column if not exists vehicle_status text not null default 'active'
    check (vehicle_status in ('active', 'inactive', 'suspended', 'pending_review', 'rejected')),
  add column if not exists deleted_at timestamptz,
  add column if not exists nickname text;

create index if not exists idx_driver_profiles_active_vehicle
  on public.driver_profiles (active_vehicle_id)
  where active_vehicle_id is not null;

create index if not exists idx_driver_vehicles_driver_status
  on public.driver_vehicles (driver_user_id, vehicle_status)
  where deleted_at is null;

alter table public.taxi_rides
  add column if not exists prefer_electric_or_hybrid boolean not null default false,
  add column if not exists electric_search_until timestamptz,
  add column if not exists electric_search_expired boolean not null default false,
  add column if not exists assigned_vehicle_id uuid references public.driver_vehicles (id) on delete set null,
  add column if not exists assigned_fuel_type text,
  add column if not exists is_green_vehicle boolean not null default false,
  add column if not exists co2_saved_estimate_g numeric(12, 2);

alter table public.taxi_offers
  add column if not exists vehicle_id uuid references public.driver_vehicles (id) on delete set null,
  add column if not exists fuel_type text,
  add column if not exists reject_reason_code text,
  add column if not exists reject_reason_message text;

alter table public.vehicle_category_rules
  add column if not exists electric_search_seconds integer not null default 30
    check (electric_search_seconds >= 0 and electric_search_seconds <= 600);

create table if not exists public.driver_vehicle_history (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id uuid references public.driver_vehicles (id) on delete set null,
  action text not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_driver_vehicle_history_driver
  on public.driver_vehicle_history (driver_user_id, created_at desc);

alter table public.driver_vehicle_history enable row level security;

drop policy if exists driver_vehicle_history_select_own on public.driver_vehicle_history;
create policy driver_vehicle_history_select_own
  on public.driver_vehicle_history for select
  using (driver_user_id = auth.uid());

create table if not exists public.taxi_accept_audit_events (
  id uuid primary key default gen_random_uuid(),
  taxi_ride_id uuid not null references public.taxi_rides (id) on delete cascade,
  taxi_offer_id uuid references public.taxi_offers (id) on delete set null,
  driver_user_id uuid not null references auth.users (id) on delete cascade,
  vehicle_id uuid references public.driver_vehicles (id) on delete set null,
  reason_code text not null,
  reason_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_taxi_accept_audit_ride
  on public.taxi_accept_audit_events (taxi_ride_id, created_at desc);

create index if not exists idx_taxi_accept_audit_driver
  on public.taxi_accept_audit_events (driver_user_id, created_at desc);

alter table public.taxi_accept_audit_events enable row level security;

drop policy if exists taxi_accept_audit_select_own on public.taxi_accept_audit_events;
create policy taxi_accept_audit_select_own
  on public.taxi_accept_audit_events for select
  using (driver_user_id = auth.uid());

-- Backfill active vehicle from primary
update public.driver_profiles dp
set active_vehicle_id = sub.id
from (
  select distinct on (dv.driver_user_id)
    dv.driver_user_id,
    dv.id
  from public.driver_vehicles dv
  where dv.deleted_at is null
    and dv.vehicle_active = true
  order by dv.driver_user_id, dv.is_primary desc, dv.updated_at desc
) sub
where dp.user_id = sub.driver_user_id
  and dp.active_vehicle_id is null;

update public.driver_vehicles
set vehicle_status = case
  when admin_review_status = 'rejected' then 'rejected'
  when admin_review_status = 'pending_review' then 'pending_review'
  when vehicle_active = false then 'inactive'
  else 'active'
end
where vehicle_status = 'active'
  and (
    admin_review_status in ('rejected', 'pending_review')
    or vehicle_active = false
  );

-- ---------------------------------------------------------------------------
-- 2) Helpers
-- ---------------------------------------------------------------------------

create or replace function public.taxi_fuel_type_is_green(p_fuel_type text)
returns boolean
language sql
immutable
as $$
  select lower(trim(coalesce(p_fuel_type, ''))) in ('electric', 'hybrid', 'plug_in_hybrid');
$$;

create or replace function public.resolve_electric_search_seconds(
  p_country_code text default null,
  p_city text default null
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select r.electric_search_seconds
      from public.vehicle_category_rules r
      where r.is_active = true
        and r.category = 'standard'
        and lower(coalesce(r.country_code, '')) = lower(coalesce(p_country_code, ''))
        and lower(coalesce(r.city, '')) = lower(coalesce(p_city, ''))
      limit 1
    ),
    (
      select r.electric_search_seconds
      from public.vehicle_category_rules r
      where r.is_active = true
        and r.category = 'standard'
        and r.country_code is not distinct from null
        and r.city is not distinct from null
      limit 1
    ),
    30
  );
$$;

create or replace function public.get_driver_active_vehicle_id(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select dp.active_vehicle_id
      from public.driver_profiles dp
      where dp.user_id = p_user_id
        and dp.active_vehicle_id is not null
        and exists (
          select 1
          from public.driver_vehicles dv
          where dv.id = dp.active_vehicle_id
            and dv.driver_user_id = p_user_id
            and dv.deleted_at is null
            and dv.vehicle_status = 'active'
            and dv.vehicle_active = true
        )
    ),
    (
      select dv.id
      from public.driver_vehicles dv
      where dv.driver_user_id = p_user_id
        and dv.deleted_at is null
        and dv.vehicle_active = true
        and dv.vehicle_status = 'active'
      order by dv.is_primary desc, dv.updated_at desc
      limit 1
    )
  );
$$;

create or replace function public.driver_vehicle_documents_valid(p_vehicle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.driver_vehicles dv
    where dv.id = p_vehicle_id
      and dv.deleted_at is null
      and dv.vehicle_active = true
      and dv.vehicle_status = 'active'
      and lower(coalesce(dv.admin_review_status, '')) = 'approved'
      and lower(coalesce(dv.inspection_status, '')) = 'approved'
      and lower(coalesce(dv.insurance_status, '')) = 'approved'
      and lower(coalesce(dv.registration_status, '')) = 'approved'
  );
$$;

create or replace function public.driver_vehicle_category_eligible(
  p_vehicle_id uuid,
  p_category text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.vehicle_category_eligibility vce
    where vce.vehicle_id = p_vehicle_id
      and vce.category = public.normalize_taxi_vehicle_category(p_category)
      and vce.status = 'eligible'
  );
$$;

create or replace function public.driver_matches_taxi_ride_category(
  p_vehicle_id uuid,
  p_ride_class text,
  p_accept_also_standard boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ride_class text := public.normalize_taxi_vehicle_category(p_ride_class);
begin
  if v_ride_class = 'standard' then
    if public.driver_vehicle_category_eligible(p_vehicle_id, 'standard') then
      return true;
    end if;
    if coalesce(p_accept_also_standard, false) then
      return public.driver_vehicle_category_eligible(p_vehicle_id, 'comfort')
        or public.driver_vehicle_category_eligible(p_vehicle_id, 'xl')
        or public.driver_vehicle_category_eligible(p_vehicle_id, 'wheelchair_accessible');
    end if;
    return false;
  end if;

  if v_ride_class = 'comfort' then
    return public.driver_vehicle_category_eligible(p_vehicle_id, 'comfort');
  end if;

  if v_ride_class = 'xl' then
    return public.driver_vehicle_category_eligible(p_vehicle_id, 'xl');
  end if;

  if v_ride_class = 'wheelchair_accessible' then
    return public.driver_vehicle_category_eligible(p_vehicle_id, 'wheelchair_accessible');
  end if;

  return false;
end;
$$;

create or replace function public.is_driver_identity_verified_for_taxi(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.driver_identity_state dis
    where dis.driver_id = p_user_id
      and dis.gate_status in (
        'required', 'pending', 'submitted', 'manual_review', 'rejected', 'expired'
      )
  );
$$;

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
        'accepted', 'driver_arrived', 'in_progress', 'dispatching'
      )
  );
$$;

create or replace function public.log_driver_vehicle_history(
  p_driver_user_id uuid,
  p_vehicle_id uuid,
  p_action text,
  p_actor_user_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.driver_vehicle_history (
    driver_user_id, vehicle_id, action, actor_user_id, metadata
  ) values (
    p_driver_user_id, p_vehicle_id, p_action, p_actor_user_id, coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Category eligibility uses active vehicle
-- ---------------------------------------------------------------------------

create or replace function public.is_driver_taxi_category_eligible(
  p_user_id uuid,
  p_vehicle_class text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_vehicle_id uuid := public.get_driver_active_vehicle_id(p_user_id);
  v_accept_standard boolean := false;
begin
  if v_vehicle_id is null then return false; end if;

  select coalesce(dsp.accept_also_standard_rides, false)
  into v_accept_standard
  from public.driver_service_preferences dsp
  where dsp.driver_user_id = p_user_id;

  return public.driver_matches_taxi_ride_category(
    v_vehicle_id,
    p_vehicle_class,
    v_accept_standard
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Ride-aware eligibility (electric preference phase)
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
  v_require_green boolean := false;
  v_fuel text;
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

  if coalesce(v_ride.prefer_electric_or_hybrid, false)
     and coalesce(v_ride.electric_search_expired, false) = false
     and (v_ride.electric_search_until is null or v_ride.electric_search_until > now()) then
    select dv.fuel_type into v_fuel
    from public.driver_vehicles dv
    where dv.id = v_vehicle_id;

    if not public.taxi_fuel_type_is_green(v_fuel) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.is_taxi_driver_eligible_for_ride(uuid, uuid) from public;
grant execute on function public.is_taxi_driver_eligible_for_ride(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Full accept-time validation
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

  if coalesce(v_ride.prefer_electric_or_hybrid, false)
     and coalesce(v_ride.electric_search_expired, false) = false
     and (v_ride.electric_search_until is null or v_ride.electric_search_until > now()) then
    select dv.fuel_type into v_fuel from public.driver_vehicles dv where dv.id = v_vehicle_id;
    if not public.taxi_fuel_type_is_green(v_fuel) then
      return jsonb_build_object('ok', false, 'reason_code', 'electric_required', 'reason_message', 'Course réservée pour véhicule électrique/hybride.');
    end if;
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
    'is_green_vehicle', public.taxi_fuel_type_is_green(v_fuel)
  );
end;
$$;

revoke all on function public.validate_taxi_offer_acceptance(uuid) from public;
grant execute on function public.validate_taxi_offer_acceptance(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) Set active vehicle (offline only, no active ride)
-- ---------------------------------------------------------------------------

create or replace function public.set_driver_active_vehicle(p_vehicle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_vehicle public.driver_vehicles%rowtype;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  select * into v_vehicle
  from public.driver_vehicles
  where id = p_vehicle_id and driver_user_id = v_driver_id and deleted_at is null;

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

revoke all on function public.set_driver_active_vehicle(uuid) from public;
grant execute on function public.set_driver_active_vehicle(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) Rewrite driver_accept_taxi_offer with full validation + audit
-- ---------------------------------------------------------------------------

create or replace function public.driver_accept_taxi_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_offer public.taxi_offers%rowtype;
  v_ride public.taxi_rides%rowtype;
  v_validation jsonb;
  v_vehicle_id uuid;
  v_fuel text;
  v_is_green boolean;
  v_old_status text;
  v_sync jsonb;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  select * into v_offer
  from public.taxi_offers
  where id = p_offer_id and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'offer_not_found');
  end if;

  v_validation := public.validate_taxi_offer_acceptance(p_offer_id);

  if coalesce((v_validation->>'ok')::boolean, false) is not true then
    update public.taxi_offers
    set
      status = 'rejected',
      reject_reason_code = v_validation->>'reason_code',
      reject_reason_message = v_validation->>'reason_message',
      updated_at = now()
    where id = p_offer_id;

    insert into public.taxi_accept_audit_events (
      taxi_ride_id, taxi_offer_id, driver_user_id, vehicle_id,
      reason_code, reason_message, metadata
    ) values (
      v_offer.taxi_ride_id,
      p_offer_id,
      v_driver_id,
      nullif(v_validation->>'vehicle_id', '')::uuid,
      coalesce(v_validation->>'reason_code', 'validation_failed'),
      v_validation->>'reason_message',
      v_validation
    );

    return jsonb_build_object(
      'ok', false,
      'message', coalesce(v_validation->>'reason_code', 'validation_failed'),
      'reason_message', v_validation->>'reason_message',
      'should_redispatch', true,
      'taxi_ride_id', v_offer.taxi_ride_id
    );
  end if;

  v_vehicle_id := (v_validation->>'vehicle_id')::uuid;
  v_fuel := v_validation->>'fuel_type';
  v_is_green := coalesce((v_validation->>'is_green_vehicle')::boolean, false);

  select * into v_ride from public.taxi_rides where id = v_offer.taxi_ride_id for update;

  update public.taxi_rides
  set
    driver_id = v_driver_id,
    status = 'accepted',
    accepted_at = now(),
    assigned_vehicle_id = v_vehicle_id,
    assigned_fuel_type = v_fuel,
    is_green_vehicle = v_is_green,
    updated_at = now()
  where id = v_ride.id
    and driver_id is null
    and lower(coalesce(payment_status, '')) = 'paid'
    and lower(coalesce(status, '')) in ('paid', 'dispatching');

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_no_longer_available', 'should_redispatch', true);
  end if;

  update public.taxi_offers
  set status = 'accepted', vehicle_id = v_vehicle_id, fuel_type = v_fuel, updated_at = now()
  where id = p_offer_id;

  update public.taxi_offers
  set status = 'superseded', updated_at = now()
  where taxi_ride_id = v_offer.taxi_ride_id
    and id <> p_offer_id
    and status = 'pending';

  v_sync := public.sync_taxi_shared_ride_driver(v_ride.id, v_driver_id);

  v_old_status := coalesce(v_ride.status, 'dispatching');

  perform public.log_taxi_event(
    v_ride.id,
    'driver_accepted',
    v_old_status,
    'accepted',
    v_driver_id,
    'driver',
    'Driver accepted taxi offer',
    jsonb_build_object('offer_id', p_offer_id, 'vehicle_id', v_vehicle_id, 'fuel_type', v_fuel, 'shared_sync', v_sync)
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', v_ride.id,
    'vehicle_id', v_vehicle_id,
    'is_green_vehicle', v_is_green
  );
end;
$$;

revoke all on function public.driver_accept_taxi_offer(uuid) from public;
grant execute on function public.driver_accept_taxi_offer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8) Expire electric search window helper (cron/API)
-- ---------------------------------------------------------------------------

create or replace function public.expire_taxi_electric_search_windows()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  update public.taxi_rides tr
  set
    electric_search_expired = true,
    updated_at = now()
  where tr.prefer_electric_or_hybrid = true
    and tr.electric_search_expired = false
    and tr.electric_search_until is not null
    and tr.electric_search_until <= now()
    and tr.driver_id is null
    and lower(coalesce(tr.status, '')) in ('paid', 'dispatching');

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.log_driver_vehicle_history(uuid, uuid, text, uuid, jsonb) to service_role;

revoke all on function public.expire_taxi_electric_search_windows() from public;
grant execute on function public.expire_taxi_electric_search_windows() to service_role;

grant execute on function public.get_driver_active_vehicle_id(uuid) to authenticated;
grant execute on function public.driver_matches_taxi_ride_category(uuid, text, boolean) to authenticated;
grant execute on function public.taxi_fuel_type_is_green(text) to authenticated;
grant execute on function public.resolve_electric_search_seconds(text, text) to authenticated;
