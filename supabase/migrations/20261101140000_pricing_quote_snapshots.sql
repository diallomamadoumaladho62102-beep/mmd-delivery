-- Phase 3: Quote Snapshot SoT for Food/Package engine charge path (ADR-001).
-- Ride/Marketplace not written here during Phase 3.

begin;

create table if not exists public.pricing_quote_snapshots (
  id bigserial primary key,
  snapshot_id uuid not null unique,
  service text not null check (service in ('food', 'package')),
  charge_path text not null check (charge_path in ('legacy', 'engine')),
  currency text not null,
  country_code text not null default 'US',
  customer_total_cents integer not null,
  pricing_version text not null,
  algorithm_semver text not null,
  legacy_version text,
  engine_version text,
  canary_key_hash text,
  quote_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pricing_quote_snapshots_created_idx
  on public.pricing_quote_snapshots (created_at desc);

create index if not exists pricing_quote_snapshots_service_idx
  on public.pricing_quote_snapshots (service, charge_path);

alter table public.pricing_quote_snapshots enable row level security;

drop policy if exists pricing_quote_snapshots_admin_read on public.pricing_quote_snapshots;
create policy pricing_quote_snapshots_admin_read
  on public.pricing_quote_snapshots
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.role = 'admin'
          or coalesce(p.is_founder, false) = true
        )
    )
  );

comment on table public.pricing_quote_snapshots is
  'ADR-001 Phase 3: immutable quote snapshots for Food/Package engine charge path.';

commit;
