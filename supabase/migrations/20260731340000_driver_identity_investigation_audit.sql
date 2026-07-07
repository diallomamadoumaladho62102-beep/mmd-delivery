-- Driver identity investigation: view/export audit trail.
begin;

create table if not exists public.driver_identity_view_audit (
  id uuid primary key default gen_random_uuid(),
  check_id uuid references public.driver_identity_checks(id) on delete set null,
  driver_id uuid not null references auth.users(id) on delete cascade,
  staff_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  section text,
  ip_address text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_driver_identity_view_audit_check
  on public.driver_identity_view_audit (check_id, created_at desc);

create index if not exists idx_driver_identity_view_audit_driver
  on public.driver_identity_view_audit (driver_id, created_at desc);

alter table public.driver_identity_view_audit enable row level security;

drop policy if exists driver_identity_view_audit_staff_select on public.driver_identity_view_audit;
create policy driver_identity_view_audit_staff_select on public.driver_identity_view_audit
  for select to authenticated
  using (public.is_staff_user());

commit;
