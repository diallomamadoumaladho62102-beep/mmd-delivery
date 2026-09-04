-- Partner SCT clawback / recovery after customer refund or lost dispute.
-- Stripe Transfer reverse is SoT when it succeeds; failed reverse (e.g. funds
-- already Instant/bank paid out of Connect) must never be silent — row stays
-- reconcile_required with the exact amount still owed to the platform.

begin;

create table if not exists public.partner_transfer_recoveries (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  stripe_transfer_id text not null,
  stripe_reversal_id text,
  refund_id text,
  dispute_id text,
  target text,
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  currency text not null default 'USD',
  status text not null
    check (status in ('reversed', 'already_reversed', 'reconcile_required')),
  failure_code text,
  failure_message text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_transfer_recoveries_idempotency_uq unique (idempotency_key)
);

create index if not exists partner_transfer_recoveries_entity_idx
  on public.partner_transfer_recoveries (entity_type, entity_id);

create index if not exists partner_transfer_recoveries_transfer_idx
  on public.partner_transfer_recoveries (stripe_transfer_id);

create index if not exists partner_transfer_recoveries_status_idx
  on public.partner_transfer_recoveries (status)
  where status = 'reconcile_required';

alter table public.partner_transfer_recoveries enable row level security;

drop policy if exists partner_transfer_recoveries_service on public.partner_transfer_recoveries;
create policy partner_transfer_recoveries_service
  on public.partner_transfer_recoveries
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.partner_transfer_recoveries from public, anon, authenticated;
grant all on table public.partner_transfer_recoveries to service_role;

commit;
