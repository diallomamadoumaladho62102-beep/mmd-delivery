-- ===========================================================================
-- MMD Loyalty Program — unified platform loyalty (Delivery + Taxi)
-- ---------------------------------------------------------------------------
-- Rewards clients and drivers with points on completed & paid orders/rides,
-- convertible into "Crédit MMD" (non-cashable store credit), plus referrals,
-- admin campaigns, and configurable loyalty tiers.
--
-- Design principles (mirror existing conventions):
--   * text + check() enums (no create type), uuid PKs, RLS via auth.uid()
--     + public.is_staff_user() for staff read access.
--   * All privileged mutations go through SECURITY DEFINER RPCs granted to
--     service_role (and authenticated where a user acts on their own row).
--   * Exactly-once accrual enforced by a unique idempotency_key on the ledger.
--   * Points/credit amounts are integers; credit stored in minor units (cents).
--   * Nothing here modifies existing tables' data or breaks existing flows.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Settings (singleton) — admin-configurable program parameters
-- ---------------------------------------------------------------------------
create table if not exists public.loyalty_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default true,
  points_per_delivery integer not null default 1 check (points_per_delivery >= 0),
  points_per_ride integer not null default 1 check (points_per_ride >= 0),
  conversion_points integer not null default 100 check (conversion_points > 0),
  conversion_credit_cents integer not null default 500 check (conversion_credit_cents > 0),
  credit_validity_months integer not null default 0 check (credit_validity_months in (0, 6, 12)),
  referral_points_client integer not null default 10 check (referral_points_client >= 0),
  referral_points_driver integer not null default 10 check (referral_points_driver >= 0),
  currency text not null default 'USD',
  updated_at timestamptz not null default now()
);

insert into public.loyalty_settings (singleton)
values (true)
on conflict (singleton) do nothing;

drop trigger if exists trg_loyalty_settings_updated_at on public.loyalty_settings;
create trigger trg_loyalty_settings_updated_at
before update on public.loyalty_settings
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Tiers — configurable thresholds (Bronze / Silver / Gold / Platinum)
-- ---------------------------------------------------------------------------
create table if not exists public.loyalty_tiers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  min_lifetime_points integer not null default 0 check (min_lifetime_points >= 0),
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_loyalty_tiers_updated_at on public.loyalty_tiers;
create trigger trg_loyalty_tiers_updated_at
before update on public.loyalty_tiers
for each row execute function public.taxi_set_updated_at();

insert into public.loyalty_tiers (code, label, min_lifetime_points, sort_order)
values
  ('bronze', 'Bronze', 0, 1),
  ('silver', 'Silver', 100, 2),
  ('gold', 'Gold', 500, 3),
  ('platinum', 'Platinum', 1500, 4)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 3) Loyalty accounts + append-only ledger
-- ---------------------------------------------------------------------------
-- Multi-role loyalty: one SEPARATE account per (user_id, role). A person who is
-- both e.g. a client and a driver has two independent accounts and balances;
-- there is NEVER any transfer of points between roles. The 'restaurant' and
-- 'seller' roles are reserved here so their programs can be added later without
-- schema churn (their campaigns/rewards are intentionally out of scope for now).
create table if not exists public.loyalty_accounts (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'client'
    check (role in ('client', 'driver', 'restaurant', 'seller')),
  points_balance integer not null default 0 check (points_balance >= 0),
  lifetime_points integer not null default 0 check (lifetime_points >= 0),
  tier_code text not null default 'bronze',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, role)
);

drop trigger if exists trg_loyalty_accounts_updated_at on public.loyalty_accounts;
create trigger trg_loyalty_accounts_updated_at
before update on public.loyalty_accounts
for each row execute function public.taxi_set_updated_at();

create table if not exists public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'client'
    check (role in ('client', 'driver', 'restaurant', 'seller')),
  delta_points integer not null,
  balance_after integer not null check (balance_after >= 0),
  entry_type text not null check (
    entry_type in ('order', 'taxi', 'bonus', 'promotion', 'referral', 'conversion', 'admin_adjust')
  ),
  reference_type text check (
    reference_type is null or reference_type in (
      'food_order', 'taxi_ride', 'marketplace_order', 'delivery_request',
      'referral', 'campaign', 'conversion', 'admin'
    )
  ),
  reference_id text,
  description text,
  idempotency_key text,
  actor_user_id uuid references public.profiles (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists loyalty_ledger_user_created_idx
  on public.loyalty_ledger (user_id, created_at desc);
create unique index if not exists loyalty_ledger_idempotency_uq
  on public.loyalty_ledger (idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- 4) MMD Credit — wallet + lots (for expiry) + append-only ledger
-- ---------------------------------------------------------------------------
create table if not exists public.mmd_credit_wallets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_mmd_credit_wallets_updated_at on public.mmd_credit_wallets;
create trigger trg_mmd_credit_wallets_updated_at
before update on public.mmd_credit_wallets
for each row execute function public.taxi_set_updated_at();

create table if not exists public.mmd_credit_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  remaining_cents bigint not null check (remaining_cents >= 0),
  expires_at timestamptz,
  source text not null default 'conversion',
  created_at timestamptz not null default now()
);

create index if not exists mmd_credit_lots_user_idx
  on public.mmd_credit_lots (user_id, expires_at nulls last, created_at);

