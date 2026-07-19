-- ===========================================================================
-- MMD Subscriptions — Phase 5
-- ---------------------------------------------------------------------------
-- Commercial subscription product for restaurants & marketplace sellers.
-- Independent from loyalty and from the commission engine. Subscription
-- benefits live in dedicated tables (not loyalty_accounts / loyalty ledgers).
-- Architecture is partner-type extensible (driver / business later).
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Feature catalogue (config-driven — no hardcoded product ifs)
-- ---------------------------------------------------------------------------
create table if not exists public.subscription_features (
  key text primary key,
  label text not null,
  description text,
  value_type text not null default 'boolean' check (
    value_type in ('boolean', 'integer', 'numeric', 'text', 'json')
  ),
  category text not null default 'general',
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.subscription_features (key, label, category, value_type, sort_order) values
  ('advanced_stats', 'Statistiques avancées', 'analytics', 'boolean', 10),
  ('export_csv', 'Export CSV', 'analytics', 'boolean', 20),
  ('export_pdf', 'Export PDF', 'analytics', 'boolean', 30),
  ('marketing_campaigns', 'Campagnes marketing', 'marketing', 'boolean', 40),
  ('sponsored_campaigns', 'Campagnes sponsorisées', 'marketing', 'boolean', 50),
  ('premium_badge', 'Badge Premium', 'visibility', 'boolean', 60),
  ('priority_visibility', 'Visibilité prioritaire', 'visibility', 'boolean', 70),
  ('sponsored_products', 'Produits sponsorisés', 'visibility', 'boolean', 80),
  ('advanced_promotions', 'Promotions avancées', 'marketing', 'boolean', 90),
  ('api_access', 'Accès API', 'platform', 'boolean', 100),
  ('multi_users', 'Accès multi-utilisateurs', 'platform', 'integer', 110),
  ('financial_reports', 'Rapports financiers', 'analytics', 'boolean', 120),
  ('unlimited_history', 'Historique illimité', 'platform', 'boolean', 130),
  ('priority_support', 'Support prioritaire', 'support', 'boolean', 140),
  ('commission_discount_pct', 'Réduction de commission (%)', 'pricing', 'numeric', 150),
  ('fee_discount_pct', 'Réduction de frais (%)', 'pricing', 'numeric', 160),
  ('custom_limits', 'Limites personnalisées', 'platform', 'json', 170)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Plans catalogue
-- ---------------------------------------------------------------------------
create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  partner_type text not null check (
    partner_type in ('restaurant', 'seller', 'driver', 'business')
  ),
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
  category text,
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

create unique index if not exists subscription_plans_market_code_uq
  on public.subscription_plans (partner_type, code, billing_period, coalesce(country_code, ''));

drop trigger if exists trg_subscription_plans_updated_at on public.subscription_plans;
create trigger trg_subscription_plans_updated_at
before update on public.subscription_plans
for each row execute function public.taxi_set_updated_at();

-- Seed starter plans (no Stripe IDs yet — prepared architecture)
insert into public.subscription_plans
  (partner_type, code, name, description, price_cents, currency, billing_period, status, sort_order, visible)
values
  ('restaurant', 'basic', 'Basic', 'Essentiel pour démarrer', 0, 'USD', 'monthly', 'active', 1, true),
  ('restaurant', 'standard', 'Standard', 'Outils marketing et stats', 2999, 'USD', 'monthly', 'active', 2, true),
  ('restaurant', 'pro', 'Pro', 'Visibilité et campagnes avancées', 7999, 'USD', 'monthly', 'active', 3, true),
  ('restaurant', 'premium', 'Premium', 'Toutes les fonctionnalités + support prioritaire', 14999, 'USD', 'monthly', 'active', 4, true),
  ('restaurant', 'standard', 'Standard (annuel)', 'Standard facturé annuellement', 29990, 'USD', 'yearly', 'active', 2, true),
  ('restaurant', 'pro', 'Pro (annuel)', 'Pro facturé annuellement', 79990, 'USD', 'yearly', 'active', 3, true),
  ('restaurant', 'premium', 'Premium (annuel)', 'Premium facturé annuellement', 149990, 'USD', 'yearly', 'active', 4, true),
  ('seller', 'starter', 'Starter', 'Démarrage Marketplace', 0, 'USD', 'monthly', 'active', 1, true),
  ('seller', 'business', 'Business', 'Croissance et stats', 1999, 'USD', 'monthly', 'active', 2, true),
  ('seller', 'pro', 'Pro', 'Visibilité et promotions', 5999, 'USD', 'monthly', 'active', 3, true),
  ('seller', 'enterprise', 'Enterprise', 'API, multi-users, support prioritaire', 19999, 'USD', 'monthly', 'active', 4, true),
  ('seller', 'business', 'Business (annuel)', 'Business facturé annuellement', 19990, 'USD', 'yearly', 'active', 2, true),
  ('seller', 'pro', 'Pro (annuel)', 'Pro facturé annuellement', 59990, 'USD', 'yearly', 'active', 3, true),
  ('seller', 'enterprise', 'Enterprise (annuel)', 'Enterprise facturé annuellement', 199990, 'USD', 'yearly', 'active', 4, true)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3) Plan ↔ feature entitlements (configuration matrix)
