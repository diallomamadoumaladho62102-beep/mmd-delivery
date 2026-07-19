-- ===========================================================================
-- MMD+ — Phase 6 — Client premium subscriptions
-- ---------------------------------------------------------------------------
-- Independent commercial product for clients. Does NOT touch loyalty, MMD
-- Credit, commissions, or partner (restaurant/seller) subscriptions.
-- One subscription covers Food, Delivery, Taxi, and Marketplace.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Benefit / feature catalogue (config-driven application rules)
-- ---------------------------------------------------------------------------
create table if not exists public.mmd_plus_features (
  key text primary key,
  label text not null,
  description text,
  value_type text not null default 'boolean' check (
    value_type in ('boolean', 'integer', 'numeric', 'text', 'json')
  ),
  -- How the benefit engine applies this feature at checkout (no product ifs)
  apply_as text not null default 'flag' check (
    apply_as in (
      'flag',
      'delivery_fee_zero',
      'delivery_fee_zero_min_order',
      'delivery_fee_pct',
      'order_pct',
      'taxi_pct',
      'marketplace_pct',
      'food_pct',
      'delivery_pct',
      'cashback_pct',
      'loyalty_points_bonus_pct',
      'none'
    )
  ),
  service_scopes text[] not null default array['all']::text[],
  category text not null default 'general',
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.mmd_plus_features
  (key, label, category, value_type, apply_as, service_scopes, sort_order)
values
  ('free_delivery', 'Livraison gratuite', 'delivery', 'boolean', 'delivery_fee_zero',
    array['food','delivery','marketplace'], 10),
  ('free_delivery_min_order', 'Livraison gratuite à partir d''un montant', 'delivery', 'numeric',
    'delivery_fee_zero_min_order', array['food','delivery','marketplace'], 20),
  ('delivery_discount_pct', 'Réduction livraison (%)', 'delivery', 'numeric', 'delivery_fee_pct',
    array['food','delivery','marketplace'], 30),
  ('taxi_discount_pct', 'Réduction Taxi (%)', 'taxi', 'numeric', 'taxi_pct',
    array['taxi'], 40),
  ('marketplace_discount_pct', 'Réduction Marketplace (%)', 'marketplace', 'numeric', 'marketplace_pct',
    array['marketplace'], 50),
  ('food_discount_pct', 'Réduction Food (%)', 'food', 'numeric', 'food_pct',
    array['food'], 60),
  ('delivery_service_discount_pct', 'Réduction Delivery (%)', 'delivery', 'numeric', 'delivery_pct',
    array['delivery'], 70),
  ('cashback_pct', 'Cashback (%)', 'rewards', 'numeric', 'cashback_pct',
    array['all'], 80),
  ('loyalty_points_bonus_pct', 'Bonus de points fidélité (%)', 'rewards', 'numeric',
    'loyalty_points_bonus_pct', array['all'], 90),
  ('birthday_gifts', 'Cadeaux anniversaire', 'perks', 'boolean', 'flag',
    array['all'], 100),
  ('early_access_promos', 'Accès anticipé aux promotions', 'perks', 'boolean', 'flag',
    array['all'], 110),
  ('exclusive_promos', 'Promotions exclusives', 'perks', 'boolean', 'flag',
    array['all'], 120),
  ('priority_support', 'Priorité support', 'support', 'boolean', 'flag',
    array['all'], 130),
  ('priority_orders', 'Priorité commandes', 'ops', 'boolean', 'flag',
    array['food','delivery','marketplace'], 140),
  ('partner_offers', 'Offres partenaires', 'perks', 'boolean', 'flag',
    array['all'], 150)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Plans catalogue
-- ---------------------------------------------------------------------------
create table if not exists public.mmd_plus_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'USD',
  billing_period text not null check (billing_period in ('monthly', 'yearly')),
  trial_enabled boolean not null default false,
  trial_days integer not null default 0 check (trial_days >= 0),
  status text not null default 'draft' check (
    status in ('draft', 'active', 'retired')
  ),
  country_code text,
  city text,
  color text,
  sort_order integer not null default 0,
  visible boolean not null default true,
  stripe_product_id text,
  stripe_price_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists mmd_plus_plans_market_code_uq
  on public.mmd_plus_plans (code, billing_period, coalesce(country_code, ''));

drop trigger if exists trg_mmd_plus_plans_updated_at on public.mmd_plus_plans;
create trigger trg_mmd_plus_plans_updated_at
before update on public.mmd_plus_plans
for each row execute function public.taxi_set_updated_at();

insert into public.mmd_plus_plans
  (code, name, description, price_cents, currency, billing_period, status, sort_order, visible, trial_enabled, trial_days, color)
values
  ('basic', 'MMD+ Basic', 'Livraison réduite et avantages essentiels', 499, 'USD', 'monthly', 'active', 1, true, true, 7, '#64748B'),
  ('plus', 'MMD+ Plus', 'Livraison gratuite et réductions multi-services', 999, 'USD', 'monthly', 'active', 2, true, true, 7, '#0EA5E9'),
  ('premium', 'MMD+ Premium', 'Tous les avantages + priorité et bonus fidélité', 1499, 'USD', 'monthly', 'active', 3, true, true, 14, '#F59E0B'),
  ('basic', 'MMD+ Basic (annuel)', 'Basic facturé annuellement', 4990, 'USD', 'yearly', 'active', 1, true, true, 7, '#64748B'),
  ('plus', 'MMD+ Plus (annuel)', 'Plus facturé annuellement', 9990, 'USD', 'yearly', 'active', 2, true, true, 7, '#0EA5E9'),
  ('premium', 'MMD+ Premium (annuel)', 'Premium facturé annuellement', 14990, 'USD', 'yearly', 'active', 3, true, true, 14, '#F59E0B')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3) Plan ↔ feature matrix
