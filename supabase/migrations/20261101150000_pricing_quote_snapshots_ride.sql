-- Phase 4: allow Ride service on pricing_quote_snapshots (ADR-001).

begin;

alter table public.pricing_quote_snapshots
  drop constraint if exists pricing_quote_snapshots_service_check;

alter table public.pricing_quote_snapshots
  add constraint pricing_quote_snapshots_service_check
  check (service in ('food', 'package', 'ride'));

comment on table public.pricing_quote_snapshots is
  'ADR-001 Phase 3–4: immutable quote snapshots for Food/Package/Ride engine charge path.';

commit;
