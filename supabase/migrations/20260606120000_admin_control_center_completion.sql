-- Admin Control Center completion: client lifecycle, communication logs, pricing regions/taxes.
-- Apply AFTER 20260605120000_admin_rbac_control_center.sql (validated production order).

begin;

-- ---------------------------------------------------------------------------
-- 1) Client account lifecycle on profiles
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists account_status text not null default 'active';

alter table public.profiles
  add column if not exists email text;

alter table public.profiles
  drop constraint if exists profiles_account_status_check;

alter table public.profiles
  add constraint profiles_account_status_check
  check (account_status in ('active', 'suspended', 'disabled'));

create index if not exists profiles_role_account_status_idx
  on public.profiles (role, account_status);

-- ---------------------------------------------------------------------------
-- 2) Pricing: region, taxes, fixed fees, promo schedule (no code deploy needed)
-- ---------------------------------------------------------------------------

alter table public.pricing_config
  add column if not exists region text not null default 'global';

alter table public.pricing_config
  drop constraint if exists pricing_config_region_check;

alter table public.pricing_config
  add constraint pricing_config_region_check
  check (region in ('global', 'us', 'africa'));

alter table public.pricing_config
  add column if not exists tax_enabled boolean not null default false;

alter table public.pricing_config
  add column if not exists tax_pct numeric(6,2) not null default 0;

alter table public.pricing_config
  add column if not exists tax_label text;

alter table public.pricing_config
  add column if not exists fixed_client_fee numeric(12,2) not null default 0;

-- promo_starts_at / promo_ends_at exist from base migration — ensure present
alter table public.pricing_config
  add column if not exists promo_starts_at timestamptz;

alter table public.pricing_config
  add column if not exists promo_ends_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3) pricing_config_history: rollback support
-- ---------------------------------------------------------------------------

alter table public.pricing_config_history
  add column if not exists change_type text not null default 'update';

alter table public.pricing_config_history
  drop constraint if exists pricing_config_history_change_type_check;

alter table public.pricing_config_history
  add constraint pricing_config_history_change_type_check
  check (change_type in ('update', 'rollback'));

-- ---------------------------------------------------------------------------
-- 4) Admin outbound communication journal
-- ---------------------------------------------------------------------------

create table if not exists public.admin_communication_logs (
  id uuid primary key default gen_random_uuid(),
  sent_by uuid references public.profiles (id) on delete set null,
  channel text not null check (channel in ('push', 'sms', 'email')),
  recipient_user_id uuid references public.profiles (id) on delete set null,
  recipient_address text,
  subject text,
  body text not null,
  status text not null default 'sent' check (status in ('sent', 'failed', 'skipped')),
  provider_response jsonb not null default '{}'::jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);

create index if not exists admin_communication_logs_created_idx
  on public.admin_communication_logs (created_at desc);

create index if not exists admin_communication_logs_recipient_idx
  on public.admin_communication_logs (recipient_user_id, created_at desc);

alter table public.admin_communication_logs enable row level security;

drop policy if exists admin_communication_logs_select_staff on public.admin_communication_logs;
create policy admin_communication_logs_select_staff
  on public.admin_communication_logs
  for select
  to authenticated
  using (public.is_staff_user(auth.uid()));

-- Inserts via service_role API only

-- ---------------------------------------------------------------------------
-- 5) Seed regional pricing rows (idempotent)
-- ---------------------------------------------------------------------------

insert into public.pricing_config (
  config_key, label, order_type, active, region, currency,
  client_pct, driver_pct, restaurant_pct, platform_pct,
  delivery_fee_base, minimum_order_amount, tax_enabled, tax_pct, fixed_client_fee, notes
)
values
  (
    'food_us',
    'Food pricing — United States',
    'food',
    true,
    'us',
    'USD',
    0, 0, 85, 15,
    0, 0, false, 0, 0,
    'US food defaults — edit from Admin Pricing.'
  ),
  (
    'food_africa',
    'Food pricing — Africa',
    'food',
    true,
    'africa',
    'USD',
    0, 0, 85, 15,
    0, 0, false, 0, 0,
    'Africa food defaults — edit from Admin Pricing.'
  ),
  (
    'errand_us',
    'Errand pricing — United States',
    'errand',
    true,
    'us',
    'USD',
    0, 80, 0, 20,
    0, 0, false, 0, 0,
    'US errand defaults.'
  ),
  (
    'errand_africa',
    'Errand pricing — Africa',
    'errand',
    true,
    'africa',
    'USD',
    0, 80, 0, 20,
    0, 0, false, 0, 0,
    'Africa errand defaults.'
  )
on conflict (config_key) do nothing;

commit;
