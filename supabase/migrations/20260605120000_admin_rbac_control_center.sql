-- Admin Control Center: staff RBAC helpers, RLS read policies, pricing history, audit columns.

begin;

-- ---------------------------------------------------------------------------
-- 1) Staff / super-admin helpers (security definer)
-- ---------------------------------------------------------------------------

create or replace function public.is_staff_user(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and lower(trim(coalesce(p.role::text, ''))) in (
        'admin', 'ops', 'finance', 'support', 'review'
      )
  );
$$;

create or replace function public.is_super_admin_user(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and lower(trim(coalesce(p.role::text, ''))) = 'admin'
  );
$$;

-- Keep is_admin_user aligned with super admin (founder)
create or replace function public.is_admin_user(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin_user(p_user_id);
$$;

-- ---------------------------------------------------------------------------
-- 2) admin_audit_logs (create if missing) + audit columns
-- ---------------------------------------------------------------------------

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_audit_logs
  add column if not exists ip_address text;

alter table public.admin_audit_logs
  add column if not exists old_values jsonb;

alter table public.admin_audit_logs
  add column if not exists new_values jsonb;

alter table public.admin_audit_logs enable row level security;

drop policy if exists admin_audit_logs_select_staff on public.admin_audit_logs;
create policy admin_audit_logs_select_staff
  on public.admin_audit_logs
  for select
  to authenticated
  using (public.is_staff_user(auth.uid()));

-- Inserts only via service_role (API routes)

-- ---------------------------------------------------------------------------
-- 3) pricing_config_history
-- ---------------------------------------------------------------------------

create table if not exists public.pricing_config_history (
  id uuid primary key default gen_random_uuid(),
  pricing_config_id uuid not null references public.pricing_config (id) on delete cascade,
  changed_by uuid references public.profiles (id) on delete set null,
  old_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);

create index if not exists pricing_config_history_config_id_idx
  on public.pricing_config_history (pricing_config_id, created_at desc);

alter table public.pricing_config_history enable row level security;

drop policy if exists pricing_config_history_select_staff on public.pricing_config_history;
create policy pricing_config_history_select_staff
  on public.pricing_config_history
  for select
  to authenticated
  using (public.is_super_admin_user(auth.uid()));

-- ---------------------------------------------------------------------------
-- 4) Staff read policies (additive — do not drop participant policies)
-- ---------------------------------------------------------------------------

do $pol$
begin
  if to_regclass('public.orders') is not null then
    alter table public.orders enable row level security;
    drop policy if exists orders_select_staff on public.orders;
    execute $sql$
      create policy orders_select_staff
        on public.orders
        for select
        to authenticated
        using (public.is_staff_user(auth.uid()))
    $sql$;
  end if;

  if to_regclass('public.order_messages') is not null then
    alter table public.order_messages enable row level security;
    drop policy if exists order_messages_select_staff on public.order_messages;
    execute $sql$
      create policy order_messages_select_staff
        on public.order_messages
        for select
        to authenticated
        using (public.is_staff_user(auth.uid()))
    $sql$;
  end if;

  if to_regclass('public.call_sessions') is not null then
    alter table public.call_sessions enable row level security;
    drop policy if exists call_sessions_select_staff on public.call_sessions;
    execute $sql$
      create policy call_sessions_select_staff
        on public.call_sessions
        for select
        to authenticated
        using (public.is_staff_user(auth.uid()))
    $sql$;
  end if;

  if to_regclass('public.profiles') is not null then
    alter table public.profiles enable row level security;
    drop policy if exists profiles_select_staff on public.profiles;
    execute $sql$
      create policy profiles_select_staff
        on public.profiles
        for select
        to authenticated
        using (public.is_staff_user(auth.uid()) or id = auth.uid())
    $sql$;
  end if;

  if to_regclass('public.delivery_requests') is not null then
    alter table public.delivery_requests enable row level security;
    drop policy if exists delivery_requests_select_staff on public.delivery_requests;
    execute $sql$
      create policy delivery_requests_select_staff
        on public.delivery_requests
        for select
        to authenticated
        using (public.is_staff_user(auth.uid()))
    $sql$;
  end if;

  if to_regclass('public.driver_order_offers') is not null then
    alter table public.driver_order_offers enable row level security;
    drop policy if exists driver_order_offers_select_staff on public.driver_order_offers;
    execute $sql$
      create policy driver_order_offers_select_staff
        on public.driver_order_offers
        for select
        to authenticated
        using (public.is_staff_user(auth.uid()))
    $sql$;
  end if;

  if to_regclass('public.delivery_request_driver_offers') is not null then
    alter table public.delivery_request_driver_offers enable row level security;
    drop policy if exists delivery_request_driver_offers_select_staff on public.delivery_request_driver_offers;
    execute $sql$
      create policy delivery_request_driver_offers_select_staff
        on public.delivery_request_driver_offers
        for select
        to authenticated
        using (public.is_staff_user(auth.uid()))
    $sql$;
  end if;

  if to_regclass('public.stripe_webhook_events') is not null then
    alter table public.stripe_webhook_events enable row level security;
    drop policy if exists stripe_webhook_events_select_staff on public.stripe_webhook_events;
    execute $sql$
      create policy stripe_webhook_events_select_staff
        on public.stripe_webhook_events
        for select
        to authenticated
        using (public.is_staff_user(auth.uid()))
    $sql$;
  end if;

  if to_regclass('public.order_dispatch_attempts') is not null then
    alter table public.order_dispatch_attempts enable row level security;
    drop policy if exists order_dispatch_attempts_select_staff on public.order_dispatch_attempts;
    execute $sql$
      create policy order_dispatch_attempts_select_staff
        on public.order_dispatch_attempts
        for select
        to authenticated
        using (public.is_staff_user(auth.uid()))
    $sql$;
  end if;

  if to_regclass('public.order_dispatch_wave_schedule') is not null then
    alter table public.order_dispatch_wave_schedule enable row level security;
    drop policy if exists order_dispatch_wave_schedule_select_staff on public.order_dispatch_wave_schedule;
    execute $sql$
      create policy order_dispatch_wave_schedule_select_staff
        on public.order_dispatch_wave_schedule
        for select
        to authenticated
        using (public.is_staff_user(auth.uid()))
    $sql$;
  end if;
end
$pol$;

commit;
