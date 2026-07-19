-- ===========================================================================
-- MMD Marketing Engine — Phase 7
-- ---------------------------------------------------------------------------
-- Central configurable campaigns / promo codes / coupons across Food,
-- Delivery, Taxi, Marketplace. Parallel to loyalty, MMD+, commissions, and
-- partner subscriptions. Does NOT rewrite vertical promo silos.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Campaign type catalogue (extensible without hard migrations)
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_campaign_types (
  key text primary key,
  label text not null,
  description text,
  category text not null default 'discount',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.marketing_campaign_types (key, label, category, sort_order) values
  ('percentage_discount', 'Réduction %', 'discount', 10),
  ('fixed_discount', 'Réduction fixe', 'discount', 20),
  ('free_delivery', 'Livraison gratuite', 'delivery', 30),
  ('delivery_fee_discount', 'Réduction frais de livraison', 'delivery', 40),
  ('taxi_discount', 'Réduction Taxi', 'taxi', 50),
  ('food_discount', 'Réduction Food', 'food', 60),
  ('marketplace_discount', 'Réduction Marketplace', 'marketplace', 70),
  ('service_fee_discount', 'Réduction frais de service', 'fee', 80),
  ('cashback', 'Cashback', 'reward', 90),
  ('loyalty_points_bonus', 'Bonus points fidélité', 'reward', 100),
  ('driver_bonus', 'Bonus chauffeur', 'driver', 110),
  ('restaurant_bonus', 'Bonus restaurant', 'partner', 120),
  ('seller_bonus', 'Bonus vendeur', 'partner', 130),
  ('referral_booster', 'Boost parrainage', 'acquisition', 140),
  ('first_order_offer', 'Première commande', 'acquisition', 150),
  ('first_ride_offer', 'Première course', 'acquisition', 160),
  ('first_marketplace_order_offer', 'Première commande Marketplace', 'acquisition', 170),
  ('reactivation_offer', 'Réactivation', 'retention', 180),
  ('birthday_offer', 'Anniversaire', 'retention', 190),
  ('happy_hour', 'Happy Hour', 'timed', 200),
  ('sponsored_campaign', 'Campagne sponsorisée', 'sponsored', 210),
  ('category_discount', 'Réduction catégorie', 'catalog', 220),
  ('product_discount', 'Réduction produit', 'catalog', 230),
  ('restaurant_discount', 'Réduction restaurant', 'partner', 240),
  ('seller_discount', 'Réduction vendeur', 'partner', 250),
  ('geographic_offer', 'Offre géographique', 'geo', 260),
  ('subscription_exclusive_offer', 'Offre exclusive MMD+', 'subscription', 270),
  ('custom_reward', 'Récompense personnalisée', 'custom', 280)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Stack / cumul policy (configurable — no hardcoded product ifs)
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_stack_policies (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  -- Ordered application layers (config-driven)
  layer_order text[] not null default array[
    'catalog','partner','automatic','promo_code','coupon',
    'mmd_plus','mmd_credit','payment'
  ]::text[],
  stackable_with_loyalty boolean not null default true,
  stackable_with_mmd_plus boolean not null default true,
  stackable_with_mmd_credit boolean not null default true,
  stackable_with_coupon boolean not null default false,
  stackable_with_automatic boolean not null default true,
  stackable_with_cashback boolean not null default true,
  stackable_with_points_bonus boolean not null default true,
  max_total_discount_pct numeric(8, 4),
  max_total_discount_cents integer,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_marketing_stack_policies_updated_at on public.marketing_stack_policies;
create trigger trg_marketing_stack_policies_updated_at
before update on public.marketing_stack_policies
for each row execute function public.taxi_set_updated_at();

insert into public.marketing_stack_policies (code, name, description)
values (
  'default',
  'Politique de cumul par défaut',
  'Catalogue → partenaire → auto → code/coupon → MMD+ → Crédit MMD → paiement'
)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 3) Campaigns
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  campaign_type text not null references public.marketing_campaign_types (key),
  status text not null default 'draft' check (
    status in ('draft', 'scheduled', 'active', 'suspended', 'ended', 'canceled')
  ),
  priority integer not null default 100,
  stack_policy_id uuid references public.marketing_stack_policies (id) on delete set null,
  -- Scope
  services text[] not null default array['all']::text[],
  audiences text[] not null default array['client']::text[],
  country_code text,
  region text,
  city text,
  geofence jsonb not null default '{}'::jsonb,
  partner_type text check (
    partner_type is null or partner_type in ('restaurant', 'seller', 'driver', 'platform')
  ),
  partner_user_id uuid references public.profiles (id) on delete set null,
  product_id uuid,
  category_key text,
  -- Timing
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'America/New_York',
  active_days int[] not null default array[0,1,2,3,4,5,6]::int[],
  active_hours_start time,
  active_hours_end time,
  -- Economics
  currency text not null default 'USD',
  min_order_cents integer not null default 0,
  max_order_cents integer,
  discount_percent numeric(8, 4),
  discount_cents integer,
  max_discount_cents integer,
  -- Caps
  per_user_limit integer,
  per_user_daily_limit integer,
  global_usage_limit integer,
  daily_usage_limit integer,
  budget_total_cents integer,
  budget_spent_cents integer not null default 0,
  budget_reserved_cents integer not null default 0,
  -- Funding
  funder text not null default 'mmd' check (
    funder in ('mmd', 'partner', 'shared', 'sponsor')
  ),
  mmd_funding_pct numeric(8, 4) not null default 100,
  partner_funding_pct numeric(8, 4) not null default 0,
  -- Flags
  requires_code boolean not null default false,
  auto_apply boolean not null default false,
  requires_mmd_plus boolean not null default false,
  first_order_only boolean not null default false,
  stackable boolean not null default false,
  visible boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_campaigns_code_uq unique (code)
);

