-- Dispatch hardening: order wave retries (cron), DR wave-1 idempotency.

begin;

create table if not exists public.order_dispatch_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  wave integer not null default 1,
  max_drivers integer,
  max_miles numeric(8, 2),
  notified_count integer not null default 0,
  status text not null,
  created_at timestamptz not null default now()
);

create index if not exists order_dispatch_attempts_order_id_idx
  on public.order_dispatch_attempts (order_id, created_at desc);

create table if not exists public.order_dispatch_wave_schedule (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  next_wave integer not null,
  run_at timestamptz not null,
  location_fresh_minutes integer not null default 20,
  cooldown_seconds integer not null default 60,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists order_dispatch_wave_schedule_pending_idx
  on public.order_dispatch_wave_schedule (status, run_at)
  where status = 'pending';

alter table public.delivery_requests
  add column if not exists dispatch_wave_1_started_at timestamptz;

commit;
