-- Align food orders kitchen timestamps with app/API expectations.
-- Production historically lacked accepted_at / restaurant_accepted_at / dispatched_at.

alter table public.orders
  add column if not exists accepted_at timestamptz,
  add column if not exists restaurant_accepted_at timestamptz,
  add column if not exists dispatched_at timestamptz;

comment on column public.orders.accepted_at is
  'When the restaurant accepted a paid food order (alias used by command center / legacy clients).';
comment on column public.orders.restaurant_accepted_at is
  'When the restaurant accepted a paid food order.';
comment on column public.orders.dispatched_at is
  'When driver dispatch started for a ready food order.';
