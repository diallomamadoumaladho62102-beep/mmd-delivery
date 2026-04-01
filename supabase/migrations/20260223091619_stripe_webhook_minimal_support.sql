-- stripe_webhook_minimal_support
-- Creates minimal tables + RPC needed by supabase/functions/stripe_webhook
-- Safe to run on local. Idempotent where possible.

begin;

-- 1) ORDERS table (minimal columns used by your webhook code)
create table if not exists public.orders (
  id uuid primary key,

  -- amounts (webhook reads total_cents OR grand_total OR total)
  total_cents integer,
  grand_total numeric,
  total numeric,

  currency text default 'usd',

  -- statuses
  payment_status text default 'unpaid',

  -- stripe refs
  stripe_session_id text,
  stripe_payment_intent_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- optional helpful index
create index if not exists orders_payment_status_idx
  on public.orders(payment_status);

-- 2) stripe_webhook_events audit table used by auditEvent()
create table if not exists public.stripe_webhook_events (
  id bigserial primary key,
  stripe_event_id text not null,
  event_type text not null,
  livemode boolean not null default false,

  order_id uuid null,
  stripe_session_id text null,
  stripe_payment_intent_id text null,

  payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create unique index if not exists stripe_webhook_events_event_id_uq
  on public.stripe_webhook_events(stripe_event_id);

-- 3) keep updated_at fresh on orders (simple trigger)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_orders_set_updated_at on public.orders;
create trigger trg_orders_set_updated_at
before update on public.orders
for each row
execute function public.set_updated_at();

-- 4) RPC: apply_checkout_paid
-- We drop first to avoid PostgreSQL errors when an existing function
-- has different parameter defaults/signature metadata.
drop function if exists public.apply_checkout_paid(
  text,
  text,
  boolean,
  uuid,
  text,
  text,
  jsonb
);

create function public.apply_checkout_paid(
  p_event_id text,
  p_event_type text,
  p_livemode boolean,
  p_order_id uuid,
  p_session_id text,
  p_payment_intent_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already boolean;
begin
  -- idempotency: if we already processed this event, just return
  select exists(
    select 1
    from public.stripe_webhook_events
    where stripe_event_id = p_event_id
  )
  into v_already;

  if v_already then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'event_id', p_event_id
    );
  end if;

  -- audit event
  insert into public.stripe_webhook_events(
    stripe_event_id,
    event_type,
    livemode,
    order_id,
    stripe_session_id,
    stripe_payment_intent_id,
    payload
  )
  values (
    p_event_id,
    p_event_type,
    coalesce(p_livemode, false),
    p_order_id,
    p_session_id,
    p_payment_intent_id,
    coalesce(p_payload, '{}'::jsonb)
  );

  -- apply payment
  update public.orders
  set
    payment_status = 'paid',
    stripe_session_id = p_session_id,
    stripe_payment_intent_id = p_payment_intent_id
  where id = p_order_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'order_not_found',
      'order_id', p_order_id::text
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'paid', true,
    'order_id', p_order_id::text
  );
end;
$$;

-- 5) RPC: apply_checkout_failed_or_expired
drop function if exists public.apply_checkout_failed_or_expired(
  text,
  text,
  boolean,
  uuid,
  text,
  text,
  jsonb
);

create function public.apply_checkout_failed_or_expired(
  p_event_id text,
  p_event_type text,
  p_livemode boolean,
  p_order_id uuid,
  p_session_id text,
  p_payment_intent_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_already boolean;
begin
  -- idempotency: if we already processed this event, just return
  select exists(
    select 1
    from public.stripe_webhook_events
    where stripe_event_id = p_event_id
  )
  into v_already;

  if v_already then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'event_id', p_event_id
    );
  end if;

  -- audit event
  insert into public.stripe_webhook_events(
    stripe_event_id,
    event_type,
    livemode,
    order_id,
    stripe_session_id,
    stripe_payment_intent_id,
    payload
  )
  values (
    p_event_id,
    p_event_type,
    coalesce(p_livemode, false),
    p_order_id,
    p_session_id,
    p_payment_intent_id,
    coalesce(p_payload, '{}'::jsonb)
  );

  -- mark unpaid (or keep unpaid) for failed/expired
  update public.orders
  set
    payment_status = 'unpaid',
    stripe_session_id = coalesce(p_session_id, stripe_session_id),
    stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id)
  where id = p_order_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'order_not_found',
      'order_id', p_order_id::text
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'failed_or_expired', true,
    'order_id', p_order_id::text
  );
end;
$$;

commit;