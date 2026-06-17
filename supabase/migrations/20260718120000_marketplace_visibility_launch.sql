-- Marketplace visibility launch: seller open/closed + driver job pool (no live checkout/payout)

begin;

-- ---------------------------------------------------------------------------
-- 1) Seller shop open/closed (mirrors restaurant is_accepting_orders)
-- ---------------------------------------------------------------------------

alter table public.sellers
  add column if not exists is_accepting_orders boolean not null default false;

create index if not exists sellers_accepting_country_idx
  on public.sellers (status, is_accepting_orders, country_code);

comment on column public.sellers.is_accepting_orders is
  'When true and status=approved, shop appears open to clients in marketplace browse.';

-- ---------------------------------------------------------------------------
-- 2) Driver can read unassigned ready jobs in their pool (visibility only)
--    Assignment still goes through authenticated API routes.
-- ---------------------------------------------------------------------------

drop policy if exists marketplace_delivery_jobs_driver_select on public.marketplace_delivery_jobs;

create policy marketplace_delivery_jobs_driver_select
  on public.marketplace_delivery_jobs
  for select
  to authenticated
  using (
    (
      assigned_driver_id = auth.uid()
      and status in ('dispatch_assigned', 'picked_up', 'delivered')
    )
    or (
      status = 'dispatch_ready'
      and assigned_driver_id is null
      and exists (
        select 1
        from public.driver_profiles dp
        where dp.user_id = auth.uid()
          and dp.status = 'approved'
      )
    )
    or public.is_staff_user(auth.uid())
  );

commit;
