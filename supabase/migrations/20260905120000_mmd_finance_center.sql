-- Phase 9 — Central Finance Center (consolidation layer)
-- Does not replace operational ledgers. Do not apply to Production from this chat.

-- ---------------------------------------------------------------------------
-- 1) Legal entities & chart of accounts
-- ---------------------------------------------------------------------------
create table if not exists public.finance_legal_entities (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  country_code text not null default 'US',
  functional_currency text not null default 'USD',
  tax_id text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into public.finance_legal_entities (code, name, country_code, functional_currency)
values ('MMD_US', 'MMD Delivery LLC', 'US', 'USD')
on conflict (code) do nothing;

create table if not exists public.finance_account_categories (
  key text primary key,
  label text not null,
  normal_balance text not null check (normal_balance in ('debit', 'credit')),
  sort_order integer not null default 100
);

insert into public.finance_account_categories (key, label, normal_balance, sort_order) values
  ('asset', 'Actifs', 'debit', 10),
  ('liability', 'Passifs', 'credit', 20),
  ('equity', 'Capitaux propres', 'credit', 30),
  ('revenue', 'Revenus', 'credit', 40),
  ('expense', 'Charges', 'debit', 50)
on conflict (key) do nothing;

create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.finance_legal_entities (id) on delete restrict,
  code text not null,
  name text not null,
  category text not null references public.finance_account_categories (key),
  currency text,
  is_postable boolean not null default true,
  is_system boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_accounts_code_uq unique (legal_entity_id, code)
);

create index if not exists finance_accounts_category_idx
  on public.finance_accounts (category, status);

-- ---------------------------------------------------------------------------
-- 2) Periods
-- ---------------------------------------------------------------------------
create table if not exists public.finance_periods (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.finance_legal_entities (id) on delete restrict,
  code text not null,
  period_type text not null check (period_type in ('month', 'quarter', 'year', 'custom')),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'open'
    check (status in ('open', 'soft_closed', 'closed', 'locked')),
  closed_at timestamptz,
  closed_by uuid references public.profiles (id) on delete set null,
  checklist jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  constraint finance_periods_code_uq unique (legal_entity_id, code),
  constraint finance_periods_range_chk check (ends_on >= starts_on)
);

-- ---------------------------------------------------------------------------
-- 3) Source events (idempotent intake)
-- ---------------------------------------------------------------------------
create table if not exists public.finance_source_events (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id text not null,
  event_type text not null,
  event_version integer not null default 1,
  occurred_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'posted', 'skipped', 'failed', 'reversed', 'manual_review')),
  attempts integer not null default 0,
  last_error text,
  journal_entry_id uuid,
  correlation_id text,
  idempotency_key text not null,
  payload_snapshot jsonb not null default '{}'::jsonb,
  checksum text,
  vertical text,
  country_code text,
  currency text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_source_events_idem_uq unique (idempotency_key)
);

create index if not exists finance_source_events_status_idx
  on public.finance_source_events (status, created_at);
create index if not exists finance_source_events_source_idx
  on public.finance_source_events (source_type, source_id);

-- ---------------------------------------------------------------------------
-- 4) Journal (double-entry)
-- ---------------------------------------------------------------------------
create table if not exists public.finance_journal_entries (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.finance_legal_entities (id) on delete restrict,
  period_id uuid references public.finance_periods (id) on delete set null,
  entry_number text,
  accounting_date date not null,
  transaction_date timestamptz not null default now(),
  event_type text not null,
  source_type text,
  source_id text,
  source_event_id uuid references public.finance_source_events (id) on delete set null,
  vertical text,
  country_code text,
  city text,
  currency text not null default 'USD',
  status text not null default 'draft'
    check (status in ('draft', 'posted', 'reversed', 'void')),
  description text,
  correlation_id text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  reversed_entry_id uuid,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint finance_journal_entries_idem_uq unique (idempotency_key)
);

create index if not exists finance_journal_entries_date_idx
  on public.finance_journal_entries (accounting_date desc, status);
create index if not exists finance_journal_entries_source_idx
  on public.finance_journal_entries (source_type, source_id);

