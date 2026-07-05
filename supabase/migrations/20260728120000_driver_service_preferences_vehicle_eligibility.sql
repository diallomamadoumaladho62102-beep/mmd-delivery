-- Driver service preferences + vehicle category eligibility for taxi dispatch

-- ---------------------------------------------------------------------------
-- 1) driver_service_preferences
-- ---------------------------------------------------------------------------

create table if not exists public.driver_service_preferences (
  driver_user_id uuid primary key references auth.users (id) on delete cascade,
  food_delivery_enabled boolean not null default false,
  package_delivery_enabled boolean not null default false,
  taxi_rides_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_driver_service_preferences_active
  on public.driver_service_preferences (driver_user_id)
  where food_delivery_enabled or package_delivery_enabled or taxi_rides_enabled;

alter table public.driver_service_preferences enable row level security;

drop policy if exists driver_service_preferences_select_own on public.driver_service_preferences;
create policy driver_service_preferences_select_own
  on public.driver_service_preferences for select
  using (driver_user_id = auth.uid());

drop policy if exists driver_service_preferences_upsert_own on public.driver_service_preferences;
create policy driver_service_preferences_upsert_own
  on public.driver_service_preferences for all
  using (driver_user_id = auth.uid())
  with check (driver_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2) vehicle_category_rules (admin-configurable)
-- ---------------------------------------------------------------------------

create table if not exists public.vehicle_category_rules (
  id uuid primary key default gen_random_uuid(),
  country_code text,
  city text,
  category text not null check (
    category in ('standard', 'comfort', 'xl', 'wheelchair_accessible')
  ),
  max_vehicle_age_years integer not null,
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

-- Global defaults
insert into public.vehicle_category_rules (
  country_code, city, category, max_vehicle_age_years, min_passenger_seats,
  requires_air_conditioning, requires_wheelchair_equipment,
  requires_wheelchair_admin_verified, min_driver_rating, allowed_vehicle_types,
  requires_admin_approval
) values
  (null, null, 'standard', 10, 4, false, false, false, null, null, false),
  (null, null, 'comfort', 5, 4, true, false, false, 4.5, null, true),
  (null, null, 'xl', 10, 6, false, false, false, null, array['suv','van','minivan'], true),
  (null, null, 'wheelchair_accessible', 10, 4, false, true, true, null, null, true)
on conflict (country_code, city, category) do nothing;

alter table public.vehicle_category_rules enable row level security;

drop policy if exists vehicle_category_rules_select_authenticated on public.vehicle_category_rules;
create policy vehicle_category_rules_select_authenticated
  on public.vehicle_category_rules for select
  to authenticated
  using (is_active = true);

-- ---------------------------------------------------------------------------
-- 3) driver_vehicles
-- ---------------------------------------------------------------------------

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
  inspection_status text not null default 'pending'
    check (inspection_status in ('pending', 'approved', 'rejected', 'expired')),
  insurance_status text not null default 'pending'
    check (insurance_status in ('pending', 'approved', 'rejected', 'expired')),
  registration_status text not null default 'pending'
    check (registration_status in ('pending', 'approved', 'rejected', 'expired')),
  vehicle_active boolean not null default true,
  admin_review_status text not null default 'pending_review'
    check (admin_review_status in ('pending_review', 'approved', 'rejected')),
  admin_review_notes text,
  review_requested_at timestamptz,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_driver_vehicles_driver_primary
  on public.driver_vehicles (driver_user_id, is_primary)
  where vehicle_active = true;

alter table public.driver_vehicles enable row level security;

drop policy if exists driver_vehicles_select_own on public.driver_vehicles;
create policy driver_vehicles_select_own
  on public.driver_vehicles for select
  using (driver_user_id = auth.uid());

drop policy if exists driver_vehicles_insert_own on public.driver_vehicles;
create policy driver_vehicles_insert_own
  on public.driver_vehicles for insert
  with check (driver_user_id = auth.uid());

drop policy if exists driver_vehicles_update_own on public.driver_vehicles;
create policy driver_vehicles_update_own
  on public.driver_vehicles for update
  using (driver_user_id = auth.uid())
  with check (driver_user_id = auth.uid());

-- Prevent drivers from self-verifying wheelchair equipment
create or replace function public.guard_driver_vehicle_self_update()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null and auth.uid() = new.driver_user_id then
    if tg_op = 'UPDATE' then
      new.wheelchair_equipment_verified := old.wheelchair_equipment_verified;
      new.admin_review_status := old.admin_review_status;
      new.admin_review_notes := old.admin_review_notes;
    else
      new.wheelchair_equipment_verified := false;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_driver_vehicle_self_update on public.driver_vehicles;
create trigger trg_guard_driver_vehicle_self_update
before insert or update on public.driver_vehicles
for each row execute function public.guard_driver_vehicle_self_update();

-- ---------------------------------------------------------------------------
-- 4) vehicle_category_eligibility
-- ---------------------------------------------------------------------------