create index if not exists marketing_campaigns_status_idx
  on public.marketing_campaigns (status, starts_at, ends_at);
create index if not exists marketing_campaigns_type_idx
  on public.marketing_campaigns (campaign_type, status);
create index if not exists marketing_campaigns_partner_idx
  on public.marketing_campaigns (partner_type, partner_user_id)
  where partner_user_id is not null;
create index if not exists marketing_campaigns_geo_idx
  on public.marketing_campaigns (country_code, city)
  where status in ('active', 'scheduled');

drop trigger if exists trg_marketing_campaigns_updated_at on public.marketing_campaigns;
create trigger trg_marketing_campaigns_updated_at
before update on public.marketing_campaigns
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4) Conditions (config rows — extensible)
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_campaign_conditions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns (id) on delete cascade,
  condition_key text not null,
  operator text not null default 'eq' check (
    operator in ('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'contains', 'exists')
  ),
  value_text text,
  value_numeric numeric(18, 4),
  value_boolean boolean,
  value_json jsonb,
  created_at timestamptz not null default now()
);

create index if not exists marketing_campaign_conditions_campaign_idx
  on public.marketing_campaign_conditions (campaign_id);

-- ---------------------------------------------------------------------------
-- 5) Promo codes
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_promo_codes (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns (id) on delete cascade,
  code_normalized text not null,
  code_display text not null,
  kind text not null default 'public' check (
    kind in ('public', 'private', 'unique_user', 'bulk')
  ),
  status text not null default 'active' check (
    status in ('active', 'inactive', 'revoked', 'expired')
  ),
  assigned_user_id uuid references public.profiles (id) on delete set null,
  max_redemptions integer,
  redemption_count integer not null default 0,
  reserved_count integer not null default 0,
  per_user_limit integer default 1,
  min_order_cents integer,
  max_discount_cents integer,
  starts_at timestamptz,
  ends_at timestamptz,
  guessable boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_promo_codes_norm_uq unique (code_normalized)
);

create index if not exists marketing_promo_codes_campaign_idx
  on public.marketing_promo_codes (campaign_id, status);

