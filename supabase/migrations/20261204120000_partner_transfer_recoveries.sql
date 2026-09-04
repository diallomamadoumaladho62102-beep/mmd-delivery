-- Partner SCT clawback / recovery after customer refund or lost dispute.
-- Status model (financial SoT):
--   reversed          = Stripe createReversal succeeded this attempt
--   already_reversed  = Stripe already had the transfer reversed (idempotent)
--   recovery_required = reverse failed (e.g. Instant/Sunday bank already paid out)
--   recovered         = RESERVED for explicit ops confirmation after non-Stripe
--                       recovery — NEVER set by automatic clawback code
-- Never mark recovered unless money was actually recovered.

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
    check (status in (
      'reversed',
      'already_reversed',
      'recovery_required',
      'recovered'
    )),
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
  where status = 'recovery_required';

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