-- ---------------------------------------------------------------------------
create table if not exists public.mmd_plus_plan_features (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.mmd_plus_plans (id) on delete cascade,
  feature_key text not null references public.mmd_plus_features (key) on delete cascade,
  enabled boolean not null default true,
  value_boolean boolean,
  value_integer integer,
  value_numeric numeric(14, 4),
  value_text text,
  value_json jsonb,
  created_at timestamptz not null default now(),
  constraint mmd_plus_plan_features_uq unique (plan_id, feature_key)
);

do $seed_mmd_plus$
declare
  v_plan record;
begin
  for v_plan in
    select id, code from public.mmd_plus_plans where status = 'active'
  loop
    -- Basic: delivery discount + priority support flag
    if v_plan.code = 'basic' then
      insert into public.mmd_plus_plan_features (plan_id, feature_key, enabled, value_boolean, value_numeric)
      values
        (v_plan.id, 'delivery_discount_pct', true, null, 25),
        (v_plan.id, 'priority_support', true, true, null),
        (v_plan.id, 'early_access_promos', true, true, null)
      on conflict (plan_id, feature_key) do nothing;
    end if;

    if v_plan.code = 'plus' then
      insert into public.mmd_plus_plan_features (plan_id, feature_key, enabled, value_boolean, value_numeric)
      values
        (v_plan.id, 'free_delivery', true, true, null),
        (v_plan.id, 'taxi_discount_pct', true, null, 10),
        (v_plan.id, 'marketplace_discount_pct', true, null, 5),
        (v_plan.id, 'food_discount_pct', true, null, 5),
        (v_plan.id, 'priority_support', true, true, null),
        (v_plan.id, 'exclusive_promos', true, true, null),
        (v_plan.id, 'early_access_promos', true, true, null)
      on conflict (plan_id, feature_key) do nothing;
    end if;

    if v_plan.code = 'premium' then
      insert into public.mmd_plus_plan_features (plan_id, feature_key, enabled, value_boolean, value_numeric)
      values
        (v_plan.id, 'free_delivery', true, true, null),
        (v_plan.id, 'taxi_discount_pct', true, null, 15),
        (v_plan.id, 'marketplace_discount_pct', true, null, 10),
        (v_plan.id, 'food_discount_pct', true, null, 10),
        (v_plan.id, 'delivery_service_discount_pct', true, null, 10),
        (v_plan.id, 'cashback_pct', true, null, 2),
        (v_plan.id, 'loyalty_points_bonus_pct', true, null, 25),
        (v_plan.id, 'birthday_gifts', true, true, null),
        (v_plan.id, 'priority_support', true, true, null),
        (v_plan.id, 'priority_orders', true, true, null),
        (v_plan.id, 'exclusive_promos', true, true, null),
        (v_plan.id, 'early_access_promos', true, true, null),
        (v_plan.id, 'partner_offers', true, true, null)
      on conflict (plan_id, feature_key) do nothing;
    end if;
  end loop;