drop trigger if exists trg_marketing_promo_codes_updated_at on public.marketing_promo_codes;
create trigger trg_marketing_promo_codes_updated_at
before update on public.marketing_promo_codes
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 6) Individual coupons (client wallet)
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_coupons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  campaign_id uuid not null references public.marketing_campaigns (id) on delete restrict,
  promo_code_id uuid references public.marketing_promo_codes (id) on delete set null,
  status text not null default 'available' check (
    status in ('available', 'reserved', 'used', 'expired', 'revoked', 'refunded', 'canceled')
  ),
  services text[] not null default array['all']::text[],
  value_cents integer,
  value_percent numeric(8, 4),
  usage_count integer not null default 0,
  usage_limit integer not null default 1,
  source text not null default 'campaign',
  reason text,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  used_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists marketing_coupons_user_idx
  on public.marketing_coupons (user_id, status);
create index if not exists marketing_coupons_expiry_idx
  on public.marketing_coupons (status, expires_at)
  where status = 'available';

drop trigger if exists trg_marketing_coupons_updated_at on public.marketing_coupons;
create trigger trg_marketing_coupons_updated_at
before update on public.marketing_coupons
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 7) Reservations (checkout hold)
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_reservations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  campaign_id uuid not null references public.marketing_campaigns (id) on delete restrict,
  promo_code_id uuid references public.marketing_promo_codes (id) on delete set null,
  coupon_id uuid references public.marketing_coupons (id) on delete set null,
  service text not null check (
    service in ('food', 'delivery', 'taxi', 'marketplace')
  ),
  entity_type text not null,
  entity_id text not null,
  status text not null default 'reserved' check (
    status in ('reserved', 'captured', 'released', 'expired', 'reversed')
  ),
  discount_cents integer not null default 0,
  delivery_fee_discount_cents integer not null default 0,
  cashback_cents integer not null default 0,
  points_bonus integer not null default 0,
  currency text not null default 'USD',
  budget_reserved_cents integer not null default 0,
  explanation jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  captured_at timestamptz,
  released_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_reservations_idem_uq unique (idempotency_key)
);

create index if not exists marketing_reservations_entity_idx
  on public.marketing_reservations (entity_type, entity_id, status);
create index if not exists marketing_reservations_expiry_idx
  on public.marketing_reservations (status, expires_at)
  where status = 'reserved';

drop trigger if exists trg_marketing_reservations_updated_at on public.marketing_reservations;
create trigger trg_marketing_reservations_updated_at
before update on public.marketing_reservations
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 8) Final applications (immutable history)
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_applications (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.marketing_reservations (id) on delete set null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  campaign_id uuid not null references public.marketing_campaigns (id) on delete restrict,
  promo_code_id uuid references public.marketing_promo_codes (id) on delete set null,
  coupon_id uuid references public.marketing_coupons (id) on delete set null,
  service text not null,
  entity_type text not null,
  entity_id text not null,
  kind text not null default 'capture' check (
    kind in ('capture', 'reverse', 'refund')
  ),
  discount_cents integer not null default 0,
  delivery_fee_discount_cents integer not null default 0,
  cashback_cents integer not null default 0,
  points_bonus integer not null default 0,
  mmd_funded_cents integer not null default 0,
  partner_funded_cents integer not null default 0,
  currency text not null default 'USD',
  explanation jsonb not null default '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz not null default now()
);

create unique index if not exists marketing_applications_idem_uq
  on public.marketing_applications (idempotency_key)
  where idempotency_key is not null;
create index if not exists marketing_applications_entity_idx
  on public.marketing_applications (entity_type, entity_id);
