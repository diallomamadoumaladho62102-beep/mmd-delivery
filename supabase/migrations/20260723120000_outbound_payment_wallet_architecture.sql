-- Outbound payment architecture: payout_methods, payout_transactions, wallet_ledger.
-- Inbound remains payment_methods + payment_transactions.

begin;

-- ---------------------------------------------------------------------------
-- 1) Clarify inbound payment_methods (client-only)
-- ---------------------------------------------------------------------------

alter table public.payment_methods
  add column if not exists flow_direction text not null default 'inbound';

alter table public.payment_methods
  add column if not exists recipient_type text not null default 'client';

alter table public.payment_methods
  drop constraint if exists payment_methods_flow_direction_check;

alter table public.payment_methods
  add constraint payment_methods_flow_direction_check
  check (flow_direction in ('inbound'));

alter table public.payment_methods
  drop constraint if exists payment_methods_recipient_type_check;

alter table public.payment_methods
  add constraint payment_methods_recipient_type_check
  check (recipient_type in ('client'));

-- Optional inbound charge categorization on transactions
alter table public.payment_transactions
  add column if not exists charge_category text;

alter table public.payment_transactions
  drop constraint if exists payment_transactions_charge_category_check;

alter table public.payment_transactions
  add constraint payment_transactions_charge_category_check
  check (
    charge_category is null
    or charge_category in (
      'food_order',
      'delivery',
      'taxi',
      'marketplace',
      'late_fee',
      'service_fee',
      'other'
    )
  );

-- ---------------------------------------------------------------------------
-- 2) payout_methods — outbound routing per country + recipient type
-- ---------------------------------------------------------------------------

create table if not exists public.payout_methods (
  id uuid primary key default gen_random_uuid(),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  recipient_type text not null check (
    recipient_type in ('driver', 'restaurant', 'seller', 'partner')
  ),
  provider text not null check (
    provider in (
      'stripe_connect',
      'orange_money_gn',
      'paydunya',
      'cinetpay',
      'bank_transfer',
      'wave',
      'mtn_momo',
      'moov_money',
      'free_money'
    )
  ),
  method_code text not null,
  display_name text not null,
  description text,
  sort_order integer not null default 100,
  enabled boolean not null default false,
  test_mode boolean not null default true,
  auto_payout_enabled boolean not null default false,
  payout_frequency text not null default 'manual' check (
    payout_frequency in ('immediate', 'daily', 'weekly', 'manual')
  ),
  minimum_payout_cents integer not null default 0 check (minimum_payout_cents >= 0),
  platform_commission_pct numeric(6, 2) not null default 0
    check (platform_commission_pct >= 0 and platform_commission_pct <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_code, recipient_type, method_code)
);

create index if not exists payout_methods_country_recipient_idx
  on public.payout_methods (country_code, recipient_type, enabled, sort_order);

drop trigger if exists trg_payout_methods_updated_at on public.payout_methods;
create trigger trg_payout_methods_updated_at
before update on public.payout_methods
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) payout_transactions — outbound disbursement ledger
-- ---------------------------------------------------------------------------

create table if not exists public.payout_transactions (
  id uuid primary key default gen_random_uuid(),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  recipient_type text not null check (
    recipient_type in ('driver', 'restaurant', 'seller', 'partner')
  ),
  recipient_user_id uuid not null,
  provider text not null,
  method_code text not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null,
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'processing', 'paid', 'failed', 'canceled')
  ),
  payout_mode text not null default 'automatic' check (
    payout_mode in ('automatic', 'manual')
  ),
  entity_type text check (
    entity_type is null
    or entity_type in ('order', 'delivery_request', 'taxi_ride', 'seller_order', 'marketplace_job')
  ),
  entity_id uuid,
  order_payout_id uuid references public.order_payouts (id) on delete set null,
  gross_amount_cents integer,
  platform_fee_cents integer not null default 0,
  net_amount_cents integer,
  external_reference text,
  destination_account text,
  failure_reason text,
  approved_at timestamptz,
  approved_by uuid,
  paid_at timestamptz,
  canceled_at timestamptz,
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payout_transactions_recipient_idx
  on public.payout_transactions (recipient_user_id, created_at desc);

create index if not exists payout_transactions_status_idx
  on public.payout_transactions (status, created_at desc);

create index if not exists payout_transactions_entity_idx
  on public.payout_transactions (entity_type, entity_id);

create index if not exists payout_transactions_order_payout_idx
  on public.payout_transactions (order_payout_id)
  where order_payout_id is not null;

drop trigger if exists trg_payout_transactions_updated_at on public.payout_transactions;
create trigger trg_payout_transactions_updated_at
before update on public.payout_transactions
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4) wallet_ledger — immutable money movement log
-- ---------------------------------------------------------------------------

