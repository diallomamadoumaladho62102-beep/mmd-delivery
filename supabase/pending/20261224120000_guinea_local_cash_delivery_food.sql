-- Guinea local cash for delivery requests and food orders (no Orange Money).
-- Adds payment_method; payment_status text values 'pending_cash' / 'cash_collected'.
-- If a payment_status CHECK constraint exists in the target database for these
-- tables, it must also allow 'pending_cash' and 'cash_collected'.
-- Does not touch historical rows, Stripe flows, or US markets.
-- Not applied. Do not run this file with supabase db push.

begin;

alter table public.delivery_requests
  add column if not exists payment_method text;

alter table public.orders
  add column if not exists payment_method text;

alter table public.delivery_requests
  drop constraint if exists delivery_requests_payment_method_check;
alter table public.delivery_requests
  add constraint delivery_requests_payment_method_check
  check (payment_method is null or payment_method in ('card', 'cash', 'orange_money', 'stripe'));

alter table public.orders
  drop constraint if exists orders_payment_method_check;
alter table public.orders
  add constraint orders_payment_method_check
  check (payment_method is null or payment_method in ('card', 'cash', 'orange_money', 'stripe'));

-- Widen payment_status CHECKs when present (text columns may already allow any value).
alter table public.delivery_requests
  drop constraint if exists delivery_requests_payment_status_check;
alter table public.orders
  drop constraint if exists orders_payment_status_check;

-- wallet_ledger.reference_type 'cash_collection' and the one-per-reference unique
-- index come from 20261017120000_guinea_cash_taxi.sql (also pending).

commit;