create index if not exists marketing_applications_campaign_idx
  on public.marketing_applications (campaign_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 9) Financial snapshots (immutable per order)
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_order_snapshots (
  id uuid primary key default gen_random_uuid(),
  service text not null,
  entity_type text not null,
  entity_id text not null,
  user_id uuid references public.profiles (id) on delete set null,
  currency text not null default 'USD',
  catalog_cents integer not null default 0,
  partner_discount_cents integer not null default 0,
  automatic_discount_cents integer not null default 0,
  promo_discount_cents integer not null default 0,
  coupon_discount_cents integer not null default 0,
  mmd_plus_discount_cents integer not null default 0,
  mmd_credit_cents integer not null default 0,
  total_discount_cents integer not null default 0,
  amount_paid_cents integer not null default 0,
  mmd_funded_cents integer not null default 0,
  partner_funded_cents integer not null default 0,
  commission_cents integer,
  payout_cents integer,
  campaigns_applied jsonb not null default '[]'::jsonb,
  stack_policy_code text,
  engine_version text not null default 'marketing_v1',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint marketing_order_snapshots_entity_uq unique (entity_type, entity_id)
);

-- ---------------------------------------------------------------------------
-- 10) Cashback ledger (separate, never card refund)
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_cashback_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  campaign_id uuid references public.marketing_campaigns (id) on delete set null,
  application_id uuid references public.marketing_applications (id) on delete set null,
  service text,
  entity_type text,
  entity_id text,
  entry_type text not null check (
    entry_type in ('accrual', 'release', 'expire', 'clawback')
  ),
  amount_cents integer not null,
  currency text not null default 'USD',
  destination text not null default 'mmd_credit' check (
    destination in ('mmd_credit', 'other_wallet')
  ),
  status text not null default 'pending' check (
    status in ('pending', 'available', 'credited', 'expired', 'clawed_back')
  ),
  available_at timestamptz,
  expires_at timestamptz,
  credited_at timestamptz,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists marketing_cashback_ledger_idem_uq
  on public.marketing_cashback_ledger (idempotency_key)
  where idempotency_key is not null;
create index if not exists marketing_cashback_ledger_user_idx
  on public.marketing_cashback_ledger (user_id, status);
create index if not exists marketing_cashback_ledger_credit_idx
  on public.marketing_cashback_ledger (status, available_at)
  where status = 'pending';

-- ---------------------------------------------------------------------------
-- 11) Driver campaign objectives
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_driver_objectives (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns (id) on delete cascade,
  title text not null,
  description text,
  target_count integer not null default 1,
  reward_cents integer not null default 0,
  reward_points integer not null default 0,
  country_code text,
  city text,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'active' check (
    status in ('draft', 'active', 'ended', 'canceled')
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.marketing_driver_progress (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid not null references public.marketing_driver_objectives (id) on delete cascade,
  driver_user_id uuid not null references public.profiles (id) on delete cascade,
  progress_count integer not null default 0,
  status text not null default 'in_progress' check (
    status in ('in_progress', 'completed', 'rewarded', 'expired')
  ),
  rewarded_at timestamptz,
  reward_ledger_ref text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint marketing_driver_progress_uq unique (objective_id, driver_user_id)
);

-- ---------------------------------------------------------------------------
-- 12) Partner campaign requests (restaurant / seller)
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_partner_requests (
  id uuid primary key default gen_random_uuid(),
  partner_type text not null check (partner_type in ('restaurant', 'seller')),
  partner_user_id uuid not null references public.profiles (id) on delete cascade,
  campaign_id uuid references public.marketing_campaigns (id) on delete set null,
  title text not null,
  description text,
  proposed_budget_cents integer,
  currency text not null default 'USD',
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'rejected', 'active', 'ended', 'canceled')
  ),
  reviewed_by uuid references public.profiles (id) on delete set null,
  review_notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_marketing_partner_requests_updated_at on public.marketing_partner_requests;