-- ---------------------------------------------------------------------------
create table if not exists public.subscription_plan_features (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.subscription_plans (id) on delete cascade,
  feature_key text not null references public.subscription_features (key) on delete cascade,
  enabled boolean not null default true,
  value_boolean boolean,
  value_integer integer,
  value_numeric numeric(14, 4),
  value_text text,
  value_json jsonb,
  created_at timestamptz not null default now(),
  constraint subscription_plan_features_uq unique (plan_id, feature_key)
);

-- Seed feature entitlements for paid restaurant / seller plans (config-driven)
do $seed_features$
declare
  v_plan record;
begin
  for v_plan in
    select id, partner_type, code from public.subscription_plans
    where status = 'active' and code in ('standard', 'pro', 'premium', 'business', 'enterprise')
  loop
    insert into public.subscription_plan_features (plan_id, feature_key, enabled, value_boolean)
    values
      (v_plan.id, 'advanced_stats', true, true),
      (v_plan.id, 'export_csv', true, true),
      (v_plan.id, 'premium_badge', true, true)
    on conflict (plan_id, feature_key) do nothing;

    if v_plan.code in ('pro', 'premium', 'enterprise') then
      insert into public.subscription_plan_features (plan_id, feature_key, enabled, value_boolean)
      values
        (v_plan.id, 'export_pdf', true, true),
        (v_plan.id, 'marketing_campaigns', true, true),
        (v_plan.id, 'priority_visibility', true, true),
        (v_plan.id, 'financial_reports', true, true)
      on conflict (plan_id, feature_key) do nothing;
    end if;

    if v_plan.code in ('premium', 'enterprise') then
      insert into public.subscription_plan_features (plan_id, feature_key, enabled, value_boolean, value_numeric)
      values
        (v_plan.id, 'sponsored_campaigns', true, true, null),
        (v_plan.id, 'api_access', true, true, null),
        (v_plan.id, 'priority_support', true, true, null),
        (v_plan.id, 'unlimited_history', true, true, null),
        (v_plan.id, 'commission_discount_pct', true, null, 2)
      on conflict (plan_id, feature_key) do nothing;

      insert into public.subscription_plan_features (plan_id, feature_key, enabled, value_integer)
      values (v_plan.id, 'multi_users', true, 5)
      on conflict (plan_id, feature_key) do nothing;
    end if;
  end loop;
end
$seed_features$;

