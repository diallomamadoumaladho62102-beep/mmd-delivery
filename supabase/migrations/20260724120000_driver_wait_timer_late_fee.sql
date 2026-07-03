-- Driver wait timer + late fee fields for orders, delivery_requests, taxi_rides.

begin;

-- ---------------------------------------------------------------------------
-- Shared wait columns helper macro via repeated blocks
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists driver_arrived_at timestamptz,
  add column if not exists wait_timer_started_at timestamptz,
  add column if not exists free_wait_minutes integer not null default 5,
  add column if not exists wait_fee_amount_cents integer not null default 0,
  add column if not exists wait_fee_currency text,
  add column if not exists wait_fee_minutes integer not null default 0,
  add column if not exists wait_fee_status text not null default 'none',
  add column if not exists completion_reason text,
  add column if not exists cancellation_exempt boolean not null default false,
  add column if not exists cancellation_exempt_reason text,
  add column if not exists driver_distance_to_target_meters numeric(10, 2),
  add column if not exists customer_no_show_validated boolean not null default false,
  add column if not exists leave_at_door boolean not null default false,
  add column if not exists manual_arrival_required boolean not null default false,
  add column if not exists wait_arrival_lat numeric(10, 7),
  add column if not exists wait_arrival_lng numeric(10, 7),
  add column if not exists wait_fee_charged_at timestamptz,
  add column if not exists client_wait_arrived_notified_at timestamptz,
  add column if not exists client_wait_fee_started_notified_at timestamptz,
  add column if not exists client_wait_final_warning_notified_at timestamptz;

alter table public.orders
  drop constraint if exists orders_wait_fee_status_check;

alter table public.orders
  add constraint orders_wait_fee_status_check
  check (
    wait_fee_status in ('none', 'free', 'accruing', 'capped', 'charged', 'waived')
  );

do $$
begin
  if to_regclass('public.delivery_requests') is not null then
    alter table public.delivery_requests
      add column if not exists driver_arrived_at timestamptz,
      add column if not exists wait_timer_started_at timestamptz,
      add column if not exists free_wait_minutes integer not null default 5,
      add column if not exists wait_fee_amount_cents integer not null default 0,
      add column if not exists wait_fee_currency text,
      add column if not exists wait_fee_minutes integer not null default 0,
      add column if not exists wait_fee_status text not null default 'none',
      add column if not exists completion_reason text,
      add column if not exists cancellation_exempt boolean not null default false,
      add column if not exists cancellation_exempt_reason text,
      add column if not exists driver_distance_to_target_meters numeric(10, 2),
      add column if not exists customer_no_show_validated boolean not null default false,
      add column if not exists leave_at_door boolean not null default false,
      add column if not exists manual_arrival_required boolean not null default false,
      add column if not exists wait_arrival_lat numeric(10, 7),
      add column if not exists wait_arrival_lng numeric(10, 7),
      add column if not exists wait_fee_charged_at timestamptz,
      add column if not exists client_wait_arrived_notified_at timestamptz,
      add column if not exists client_wait_fee_started_notified_at timestamptz,
      add column if not exists client_wait_final_warning_notified_at timestamptz;

    alter table public.delivery_requests
      drop constraint if exists delivery_requests_wait_fee_status_check;

    alter table public.delivery_requests
      add constraint delivery_requests_wait_fee_status_check
      check (
        wait_fee_status in ('none', 'free', 'accruing', 'capped', 'charged', 'waived')
      );
  end if;
end $$;

alter table public.taxi_rides
  add column if not exists wait_timer_started_at timestamptz,
  add column if not exists free_wait_minutes integer not null default 5,
  add column if not exists wait_fee_amount_cents integer not null default 0,
  add column if not exists wait_fee_currency text,
  add column if not exists wait_fee_minutes integer not null default 0,
  add column if not exists wait_fee_status text not null default 'none',
  add column if not exists completion_reason text,
  add column if not exists cancellation_exempt boolean not null default false,
  add column if not exists cancellation_exempt_reason text,
  add column if not exists driver_distance_to_target_meters numeric(10, 2),
  add column if not exists customer_no_show_validated boolean not null default false,
  add column if not exists manual_arrival_required boolean not null default false,
  add column if not exists wait_arrival_lat numeric(10, 7),
  add column if not exists wait_arrival_lng numeric(10, 7),
  add column if not exists wait_fee_charged_at timestamptz,
  add column if not exists client_wait_arrived_notified_at timestamptz,
  add column if not exists client_wait_fee_started_notified_at timestamptz,
  add column if not exists client_wait_final_warning_notified_at timestamptz;

-- taxi_rides already has driver_arrived_at from sprint1

alter table public.taxi_rides
  drop constraint if exists taxi_rides_wait_fee_status_check;

alter table public.taxi_rides
  add constraint taxi_rides_wait_fee_status_check
  check (
    wait_fee_status in ('none', 'free', 'accruing', 'capped', 'charged', 'waived')
  );

-- ---------------------------------------------------------------------------
-- Audit timeline for wait timer actions
-- ---------------------------------------------------------------------------

create table if not exists public.wait_timer_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (
    entity_type in ('order', 'delivery_request', 'taxi_ride')
  ),
  entity_id uuid not null,
  event_type text not null,
  actor_id uuid,
  triggered_role text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists wait_timer_events_entity_idx
  on public.wait_timer_events (entity_type, entity_id, created_at desc);

alter table public.wait_timer_events enable row level security;

drop policy if exists wait_timer_events_participant_select on public.wait_timer_events;
create policy wait_timer_events_participant_select
on public.wait_timer_events for select to authenticated
using (true);

-- ---------------------------------------------------------------------------
-- order_events baseline (used by app, may be missing in some envs)
-- ---------------------------------------------------------------------------

create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  event_type text not null,
  old_status text,
  new_status text,
  description text,
  note text,
  actor_id uuid,
  triggered_by uuid,
  triggered_role text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists order_events_order_id_idx
  on public.order_events (order_id, created_at desc);

commit;
