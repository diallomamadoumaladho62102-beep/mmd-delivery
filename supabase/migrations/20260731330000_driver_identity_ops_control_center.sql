-- Driver identity Control Center: assignment, locks, SLA settings, decision audit.
begin;

alter table public.driver_identity_settings
  add column if not exists sla_warning_minutes integer not null default 30
    check (sla_warning_minutes >= 1),
  add column if not exists sla_critical_minutes integer not null default 120
    check (sla_critical_minutes >= sla_warning_minutes),
  add column if not exists lock_ttl_minutes integer not null default 15
    check (lock_ttl_minutes >= 1 and lock_ttl_minutes <= 120);

alter table public.driver_identity_checks
  add column if not exists assigned_to uuid references auth.users(id) on delete set null,
  add column if not exists assigned_by uuid references auth.users(id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists locked_by uuid references auth.users(id) on delete set null,
  add column if not exists locked_at timestamptz,
  add column if not exists lock_expires_at timestamptz,
  add column if not exists review_started_at timestamptz,
  add column if not exists decision_change_count integer not null default 0;

create index if not exists idx_driver_identity_checks_assigned_to
  on public.driver_identity_checks (assigned_to, status, created_at desc);

create index if not exists idx_driver_identity_checks_locked_by
  on public.driver_identity_checks (locked_by, lock_expires_at);

create table if not exists public.driver_identity_decisions (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.driver_identity_checks(id) on delete cascade,
  driver_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('approve', 'reject', 'request_new_photo', 'suspend')),
  previous_status text,
  new_status text not null,
  review_started_at timestamptz,
  processing_duration_ms integer check (processing_duration_ms is null or processing_duration_ms >= 0),
  decision_change_index integer not null default 1 check (decision_change_index >= 1),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_driver_identity_decisions_check
  on public.driver_identity_decisions (check_id, created_at desc);

create index if not exists idx_driver_identity_decisions_actor_day
  on public.driver_identity_decisions (actor_user_id, created_at desc);

alter table public.driver_identity_decisions enable row level security;

drop policy if exists driver_identity_decisions_staff_select on public.driver_identity_decisions;
create policy driver_identity_decisions_staff_select on public.driver_identity_decisions
  for select to authenticated
  using (public.is_staff_user());

commit;