create table if not exists public.mmd_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  delta_cents bigint not null,
  balance_after_cents bigint not null check (balance_after_cents >= 0),
  entry_type text not null check (
    entry_type in ('conversion', 'spend', 'refund', 'expire', 'admin_adjust')
  ),
  reference_type text,
  reference_id text,
  description text,
  idempotency_key text,
  actor_user_id uuid references public.profiles (id) on delete set null,
  currency text not null default 'USD',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mmd_credit_ledger_user_created_idx
  on public.mmd_credit_ledger (user_id, created_at desc);
create unique index if not exists mmd_credit_ledger_idempotency_uq
  on public.mmd_credit_ledger (idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- 5) Referral codes + referral records
-- ---------------------------------------------------------------------------
create table if not exists public.loyalty_referral_codes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'client'
    check (role in ('client', 'driver', 'restaurant', 'seller')),
  code text not null unique,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table if not exists public.loyalty_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references public.profiles (id) on delete cascade,
  referred_user_id uuid not null references public.profiles (id) on delete cascade,
  code text not null,
  audience text not null default 'client'
    check (audience in ('client', 'driver', 'restaurant', 'seller')),
  status text not null default 'pending' check (status in ('pending', 'rewarded', 'void')),
  rewarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_referrals_referred_uq unique (referred_user_id)
);

create index if not exists loyalty_referrals_referrer_idx
  on public.loyalty_referrals (referrer_user_id, created_at desc);

drop trigger if exists trg_loyalty_referrals_updated_at on public.loyalty_referrals;
create trigger trg_loyalty_referrals_updated_at
before update on public.loyalty_referrals
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 6) Campaigns (admin-created, no code changes required)
-- ---------------------------------------------------------------------------
create table if not exists public.loyalty_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  audience text not null default 'client' check (audience in ('client', 'driver', 'both')),
  vertical text not null default 'any' check (
    vertical in ('any', 'food', 'taxi', 'marketplace', 'delivery')
  ),
  bonus_type text not null default 'flat' check (bonus_type in ('flat', 'multiplier')),
  bonus_points integer not null default 0 check (bonus_points >= 0),
  multiplier numeric(6, 2) not null default 1 check (multiplier >= 0),
  country_code text,
  city text,
  restaurant_id text,
  category text,
  days_of_week integer[] not null default '{}',
  hour_start integer check (hour_start is null or (hour_start between 0 and 23)),
  hour_end integer check (hour_end is null or (hour_end between 0 and 23)),
  starts_at timestamptz,
  ends_at timestamptz,
  max_uses integer check (max_uses is null or max_uses >= 0),
  uses_count integer not null default 0 check (uses_count >= 0),
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists loyalty_campaigns_active_idx
  on public.loyalty_campaigns (active, vertical, audience);

drop trigger if exists trg_loyalty_campaigns_updated_at on public.loyalty_campaigns;
create trigger trg_loyalty_campaigns_updated_at
before update on public.loyalty_campaigns
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 7) RLS — users read their own rows; staff read all. All writes via RPCs.
-- ---------------------------------------------------------------------------
alter table public.loyalty_settings enable row level security;
alter table public.loyalty_tiers enable row level security;
alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_ledger enable row level security;
alter table public.mmd_credit_wallets enable row level security;
alter table public.mmd_credit_lots enable row level security;
alter table public.mmd_credit_ledger enable row level security;
alter table public.loyalty_referral_codes enable row level security;
alter table public.loyalty_referrals enable row level security;
alter table public.loyalty_campaigns enable row level security;

drop policy if exists loyalty_settings_select on public.loyalty_settings;
create policy loyalty_settings_select
on public.loyalty_settings for select to authenticated
using (enabled = true or public.is_staff_user(auth.uid()));

drop policy if exists loyalty_tiers_select on public.loyalty_tiers;
create policy loyalty_tiers_select
on public.loyalty_tiers for select to authenticated
using (active = true or public.is_staff_user(auth.uid()));

drop policy if exists loyalty_accounts_select_own on public.loyalty_accounts;
create policy loyalty_accounts_select_own
on public.loyalty_accounts for select to authenticated
using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists loyalty_ledger_select_own on public.loyalty_ledger;
create policy loyalty_ledger_select_own
on public.loyalty_ledger for select to authenticated
using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists mmd_credit_wallets_select_own on public.mmd_credit_wallets;
create policy mmd_credit_wallets_select_own
on public.mmd_credit_wallets for select to authenticated
using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists mmd_credit_lots_select_own on public.mmd_credit_lots;
create policy mmd_credit_lots_select_own
on public.mmd_credit_lots for select to authenticated
using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists mmd_credit_ledger_select_own on public.mmd_credit_ledger;
create policy mmd_credit_ledger_select_own
on public.mmd_credit_ledger for select to authenticated
using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists loyalty_referral_codes_select_own on public.loyalty_referral_codes;
create policy loyalty_referral_codes_select_own
on public.loyalty_referral_codes for select to authenticated
using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists loyalty_referrals_select_own on public.loyalty_referrals;
create policy loyalty_referrals_select_own
on public.loyalty_referrals for select to authenticated
using (
  referrer_user_id = auth.uid()
  or referred_user_id = auth.uid()
  or public.is_staff_user(auth.uid())
);

drop policy if exists loyalty_campaigns_select on public.loyalty_campaigns;
create policy loyalty_campaigns_select
on public.loyalty_campaigns for select to authenticated
using (active = true or public.is_staff_user(auth.uid()));

commit;
