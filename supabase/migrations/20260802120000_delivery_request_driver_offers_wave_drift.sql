-- Idempotent prod-drift fix for delivery_request_driver_offers.
-- Root cause: the table pre-existed in production without the `wave` column, and
-- 20260602210000_delivery_request_driver_offers.sql only uses `create table if not exists`
-- (no follow-up `add column if not exists`), so the column was never backfilled.
-- The /api/cron/retry-delivery-request-dispatch route selects/orders by `wave`, which
-- caused: column delivery_request_driver_offers.wave does not exist (HTTP 500).
-- Mirrors the "idempotent for prod drift" pattern used by driver_order_offers.

begin;

alter table public.delivery_request_driver_offers
  add column if not exists wave integer not null default 1;

alter table public.delivery_request_driver_offers
  add column if not exists pickup_address text;

alter table public.delivery_request_driver_offers
  add column if not exists dropoff_address text;

alter table public.delivery_request_driver_offers
  add column if not exists driver_price_cents integer;

alter table public.delivery_request_driver_offers
  add column if not exists distance_miles numeric(8, 2);

alter table public.delivery_request_driver_offers
  add column if not exists eta_minutes integer;

alter table public.delivery_request_driver_offers
  add column if not exists updated_at timestamptz not null default now();

commit;
