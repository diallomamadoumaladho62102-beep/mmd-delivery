-- Country-based payment routing: mobile money (Africa) + Stripe (supported markets).
-- Provider secrets live in server env only — never in this table.

begin;

-- ---------------------------------------------------------------------------
-- 1) payment_methods — per-country provider configuration
-- ---------------------------------------------------------------------------

create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  provider text not null check (
    provider in ('stripe', 'orange_money_gn', 'paydunya', 'cinetpay')
  ),
  method_code text not null,
  display_name text not null,
  description text,
  sort_order integer not null default 100,
  enabled boolean not null default false,
  test_mode boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_code, method_code)
);

create index if not exists payment_methods_country_enabled_idx
  on public.payment_methods (country_code, enabled, sort_order);

drop trigger if exists trg_payment_methods_updated_at on public.payment_methods;
create trigger trg_payment_methods_updated_at
before update on public.payment_methods
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) payment_transactions — canonical payment ledger
-- ---------------------------------------------------------------------------

create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders (id) on delete set null,
  user_id uuid not null,
  entity_type text not null check (
    entity_type in ('order', 'delivery_request', 'taxi_ride', 'seller_order')
  ),
  entity_id uuid not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  provider text not null,
  method_code text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null,
  status text not null default 'pending' check (
    status in (
      'pending',
      'processing',
      'paid',
      'failed',
      'canceled',
      'expired',
      'manual_review'
    )
  ),
  external_reference text,
  payment_url text,
  provider_payload jsonb not null default '{}'::jsonb,
  payer_phone text,
  failure_reason text,
  paid_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_transactions_user_idx
  on public.payment_transactions (user_id, created_at desc);

create index if not exists payment_transactions_entity_idx
  on public.payment_transactions (entity_type, entity_id);

create index if not exists payment_transactions_external_ref_idx
  on public.payment_transactions (provider, external_reference)
  where external_reference is not null;

create index if not exists payment_transactions_status_idx
  on public.payment_transactions (status, created_at desc);

drop trigger if exists trg_payment_transactions_updated_at on public.payment_transactions;
create trigger trg_payment_transactions_updated_at
before update on public.payment_transactions
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) payment_webhook_events — idempotency for local provider callbacks
-- ---------------------------------------------------------------------------

create table if not exists public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_event_id text not null,
  payment_transaction_id uuid references public.payment_transactions (id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  unique (provider, external_event_id)
);

-- ---------------------------------------------------------------------------
-- 4) Seed default routing (Stripe off for Guinea by default)
-- ---------------------------------------------------------------------------

insert into public.payment_methods (
  country_code, provider, method_code, display_name, description, sort_order, enabled, test_mode
)
values
  (
    'GN',
    'orange_money_gn',
    'mobile_money_orange_gn',
    'Orange Money',
    'Pay with Orange Money Guinea',
    1,
    true,
    true
  ),
  (
    'SN',
    'paydunya',
    'mobile_money_sn',
    'Mobile Money',
    'Orange Money, Wave, and other mobile wallets via PayDunya',
    1,
    true,
    true
  ),
  (
    'CI',
    'cinetpay',
    'mobile_money_ci',
    'Mobile Money',
    'Pay with mobile money via CinetPay',
    1,
    true,
    true
  ),
  (
    'CI',
    'paydunya',
    'mobile_money_ci_paydunya',
    'Mobile Money (PayDunya)',
    'Alternative mobile money via PayDunya',
    2,
    false,
    true
  ),
  (
    'US',
    'stripe',
    'stripe_card',
    'Card',
    'Pay with debit or credit card',
    1,
    true,
    false
  ),
  (
    'CA',
    'stripe',
    'stripe_card',
    'Card',
    'Pay with debit or credit card',
    1,
    true,
    false
  ),
  (
    'GB',
    'stripe',
    'stripe_card',
    'Card',
    'Pay with debit or credit card',
    1,
    true,
    false
  ),
  (
    'FR',
    'stripe',
    'stripe_card',
    'Card',
    'Pay with debit or credit card',
    1,
    true,
    false
  )
on conflict (country_code, method_code) do nothing;

-- Optional Stripe for Guinea — disabled until admin enables row + env STRIPE_ENABLED_GN=true
insert into public.payment_methods (
  country_code, provider, method_code, display_name, description, sort_order, enabled, test_mode
)
values (
  'GN',
  'stripe',
  'stripe_card_gn',
  'Card (Stripe)',
  'International card — disabled by default in Guinea',
  99,
  false,
  false
)
on conflict (country_code, method_code) do nothing;

-- ---------------------------------------------------------------------------
-- 5) RLS
-- ---------------------------------------------------------------------------

alter table public.payment_methods enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.payment_webhook_events enable row level security;

drop policy if exists payment_methods_select_enabled on public.payment_methods;
create policy payment_methods_select_enabled
on public.payment_methods for select to authenticated
using (enabled = true);

drop policy if exists payment_transactions_select_own on public.payment_transactions;
create policy payment_transactions_select_own
on public.payment_transactions for select to authenticated
using (user_id = auth.uid());

commit;