create table if not exists public.finance_journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references public.finance_journal_entries (id) on delete cascade,
  line_no integer not null default 1,
  account_id uuid not null references public.finance_accounts (id) on delete restrict,
  debit_cents bigint not null default 0 check (debit_cents >= 0),
  credit_cents bigint not null default 0 check (credit_cents >= 0),
  currency text not null default 'USD',
  original_amount_cents bigint,
  converted_amount_cents bigint,
  fx_rate numeric(18, 8),
  partner_type text,
  partner_user_id uuid,
  user_id uuid,
  entity_type text,
  entity_id text,
  cost_center text,
  dimensions jsonb not null default '{}'::jsonb,
  memo text,
  created_at timestamptz not null default now(),
  constraint finance_journal_lines_dc_chk check (
    (debit_cents > 0 and credit_cents = 0) or (credit_cents > 0 and debit_cents = 0)
  ),
  constraint finance_journal_lines_entry_line_uq unique (journal_entry_id, line_no)
);

create index if not exists finance_journal_lines_account_idx
  on public.finance_journal_lines (account_id, created_at desc);

alter table public.finance_source_events
  drop constraint if exists finance_source_events_journal_fk;
alter table public.finance_source_events
  add constraint finance_source_events_journal_fk
  foreign key (journal_entry_id) references public.finance_journal_entries (id) on delete set null;

alter table public.finance_journal_entries
  drop constraint if exists finance_journal_entries_reversed_fk;
alter table public.finance_journal_entries
  add constraint finance_journal_entries_reversed_fk
  foreign key (reversed_entry_id) references public.finance_journal_entries (id) on delete set null;

-- ---------------------------------------------------------------------------
-- 5) Balances snapshot
-- ---------------------------------------------------------------------------
create table if not exists public.finance_balances (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.finance_legal_entities (id) on delete restrict,
  account_id uuid not null references public.finance_accounts (id) on delete restrict,
  period_id uuid references public.finance_periods (id) on delete set null,
  as_of_date date not null,
  currency text not null default 'USD',
  debit_cents bigint not null default 0,
  credit_cents bigint not null default 0,
  balance_cents bigint not null default 0,
  computed_at timestamptz not null default now(),
  constraint finance_balances_uq unique (legal_entity_id, account_id, as_of_date, currency)
);

-- ---------------------------------------------------------------------------
-- 6) Adjustments & approvals
-- ---------------------------------------------------------------------------
create table if not exists public.finance_adjustments (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null references public.finance_legal_entities (id) on delete restrict,
  adjustment_type text not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'USD',
  debit_account_id uuid not null references public.finance_accounts (id),
  credit_account_id uuid not null references public.finance_accounts (id),
  reason text not null,
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'executed', 'canceled')),
  requires_dual_approval boolean not null default false,
  requested_by uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  rejected_by uuid references public.profiles (id) on delete set null,
  journal_entry_id uuid references public.finance_journal_entries (id) on delete set null,
  reference text,
  attachment_refs jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_approvals (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id uuid not null,
  action text not null,
  status text not null default 'pending_approval'
    check (status in ('draft', 'pending_approval', 'approved', 'rejected', 'executed', 'canceled')),
  requested_by uuid not null references public.profiles (id) on delete restrict,
  approved_by uuid references public.profiles (id) on delete set null,
  reason text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists finance_approvals_subject_idx
  on public.finance_approvals (subject_type, subject_id, status);

-- ---------------------------------------------------------------------------
-- 7) External transactions & reconciliation
-- ---------------------------------------------------------------------------
create table if not exists public.finance_external_transactions (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_account text,
  provider_transaction_id text not null,
  txn_type text not null,
  gross_amount_cents bigint not null default 0,
  fee_amount_cents bigint not null default 0,
  net_amount_cents bigint not null default 0,
  currency text not null default 'USD',
  status text,
  available_on date,
  settlement_id text,
  source_reference text,
  metadata jsonb not null default '{}'::jsonb,
  raw_reference text,
  occurred_at timestamptz,
  imported_at timestamptz not null default now(),
  constraint finance_external_txn_uq unique (provider, provider_transaction_id)
);

create table if not exists public.finance_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  legal_entity_id uuid references public.finance_legal_entities (id) on delete set null,
  period_start date not null,
  period_end date not null,
  currency text,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'canceled')),
  matched_count integer not null default 0,
  mismatch_count integer not null default 0,
  started_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  report jsonb not null default '{}'::jsonb
);

