-- Phase 9 performance: batch taxi category counts, admin email batch lookup,
-- and hot-path indexes for marketplace / seller / taxi eligibility.

begin;

-- ---------------------------------------------------------------------------
-- 1) Batch taxi eligible driver counts (eliminates N RPCs on quote screen)
-- ---------------------------------------------------------------------------

create or replace function public.count_taxi_eligible_drivers_all_categories()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(category, cnt),
    '{}'::jsonb
  )
  from (
    select
      vce.category::text as category,
      count(distinct dv.driver_user_id)::integer as cnt
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
      and vce.status = 'eligible'
    group by vce.category
  ) s;
$$;

revoke all on function public.count_taxi_eligible_drivers_all_categories() from public;
grant execute on function public.count_taxi_eligible_drivers_all_categories() to authenticated;
grant execute on function public.count_taxi_eligible_drivers_all_categories() to service_role;

comment on function public.count_taxi_eligible_drivers_all_categories() is
  'Phase 9: single-roundtrip taxi category availability counts. No money movement.';

-- ---------------------------------------------------------------------------
-- 2) Batch auth email lookup for admin client lists (security definer, staff-gated)
-- ---------------------------------------------------------------------------

create or replace function public.admin_lookup_user_emails(p_ids uuid[])
returns table(id uuid, email text)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null or not public.is_staff_user(auth.uid()) then
      raise exception 'forbidden';
    end if;
  end if;

  return query
  select u.id, u.email::text
  from auth.users u
  where u.id = any(p_ids);
end;
$$;

revoke all on function public.admin_lookup_user_emails(uuid[]) from public;
grant execute on function public.admin_lookup_user_emails(uuid[]) to authenticated;
grant execute on function public.admin_lookup_user_emails(uuid[]) to service_role;

comment on function public.admin_lookup_user_emails(uuid[]) is
  'Phase 9: staff-only batch email lookup for admin client list. No secrets returned beyond email.';

-- ---------------------------------------------------------------------------
-- 3) Hot-path indexes
-- ---------------------------------------------------------------------------

create index if not exists seller_orders_seller_status_created_idx
  on public.seller_orders (seller_id, status, created_at desc);

create index if not exists seller_orders_client_created_idx
  on public.seller_orders (client_user_id, created_at desc);

create index if not exists seller_products_seller_active_category_idx
  on public.seller_products (seller_id, active, category);

create index if not exists vehicle_category_eligibility_status_category_idx
  on public.vehicle_category_eligibility (status, category, vehicle_id);

create index if not exists driver_profiles_online_approved_idx
  on public.driver_profiles (is_online, status)
  where is_online = true;

create index if not exists profiles_role_created_idx
  on public.profiles (role, created_at desc);

commit;
