-- Align leftover RLS policies with canonical profiles.role values.
-- After admin→super_admin migration, policies that only checked role='admin'
-- or short staff arrays (ops/finance/…) would deny legitimate staff.

begin;

-- Super-admin gated tables (founder / super_admin / legacy admin).
drop policy if exists orders_admin_select_all on public.orders;
create policy orders_admin_select_all
  on public.orders
  for select
  to authenticated
  using (public.is_super_admin_user());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin
  on public.profiles
  for update
  to authenticated
  using (public.is_super_admin_user())
  with check (public.is_super_admin_user());

drop policy if exists restaurant_profiles_select_admin on public.restaurant_profiles;
create policy restaurant_profiles_select_admin
  on public.restaurant_profiles
  for select
  to authenticated
  using (public.is_super_admin_user());

drop policy if exists restaurant_documents_select_admin on public.restaurant_documents;
create policy restaurant_documents_select_admin
  on public.restaurant_documents
  for select
  using (public.is_super_admin_user());

drop policy if exists restaurant_documents_update_admin on public.restaurant_documents;
create policy restaurant_documents_update_admin
  on public.restaurant_documents
  for update
  using (public.is_super_admin_user())
  with check (public.is_super_admin_user());

drop policy if exists admin_audit_logs_admin_select on public.admin_audit_logs;
create policy admin_audit_logs_admin_select
  on public.admin_audit_logs
  for select
  to authenticated
  using (public.is_super_admin_user());

drop policy if exists admin_audit_logs_admin_insert on public.admin_audit_logs;
create policy admin_audit_logs_admin_insert
  on public.admin_audit_logs
  for insert
  to authenticated
  with check (public.is_super_admin_user());

drop policy if exists pricing_business_defaults_admin_all on public.pricing_business_defaults;
create policy pricing_business_defaults_admin_all
  on public.pricing_business_defaults
  for all
  to authenticated
  using (public.is_super_admin_user())
  with check (public.is_super_admin_user());

drop policy if exists pricing_shadow_compare_logs_admin_read on public.pricing_shadow_compare_logs;
create policy pricing_shadow_compare_logs_admin_read
  on public.pricing_shadow_compare_logs
  for select
  to authenticated
  using (public.is_super_admin_user());

drop policy if exists pricing_quote_snapshots_admin_read on public.pricing_quote_snapshots;
create policy pricing_quote_snapshots_admin_read
  on public.pricing_quote_snapshots
  for select
  to authenticated
  using (public.is_super_admin_user());

-- Staff-gated taxi surfaces: use is_staff_user() (canonical + legacy).
drop policy if exists taxi_shared_rides_select_participant on public.taxi_shared_rides;
create policy taxi_shared_rides_select_participant
  on public.taxi_shared_rides
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.taxi_shared_ride_passengers p
      where p.shared_ride_id = taxi_shared_rides.id
        and p.client_user_id = auth.uid()
    )
    or public.is_staff_user()
    or driver_id = auth.uid()
  );

drop policy if exists taxi_shared_passengers_select_own on public.taxi_shared_ride_passengers;
create policy taxi_shared_passengers_select_own
  on public.taxi_shared_ride_passengers
  for select
  to authenticated
  using (
    client_user_id = auth.uid()
    or exists (
      select 1
      from public.taxi_shared_rides sr
      where sr.id = taxi_shared_ride_passengers.shared_ride_id
        and sr.driver_id = auth.uid()
    )
    or public.is_staff_user()
  );

drop policy if exists taxi_business_accounts_select_member on public.taxi_business_accounts;
create policy taxi_business_accounts_select_member
  on public.taxi_business_accounts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.taxi_business_members m
      where m.business_account_id = taxi_business_accounts.id
        and m.user_id = auth.uid()
        and m.active = true
    )
    or public.is_staff_user()
  );

drop policy if exists taxi_business_billing_select_member on public.taxi_business_billing_events;
create policy taxi_business_billing_select_member
  on public.taxi_business_billing_events
  for select
  to authenticated
  using (
    member_user_id = auth.uid()
    or public.is_taxi_business_member(
      auth.uid(),
      business_account_id,
      array['manager'::text, 'admin'::text]
    )
    or public.is_staff_user()
  );

drop policy if exists taxi_driver_quality_select_own_or_staff on public.taxi_driver_quality_scores;
create policy taxi_driver_quality_select_own_or_staff
  on public.taxi_driver_quality_scores
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff_user());

drop policy if exists taxi_driver_quality_events_select_own on public.taxi_driver_quality_events;
create policy taxi_driver_quality_events_select_own
  on public.taxi_driver_quality_events
  for select
  to authenticated
  using (driver_user_id = auth.uid() or public.is_staff_user());

notify pgrst, 'reload schema';

commit;