create table if not exists public.finance_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.finance_reconciliation_runs (id) on delete cascade,
  status text not null
    check (status in (
      'matched', 'partially_matched', 'missing_internal', 'missing_external',
      'amount_mismatch', 'currency_mismatch', 'duplicate', 'timing_difference',
      'manual_review', 'resolved'
    )),
  internal_ref text,
  external_txn_id uuid references public.finance_external_transactions (id) on delete set null,
  internal_amount_cents bigint,
  external_amount_cents bigint,
  currency text,
  notes text,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.finance_settlement_batches (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  legal_entity_id uuid references public.finance_legal_entities (id) on delete set null,
  currency text not null default 'USD',
  gross_cents bigint not null default 0,
  fees_cents bigint not null default 0,
  refunds_cents bigint not null default 0,
  chargebacks_cents bigint not null default 0,
  reserves_cents bigint not null default 0,
  net_cents bigint not null default 0,
  available_on date,
  settled_on date,
  bank_account_ref text,
  status text not null default 'expected'
    check (status in ('expected', 'in_transit', 'paid', 'partially_paid', 'failed', 'reconciled', 'closed')),
  external_settlement_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 8) Tax, FX, revenue recognition, disputes, imports/exports, audit
-- ---------------------------------------------------------------------------
create table if not exists public.finance_tax_records (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid references public.finance_legal_entities (id) on delete set null,
  entity_type text,
  entity_id text,
  jurisdiction_country text,
  jurisdiction_state text,
  jurisdiction_city text,
  tax_type text not null,
  rate_bps integer,
  taxable_base_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  currency text not null default 'USD',
  collected_from text,
  owed_by text,
  source_type text,
  source_id text,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.finance_exchange_rates (
  id uuid primary key default gen_random_uuid(),
  currency_from text not null,
  currency_to text not null,
  rate numeric(18, 8) not null check (rate > 0),
  effective_at timestamptz not null,
  source text not null default 'manual',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint finance_fx_uq unique (currency_from, currency_to, effective_at, source)
);

create table if not exists public.finance_revenue_schedules (
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid references public.finance_legal_entities (id) on delete set null,
  source_type text not null,
  source_id text not null,
  currency text not null default 'USD',
  total_billed_cents bigint not null default 0,
  recognized_cents bigint not null default 0,
  deferred_cents bigint not null default 0,
  recognition_method text not null default 'straight_line',
  starts_on date not null,
  ends_on date not null,
  status text not null default 'active'
    check (status in ('active', 'completed', 'canceled')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint finance_revenue_schedules_uq unique (source_type, source_id)
);

create table if not exists public.finance_disputes (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_dispute_id text not null,
  payment_ref text,
  client_user_id uuid,
  entity_type text,
  entity_id text,
  amount_cents bigint not null default 0,
  currency text not null default 'USD',
  reason text,
  status text not null default 'warning'
    check (status in ('warning', 'needs_response', 'under_review', 'won', 'lost', 'closed')),
  due_by timestamptz,
  fee_cents bigint not null default 0,
  amount_lost_cents bigint not null default 0,
  amount_recovered_cents bigint not null default 0,
  evidence_refs jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_disputes_uq unique (provider, provider_dispute_id)
);

create table if not exists public.finance_imports (
  id uuid primary key default gen_random_uuid(),
  import_type text not null,
  provider text,
  filename text,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'validated', 'previewed', 'imported', 'failed', 'canceled')),
  row_count integer not null default 0,
  error_count integer not null default 0,
  mapping jsonb not null default '{}'::jsonb,
  report jsonb not null default '{}'::jsonb,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.finance_report_exports (
  id uuid primary key default gen_random_uuid(),
  report_type text not null,
  format text not null check (format in ('csv', 'excel', 'pdf', 'json')),
  filters jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'ready', 'failed', 'expired')),
  row_count integer,
  file_ref text,
  expires_at timestamptz,
  requested_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.finance_reports (
  id uuid primary key default gen_random_uuid(),
  report_type text not null,
  legal_entity_id uuid references public.finance_legal_entities (id) on delete set null,
  period_id uuid references public.finance_periods (id) on delete set null,
  currency text,
  payload jsonb not null default '{}'::jsonb,
  generated_by uuid references public.profiles (id) on delete set null,
  generated_at timestamptz not null default now()
);

create table if not exists public.finance_audit (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  reason text,
  correlation_id text,
  idempotency_key text,
  ip_address text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists finance_audit_action_idx
  on public.finance_audit (action, created_at desc);

-- ---------------------------------------------------------------------------
-- 9) Seed chart of accounts (MMD_US)
-- ---------------------------------------------------------------------------
do $$
declare
  v_entity uuid;
