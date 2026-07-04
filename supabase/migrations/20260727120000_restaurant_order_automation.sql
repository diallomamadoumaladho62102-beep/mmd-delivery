-- Restaurant order automation: auto-accept, prep time, print jobs.
begin;

alter table public.restaurant_profiles
  add column if not exists auto_accept_orders_enabled boolean not null default false,
  add column if not exists auto_accept_only_during_hours boolean not null default true,
  add column if not exists default_prep_minutes integer not null default 20
    check (default_prep_minutes between 1 and 180),
  add column if not exists auto_pause_when_closed boolean not null default true,
  add column if not exists auto_pause_when_busy boolean not null default false,
  add column if not exists busy_order_threshold integer not null default 12
    check (busy_order_threshold between 1 and 200),
  add column if not exists auto_print_enabled boolean not null default false,
  add column if not exists print_kitchen_ticket boolean not null default true,
  add column if not exists print_customer_ticket boolean not null default true,
  add column if not exists print_driver_ticket boolean not null default true,
  add column if not exists print_copies integer not null default 1
    check (print_copies between 1 and 5),
  add column if not exists print_paper_width text not null default '80mm'
    check (print_paper_width in ('58mm', '80mm')),
  add column if not exists print_show_qr_code boolean not null default true,
  add column if not exists print_special_instructions boolean not null default true;

alter table public.orders
  add column if not exists estimated_prep_minutes integer,
  add column if not exists prep_ready_at timestamptz,
  add column if not exists auto_accepted boolean not null default false;

create table if not exists public.restaurant_print_jobs (
  id uuid primary key default gen_random_uuid(),
  restaurant_user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  job_type text not null
    check (job_type in ('kitchen', 'customer', 'driver', 'test')),
  status text not null default 'pending'
    check (status in ('pending', 'printing', 'printed', 'failed', 'canceled')),
  copies integer not null default 1 check (copies between 1 and 5),
  paper_width text not null default '80mm' check (paper_width in ('58mm', '80mm')),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  source text not null default 'auto'
    check (source in ('auto', 'manual', 'reprint', 'test')),
  created_at timestamptz not null default now(),
  printed_at timestamptz
);

create index if not exists idx_restaurant_print_jobs_restaurant_status
  on public.restaurant_print_jobs (restaurant_user_id, status, created_at desc);

create index if not exists idx_restaurant_print_jobs_order
  on public.restaurant_print_jobs (order_id, created_at desc);

alter table public.restaurant_print_jobs enable row level security;

drop policy if exists restaurant_print_jobs_select_own on public.restaurant_print_jobs;
create policy restaurant_print_jobs_select_own on public.restaurant_print_jobs
  for select to authenticated
  using (restaurant_user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists restaurant_print_jobs_update_own on public.restaurant_print_jobs;
create policy restaurant_print_jobs_update_own on public.restaurant_print_jobs
  for update to authenticated
  using (restaurant_user_id = auth.uid())
  with check (restaurant_user_id = auth.uid());

comment on column public.restaurant_profiles.auto_accept_orders_enabled is
  'When true, paid food orders are accepted automatically if all safety checks pass.';
comment on column public.restaurant_profiles.auto_print_enabled is
  'When true, tickets are queued for printing after order acceptance.';

commit;