end
$seed_mmd_plus$;

-- ---------------------------------------------------------------------------
-- 4) Active client subscriptions
-- ---------------------------------------------------------------------------
create table if not exists public.mmd_plus_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan_id uuid not null references public.mmd_plus_plans (id) on delete restrict,
  status text not null default 'incomplete' check (
    status in (
      'incomplete', 'trialing', 'active', 'past_due',
      'paused', 'canceled', 'expired', 'suspended'
    )
  ),
  starts_at timestamptz,
  ends_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  cancel_reason text,
  renews boolean not null default true,
  is_trial boolean not null default false,
  price_cents integer not null default 0 check (price_cents >= 0),
  currency text not null default 'USD',
  payment_method text,
  stripe_subscription_id text,
  stripe_customer_id text,
  stripe_price_id text,
  offered_by_admin boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists mmd_plus_subscriptions_stripe_sub_uq
  on public.mmd_plus_subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

create unique index if not exists mmd_plus_subscriptions_active_uq
  on public.mmd_plus_subscriptions (user_id)
  where status in ('active', 'trialing', 'past_due', 'paused');

create index if not exists mmd_plus_subscriptions_user_idx
  on public.mmd_plus_subscriptions (user_id, status);
create index if not exists mmd_plus_subscriptions_period_idx
  on public.mmd_plus_subscriptions (status, current_period_end);

drop trigger if exists trg_mmd_plus_subscriptions_updated_at on public.mmd_plus_subscriptions;
create trigger trg_mmd_plus_subscriptions_updated_at
before update on public.mmd_plus_subscriptions
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5) Active benefits (dedicated engine — not loyalty)
-- ---------------------------------------------------------------------------
create table if not exists public.mmd_plus_active_benefits (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.mmd_plus_subscriptions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  feature_key text not null references public.mmd_plus_features (key) on delete cascade,
  apply_as text not null,
  service_scopes text[] not null default array['all']::text[],
  value_boolean boolean,
  value_integer integer,
  value_numeric numeric(14, 4),
  value_text text,
  value_json jsonb,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'active' check (
    status in ('scheduled', 'active', 'expired', 'suspended', 'canceled')
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mmd_plus_active_benefits_user_idx
  on public.mmd_plus_active_benefits (user_id, status);
create index if not exists mmd_plus_active_benefits_sub_idx
  on public.mmd_plus_active_benefits (subscription_id, status);
create index if not exists mmd_plus_active_benefits_expiry_idx
  on public.mmd_plus_active_benefits (status, expires_at)
  where status in ('scheduled', 'active');

drop trigger if exists trg_mmd_plus_active_benefits_updated_at on public.mmd_plus_active_benefits;
create trigger trg_mmd_plus_active_benefits_updated_at
before update on public.mmd_plus_active_benefits
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 6) Benefit applications at checkout (idempotent audit trail)
-- ---------------------------------------------------------------------------
create table if not exists public.mmd_plus_benefit_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  subscription_id uuid references public.mmd_plus_subscriptions (id) on delete set null,
  service text not null check (
    service in ('food', 'delivery', 'taxi', 'marketplace')
  ),
  entity_type text not null,
  entity_id text not null,
  adjustments jsonb not null default '{}'::jsonb,
  delivery_fee_discount_cents integer not null default 0,
  order_discount_cents integer not null default 0,
  currency text not null default 'USD',
  idempotency_key text,
  created_at timestamptz not null default now()
);

create unique index if not exists mmd_plus_benefit_applications_idem_uq
  on public.mmd_plus_benefit_applications (idempotency_key)
  where idempotency_key is not null;
create index if not exists mmd_plus_benefit_applications_entity_idx
  on public.mmd_plus_benefit_applications (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- 7) Billing history
