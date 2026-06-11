-- Marketplace live dispatch preparation (jobs table — OFF by default, no core dispatch)

begin;

create table if not exists public.marketplace_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  seller_order_id uuid not null
    references public.seller_orders (id) on delete cascade,
  seller_id uuid not null
    references public.sellers (id) on delete cascade,
  client_id uuid
    references auth.users (id) on delete set null,
  pickup_location_id uuid
    references public.location_points (id) on delete set null,
  dropoff_location_id uuid
    references public.location_points (id) on delete set null,
  pickup_address text,
  dropoff_address text,
  status text not null default 'dispatch_pending'
    check (
      status in (
        'dispatch_pending',
        'dispatch_ready',
        'dispatch_assigned',
        'picked_up',
        'delivered',
        'cancelled'
      )
    ),
  assigned_driver_id uuid
    references auth.users (id) on delete set null,
  estimated_distance_miles numeric,
  estimated_minutes numeric,
  driver_earning_cents integer not null default 0
    check (driver_earning_cents >= 0),
  platform_margin_cents integer not null default 0,
  live_dispatch_enabled boolean not null default false,
  drivers_notified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_delivery_jobs_seller_order_id_key unique (seller_order_id)
);

create index if not exists marketplace_delivery_jobs_status_idx
  on public.marketplace_delivery_jobs (status, updated_at desc);

create index if not exists marketplace_delivery_jobs_seller_idx
  on public.marketplace_delivery_jobs (seller_id, updated_at desc);

alter table public.marketplace_delivery_jobs enable row level security;

create policy marketplace_delivery_jobs_staff_select
  on public.marketplace_delivery_jobs
  for select
  using (public.is_staff_user(auth.uid()));

create policy marketplace_delivery_jobs_client_select
  on public.marketplace_delivery_jobs
  for select
  using (client_id = auth.uid());

create policy marketplace_delivery_jobs_seller_select
  on public.marketplace_delivery_jobs
  for select
  using (
    public.user_owns_seller(seller_id, auth.uid())
    or public.is_staff_user(auth.uid())
  );

create policy marketplace_delivery_jobs_driver_select
  on public.marketplace_delivery_jobs
  for select
  using (
    assigned_driver_id = auth.uid()
    and live_dispatch_enabled = true
  );

grant select on public.marketplace_delivery_jobs to authenticated;
grant all on public.marketplace_delivery_jobs to service_role;

commit;