create trigger trg_marketing_partner_requests_updated_at
before update on public.marketing_partner_requests
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 13) Lightweight stats counters
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_campaign_stats (
  campaign_id uuid primary key references public.marketing_campaigns (id) on delete cascade,
  impressions integer not null default 0,
  views integer not null default 0,
  code_attempts integer not null default 0,
  code_accepted integer not null default 0,
  reservations integer not null default 0,
  captures integer not null default 0,
  refunds integer not null default 0,
  discount_cents_total integer not null default 0,
  mmd_funded_cents_total integer not null default 0,
  partner_funded_cents_total integer not null default 0,
  fraud_flags integer not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 14) Fraud signals (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_fraud_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  campaign_id uuid references public.marketing_campaigns (id) on delete set null,
  signal_type text not null,
  severity text not null default 'info' check (
    severity in ('info', 'warn', 'block')
  ),
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists marketing_fraud_signals_user_idx
  on public.marketing_fraud_signals (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 15) Audit (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.marketing_audit (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  campaign_id uuid,
  old_value jsonb,
  new_value jsonb,
  reason text,
  ip_address text,
  correlation_id text,
  source text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists marketing_audit_campaign_idx
  on public.marketing_audit (campaign_id, created_at desc);
create index if not exists marketing_audit_entity_idx
  on public.marketing_audit (entity_type, entity_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 16) Additive columns on orders / delivery / taxi / marketplace (snapshots)
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists marketing_discount_cents integer not null default 0,
  add column if not exists marketing_reservation_id uuid,
  add column if not exists marketing_campaign_ids uuid[] not null default '{}'::uuid[];

alter table public.delivery_requests
  add column if not exists marketing_discount_cents integer not null default 0,
  add column if not exists marketing_reservation_id uuid,
  add column if not exists marketing_campaign_ids uuid[] not null default '{}'::uuid[];

alter table public.taxi_rides
  add column if not exists marketing_discount_cents integer not null default 0,
  add column if not exists marketing_reservation_id uuid,
  add column if not exists marketing_campaign_ids uuid[] not null default '{}'::uuid[];

do $$
begin
  if to_regclass('public.seller_orders') is not null then
    alter table public.seller_orders
      add column if not exists marketing_discount_cents integer not null default 0,
      add column if not exists marketing_reservation_id uuid,
      add column if not exists marketing_campaign_ids uuid[] not null default '{}'::uuid[];
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 17) Seed a few starter campaigns (inactive draft / scheduled examples)
-- ---------------------------------------------------------------------------
insert into public.marketing_campaigns (
  code, name, description, campaign_type, status, priority,
  services, audiences, auto_apply, discount_percent, max_discount_cents,
  min_order_cents, currency, visible, starts_at, ends_at
)
select
  'welcome_food_10',
  'Bienvenue Food -10%',
  'Réduction automatique première commande Food (brouillon — activer en admin)',
  'first_order_offer',
  'draft',
  50,
  array['food']::text[],
  array['client','new_clients']::text[],
  true,
  10,
  1500,
  1500,
  'USD',
  true,
  now(),
  now() + interval '365 days'
where not exists (
  select 1 from public.marketing_campaigns where code = 'welcome_food_10'
);

insert into public.marketing_campaigns (
  code, name, description, campaign_type, status, priority,
  services, audiences, auto_apply, requires_mmd_plus,
  discount_percent, max_discount_cents, currency, visible
)
select
  'mmdplus_exclusive_5',
  'MMD+ Exclusive -5%',
  'Offre exclusive abonnés MMD+ (brouillon)',
  'subscription_exclusive_offer',
  'draft',
  40,
  array['food','delivery','taxi','marketplace']::text[],
  array['client','mmd_plus']::text[],
  true,
  true,
  5,
  2000,
  'USD',
  true
where not exists (
  select 1 from public.marketing_campaigns where code = 'mmdplus_exclusive_5'
);

-- ---------------------------------------------------------------------------
-- 18) RLS
-- ---------------------------------------------------------------------------
alter table public.marketing_campaign_types enable row level security;
alter table public.marketing_stack_policies enable row level security;
alter table public.marketing_campaigns enable row level security;
alter table public.marketing_campaign_conditions enable row level security;
alter table public.marketing_promo_codes enable row level security;
alter table public.marketing_coupons enable row level security;
alter table public.marketing_reservations enable row level security;
alter table public.marketing_applications enable row level security;
alter table public.marketing_order_snapshots enable row level security;
alter table public.marketing_cashback_ledger enable row level security;
alter table public.marketing_driver_objectives enable row level security;
alter table public.marketing_driver_progress enable row level security;
alter table public.marketing_partner_requests enable row level security;
alter table public.marketing_campaign_stats enable row level security;
alter table public.marketing_fraud_signals enable row level security;
alter table public.marketing_audit enable row level security;

drop policy if exists marketing_campaign_types_select on public.marketing_campaign_types;
create policy marketing_campaign_types_select
on public.marketing_campaign_types for select to authenticated
using (active = true or public.is_staff_user(auth.uid()));

drop policy if exists marketing_stack_policies_select on public.marketing_stack_policies;
create policy marketing_stack_policies_select
on public.marketing_stack_policies for select to authenticated
using (active = true or public.is_staff_user(auth.uid()));

drop policy if exists marketing_campaigns_select on public.marketing_campaigns;
create policy marketing_campaigns_select
on public.marketing_campaigns for select to authenticated
using (
  (status in ('active', 'scheduled') and visible = true)
  or public.is_staff_user(auth.uid())
  or (partner_user_id = auth.uid())
);

drop policy if exists marketing_promo_codes_select on public.marketing_promo_codes;
create policy marketing_promo_codes_select
on public.marketing_promo_codes for select to authenticated
using (
  (kind = 'public' and status = 'active')
  or assigned_user_id = auth.uid()
  or public.is_staff_user(auth.uid())
);

drop policy if exists marketing_coupons_select_own on public.marketing_coupons;
create policy marketing_coupons_select_own
on public.marketing_coupons for select to authenticated
using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists marketing_reservations_select_own on public.marketing_reservations;
create policy marketing_reservations_select_own
on public.marketing_reservations for select to authenticated
using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists marketing_applications_select_own on public.marketing_applications;
create policy marketing_applications_select_own
on public.marketing_applications for select to authenticated
using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists marketing_cashback_select_own on public.marketing_cashback_ledger;
create policy marketing_cashback_select_own
on public.marketing_cashback_ledger for select to authenticated
using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists marketing_driver_objectives_select on public.marketing_driver_objectives;
create policy marketing_driver_objectives_select
on public.marketing_driver_objectives for select to authenticated
using (status = 'active' or public.is_staff_user(auth.uid()));

drop policy if exists marketing_driver_progress_select_own on public.marketing_driver_progress;
create policy marketing_driver_progress_select_own
on public.marketing_driver_progress for select to authenticated
using (driver_user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists marketing_partner_requests_select_own on public.marketing_partner_requests;
create policy marketing_partner_requests_select_own
on public.marketing_partner_requests for select to authenticated
using (partner_user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists marketing_campaign_stats_staff on public.marketing_campaign_stats;
create policy marketing_campaign_stats_staff
on public.marketing_campaign_stats for select to authenticated
using (public.is_staff_user(auth.uid()));

drop policy if exists marketing_fraud_signals_staff on public.marketing_fraud_signals;
create policy marketing_fraud_signals_staff
on public.marketing_fraud_signals for select to authenticated
using (public.is_staff_user(auth.uid()));

drop policy if exists marketing_audit_staff on public.marketing_audit;
create policy marketing_audit_staff
on public.marketing_audit for select to authenticated
using (public.is_staff_user(auth.uid()));

drop policy if exists marketing_order_snapshots_select on public.marketing_order_snapshots;
create policy marketing_order_snapshots_select
on public.marketing_order_snapshots for select to authenticated
using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists marketing_campaign_conditions_select on public.marketing_campaign_conditions;
create policy marketing_campaign_conditions_select
on public.marketing_campaign_conditions for select to authenticated
using (
  exists (
    select 1 from public.marketing_campaigns c
    where c.id = campaign_id
      and (
        (c.status in ('active', 'scheduled') and c.visible = true)
        or public.is_staff_user(auth.uid())
        or c.partner_user_id = auth.uid()
      )
  )
);

commit;
