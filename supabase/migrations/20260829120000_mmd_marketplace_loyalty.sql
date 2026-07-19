-- ===========================================================================
-- MMD Marketplace Loyalty — Phase 3 (Marketplace sellers only)
-- ---------------------------------------------------------------------------
-- Performance-based loyalty for Marketplace sellers. Points are NON-monetary:
-- not cash, not withdrawable, not transferable, never added to the seller payout
-- balance, and completely separate from the MMD Credit wallet (clients/drivers)
-- and from Marketplace revenue.
--
-- Uses the multi-role account from Phase 1:
--   loyalty_accounts.role = 'seller'  (keyed by the seller's user_id, i.e.
--   sellers.user_id / profiles.id). Sellers are identified by a row in
--   public.sellers (surrogate id + unique user_id).
--
-- Mirrors the Phase-2 restaurant loyalty architecture. Nothing here touches the
-- commission/payout engines; it only PREPARES commission-discount benefits for a
-- future unified commissions engine.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) Extend shared ledger reference types (additive; keep all prior values)
-- ---------------------------------------------------------------------------
alter table public.loyalty_ledger drop constraint if exists loyalty_ledger_reference_type_check;
alter table public.loyalty_ledger
  add constraint loyalty_ledger_reference_type_check check (
    reference_type is null or reference_type in (
      'food_order', 'taxi_ride', 'marketplace_order', 'delivery_request',
      'referral', 'campaign', 'conversion', 'admin',
      'restaurant_rule', 'restaurant_reward', 'restaurant_referral',
      'marketplace_rule', 'marketplace_reward', 'marketplace_referral'
    )
  );

-- ---------------------------------------------------------------------------
-- 1) Settings (singleton) — program toggle + referral bonus
-- ---------------------------------------------------------------------------
create table if not exists public.marketplace_loyalty_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  referral_points_referrer integer not null default 50 check (referral_points_referrer >= 0),
  referral_points_referred integer not null default 50 check (referral_points_referred >= 0),
  currency text not null default 'USD',
  updated_at timestamptz not null default now()
);

insert into public.marketplace_loyalty_settings (singleton)
values (true)
on conflict (singleton) do nothing;

