-- Production hardening: RLS, country/city rules, notifications audit, year refresh, performance indexes

-- ---------------------------------------------------------------------------
-- 1) Notification audit log
-- ---------------------------------------------------------------------------

create table if not exists public.driver_vehicle_notification_events (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  category text,
  document_type text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_driver_vehicle_notification_events_driver
  on public.driver_vehicle_notification_events (driver_user_id, created_at desc);

alter table public.driver_vehicle_notification_events enable row level security;

drop policy if exists driver_vehicle_notification_events_select_own on public.driver_vehicle_notification_events;
create policy driver_vehicle_notification_events_select_own
  on public.driver_vehicle_notification_events for select
  using (driver_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2) Harden driver vehicle self-update (block document/admin fields)
-- ---------------------------------------------------------------------------

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
      new.inspection_status := old.inspection_status;
      new.insurance_status := old.insurance_status;
      new.registration_status := old.registration_status;
      new.vehicle_active := old.vehicle_active;
    else
      new.wheelchair_equipment_verified := false;
      new.inspection_status := coalesce(new.inspection_status, 'pending');
      new.insurance_status := coalesce(new.insurance_status, 'pending');
      new.registration_status := coalesce(new.registration_status, 'pending');
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Drivers cannot write eligibility rows (read-only via RLS; service role bypasses)
revoke insert, update, delete on public.vehicle_category_eligibility from authenticated;
revoke insert, update, delete on public.vehicle_category_rules from authenticated;

-- Composite indexes for dispatch filtering at scale
create index if not exists idx_driver_service_preferences_food
  on public.driver_service_preferences (driver_user_id)
  where food_delivery_enabled = true;

create index if not exists idx_driver_service_preferences_package
  on public.driver_service_preferences (driver_user_id)
  where package_delivery_enabled = true;

create index if not exists idx_driver_service_preferences_taxi
  on public.driver_service_preferences (driver_user_id)
  where taxi_rides_enabled = true;

create index if not exists idx_vehicle_category_eligibility_eligible
  on public.vehicle_category_eligibility (driver_user_id, category)
  where status = 'eligible';

-- ---------------------------------------------------------------------------
-- 3) Resolve vehicle category rule (country + city aware)
-- ---------------------------------------------------------------------------

drop function if exists public.resolve_vehicle_category_rule(text, text, text);

create or replace function public.resolve_vehicle_category_rule(
  p_category text,
  p_country_code text default null,
  p_city text default null
)
returns public.vehicle_category_rules
language sql
stable
as $$
  select r.*
  from public.vehicle_category_rules r
  where r.category = lower(trim(p_category))
    and r.is_active = true
    and (
      (r.country_code is not distinct from upper(nullif(trim(p_country_code), ''))
       and r.city is not distinct from nullif(trim(p_city), ''))
      or (r.country_code is not distinct from upper(nullif(trim(p_country_code), ''))
          and r.city is null
          and nullif(trim(p_city), '') is not null)
      or (r.country_code is null and r.city is null)
    )
  order by
    case when r.city is not null and r.country_code is not null then 0
         when r.country_code is not null and r.city is null then 1
         else 2 end
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 4) Recalculate with country/city rules + return transition snapshot
-- ---------------------------------------------------------------------------

drop function if exists public.recalculate_vehicle_category_eligibility(uuid);

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

    v_after := v_after || jsonb_build_array(jsonb_build_object(
      'category', v_category,
      'status', v_status,
      'reason_message', v_reason_message
    ));
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

-- ---------------------------------------------------------------------------
-- 5) Bulk refresh (year rollover / daily cron)
-- ---------------------------------------------------------------------------

create or replace function public.refresh_all_vehicle_category_eligibility()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle_id uuid;
  v_count integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  for v_vehicle_id in
    select id from public.driver_vehicles where vehicle_active = true
  loop
    v_result := public.recalculate_vehicle_category_eligibility(v_vehicle_id);
    v_count := v_count + 1;
    v_results := v_results || jsonb_build_array(v_result);
  end loop;

  return jsonb_build_object('ok', true, 'processed', v_count, 'results', v_results);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Fast taxi category availability counts
-- ---------------------------------------------------------------------------

create or replace function public.count_taxi_eligible_drivers_by_category(p_vehicle_class text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct dv.driver_user_id)::integer
  from public.driver_vehicles dv
  join public.vehicle_category_eligibility vce on vce.vehicle_id = dv.id
  join public.driver_service_preferences dsp on dsp.driver_user_id = dv.driver_user_id
  join public.driver_profiles dp on dp.user_id = dv.driver_user_id
  join public.taxi_driver_features tdf on tdf.user_id = dv.driver_user_id
  where dv.is_primary = true
    and dv.vehicle_active = true
    and dp.is_online = true
    and lower(coalesce(dp.status, '')) = 'approved'
    and dsp.taxi_rides_enabled = true
    and tdf.taxi_enabled = true
    and vce.category = public.normalize_taxi_vehicle_category(p_vehicle_class)
    and vce.status = 'eligible';
$$;

grant execute on function public.refresh_all_vehicle_category_eligibility() to service_role;
grant execute on function public.count_taxi_eligible_drivers_by_category(text) to authenticated;
grant execute on function public.resolve_vehicle_category_rule(text, text, text) to authenticated;