create table if not exists public.vehicle_category_eligibility (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.driver_vehicles (id) on delete cascade,
  driver_user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (
    category in ('standard', 'comfort', 'xl', 'wheelchair_accessible')
  ),
  status text not null default 'not_eligible'
    check (status in (
      'eligible', 'not_eligible', 'pending_review', 'suspended',
      'expired_age', 'missing_documents', 'insufficient_seats', 'wheelchair_not_verified'
    )),
  reason_code text,
  reason_message text,
  admin_approved boolean not null default false,
  admin_suspended boolean not null default false,
  computed_at timestamptz not null default now(),
  unique (vehicle_id, category)
);

create index if not exists idx_vehicle_category_eligibility_driver
  on public.vehicle_category_eligibility (driver_user_id, category, status);

alter table public.vehicle_category_eligibility enable row level security;

drop policy if exists vehicle_category_eligibility_select_own on public.vehicle_category_eligibility;
create policy vehicle_category_eligibility_select_own
  on public.vehicle_category_eligibility for select
  using (driver_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5) Helper: normalize taxi category (premium -> comfort)
-- ---------------------------------------------------------------------------

create or replace function public.normalize_taxi_vehicle_category(p_class text)
returns text
language sql
immutable
as $$
  select case lower(trim(coalesce(p_class, 'standard')))
    when 'premium' then 'comfort'
    when 'comfort' then 'comfort'
    when 'xl' then 'xl'
    when 'wheelchair_accessible' then 'wheelchair_accessible'
    when 'wheelchair' then 'wheelchair_accessible'
    else 'standard'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Service preference helpers
-- ---------------------------------------------------------------------------

create or replace function public.driver_has_any_service_enabled(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.driver_service_preferences dsp
    where dsp.driver_user_id = p_user_id
      and (
        dsp.food_delivery_enabled
        or dsp.package_delivery_enabled
        or dsp.taxi_rides_enabled
      )
  );
$$;