begin
  select id into v_entity from public.finance_legal_entities where code = 'MMD_US' limit 1;
  if v_entity is null then return; end if;

  insert into public.finance_accounts (legal_entity_id, code, name, category, is_system) values
    (v_entity, '1010', 'Trésorerie Stripe', 'asset', true),
    (v_entity, '1020', 'Paiements en transit', 'asset', true),
    (v_entity, '1030', 'Trésorerie bancaire', 'asset', true),
    (v_entity, '1100', 'Créances clients', 'asset', true),
    (v_entity, '1200', 'Taxes récupérables', 'asset', true),
    (v_entity, '2010', 'Dû Chauffeurs', 'liability', true),
    (v_entity, '2020', 'Dû Restaurants', 'liability', true),
    (v_entity, '2030', 'Dû Vendeurs Marketplace', 'liability', true),
    (v_entity, '2100', 'Crédit MMD non consommé', 'liability', true),
    (v_entity, '2110', 'Cashback dû', 'liability', true),
    (v_entity, '2200', 'Revenus différés abonnements', 'liability', true),
    (v_entity, '2300', 'Taxes collectées', 'liability', true),
    (v_entity, '2400', 'Remboursements dus', 'liability', true),
    (v_entity, '2500', 'Chargebacks en attente', 'liability', true),
    (v_entity, '2600', 'Comptes d''attente', 'liability', true),
    (v_entity, '3000', 'Capitaux propres', 'equity', true),
    (v_entity, '3100', 'Résultat de la période', 'equity', true),
    (v_entity, '4010', 'Commissions Food', 'revenue', true),
    (v_entity, '4020', 'Commissions Delivery', 'revenue', true),
    (v_entity, '4030', 'Commissions Taxi', 'revenue', true),
    (v_entity, '4040', 'Commissions Marketplace', 'revenue', true),
    (v_entity, '4100', 'Frais de service', 'revenue', true),
    (v_entity, '4200', 'Abonnements MMD+', 'revenue', true),
    (v_entity, '4210', 'Abonnements partenaires', 'revenue', true),
    (v_entity, '4300', 'Frais d''annulation / attente', 'revenue', true),
    (v_entity, '4900', 'Autres revenus', 'revenue', true),
    (v_entity, '5010', 'Frais Stripe / paiements', 'expense', true),
    (v_entity, '5100', 'Promotions financées MMD', 'expense', true),
    (v_entity, '5200', 'Cashback', 'expense', true),
    (v_entity, '5300', 'Bonus Chauffeurs', 'expense', true),
    (v_entity, '5400', 'Remboursements non récupérables', 'expense', true),
    (v_entity, '5500', 'Chargebacks', 'expense', true),
    (v_entity, '5600', 'Ajustements', 'expense', true),
    (v_entity, '5900', 'Autres charges', 'expense', true)
  on conflict (legal_entity_id, code) do nothing;
end $$;

-- Open current month period
do $$
declare
  v_entity uuid;
  v_start date := date_trunc('month', timezone('utc', now()))::date;
  v_end date := (date_trunc('month', timezone('utc', now())) + interval '1 month - 1 day')::date;
  v_code text := to_char(timezone('utc', now()), 'YYYY-MM');
begin
  select id into v_entity from public.finance_legal_entities where code = 'MMD_US' limit 1;
  if v_entity is null then return; end if;
  insert into public.finance_periods (legal_entity_id, code, period_type, starts_on, ends_on, status)
  values (v_entity, v_code, 'month', v_start, v_end, 'open')
  on conflict (legal_entity_id, code) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- 10) RLS (staff via service_role APIs)
-- ---------------------------------------------------------------------------
alter table public.finance_legal_entities enable row level security;
alter table public.finance_accounts enable row level security;
alter table public.finance_periods enable row level security;
alter table public.finance_source_events enable row level security;
alter table public.finance_journal_entries enable row level security;
alter table public.finance_journal_lines enable row level security;
alter table public.finance_balances enable row level security;
alter table public.finance_adjustments enable row level security;
alter table public.finance_approvals enable row level security;
alter table public.finance_external_transactions enable row level security;
alter table public.finance_reconciliation_runs enable row level security;
alter table public.finance_reconciliation_items enable row level security;
alter table public.finance_settlement_batches enable row level security;
alter table public.finance_tax_records enable row level security;
alter table public.finance_exchange_rates enable row level security;
alter table public.finance_revenue_schedules enable row level security;
alter table public.finance_disputes enable row level security;
alter table public.finance_imports enable row level security;
alter table public.finance_report_exports enable row level security;
alter table public.finance_reports enable row level security;
alter table public.finance_audit enable row level security;
