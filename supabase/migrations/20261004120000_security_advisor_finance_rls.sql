-- Close Supabase Security Advisor CRITICAL / ERROR findings:
-- 1) rls_disabled_in_public on public.finance_account_categories
-- 2) security_definer_view on analytics daily views
--
-- Root cause (1): 20260905120000_mmd_finance_center.sql enabled RLS on every
-- finance_* table except finance_account_categories (omission).
-- Production verified: anon + authenticated had SELECT/INSERT/UPDATE/DELETE
-- while relrowsecurity=false — real public CRUD exposure of the chart-of-accounts
-- category lookup (reference data; no PII, but writable by anyone with the anon key).
--
-- Root cause (2): analytics views created without security_invoker, so Postgres
-- defaults to SECURITY DEFINER semantics for the view owner.

begin;

-- ---------------------------------------------------------------------------
-- 1) finance_account_categories — enable RLS + least privilege
-- ---------------------------------------------------------------------------
alter table public.finance_account_categories enable row level security;

-- Defense in depth: remove default public grants for anon.
revoke all on table public.finance_account_categories from anon;
revoke all on table public.finance_account_categories from public;

-- Staff may read the reference chart categories; mutations stay service_role.
drop policy if exists finance_account_categories_staff_select
  on public.finance_account_categories;
create policy finance_account_categories_staff_select
  on public.finance_account_categories
  for select
  to authenticated
  using (public.is_staff_user(auth.uid()));

drop policy if exists finance_account_categories_staff_write
  on public.finance_account_categories;
create policy finance_account_categories_staff_write
  on public.finance_account_categories
  for all
  to authenticated
  using (public.is_staff_user(auth.uid()))
  with check (public.is_staff_user(auth.uid()));

grant select on table public.finance_account_categories to authenticated;
grant all on table public.finance_account_categories to service_role;

-- ---------------------------------------------------------------------------
-- 2) Analytics views — force SECURITY INVOKER (Postgres 15+)
-- ---------------------------------------------------------------------------
create or replace view public.v_analytics_taxi_paid_daily
with (security_invoker = true)
as
select
  (coalesce(r.paid_at, r.created_at))::date as metric_date,
  upper(coalesce(nullif(trim(r.country_code), ''), '')) as country_code,
  coalesce(nullif(trim(r.pickup_city), ''), '') as city,
  count(*)::integer as rides_count,
  coalesce(sum(r.total_cents), 0)::bigint as revenue_cents,
  coalesce(sum(r.distance_miles), 0)::numeric as distance_miles,
  coalesce(avg(r.duration_minutes), 0)::numeric as avg_duration_min,
  count(*) filter (where lower(coalesce(r.status, '')) like '%cancel%')::integer as canceled_count
from public.taxi_rides r
group by 1, 2, 3;

create or replace view public.v_analytics_marketplace_paid_daily
with (security_invoker = true)
as
select
  (coalesce(s.paid_at, s.created_at))::date as metric_date,
  upper(coalesce(nullif(trim(s.country_code), ''), '')) as country_code,
  count(*)::integer as orders_count,
  coalesce(sum(s.total_cents), 0)::bigint as gmv_cents,
  count(distinct s.seller_id)::integer as sellers_count
from public.seller_orders s
group by 1, 2;

-- Views are consolidation helpers for service_role analytics refresh paths.
revoke all on public.v_analytics_taxi_paid_daily from anon, authenticated, public;
revoke all on public.v_analytics_marketplace_paid_daily from anon, authenticated, public;
grant select on public.v_analytics_taxi_paid_daily to service_role;
grant select on public.v_analytics_marketplace_paid_daily to service_role;

notify pgrst, 'reload schema';

commit;
