-- ===========================================================================
-- MMD Central Commission Engine — Phase 4
-- ---------------------------------------------------------------------------
-- Unified commission resolution for Restaurants (food) and Marketplace sellers.
-- Reads loyalty active benefits (commission_discount / fee credits) WITHOUT
-- modifying loyalty programs. Snapshots are write-once per order.
--
-- Priority (single winning rule):
--   1. loyalty_benefit (active commission_discount)
--   2. partner_override (personalized)
--   3. commercial_contract
--   4. commercial_campaign
--   5. service_rate
--   6. category_rate
--   7. city_rate
--   8. country_rate
--   9. standard_rate
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Commercial contracts
-- ---------------------------------------------------------------------------
create table if not exists public.commercial_contracts (
  id uuid primary key default gen_random_uuid(),
  partner_type text not null check (partner_type in ('restaurant', 'seller')),
  partner_user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  rate_pct numeric(8, 4) not null check (rate_pct >= 0 and rate_pct <= 100),
  fixed_fee_cents integer not null default 0 check (fixed_fee_cents >= 0),
  services text[] not null default '{}'::text[],
  categories text[] not null default '{}'::text[],
  country_code text,
  city text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'draft' check (
    status in ('draft', 'active', 'suspended', 'expired')
  ),
  internal_notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_contracts_dates_chk check (
    starts_at is null or ends_at is null or starts_at <= ends_at
  )
);

create index if not exists commercial_contracts_partner_idx
  on public.commercial_contracts (partner_type, partner_user_id, status);
create index if not exists commercial_contracts_active_idx
  on public.commercial_contracts (status, starts_at, ends_at);

drop trigger if exists trg_commercial_contracts_updated_at on public.commercial_contracts;
create trigger trg_commercial_contracts_updated_at
before update on public.commercial_contracts
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Commercial campaigns (market-wide or scoped rate offers)
-- ---------------------------------------------------------------------------
create table if not exists public.commercial_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  partner_type text check (partner_type is null or partner_type in ('restaurant', 'seller')),
  service text check (service is null or service in ('food', 'marketplace')),
  category text,
  country_code text,
  city text,
  rate_pct numeric(8, 4) not null check (rate_pct >= 0 and rate_pct <= 100),
  fixed_fee_cents integer not null default 0 check (fixed_fee_cents >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'draft' check (
    status in ('draft', 'active', 'suspended', 'ended')
  ),
  reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_campaigns_dates_chk check (
    starts_at is null or ends_at is null or starts_at <= ends_at
  )
);

create index if not exists commercial_campaigns_active_idx
  on public.commercial_campaigns (status, partner_type, service);