drop trigger if exists trg_marketplace_loyalty_settings_updated_at on public.marketplace_loyalty_settings;
create trigger trg_marketplace_loyalty_settings_updated_at
before update on public.marketplace_loyalty_settings
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Performance rules — the configurable accrual engine
-- ---------------------------------------------------------------------------
create table if not exists public.marketplace_loyalty_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  criterion text not null check (
    criterion in (
      'first_completed_sale', 'completed_sales_count', 'revenue_reached',
      'avg_rating', 'cancellation_rate', 'refund_rate', 'catalog_complete',
      'compliant_products', 'product_availability', 'fast_response',
      'campaign_participation', 'tenure', 'custom'
    )
  ),
  threshold numeric(14, 2) not null default 0,
  points integer not null default 0 check (points >= 0),
  period text not null default 'once' check (
    period in ('once', 'lifetime', 'daily', 'weekly', 'monthly')
  ),
  country_code text,
  city text,
  category text,
  -- null seller_user_id = applies to all sellers.
  seller_user_id uuid references public.profiles (id) on delete cascade,
  starts_at timestamptz,
  ends_at timestamptz,
  global_quota integer check (global_quota is null or global_quota >= 0),
  per_seller_quota integer check (per_seller_quota is null or per_seller_quota >= 0),
  awarded_count integer not null default 0 check (awarded_count >= 0),
  status text not null default 'draft' check (
    status in ('draft', 'active', 'suspended', 'ended')
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketplace_loyalty_rules_active_idx
  on public.marketplace_loyalty_rules (status, criterion);

drop trigger if exists trg_marketplace_loyalty_rules_updated_at on public.marketplace_loyalty_rules;
create trigger trg_marketplace_loyalty_rules_updated_at
before update on public.marketplace_loyalty_rules
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) Configurable tiers (per market)
-- ---------------------------------------------------------------------------
create table if not exists public.marketplace_loyalty_tiers (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  label text not null,
  country_code text,
  sort_order integer not null default 0,
  min_points integer not null default 0 check (min_points >= 0),
  min_completed_sales integer not null default 0 check (min_completed_sales >= 0),
  min_revenue_cents bigint not null default 0 check (min_revenue_cents >= 0),
  min_avg_rating numeric(4, 2),
  max_cancellation_rate numeric(6, 2),
  max_refund_rate numeric(6, 2),
  min_tenure_days integer not null default 0 check (min_tenure_days >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_loyalty_tiers_market_code_uq unique (country_code, code)
);

drop trigger if exists trg_marketplace_loyalty_tiers_updated_at on public.marketplace_loyalty_tiers;
create trigger trg_marketplace_loyalty_tiers_updated_at
before update on public.marketplace_loyalty_tiers
for each row execute function public.taxi_set_updated_at();

insert into public.marketplace_loyalty_tiers
  (code, label, country_code, sort_order, min_points, min_completed_sales, min_revenue_cents, min_tenure_days)
values
  ('standard', 'Standard', null, 1, 0, 0, 0, 0),
  ('bronze', 'Bronze', null, 2, 100, 25, 0, 30),
  ('silver', 'Silver', null, 3, 500, 150, 0, 90),
  ('gold', 'Gold', null, 4, 1500, 500, 0, 180),
  ('platinum', 'Platinum', null, 5, 4000, 1500, 0, 365)
on conflict (country_code, code) do nothing;

-- ---------------------------------------------------------------------------
-- 4) Rewards catalogue — professional benefits redeemable with points
-- ---------------------------------------------------------------------------
create table if not exists public.marketplace_rewards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  points_cost integer not null check (points_cost > 0),
  benefit_type text not null check (
    benefit_type in (
      'marketplace_fee_credit', 'commission_discount', 'priority_placement',
      'sponsored_product', 'recommended_badge', 'ad_credit', 'free_promotion',
      'advanced_tools', 'extra_visibility', 'custom'
    )
  ),
  benefit_value numeric(14, 2) not null default 0,
  benefit_currency text not null default 'USD',
  duration_days integer check (duration_days is null or duration_days >= 0),
  country_code text,
  city text,
  category text,
  -- null eligible_seller_ids = all sellers eligible.
  eligible_seller_ids uuid[],
  starts_at timestamptz,
  ends_at timestamptz,
  max_redemptions integer check (max_redemptions is null or max_redemptions >= 0),
  redemptions_count integer not null default 0 check (redemptions_count >= 0),
  status text not null default 'draft' check (
    status in ('draft', 'active', 'suspended', 'ended')
  ),
  conditions jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketplace_rewards_status_idx
  on public.marketplace_rewards (status, benefit_type);

drop trigger if exists trg_marketplace_rewards_updated_at on public.marketplace_rewards;
create trigger trg_marketplace_rewards_updated_at
before update on public.marketplace_rewards
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5) Award ledger — one row per (rule, seller, period) attribution
-- ---------------------------------------------------------------------------
create table if not exists public.marketplace_loyalty_awards (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.marketplace_loyalty_rules (id) on delete cascade,
  seller_user_id uuid not null references public.profiles (id) on delete cascade,
  period_key text not null,
  metric_value numeric(14, 2),
  threshold numeric(14, 2),
  points_awarded integer not null default 0,
  ledger_id uuid references public.loyalty_ledger (id) on delete set null,
  idempotency_key text,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint marketplace_loyalty_awards_uq unique (rule_id, seller_user_id, period_key)
);

create index if not exists marketplace_loyalty_awards_seller_idx
  on public.marketplace_loyalty_awards (seller_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 6) Redemptions ledger — one row per points -> reward exchange