-- ---------------------------------------------------------------------------
-- 4) Active / historical subscriptions
-- ---------------------------------------------------------------------------
create table if not exists public.partner_subscriptions (
  id uuid primary key default gen_random_uuid(),
  partner_type text not null check (
    partner_type in ('restaurant', 'seller', 'driver', 'business')
  ),
  partner_user_id uuid not null references public.profiles (id) on delete cascade,
  plan_id uuid not null references public.subscription_plans (id) on delete restrict,
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

create unique index if not exists partner_subscriptions_stripe_sub_uq
  on public.partner_subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- At most one active/trialing subscription per partner+type
create unique index if not exists partner_subscriptions_active_uq
  on public.partner_subscriptions (partner_type, partner_user_id)
  where status in ('active', 'trialing', 'past_due', 'paused');

create index if not exists partner_subscriptions_partner_idx
  on public.partner_subscriptions (partner_type, partner_user_id, status);
create index if not exists partner_subscriptions_period_idx
  on public.partner_subscriptions (status, current_period_end);

drop trigger if exists trg_partner_subscriptions_updated_at on public.partner_subscriptions;
create trigger trg_partner_subscriptions_updated_at
before update on public.partner_subscriptions
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5) Dedicated subscription benefits (NOT loyalty — parallel engine)
-- ---------------------------------------------------------------------------
create table if not exists public.subscription_active_benefits (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.partner_subscriptions (id) on delete cascade,
  partner_type text not null,
  partner_user_id uuid not null references public.profiles (id) on delete cascade,
  benefit_type text not null check (
    benefit_type in (
      'commission_discount', 'fee_discount', 'priority_visibility',
      'premium_badge', 'sponsored_campaigns', 'advanced_stats', 'custom'
    )
  ),
  benefit_value numeric(14, 4) not null default 0,
  benefit_currency text not null default 'USD',
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'active' check (
    status in ('scheduled', 'active', 'expired', 'suspended', 'canceled')
  ),
  source_feature_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscription_active_benefits_partner_idx
  on public.subscription_active_benefits (partner_type, partner_user_id, status);
create index if not exists subscription_active_benefits_sub_idx
  on public.subscription_active_benefits (subscription_id, status);

drop trigger if exists trg_subscription_active_benefits_updated_at on public.subscription_active_benefits;
create trigger trg_subscription_active_benefits_updated_at
before update on public.subscription_active_benefits
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 6) Billing history (invoices / payments / refunds / credits)
-- ---------------------------------------------------------------------------
create table if not exists public.subscription_invoices (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.partner_subscriptions (id) on delete set null,
  partner_type text not null,
  partner_user_id uuid not null references public.profiles (id) on delete cascade,
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

create unique index if not exists subscription_invoices_idem_uq
  on public.subscription_invoices (idempotency_key)
  where idempotency_key is not null;
create unique index if not exists subscription_invoices_stripe_inv_uq
  on public.subscription_invoices (stripe_invoice_id)
  where stripe_invoice_id is not null;
create index if not exists subscription_invoices_partner_idx
  on public.subscription_invoices (partner_type, partner_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 7) Webhook event log (idempotency for Stripe Billing)
-- ---------------------------------------------------------------------------
create table if not exists public.subscription_webhook_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  processed_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------------
-- 8) Audit (never delete)
-- ---------------------------------------------------------------------------
create table if not exists public.subscription_audit (
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

create index if not exists subscription_audit_entity_idx
  on public.subscription_audit (entity_type, entity_id, created_at desc);
create index if not exists subscription_audit_partner_idx
  on public.subscription_audit (partner_type, partner_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 9) RLS
-- ---------------------------------------------------------------------------
alter table public.subscription_features enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.subscription_plan_features enable row level security;
alter table public.partner_subscriptions enable row level security;
alter table public.subscription_active_benefits enable row level security;
alter table public.subscription_invoices enable row level security;
alter table public.subscription_webhook_events enable row level security;
alter table public.subscription_audit enable row level security;

drop policy if exists subscription_features_select on public.subscription_features;
create policy subscription_features_select
on public.subscription_features for select to authenticated
using (active = true or public.is_staff_user(auth.uid()));

drop policy if exists subscription_plans_select on public.subscription_plans;
create policy subscription_plans_select
on public.subscription_plans for select to authenticated
using (
  (status = 'active' and visible = true)
  or public.is_staff_user(auth.uid())
);

drop policy if exists subscription_plan_features_select on public.subscription_plan_features;
create policy subscription_plan_features_select
on public.subscription_plan_features for select to authenticated
using (true);

drop policy if exists partner_subscriptions_select_own on public.partner_subscriptions;
create policy partner_subscriptions_select_own
on public.partner_subscriptions for select to authenticated
using (partner_user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists subscription_active_benefits_select_own on public.subscription_active_benefits;
create policy subscription_active_benefits_select_own
on public.subscription_active_benefits for select to authenticated
using (partner_user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists subscription_invoices_select_own on public.subscription_invoices;
create policy subscription_invoices_select_own
on public.subscription_invoices for select to authenticated
using (partner_user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists subscription_webhook_events_staff on public.subscription_webhook_events;
create policy subscription_webhook_events_staff
on public.subscription_webhook_events for select to authenticated
using (public.is_staff_user(auth.uid()));

drop policy if exists subscription_audit_staff on public.subscription_audit;
create policy subscription_audit_staff
on public.subscription_audit for select to authenticated
using (public.is_staff_user(auth.uid()));

commit;
