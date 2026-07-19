-- ===========================================================================
-- MMD Restaurant Loyalty — Phase 2 (partner restaurants only)
-- ---------------------------------------------------------------------------
-- Performance-based loyalty for restaurant partners. Points are NON-monetary
-- performance points: not cash, not withdrawable, not transferable, never added
-- to the restaurant payout balance, and completely separate from the MMD Credit
-- wallet used by clients/drivers.
--
-- Uses the multi-role account introduced in Phase 1:
--   loyalty_accounts.role = 'restaurant'  (keyed by the restaurant's user_id,
--   i.e. restaurant_profiles.user_id / profiles.id).
--
-- Design principles mirror the existing loyalty schema:
--   * text + check() enums, uuid PKs, RLS via auth.uid() + is_staff_user().
--   * All privileged mutations go through SECURITY DEFINER RPCs (service_role).
--   * Exactly-once accrual via unique (rule, restaurant, period) + ledger idem.
--   * Nothing here modifies commission/payout engines. It only PREPARES the
--     architecture for commission-discount benefits (applied in a later phase).
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) Evolve shared Phase-1 tables (additive, backward compatible)
-- ---------------------------------------------------------------------------
-- Account-level status lets admins suspend/reactivate a loyalty account for any
-- role (used here to block restaurant accrual/redemption on fraud/suspension).
alter table public.loyalty_accounts
  add column if not exists status text not null default 'active';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'loyalty_accounts_status_check'
  ) then
    alter table public.loyalty_accounts
      add constraint loyalty_accounts_status_check
      check (status in ('active', 'suspended'));
  end if;
end $$;

-- Allow restaurant point movements to be recorded with meaningful ledger types.
alter table public.loyalty_ledger drop constraint if exists loyalty_ledger_entry_type_check;
alter table public.loyalty_ledger
  add constraint loyalty_ledger_entry_type_check check (
    entry_type in (
      'order', 'taxi', 'bonus', 'promotion', 'referral',
      'conversion', 'admin_adjust', 'redemption'
    )
  );

alter table public.loyalty_ledger drop constraint if exists loyalty_ledger_reference_type_check;
alter table public.loyalty_ledger
  add constraint loyalty_ledger_reference_type_check check (
    reference_type is null or reference_type in (
      'food_order', 'taxi_ride', 'marketplace_order', 'delivery_request',
      'referral', 'campaign', 'conversion', 'admin',
      'restaurant_rule', 'restaurant_reward', 'restaurant_referral'
    )
  );

-- ---------------------------------------------------------------------------
-- 1) Restaurant loyalty settings (singleton) — program toggle + referral bonus
-- ---------------------------------------------------------------------------
create table if not exists public.restaurant_loyalty_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  referral_points_referrer integer not null default 50 check (referral_points_referrer >= 0),
  referral_points_referred integer not null default 50 check (referral_points_referred >= 0),
  currency text not null default 'USD',
  updated_at timestamptz not null default now()
);

insert into public.restaurant_loyalty_settings (singleton)
values (true)
on conflict (singleton) do nothing;

