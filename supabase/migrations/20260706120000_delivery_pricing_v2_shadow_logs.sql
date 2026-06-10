-- Delivery Pricing Engine V2 — shadow logs (V1 remains billing source of truth)

begin;

create table if not exists public.delivery_pricing_shadow_logs (
  id uuid primary key default gen_random_uuid(),
  source_type text not null
    check (source_type in ('delivery_request', 'food_order', 'marketplace_order_future')),
  source_id uuid,
  country_code text,
  region_code text,
  zone_code text,
  old_customer_total_cents integer not null,
  old_driver_earning_cents integer not null,
  v2_customer_total_cents integer not null,
  v2_driver_earning_cents integer not null,
  v2_platform_margin_cents integer not null,
  diff_customer_cents integer not null,
  diff_driver_cents integer not null,
  diff_margin_cents integer not null,
  pricing_engine_version text not null default 'v2_shadow',
  inputs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists delivery_pricing_shadow_logs_created_idx
  on public.delivery_pricing_shadow_logs (created_at desc);

create index if not exists delivery_pricing_shadow_logs_source_idx
  on public.delivery_pricing_shadow_logs (source_type, source_id);

alter table public.delivery_pricing_shadow_logs enable row level security;

drop policy if exists delivery_pricing_shadow_logs_staff_read on public.delivery_pricing_shadow_logs;
create policy delivery_pricing_shadow_logs_staff_read
on public.delivery_pricing_shadow_logs for select to authenticated
using (public.is_staff_user(auth.uid()));

-- Inserts are service_role only (backend shadow logger)
revoke all on table public.delivery_pricing_shadow_logs from anon, authenticated;
grant select on table public.delivery_pricing_shadow_logs to authenticated;
grant all on table public.delivery_pricing_shadow_logs to service_role;

commit;