-- ---------------------------------------------------------------------------
create table if not exists public.marketplace_loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  seller_user_id uuid not null references public.profiles (id) on delete cascade,
  reward_id uuid not null references public.marketplace_rewards (id) on delete restrict,
  points_spent integer not null check (points_spent >= 0),
  ledger_id uuid references public.loyalty_ledger (id) on delete set null,
  status text not null default 'active' check (
    status in ('active', 'expired', 'canceled', 'fraud_reversed')
  ),
  idempotency_key text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketplace_loyalty_redemptions_seller_idx
  on public.marketplace_loyalty_redemptions (seller_user_id, created_at desc);
create unique index if not exists marketplace_loyalty_redemptions_idem_uq
  on public.marketplace_loyalty_redemptions (idempotency_key)
  where idempotency_key is not null;

drop trigger if exists trg_marketplace_loyalty_redemptions_updated_at on public.marketplace_loyalty_redemptions;
create trigger trg_marketplace_loyalty_redemptions_updated_at
before update on public.marketplace_loyalty_redemptions
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 7) Active benefits — professional advantages currently granted
-- ---------------------------------------------------------------------------
create table if not exists public.marketplace_active_benefits (
  id uuid primary key default gen_random_uuid(),
  seller_user_id uuid not null references public.profiles (id) on delete cascade,
  reward_id uuid references public.marketplace_rewards (id) on delete set null,
  redemption_id uuid references public.marketplace_loyalty_redemptions (id) on delete set null,
  benefit_type text not null,
  benefit_value numeric(14, 2) not null default 0,
  benefit_currency text not null default 'USD',
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'active' check (
    status in ('scheduled', 'active', 'expired', 'suspended', 'canceled')
  ),
  uses_count integer not null default 0 check (uses_count >= 0),
  uses_limit integer check (uses_limit is null or uses_limit >= 0),
  reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketplace_active_benefits_seller_idx
  on public.marketplace_active_benefits (seller_user_id, status);
create index if not exists marketplace_active_benefits_expiry_idx
  on public.marketplace_active_benefits (status, expires_at)
  where expires_at is not null;

drop trigger if exists trg_marketplace_active_benefits_updated_at on public.marketplace_active_benefits;
create trigger trg_marketplace_active_benefits_updated_at
before update on public.marketplace_active_benefits
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 8) Seller referrals — multi-step qualification journey
-- ---------------------------------------------------------------------------
-- Referral CODES reuse loyalty_referral_codes with role = 'seller'.
create table if not exists public.marketplace_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references public.profiles (id) on delete cascade,
  referred_user_id uuid not null references public.profiles (id) on delete cascade,
  code text not null,
  status text not null default 'pending' check (
    status in ('pending', 'verified', 'approved', 'qualified', 'rewarded', 'rejected', 'reversed')
  ),
  account_created_at timestamptz not null default now(),
  verified_at timestamptz,
  approved_at timestamptz,
  product_published_at timestamptz,
  first_sale_at timestamptz,
  qualified_at timestamptz,
  rewarded_at timestamptz,
  phone_verified boolean not null default false,
  business_verified boolean not null default false,
  documents_verified boolean not null default false,
  device_verified boolean not null default false,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketplace_referrals_referred_uq unique (referred_user_id),
  constraint marketplace_referrals_no_self check (referrer_user_id <> referred_user_id)
);

create index if not exists marketplace_referrals_referrer_idx
  on public.marketplace_referrals (referrer_user_id, created_at desc);