create table if not exists public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  account_type text not null check (
    account_type in ('platform', 'driver', 'restaurant', 'seller', 'partner', 'client')
  ),
  account_user_id uuid,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  currency text not null,
  direction text not null check (direction in ('credit', 'debit')),
  amount_cents integer not null check (amount_cents > 0),
  balance_after_cents bigint,
  reference_type text not null check (
    reference_type in (
      'payment_transaction',
      'payout_transaction',
      'commission',
      'refund',
      'adjustment',
      'order_payout'
    )
  ),
  reference_id uuid not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists wallet_ledger_account_idx
  on public.wallet_ledger (account_type, account_user_id, created_at desc);

create index if not exists wallet_ledger_reference_idx
  on public.wallet_ledger (reference_type, reference_id);

-- ---------------------------------------------------------------------------
-- 5) Seed outbound methods (disabled/test by default except Stripe in US)
-- ---------------------------------------------------------------------------

insert into public.payout_methods (
  country_code, recipient_type, provider, method_code, display_name, description,
  sort_order, enabled, test_mode, auto_payout_enabled, payout_frequency, minimum_payout_cents, platform_commission_pct
)
values
  ('GN', 'driver', 'orange_money_gn', 'payout_orange_money_gn_driver', 'Orange Money', 'Driver payout via Orange Money Guinea', 1, true, true, false, 'manual', 5000, 0),
  ('GN', 'driver', 'bank_transfer', 'payout_bank_gn_driver', 'Bank transfer', 'Local bank transfer', 2, true, true, false, 'weekly', 10000, 0),
  ('GN', 'restaurant', 'orange_money_gn', 'payout_orange_money_gn_restaurant', 'Orange Money', 'Restaurant payout via Orange Money Guinea', 1, true, true, false, 'manual', 10000, 0),
  ('GN', 'restaurant', 'bank_transfer', 'payout_bank_gn_restaurant', 'Bank transfer', 'Local bank transfer', 2, true, true, false, 'weekly', 25000, 0),
  ('GN', 'seller', 'orange_money_gn', 'payout_orange_money_gn_seller', 'Orange Money', 'Marketplace seller payout', 1, true, true, false, 'manual', 10000, 0),
  ('SN', 'driver', 'paydunya', 'payout_paydunya_sn_driver', 'Wave / Orange / Free Money', 'Driver payout via PayDunya rails', 1, true, true, false, 'manual', 5000, 0),
  ('SN', 'driver', 'bank_transfer', 'payout_bank_sn_driver', 'Bank transfer', 'Local bank transfer', 2, true, true, false, 'weekly', 10000, 0),
  ('SN', 'restaurant', 'paydunya', 'payout_paydunya_sn_restaurant', 'Wave / Orange / Free Money', 'Restaurant payout via PayDunya', 1, true, true, false, 'manual', 10000, 0),
  ('CI', 'driver', 'cinetpay', 'payout_cinetpay_ci_driver', 'Orange / Wave / MTN / Moov', 'Driver payout via CinetPay', 1, true, true, false, 'manual', 5000, 0),
  ('CI', 'driver', 'paydunya', 'payout_paydunya_ci_driver', 'PayDunya mobile money', 'Alternative mobile payout', 2, false, true, false, 'manual', 5000, 0),
  ('CI', 'restaurant', 'cinetpay', 'payout_cinetpay_ci_restaurant', 'Orange / Wave / MTN / Moov', 'Restaurant payout via CinetPay', 1, true, true, false, 'manual', 10000, 0),
  ('US', 'driver', 'stripe_connect', 'payout_stripe_us_driver', 'Stripe Connect', 'Automatic Stripe Connect transfer', 1, true, false, true, 'immediate', 100, 0),
  ('US', 'restaurant', 'stripe_connect', 'payout_stripe_us_restaurant', 'Stripe Connect', 'Automatic Stripe Connect transfer', 1, true, false, true, 'immediate', 100, 0),
  ('US', 'seller', 'stripe_connect', 'payout_stripe_us_seller', 'Stripe Connect', 'Marketplace seller Stripe payout', 1, true, false, true, 'weekly', 100, 0)
on conflict (country_code, recipient_type, method_code) do nothing;

-- ---------------------------------------------------------------------------
-- 6) RLS
-- ---------------------------------------------------------------------------

alter table public.payout_methods enable row level security;
alter table public.payout_transactions enable row level security;
alter table public.wallet_ledger enable row level security;

drop policy if exists payout_methods_select_enabled on public.payout_methods;
create policy payout_methods_select_enabled
on public.payout_methods for select to authenticated
using (enabled = true);

drop policy if exists payout_transactions_select_own on public.payout_transactions;
create policy payout_transactions_select_own
on public.payout_transactions for select to authenticated
using (recipient_user_id = auth.uid());

drop policy if exists wallet_ledger_select_own on public.wallet_ledger;
create policy wallet_ledger_select_own
on public.wallet_ledger for select to authenticated
using (account_user_id = auth.uid());

commit;