create or replace function public.is_driver_service_enabled(p_user_id uuid, p_service text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case lower(trim(coalesce(p_service, '')))
    when 'food' then coalesce((
      select dsp.food_delivery_enabled from public.driver_service_preferences dsp
      where dsp.driver_user_id = p_user_id
    ), false)
    when 'food_delivery' then coalesce((
      select dsp.food_delivery_enabled from public.driver_service_preferences dsp
      where dsp.driver_user_id = p_user_id
    ), false)
    when 'package' then coalesce((
      select dsp.package_delivery_enabled from public.driver_service_preferences dsp
      where dsp.driver_user_id = p_user_id
    ), false)
    when 'package_delivery' then coalesce((
      select dsp.package_delivery_enabled from public.driver_service_preferences dsp
      where dsp.driver_user_id = p_user_id
    ), false)
    when 'taxi' then coalesce((
      select dsp.taxi_rides_enabled from public.driver_service_preferences dsp
      where dsp.driver_user_id = p_user_id
    ), false)
    when 'taxi_rides' then coalesce((
      select dsp.taxi_rides_enabled from public.driver_service_preferences dsp
      where dsp.driver_user_id = p_user_id
    ), false)
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Recalculate vehicle category eligibility
-- ---------------------------------------------------------------------------

create or replace function public.recalculate_vehicle_category_eligibility(p_vehicle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle public.driver_vehicles%rowtype;
  v_driver_rating numeric;
  v_category text;
  v_rule public.vehicle_category_rules%rowtype;
  v_age integer;
  v_status text;
  v_reason_code text;
  v_reason_message text;
  v_vehicle_type text;
begin
  select * into v_vehicle from public.driver_vehicles where id = p_vehicle_id;
  if not found then return; end if;

  select coalesce(dp.rating, 0) into v_driver_rating
  from public.driver_profiles dp
  where dp.user_id = v_vehicle.driver_user_id;

  v_age := extract(year from now())::integer - coalesce(v_vehicle.vehicle_year, 0);
  v_vehicle_type := lower(trim(coalesce(v_vehicle.vehicle_type, '')));

  foreach v_category in array array['standard','comfort','xl','wheelchair_accessible'] loop
    select * into v_rule
    from public.vehicle_category_rules r
    where r.category = v_category and r.is_active = true
    order by r.city nulls last, r.country_code nulls last
    limit 1;

    if not found then
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
      v_reason_message := format('Minimum driver rating %.1f required', v_rule.min_driver_rating);
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

  -- Apply admin overrides
  update public.vehicle_category_eligibility vce
  set status = case
    when vce.admin_suspended then 'suspended'
    when vce.admin_approved and vce.status in ('pending_review', 'eligible') then 'eligible'
    else vce.status
  end
  where vce.vehicle_id = p_vehicle_id;
end;
$$;

create or replace function public.recalculate_driver_primary_vehicle_eligibility(p_driver_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle_id uuid;
begin
  select dv.id into v_vehicle_id
  from public.driver_vehicles dv
  where dv.driver_user_id = p_driver_user_id
    and dv.is_primary = true
    and dv.vehicle_active = true
  order by dv.updated_at desc
  limit 1;

  if v_vehicle_id is not null then
    perform public.recalculate_vehicle_category_eligibility(v_vehicle_id);
  end if;
end;
$$;

drop trigger if exists trg_driver_vehicles_recalc_eligibility on public.driver_vehicles;
create or replace function public.trg_driver_vehicles_recalc_eligibility_fn()
returns trigger language plpgsql as $$
begin
  perform public.recalculate_vehicle_category_eligibility(new.id);
  return new;
end;
$$;
create trigger trg_driver_vehicles_recalc_eligibility
after insert or update on public.driver_vehicles
for each row execute function public.trg_driver_vehicles_recalc_eligibility_fn();

-- ---------------------------------------------------------------------------
-- 8) Taxi dispatch eligibility check
-- ---------------------------------------------------------------------------

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
    from public.driver_vehicles dv
    join public.vehicle_category_eligibility vce
      on vce.vehicle_id = dv.id
    where dv.driver_user_id = p_user_id
      and dv.is_primary = true
      and dv.vehicle_active = true
      and vce.category = public.normalize_taxi_vehicle_category(p_vehicle_class)
      and vce.status = 'eligible'
  );
$$;

-- ---------------------------------------------------------------------------
-- 9) Update is_taxi_driver_eligible
-- ---------------------------------------------------------------------------

drop function if exists public.is_taxi_driver_eligible(uuid, text, boolean);