-- ---------------------------------------------------------------------------
create table if not exists public.mmd_plus_invoices (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.mmd_plus_subscriptions (id) on delete set null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (
    kind in ('invoice', 'payment', 'refund', 'credit', 'tax')
  ),
  status text not null default 'open' check (
    status in ('draft', 'open', 'paid', 'void', 'uncollectible', 'refunded', 'failed')
  ),
  amount_cents integer not null default 0,
  tax_cents integer not null default 0,
  currency text not null default 'USD',
  description text,
  stripe_invoice_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  period_start timestamptz,
  period_end timestamptz,
  paid_at timestamptz,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists mmd_plus_invoices_idem_uq
  on public.mmd_plus_invoices (idempotency_key)
  where idempotency_key is not null;
create unique index if not exists mmd_plus_invoices_stripe_inv_uq
  on public.mmd_plus_invoices (stripe_invoice_id)
  where stripe_invoice_id is not null;
create index if not exists mmd_plus_invoices_user_idx
  on public.mmd_plus_invoices (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 8) Webhook idempotency
-- ---------------------------------------------------------------------------
create table if not exists public.mmd_plus_webhook_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  processed_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- 9) Audit (append-only — never delete)
-- ---------------------------------------------------------------------------
create table if not exists public.mmd_plus_audit (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  user_id uuid,
  old_value jsonb,
  new_value jsonb,
  reason text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mmd_plus_audit_entity_idx
  on public.mmd_plus_audit (entity_type, entity_id, created_at desc);
create index if not exists mmd_plus_audit_user_idx
  on public.mmd_plus_audit (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 10) RLS
-- ---------------------------------------------------------------------------
alter table public.mmd_plus_features enable row level security;
alter table public.mmd_plus_plans enable row level security;
alter table public.mmd_plus_plan_features enable row level security;
alter table public.mmd_plus_subscriptions enable row level security;
alter table public.mmd_plus_active_benefits enable row level security;
alter table public.mmd_plus_benefit_applications enable row level security;
alter table public.mmd_plus_invoices enable row level security;
alter table public.mmd_plus_webhook_events enable row level security;
alter table public.mmd_plus_audit enable row level security;

drop policy if exists mmd_plus_features_select on public.mmd_plus_features;
create policy mmd_plus_features_select
on public.mmd_plus_features for select to authenticated
using (active = true or public.is_staff_user(auth.uid()));

drop policy if exists mmd_plus_plans_select on public.mmd_plus_plans;
create policy mmd_plus_plans_select
on public.mmd_plus_plans for select to authenticated
using (
  (status = 'active' and visible = true)
  or public.is_staff_user(auth.uid())
);

drop policy if exists mmd_plus_plan_features_select on public.mmd_plus_plan_features;
create policy mmd_plus_plan_features_select
on public.mmd_plus_plan_features for select to authenticated
using (true);

drop policy if exists mmd_plus_subscriptions_select_own on public.mmd_plus_subscriptions;
create policy mmd_plus_subscriptions_select_own
on public.mmd_plus_subscriptions for select to authenticated
using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists mmd_plus_active_benefits_select_own on public.mmd_plus_active_benefits;
create policy mmd_plus_active_benefits_select_own
on public.mmd_plus_active_benefits for select to authenticated
using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists mmd_plus_benefit_applications_select_own on public.mmd_plus_benefit_applications;
create policy mmd_plus_benefit_applications_select_own
on public.mmd_plus_benefit_applications for select to authenticated
using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists mmd_plus_invoices_select_own on public.mmd_plus_invoices;
create policy mmd_plus_invoices_select_own
on public.mmd_plus_invoices for select to authenticated
using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists mmd_plus_webhook_events_staff on public.mmd_plus_webhook_events;
create policy mmd_plus_webhook_events_staff
on public.mmd_plus_webhook_events for select to authenticated
using (public.is_staff_user(auth.uid()));

drop policy if exists mmd_plus_audit_staff on public.mmd_plus_audit;
create policy mmd_plus_audit_staff
on public.mmd_plus_audit for select to authenticated
using (public.is_staff_user(auth.uid()));

-- Optional taxi application column (additive — does not alter taxi pricing RPCs)
alter table public.taxi_rides
  add column if not exists mmd_plus_discount_cents integer not null default 0;

commit;
