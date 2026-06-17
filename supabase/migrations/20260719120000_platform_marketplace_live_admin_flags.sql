-- Admin-controlled Marketplace live flags per country / region (default OFF)

begin;

alter table public.platform_countries
  add column if not exists marketplace_checkout_live_enabled boolean not null default false,
  add column if not exists marketplace_dispatch_live_enabled boolean not null default false,
  add column if not exists marketplace_payouts_live_enabled boolean not null default false;

alter table public.platform_regions
  add column if not exists marketplace_checkout_live_enabled boolean not null default false,
  add column if not exists marketplace_dispatch_live_enabled boolean not null default false,
  add column if not exists marketplace_payouts_live_enabled boolean not null default false;

comment on column public.platform_countries.marketplace_checkout_live_enabled is
  'Admin-only: regional Marketplace Stripe checkout live (requires env MARKETPLACE_CHECKOUT_LIVE_ENABLED).';
comment on column public.platform_countries.marketplace_dispatch_live_enabled is
  'Admin-only: regional Marketplace driver dispatch live (requires env MARKETPLACE_DISPATCH_LIVE_ENABLED).';
comment on column public.platform_countries.marketplace_payouts_live_enabled is
  'Admin-only: regional Marketplace seller/driver payouts live (requires env MARKETPLACE_PAYOUTS_LIVE_ENABLED).';

commit;
