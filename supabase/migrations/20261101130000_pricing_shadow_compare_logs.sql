-- Phase 2: Shadow Compare audit log (ADR-001).
-- No impact on charge path. Service role writes from API.

begin;

create table if not exists public.pricing_shadow_compare_logs (
  id bigserial primary key,
  compare_id uuid not null,
  service text not null,
  currency text not null,
  equal boolean not null,
  diff_cents integer not null default 0,
  legacy_total_cents integer not null,
  engine_total_cents integer not null,
  field_diffs jsonb not null default '[]'::jsonb,
  legacy_latency_ms integer,
  engine_latency_ms integer,
  legacy_version text,
  engine_version text,
  legacy_payload jsonb,
  engine_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pricing_shadow_compare_logs_created_idx
  on public.pricing_shadow_compare_logs (created_at desc);

create index if not exists pricing_shadow_compare_logs_equal_idx
  on public.pricing_shadow_compare_logs (equal, service);

alter table public.pricing_shadow_compare_logs enable row level security;

drop policy if exists pricing_shadow_compare_logs_admin_read on public.pricing_shadow_compare_logs;
create policy pricing_shadow_compare_logs_admin_read
  on public.pricing_shadow_compare_logs
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

comment on table public.pricing_shadow_compare_logs is
  'ADR-001 Phase 2: Legacy vs Pricing Engine shadow compare audit (not used for charging).';

commit;