create or replace function public.is_taxi_driver_eligible(
  p_user_id uuid default auth.uid(),
  p_vehicle_class text default 'standard',
  p_require_premium_driver boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_class text := public.normalize_taxi_vehicle_category(p_vehicle_class);
  v_features public.taxi_driver_features%rowtype;
  v_quality public.taxi_driver_quality_scores%rowtype;
begin
  if p_user_id is null then return false; end if;

  if not public.is_driver_service_enabled(p_user_id, 'taxi') then
    return false;
  end if;

  if not public.is_taxi_account_active(p_user_id) then return false; end if;

  if to_regprocedure('public.is_driver_operational(uuid)') is not null then
    if not public.is_driver_operational(p_user_id) then return false; end if;
  else
    if not exists (
      select 1 from public.driver_profiles dp
      where dp.user_id = p_user_id and lower(coalesce(dp.status, '')) = 'approved'
    ) then return false; end if;
  end if;

  select * into v_features from public.taxi_driver_features tdf where tdf.user_id = p_user_id;
  if not found or coalesce(v_features.taxi_enabled, false) is not true then return false; end if;

  if p_require_premium_driver or v_class = 'comfort' then
    if not public.is_driver_taxi_category_eligible(p_user_id, 'comfort') then
      return false;
    end if;
    select * into v_quality from public.taxi_driver_quality_scores where user_id = p_user_id;
    if p_require_premium_driver then
      if not found or coalesce(v_quality.premium_active, false) is not true then return false; end if;
    end if;
    return true;
  end if;

  return public.is_driver_taxi_category_eligible(p_user_id, v_class);
end;
$$;

revoke all on function public.is_taxi_driver_eligible(uuid, text, boolean) from public;
grant execute on function public.is_taxi_driver_eligible(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 10) Online gate — at least one service enabled
-- ---------------------------------------------------------------------------

create or replace function public.enforce_driver_profile_online_rules()
returns trigger
language plpgsql
as $$
begin
  if coalesce(lower(new.status), '') in ('suspended', 'disabled') then
    new.is_online := false;
  end if;

  if new.is_online is true and coalesce(lower(new.status), '') <> 'approved' then
    raise exception 'driver_not_eligible_for_online'
      using hint = 'Driver must be approved to go online.';
  end if;

  if new.is_online is true and not public.driver_has_any_service_enabled(new.user_id) then
    raise exception 'driver_no_service_enabled'
      using hint = 'Enable at least one service before going online.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11) Backfill preferences + vehicles from existing data
-- ---------------------------------------------------------------------------

insert into public.driver_service_preferences (
  driver_user_id, food_delivery_enabled, package_delivery_enabled, taxi_rides_enabled
)
select
  dp.user_id,
  true,
  true,
  coalesce(tdf.taxi_enabled, false)
from public.driver_profiles dp
left join public.taxi_driver_features tdf on tdf.user_id = dp.user_id
where lower(coalesce(dp.status, '')) = 'approved'
on conflict (driver_user_id) do nothing;

insert into public.driver_vehicles (
  driver_user_id,
  vehicle_make,
  vehicle_model,
  vehicle_year,
  vehicle_color,
  license_plate,
  seats_count,
  vehicle_type,
  has_air_conditioning,
  wheelchair_accessible,
  inspection_status,
  insurance_status,
  registration_status,
  vehicle_active,
  admin_review_status,
  is_primary
)
select
  dp.user_id,
  coalesce(tdf.vehicle_make, dp.vehicle_brand),
  coalesce(tdf.vehicle_model, dp.vehicle_model),
  coalesce(tdf.vehicle_year, dp.vehicle_year),
  coalesce(tdf.vehicle_color, dp.vehicle_color),
  coalesce(tdf.vehicle_plate, dp.plate_number),
  coalesce(tdf.passenger_capacity, 4),
  coalesce(dp.vehicle_type, 'sedan'),
  coalesce(tdf.premium_eligible, false),
  false,
  case when coalesce(dp.vehicle_verified, false) then 'approved' else 'pending' end,
  case when coalesce(dp.vehicle_verified, false) then 'approved' else 'pending' end,
  case when coalesce(dp.vehicle_verified, false) then 'approved' else 'pending' end,
  true,
  case when coalesce(dp.vehicle_verified, false) then 'approved' else 'pending_review' end,
  true
from public.driver_profiles dp
left join public.taxi_driver_features tdf on tdf.user_id = dp.user_id
where dp.user_id is not null
  and (
    dp.vehicle_brand is not null
    or dp.vehicle_model is not null
    or tdf.vehicle_make is not null
    or lower(coalesce(dp.transport_mode, '')) in ('car', 'moto')
  )
  and not exists (
    select 1 from public.driver_vehicles dv where dv.driver_user_id = dp.user_id
  );

-- Sync admin-approved categories from legacy taxi_driver_features
do $$
declare r record;
begin
  for r in select id from public.driver_vehicles loop
    perform public.recalculate_vehicle_category_eligibility(r.id);
  end loop;

  update public.vehicle_category_eligibility vce
  set admin_approved = true, status = 'eligible'
  from public.driver_vehicles dv
  join public.taxi_driver_features tdf on tdf.user_id = dv.driver_user_id
  where vce.vehicle_id = dv.id
    and vce.category = 'standard'
    and coalesce(tdf.taxi_enabled, false) = true;

  update public.vehicle_category_eligibility vce
  set admin_approved = true, status = 'eligible'
  from public.driver_vehicles dv
  join public.taxi_driver_features tdf on tdf.user_id = dv.driver_user_id
  where vce.vehicle_id = dv.id
    and vce.category = 'xl'
    and coalesce(tdf.xl_eligible, false) = true;

  update public.vehicle_category_eligibility vce
  set admin_approved = true, status = 'eligible'
  from public.driver_vehicles dv
  join public.taxi_driver_features tdf on tdf.user_id = dv.driver_user_id
  where vce.vehicle_id = dv.id
    and vce.category = 'comfort'
    and coalesce(tdf.premium_eligible, false) = true;
end $$;

grant execute on function public.recalculate_vehicle_category_eligibility(uuid) to service_role;
grant execute on function public.recalculate_driver_primary_vehicle_eligibility(uuid) to service_role;
grant execute on function public.is_driver_service_enabled(uuid, text) to authenticated;
grant execute on function public.is_driver_taxi_category_eligible(uuid, text) to authenticated;
grant execute on function public.driver_has_any_service_enabled(uuid) to authenticated;