drop trigger if exists trg_commercial_campaigns_updated_at on public.commercial_campaigns;
create trigger trg_commercial_campaigns_updated_at
before update on public.commercial_campaigns
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) Personalized partner commission overrides
-- ---------------------------------------------------------------------------
create table if not exists public.partner_commission_overrides (
  id uuid primary key default gen_random_uuid(),
  partner_type text not null check (partner_type in ('restaurant', 'seller')),
  partner_user_id uuid not null references public.profiles (id) on delete cascade,
  service text check (service is null or service in ('food', 'marketplace')),
  rate_pct numeric(8, 4) not null check (rate_pct >= 0 and rate_pct <= 100),
  fixed_fee_cents integer not null default 0 check (fixed_fee_cents >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'draft' check (
    status in ('draft', 'active', 'suspended', 'scheduled', 'ended')
  ),
  reason text not null,
  contract_id uuid references public.commercial_contracts (id) on delete set null,
  campaign_id uuid references public.commercial_campaigns (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_commission_overrides_dates_chk check (
    starts_at is null or ends_at is null or starts_at <= ends_at
  )
);

-- At most one ACTIVE override per (partner, service) at a time (service null = all).
create unique index if not exists partner_commission_overrides_active_uq
  on public.partner_commission_overrides (
    partner_type, partner_user_id, coalesce(service, '')
  )
  where status = 'active';

create index if not exists partner_commission_overrides_partner_idx
  on public.partner_commission_overrides (partner_type, partner_user_id, status);

drop trigger if exists trg_partner_commission_overrides_updated_at on public.partner_commission_overrides;
create trigger trg_partner_commission_overrides_updated_at
before update on public.partner_commission_overrides
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4) Scoped rate tables (service / category / city / country / standard)
-- ---------------------------------------------------------------------------
create table if not exists public.commission_service_rates (
  id uuid primary key default gen_random_uuid(),
  service text not null check (service in ('food', 'marketplace')),
  partner_type text not null check (partner_type in ('restaurant', 'seller')),
  rate_pct numeric(8, 4) not null check (rate_pct >= 0 and rate_pct <= 100),
  fixed_fee_cents integer not null default 0 check (fixed_fee_cents >= 0),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_service_rates_uq unique (service, partner_type)
);

create table if not exists public.commission_category_rates (
  id uuid primary key default gen_random_uuid(),
  partner_type text not null check (partner_type in ('restaurant', 'seller')),
  category text not null,
  service text check (service is null or service in ('food', 'marketplace')),
  country_code text,
  rate_pct numeric(8, 4) not null check (rate_pct >= 0 and rate_pct <= 100),
  fixed_fee_cents integer not null default 0 check (fixed_fee_cents >= 0),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists commission_category_rates_uq
  on public.commission_category_rates (
    partner_type, lower(category), coalesce(service, ''), coalesce(country_code, '')
  );

create table if not exists public.commission_city_rates (
  id uuid primary key default gen_random_uuid(),
  partner_type text not null check (partner_type in ('restaurant', 'seller')),
  country_code text not null,
  city text not null,
  service text check (service is null or service in ('food', 'marketplace')),
  rate_pct numeric(8, 4) not null check (rate_pct >= 0 and rate_pct <= 100),
  fixed_fee_cents integer not null default 0 check (fixed_fee_cents >= 0),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists commission_city_rates_uq
  on public.commission_city_rates (
    partner_type, upper(country_code), lower(city), coalesce(service, '')
  );

create table if not exists public.commission_country_rates (
  id uuid primary key default gen_random_uuid(),
  partner_type text not null check (partner_type in ('restaurant', 'seller')),
  country_code text not null,
  service text check (service is null or service in ('food', 'marketplace')),
  rate_pct numeric(8, 4) not null check (rate_pct >= 0 and rate_pct <= 100),
  fixed_fee_cents integer not null default 0 check (fixed_fee_cents >= 0),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists commission_country_rates_uq
  on public.commission_country_rates (
    partner_type, upper(country_code), coalesce(service, '')
  );

create table if not exists public.commission_standard_rates (
  id uuid primary key default gen_random_uuid(),
  partner_type text not null check (partner_type in ('restaurant', 'seller')),
  service text not null check (service in ('food', 'marketplace')),
  rate_pct numeric(8, 4) not null check (rate_pct >= 0 and rate_pct <= 100),
  fixed_fee_cents integer not null default 0 check (fixed_fee_cents >= 0),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_standard_rates_uq unique (partner_type, service)
);

-- Seed standards from current production defaults:
-- Food platform take ~15%; Marketplace hardcoded 5%.
insert into public.commission_standard_rates (partner_type, service, rate_pct, fixed_fee_cents)
values
  ('restaurant', 'food', 15, 0),
  ('seller', 'marketplace', 5, 0)
on conflict (partner_type, service) do nothing;

insert into public.commission_service_rates (service, partner_type, rate_pct, fixed_fee_cents)
values
  ('food', 'restaurant', 15, 0),
  ('marketplace', 'seller', 5, 0)
on conflict (service, partner_type) do nothing;

-- ---------------------------------------------------------------------------
-- 5) Immutable per-order commission snapshots (write-once)
-- ---------------------------------------------------------------------------
create table if not exists public.commission_snapshots (
  id uuid primary key default gen_random_uuid(),
  order_kind text not null check (order_kind in ('food', 'marketplace')),
  order_id uuid not null,
  partner_type text not null check (partner_type in ('restaurant', 'seller')),
  partner_user_id uuid not null references public.profiles (id) on delete restrict,
  currency text not null default 'USD',
  rate_pct numeric(8, 4) not null check (rate_pct >= 0 and rate_pct <= 100),
  fixed_fee_cents integer not null default 0 check (fixed_fee_cents >= 0),
  fee_credit_cents integer not null default 0,
  base_rate_pct numeric(8, 4),
  rule_type text not null check (
    rule_type in (
      'loyalty_benefit', 'partner_override', 'commercial_contract',
      'commercial_campaign', 'service_rate', 'category_rate',
      'city_rate', 'country_rate', 'standard_rate'
    )
  ),
  rule_id uuid,
  rule_label text,
  country_code text,
  city text,
  category text,
  service text,
  loyalty_benefit_id uuid,
  resolved_at timestamptz not null default now(),
  frozen boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint commission_snapshots_order_uq unique (order_kind, order_id)
);

create index if not exists commission_snapshots_partner_idx
  on public.commission_snapshots (partner_type, partner_user_id, resolved_at desc);

-- ---------------------------------------------------------------------------
-- 6) Dedicated commission audit history (never delete)
-- ---------------------------------------------------------------------------
create table if not exists public.commission_rule_audit (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  partner_type text,
  partner_user_id uuid,
  old_value jsonb,
  new_value jsonb,
  reason text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists commission_rule_audit_entity_idx
  on public.commission_rule_audit (entity_type, entity_id, created_at desc);
create index if not exists commission_rule_audit_partner_idx
  on public.commission_rule_audit (partner_type, partner_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 7) RLS — staff read/write via service_role; authenticated read limited
-- ---------------------------------------------------------------------------
alter table public.commercial_contracts enable row level security;
alter table public.commercial_campaigns enable row level security;
alter table public.partner_commission_overrides enable row level security;
alter table public.commission_service_rates enable row level security;
alter table public.commission_category_rates enable row level security;
alter table public.commission_city_rates enable row level security;
alter table public.commission_country_rates enable row level security;
alter table public.commission_standard_rates enable row level security;
alter table public.commission_snapshots enable row level security;
alter table public.commission_rule_audit enable row level security;

drop policy if exists commercial_contracts_staff_select on public.commercial_contracts;
create policy commercial_contracts_staff_select
on public.commercial_contracts for select to authenticated
using (
  public.is_staff_user(auth.uid())
  or partner_user_id = auth.uid()
);

drop policy if exists commercial_campaigns_staff_select on public.commercial_campaigns;
create policy commercial_campaigns_staff_select
on public.commercial_campaigns for select to authenticated
using (status = 'active' or public.is_staff_user(auth.uid()));

drop policy if exists partner_commission_overrides_select on public.partner_commission_overrides;
create policy partner_commission_overrides_select
on public.partner_commission_overrides for select to authenticated
using (
  public.is_staff_user(auth.uid())
  or partner_user_id = auth.uid()
);

drop policy if exists commission_rate_tables_select on public.commission_service_rates;
create policy commission_rate_tables_select
on public.commission_service_rates for select to authenticated
using (status = 'active' or public.is_staff_user(auth.uid()));

drop policy if exists commission_category_rates_select on public.commission_category_rates;
create policy commission_category_rates_select
on public.commission_category_rates for select to authenticated
using (status = 'active' or public.is_staff_user(auth.uid()));

drop policy if exists commission_city_rates_select on public.commission_city_rates;
create policy commission_city_rates_select
on public.commission_city_rates for select to authenticated
using (status = 'active' or public.is_staff_user(auth.uid()));

drop policy if exists commission_country_rates_select on public.commission_country_rates;
create policy commission_country_rates_select
on public.commission_country_rates for select to authenticated
using (status = 'active' or public.is_staff_user(auth.uid()));

drop policy if exists commission_standard_rates_select on public.commission_standard_rates;
create policy commission_standard_rates_select
on public.commission_standard_rates for select to authenticated
using (status = 'active' or public.is_staff_user(auth.uid()));

drop policy if exists commission_snapshots_select on public.commission_snapshots;
create policy commission_snapshots_select
on public.commission_snapshots for select to authenticated
using (
  public.is_staff_user(auth.uid())
  or partner_user_id = auth.uid()
);

drop policy if exists commission_rule_audit_staff_select on public.commission_rule_audit;
create policy commission_rule_audit_staff_select
on public.commission_rule_audit for select to authenticated
using (public.is_staff_user(auth.uid()));

commit;
