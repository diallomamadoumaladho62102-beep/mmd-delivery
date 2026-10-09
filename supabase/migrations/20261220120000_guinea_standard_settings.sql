-- Guinea Standard fare settings. Does not change USA taxi_pricing, XL, or wallet_ledger.
-- Initial row is the authorized default. Later admin edits are kept (on conflict do nothing).
-- Do not apply until explicitly authorized.

begin;

create table if not exists public.guinea_standard_settings (
  id text primary key,
  country_code text not null default 'GN' check (country_code = 'GN'),
  currency text not null default 'GNF' check (currency = 'GNF'),
  base_fare_gnf integer not null check (base_fare_gnf >= 0),
  per_km_gnf integer not null check (per_km_gnf >= 0),
  per_minute_gnf integer not null check (per_minute_gnf >= 0),
  minimum_fare_gnf integer not null check (minimum_fare_gnf >= 0),
  maximum_fare_gnf integer check (maximum_fare_gnf is null or maximum_fare_gnf >= 0),
  platform_share_bps integer not null check (platform_share_bps >= 0 and platform_share_bps <= 10000),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.guinea_standard_settings (
  id, country_code, currency,
  base_fare_gnf, per_km_gnf, per_minute_gnf, minimum_fare_gnf,
  platform_share_bps
)
values ('GN', 'GN', 'GNF', 1000, 2000, 500, 5000, 1500)
on conflict (id) do nothing;

create table if not exists public.guinea_standard_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.guinea_standard_settings enable row level security;
alter table public.guinea_standard_audit enable row level security;

revoke all on public.guinea_standard_settings from anon, authenticated;
revoke all on public.guinea_standard_audit from anon, authenticated;

commit;
