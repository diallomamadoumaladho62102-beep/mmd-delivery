-- Marketplace payout preparation (seller + driver ledgers — OFF by default, no live Stripe)

begin;

create table if not exists public.marketplace_seller_payouts (
  id uuid primary key default gen_random_uuid(),
  seller_order_id uuid not null
    references public.seller_orders (id) on delete cascade,
  seller_id uuid not null
    references public.sellers (id) on delete cascade,
  gross_amount_cents integer not null default 0
    check (gross_amount_cents >= 0),
  platform_fee_cents integer not null default 0
    check (platform_fee_cents >= 0),
  seller_net_amount_cents integer not null default 0
    check (seller_net_amount_cents >= 0),
  currency text not null default 'USD',
  status text not null default 'pending'
    check (
      status in ('pending', 'approved', 'paid', 'failed', 'cancelled')
    ),
  stripe_transfer_id text,
  payout_live_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_seller_payouts_seller_order_id_key unique (seller_order_id)
);

create index if not exists marketplace_seller_payouts_status_idx
  on public.marketplace_seller_payouts (status, updated_at desc);

create index if not exists marketplace_seller_payouts_seller_idx
  on public.marketplace_seller_payouts (seller_id, updated_at desc);

create table if not exists public.marketplace_driver_payouts (
  id uuid primary key default gen_random_uuid(),
  marketplace_delivery_job_id uuid not null
    references public.marketplace_delivery_jobs (id) on delete cascade,
  seller_order_id uuid not null
    references public.seller_orders (id) on delete cascade,
  driver_id uuid not null
    references auth.users (id) on delete cascade,
  driver_earning_cents integer not null default 0
    check (driver_earning_cents >= 0),
  bonus_cents integer not null default 0
    check (bonus_cents >= 0),
  total_driver_payout_cents integer not null default 0
    check (total_driver_payout_cents >= 0),
  currency text not null default 'USD',
  status text not null default 'pending'
    check (
      status in ('pending', 'approved', 'paid', 'failed', 'cancelled')
    ),
  stripe_transfer_id text,
  payout_live_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_driver_payouts_job_id_key unique (marketplace_delivery_job_id)
);

create index if not exists marketplace_driver_payouts_status_idx
  on public.marketplace_driver_payouts (status, updated_at desc);

create index if not exists marketplace_driver_payouts_driver_idx
  on public.marketplace_driver_payouts (driver_id, updated_at desc);

alter table public.marketplace_seller_payouts enable row level security;
alter table public.marketplace_driver_payouts enable row level security;

create policy marketplace_seller_payouts_staff_select
  on public.marketplace_seller_payouts
  for select
  using (public.is_staff_user(auth.uid()));

create policy marketplace_seller_payouts_seller_select
  on public.marketplace_seller_payouts
  for select
  using (
    public.user_owns_seller(seller_id, auth.uid())
    or public.is_staff_user(auth.uid())
  );

create policy marketplace_driver_payouts_staff_select
  on public.marketplace_driver_payouts
  for select
  using (public.is_staff_user(auth.uid()));

create policy marketplace_driver_payouts_driver_select
  on public.marketplace_driver_payouts
  for select
  using (
    driver_id = auth.uid()
    or public.is_staff_user(auth.uid())
  );

grant select on public.marketplace_seller_payouts to authenticated;
grant select on public.marketplace_driver_payouts to authenticated;
grant all on public.marketplace_seller_payouts to service_role;
grant all on public.marketplace_driver_payouts to service_role;

commit;