drop trigger if exists trg_restaurant_loyalty_settings_updated_at on public.restaurant_loyalty_settings;
create trigger trg_restaurant_loyalty_settings_updated_at
before update on public.restaurant_loyalty_settings
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) Performance rules — the configurable accrual engine
-- ---------------------------------------------------------------------------
create table if not exists public.restaurant_loyalty_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  criterion text not null check (
    criterion in (
      'first_completed_order', 'completed_orders_count', 'revenue_reached',
      'avg_rating', 'acceptance_rate', 'cancellation_rate',
      'prep_time_compliance', 'campaign_participation', 'menu_complete',
      'profile_up_to_date', 'valid_documents', 'tenure', 'custom'
    )
  ),
  threshold numeric(14, 2) not null default 0,
  points integer not null default 0 check (points >= 0),
  -- 'once' = lifetime one-shot per restaurant; the rest are recurring windows.
  period text not null default 'once' check (
    period in ('once', 'lifetime', 'daily', 'weekly', 'monthly')
  ),
  country_code text,
  city text,
  -- null restaurant_user_id = applies to all restaurants.
  restaurant_user_id uuid references public.profiles (id) on delete cascade,
  starts_at timestamptz,
  ends_at timestamptz,
  global_quota integer check (global_quota is null or global_quota >= 0),
  per_restaurant_quota integer check (per_restaurant_quota is null or per_restaurant_quota >= 0),
  awarded_count integer not null default 0 check (awarded_count >= 0),
  status text not null default 'draft' check (
    status in ('draft', 'active', 'suspended', 'ended')
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists restaurant_loyalty_rules_active_idx
  on public.restaurant_loyalty_rules (status, criterion);

drop trigger if exists trg_restaurant_loyalty_rules_updated_at on public.restaurant_loyalty_rules;
create trigger trg_restaurant_loyalty_rules_updated_at
before update on public.restaurant_loyalty_rules
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) Configurable tiers (per market) — Standard/Bronze/Silver/Gold/Platinum
-- ---------------------------------------------------------------------------
create table if not exists public.restaurant_loyalty_tiers (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  label text not null,
  -- null country_code = default ladder used when no market-specific ladder set.
  country_code text,
  sort_order integer not null default 0,
  min_points integer not null default 0 check (min_points >= 0),
  min_completed_orders integer not null default 0 check (min_completed_orders >= 0),
  min_revenue_cents bigint not null default 0 check (min_revenue_cents >= 0),
  min_avg_rating numeric(4, 2),
  min_acceptance_rate numeric(6, 2),
  max_cancellation_rate numeric(6, 2),
  min_tenure_days integer not null default 0 check (min_tenure_days >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_loyalty_tiers_market_code_uq unique (country_code, code)
);

drop trigger if exists trg_restaurant_loyalty_tiers_updated_at on public.restaurant_loyalty_tiers;
create trigger trg_restaurant_loyalty_tiers_updated_at
before update on public.restaurant_loyalty_tiers
for each row execute function public.taxi_set_updated_at();

insert into public.restaurant_loyalty_tiers
  (code, label, country_code, sort_order, min_points, min_completed_orders, min_revenue_cents, min_tenure_days)
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
create table if not exists public.restaurant_rewards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  points_cost integer not null check (points_cost > 0),
  benefit_type text not null check (
    benefit_type in (
      'service_fee_credit', 'commission_discount', 'sponsored_boost',
      'priority_placement', 'recommended_badge', 'free_campaign',
      'ad_credit', 'advanced_stats', 'custom'
    )
  ),
  -- Interpretation depends on benefit_type (e.g. percent for commission_discount,
  -- cents for *_credit). Applied by a later phase; stored as canonical value.
  benefit_value numeric(14, 2) not null default 0,
  benefit_currency text not null default 'USD',
  duration_days integer check (duration_days is null or duration_days >= 0),
  country_code text,
  city text,
  -- null eligible_restaurant_ids = all restaurants eligible.
  eligible_restaurant_ids uuid[],
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

create index if not exists restaurant_rewards_status_idx
  on public.restaurant_rewards (status, benefit_type);

drop trigger if exists trg_restaurant_rewards_updated_at on public.restaurant_rewards;
create trigger trg_restaurant_rewards_updated_at
before update on public.restaurant_rewards
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5) Award ledger — one row per (rule, restaurant, period) attribution
-- ---------------------------------------------------------------------------
-- Exactly-once guaranteed by the unique (rule_id, restaurant_user_id, period_key).
create table if not exists public.restaurant_loyalty_awards (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.restaurant_loyalty_rules (id) on delete cascade,
  restaurant_user_id uuid not null references public.profiles (id) on delete cascade,
  period_key text not null,
  metric_value numeric(14, 2),
  threshold numeric(14, 2),
  points_awarded integer not null default 0,
  ledger_id uuid references public.loyalty_ledger (id) on delete set null,
  idempotency_key text,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint restaurant_loyalty_awards_uq unique (rule_id, restaurant_user_id, period_key)
);

create index if not exists restaurant_loyalty_awards_restaurant_idx
  on public.restaurant_loyalty_awards (restaurant_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 6) Redemptions ledger — one row per points -> reward exchange
-- ---------------------------------------------------------------------------
create table if not exists public.restaurant_loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  restaurant_user_id uuid not null references public.profiles (id) on delete cascade,
  reward_id uuid not null references public.restaurant_rewards (id) on delete restrict,
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

create index if not exists restaurant_loyalty_redemptions_restaurant_idx
  on public.restaurant_loyalty_redemptions (restaurant_user_id, created_at desc);
create unique index if not exists restaurant_loyalty_redemptions_idem_uq
  on public.restaurant_loyalty_redemptions (idempotency_key)
  where idempotency_key is not null;

drop trigger if exists trg_restaurant_loyalty_redemptions_updated_at on public.restaurant_loyalty_redemptions;
create trigger trg_restaurant_loyalty_redemptions_updated_at
before update on public.restaurant_loyalty_redemptions
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 7) Active benefits — professional advantages currently granted
-- ---------------------------------------------------------------------------
create table if not exists public.restaurant_active_benefits (
  id uuid primary key default gen_random_uuid(),
  restaurant_user_id uuid not null references public.profiles (id) on delete cascade,
  reward_id uuid references public.restaurant_rewards (id) on delete set null,
  redemption_id uuid references public.restaurant_loyalty_redemptions (id) on delete set null,
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

create index if not exists restaurant_active_benefits_restaurant_idx
  on public.restaurant_active_benefits (restaurant_user_id, status);
create index if not exists restaurant_active_benefits_expiry_idx
  on public.restaurant_active_benefits (status, expires_at)
  where expires_at is not null;

drop trigger if exists trg_restaurant_active_benefits_updated_at on public.restaurant_active_benefits;
create trigger trg_restaurant_active_benefits_updated_at
before update on public.restaurant_active_benefits
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 8) Restaurant referrals — multi-step qualification journey
-- ---------------------------------------------------------------------------
-- Referral CODES reuse the Phase-1 loyalty_referral_codes table with
-- role = 'restaurant'. This table tracks the qualification lifecycle, which is
-- richer than the simple client/driver loyalty_referrals flow.
create table if not exists public.restaurant_referrals (
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
  menu_published_at timestamptz,
  first_order_at timestamptz,
  qualified_at timestamptz,
  rewarded_at timestamptz,
  phone_verified boolean not null default false,
  address_verified boolean not null default false,
  documents_verified boolean not null default false,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_referrals_referred_uq unique (referred_user_id),
  constraint restaurant_referrals_no_self check (referrer_user_id <> referred_user_id)
);

