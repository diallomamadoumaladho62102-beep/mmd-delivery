-- Taxi pay-then-create: store quote checkout intents until Stripe confirms payment.
-- No taxi_rides row until payment succeeds.

create table if not exists public.taxi_checkout_intents (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'checkout_open', 'paid', 'expired', 'cancelled', 'failed')),
  currency text not null default 'USD',
  amount_cents integer not null check (amount_cents > 0),
  quote_hash text not null,
  snapshot jsonb not null,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  taxi_ride_id uuid references public.taxi_rides (id) on delete set null,
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists taxi_checkout_intents_session_uq
  on public.taxi_checkout_intents (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create unique index if not exists taxi_checkout_intents_pi_uq
  on public.taxi_checkout_intents (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create index if not exists taxi_checkout_intents_client_pending_idx
  on public.taxi_checkout_intents (client_user_id, status, expires_at);

comment on table public.taxi_checkout_intents is
  'Server-side taxi quote snapshot for Stripe Checkout. Ride is created only after payment confirmation.';

alter table public.taxi_checkout_intents enable row level security;

-- Service role / backend only; no client policies.
drop policy if exists taxi_checkout_intents_deny_all on public.taxi_checkout_intents;
create policy taxi_checkout_intents_deny_all
  on public.taxi_checkout_intents
  for all
  using (false)
  with check (false);

grant select, insert, update, delete on public.taxi_checkout_intents to service_role;
