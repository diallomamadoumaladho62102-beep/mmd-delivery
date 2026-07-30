-- Pay-then-create intents for Food orders and Package delivery requests.
-- No operational orders/delivery_requests until Stripe payment succeeds.

create table if not exists public.food_checkout_intents (
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
  order_id uuid references public.orders (id) on delete set null,
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists food_checkout_intents_session_uq
  on public.food_checkout_intents (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create unique index if not exists food_checkout_intents_pi_uq
  on public.food_checkout_intents (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create index if not exists food_checkout_intents_client_pending_idx
  on public.food_checkout_intents (client_user_id, status, expires_at);

comment on table public.food_checkout_intents is
  'Food quote snapshot for Stripe Checkout. Order is created only after payment confirmation.';

alter table public.food_checkout_intents enable row level security;

drop policy if exists food_checkout_intents_deny_all on public.food_checkout_intents;
create policy food_checkout_intents_deny_all
  on public.food_checkout_intents
  for all
  using (false)
  with check (false);

grant select, insert, update, delete on public.food_checkout_intents to service_role;

create table if not exists public.delivery_checkout_intents (
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
  delivery_request_id uuid references public.delivery_requests (id) on delete set null,
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists delivery_checkout_intents_session_uq
  on public.delivery_checkout_intents (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create unique index if not exists delivery_checkout_intents_pi_uq
  on public.delivery_checkout_intents (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create index if not exists delivery_checkout_intents_client_pending_idx
  on public.delivery_checkout_intents (client_user_id, status, expires_at);

comment on table public.delivery_checkout_intents is
  'Package delivery quote snapshot for Stripe Checkout. Request is created only after payment confirmation.';

alter table public.delivery_checkout_intents enable row level security;

drop policy if exists delivery_checkout_intents_deny_all on public.delivery_checkout_intents;
create policy delivery_checkout_intents_deny_all
  on public.delivery_checkout_intents
  for all
  using (false)
  with check (false);

grant select, insert, update, delete on public.delivery_checkout_intents to service_role;