drop trigger if exists trg_marketplace_referrals_updated_at on public.marketplace_referrals;
create trigger trg_marketplace_referrals_updated_at
before update on public.marketplace_referrals
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 9) Per-seller performance stats cache (idempotent, order-guarded)
-- ---------------------------------------------------------------------------
create table if not exists public.marketplace_loyalty_stats (
  seller_user_id uuid primary key references public.profiles (id) on delete cascade,
  completed_sales integer not null default 0 check (completed_sales >= 0),
  revenue_cents bigint not null default 0 check (revenue_cents >= 0),
  first_sale_at timestamptz,
  last_sale_at timestamptz,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_marketplace_loyalty_stats_updated_at on public.marketplace_loyalty_stats;
create trigger trg_marketplace_loyalty_stats_updated_at
before update on public.marketplace_loyalty_stats
for each row execute function public.taxi_set_updated_at();

create table if not exists public.marketplace_order_loyalty_processed (
  seller_order_id uuid primary key,
  seller_user_id uuid not null references public.profiles (id) on delete cascade,
  processed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 10) RLS — sellers read their OWN rows; staff read all. Catalog readable.
-- ---------------------------------------------------------------------------
alter table public.marketplace_loyalty_settings enable row level security;
alter table public.marketplace_loyalty_rules enable row level security;
alter table public.marketplace_loyalty_tiers enable row level security;
alter table public.marketplace_rewards enable row level security;
alter table public.marketplace_loyalty_awards enable row level security;
alter table public.marketplace_loyalty_redemptions enable row level security;
alter table public.marketplace_active_benefits enable row level security;
alter table public.marketplace_referrals enable row level security;
alter table public.marketplace_loyalty_stats enable row level security;
alter table public.marketplace_order_loyalty_processed enable row level security;

drop policy if exists marketplace_loyalty_settings_select on public.marketplace_loyalty_settings;
create policy marketplace_loyalty_settings_select
on public.marketplace_loyalty_settings for select to authenticated
using (enabled = true or public.is_staff_user(auth.uid()));

drop policy if exists marketplace_loyalty_rules_select on public.marketplace_loyalty_rules;
create policy marketplace_loyalty_rules_select
on public.marketplace_loyalty_rules for select to authenticated
using (
  public.is_staff_user(auth.uid())
  or (status = 'active' and (seller_user_id is null or seller_user_id = auth.uid()))
);

drop policy if exists marketplace_loyalty_tiers_select on public.marketplace_loyalty_tiers;
create policy marketplace_loyalty_tiers_select
on public.marketplace_loyalty_tiers for select to authenticated
using (active = true or public.is_staff_user(auth.uid()));

drop policy if exists marketplace_rewards_select on public.marketplace_rewards;
create policy marketplace_rewards_select
on public.marketplace_rewards for select to authenticated
using (status = 'active' or public.is_staff_user(auth.uid()));

drop policy if exists marketplace_loyalty_awards_select_own on public.marketplace_loyalty_awards;
create policy marketplace_loyalty_awards_select_own
on public.marketplace_loyalty_awards for select to authenticated
using (seller_user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists marketplace_loyalty_redemptions_select_own on public.marketplace_loyalty_redemptions;
create policy marketplace_loyalty_redemptions_select_own
on public.marketplace_loyalty_redemptions for select to authenticated
using (seller_user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists marketplace_active_benefits_select_own on public.marketplace_active_benefits;
create policy marketplace_active_benefits_select_own
on public.marketplace_active_benefits for select to authenticated
using (seller_user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists marketplace_referrals_select_own on public.marketplace_referrals;
create policy marketplace_referrals_select_own
on public.marketplace_referrals for select to authenticated
using (
  referrer_user_id = auth.uid()
  or referred_user_id = auth.uid()
  or public.is_staff_user(auth.uid())
);

drop policy if exists marketplace_loyalty_stats_select_own on public.marketplace_loyalty_stats;
create policy marketplace_loyalty_stats_select_own
on public.marketplace_loyalty_stats for select to authenticated
using (seller_user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists marketplace_order_loyalty_processed_select on public.marketplace_order_loyalty_processed;
create policy marketplace_order_loyalty_processed_select
on public.marketplace_order_loyalty_processed for select to authenticated
using (public.is_staff_user(auth.uid()));

commit;