create index if not exists restaurant_referrals_referrer_idx
  on public.restaurant_referrals (referrer_user_id, created_at desc);

drop trigger if exists trg_restaurant_referrals_updated_at on public.restaurant_referrals;
create trigger trg_restaurant_referrals_updated_at
before update on public.restaurant_referrals
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 9) Per-restaurant performance stats cache (idempotent, order-guarded)
-- ---------------------------------------------------------------------------
create table if not exists public.restaurant_loyalty_stats (
  restaurant_user_id uuid primary key references public.profiles (id) on delete cascade,
  completed_orders integer not null default 0 check (completed_orders >= 0),
  revenue_cents bigint not null default 0 check (revenue_cents >= 0),
  first_order_at timestamptz,
  last_order_at timestamptz,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_restaurant_loyalty_stats_updated_at on public.restaurant_loyalty_stats;
create trigger trg_restaurant_loyalty_stats_updated_at
before update on public.restaurant_loyalty_stats
for each row execute function public.taxi_set_updated_at();

-- Guard table: ensures a completed order updates stats at most once.
create table if not exists public.restaurant_order_loyalty_processed (
  order_id uuid primary key,
  restaurant_user_id uuid not null references public.profiles (id) on delete cascade,
  processed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 10) RLS — restaurants read their OWN rows; staff read all. Catalog readable.
-- ---------------------------------------------------------------------------
alter table public.restaurant_loyalty_settings enable row level security;
alter table public.restaurant_loyalty_rules enable row level security;
alter table public.restaurant_loyalty_tiers enable row level security;
alter table public.restaurant_rewards enable row level security;
alter table public.restaurant_loyalty_awards enable row level security;
alter table public.restaurant_loyalty_redemptions enable row level security;
alter table public.restaurant_active_benefits enable row level security;
alter table public.restaurant_referrals enable row level security;
alter table public.restaurant_loyalty_stats enable row level security;
alter table public.restaurant_order_loyalty_processed enable row level security;

drop policy if exists restaurant_loyalty_settings_select on public.restaurant_loyalty_settings;
create policy restaurant_loyalty_settings_select
on public.restaurant_loyalty_settings for select to authenticated
using (enabled = true or public.is_staff_user(auth.uid()));

drop policy if exists restaurant_loyalty_rules_select on public.restaurant_loyalty_rules;
create policy restaurant_loyalty_rules_select
on public.restaurant_loyalty_rules for select to authenticated
using (
  public.is_staff_user(auth.uid())
  or (status = 'active' and (restaurant_user_id is null or restaurant_user_id = auth.uid()))
);

drop policy if exists restaurant_loyalty_tiers_select on public.restaurant_loyalty_tiers;
create policy restaurant_loyalty_tiers_select
on public.restaurant_loyalty_tiers for select to authenticated
using (active = true or public.is_staff_user(auth.uid()));

drop policy if exists restaurant_rewards_select on public.restaurant_rewards;
create policy restaurant_rewards_select
on public.restaurant_rewards for select to authenticated
using (status = 'active' or public.is_staff_user(auth.uid()));

drop policy if exists restaurant_loyalty_awards_select_own on public.restaurant_loyalty_awards;
create policy restaurant_loyalty_awards_select_own
on public.restaurant_loyalty_awards for select to authenticated
using (restaurant_user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists restaurant_loyalty_redemptions_select_own on public.restaurant_loyalty_redemptions;
create policy restaurant_loyalty_redemptions_select_own
on public.restaurant_loyalty_redemptions for select to authenticated
using (restaurant_user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists restaurant_active_benefits_select_own on public.restaurant_active_benefits;
create policy restaurant_active_benefits_select_own
on public.restaurant_active_benefits for select to authenticated
using (restaurant_user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists restaurant_referrals_select_own on public.restaurant_referrals;
create policy restaurant_referrals_select_own
on public.restaurant_referrals for select to authenticated
using (
  referrer_user_id = auth.uid()
  or referred_user_id = auth.uid()
  or public.is_staff_user(auth.uid())
);

drop policy if exists restaurant_loyalty_stats_select_own on public.restaurant_loyalty_stats;
create policy restaurant_loyalty_stats_select_own
on public.restaurant_loyalty_stats for select to authenticated
using (restaurant_user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists restaurant_order_loyalty_processed_select on public.restaurant_order_loyalty_processed;
create policy restaurant_order_loyalty_processed_select
on public.restaurant_order_loyalty_processed for select to authenticated
using (public.is_staff_user(auth.uid()));

commit;
