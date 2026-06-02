-- Phase 1 / S0-3: harden payment RPC grants and version missing payment RPCs.
-- Safe to re-run on staging/production (idempotent where possible).

begin;

-- ---------------------------------------------------------------------------
-- 0) Minimal schema guards used by payment RPCs (no-op if already present)
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists paid_at timestamptz;

alter table public.orders
  add column if not exists payment_status text default 'unpaid';

alter table public.orders
  add column if not exists stripe_session_id text;

alter table public.orders
  add column if not exists stripe_payment_intent_id text;

alter table public.orders
  add column if not exists driver_payout_id uuid;

alter table public.orders
  add column if not exists driver_paid_out boolean default false;

alter table public.orders
  add column if not exists driver_paid_out_at timestamptz;

alter table public.orders
  add column if not exists driver_transfer_id text;

alter table public.orders
  add column if not exists driver_delivery_payout numeric;

alter table public.orders
  add column if not exists tip_cents integer;

create table if not exists public.driver_payouts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'USD',
  status text not null default 'scheduled'
    check (status in ('scheduled', 'processing', 'paid', 'canceled', 'failed')),
  stripe_transfer_id text,
  stripe_payout_id text,
  scheduled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists driver_payouts_driver_id_created_at_idx
  on public.driver_payouts (driver_id, created_at desc);

do $$
begin
  if to_regclass('public.delivery_requests') is not null then
    alter table public.delivery_requests
      add column if not exists driver_payout_id uuid;

    alter table public.delivery_requests
      add column if not exists driver_paid_out boolean default false;

    alter table public.delivery_requests
      add column if not exists driver_paid_out_at timestamptz;

    alter table public.delivery_requests
      add column if not exists driver_delivery_payout numeric;

    alter table public.delivery_requests
      add column if not exists updated_at timestamptz default now();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) mark_order_paid — server/webhook only
-- ---------------------------------------------------------------------------

drop function if exists public.mark_order_paid(uuid, text, text);

create or replace function public.mark_order_paid(
  p_order_id uuid,
  p_session_id text default null,
  p_payment_intent_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_payment_status text;
begin
  update public.orders
  set
    payment_status = 'paid',
    paid_at = coalesce(paid_at, v_now),
    stripe_session_id = coalesce(p_session_id, stripe_session_id),
    stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
    updated_at = v_now
  where id = p_order_id
    and coalesce(payment_status, 'unpaid') <> 'paid';

  if found then
    return jsonb_build_object(
      'ok', true,
      'paid', true,
      'order_id', p_order_id::text
    );
  end if;

  select payment_status
  into v_payment_status
  from public.orders
  where id = p_order_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'order_not_found',
      'order_id', p_order_id::text
    );
  end if;

  if lower(coalesce(v_payment_status, '')) = 'paid' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'paid', true,
      'order_id', p_order_id::text
    );
  end if;

  return jsonb_build_object(
    'ok', false,
    'error', 'update_failed',
    'order_id', p_order_id::text
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) admin_pay_driver_now — called by pay-driver-now edge function (service role)
-- ---------------------------------------------------------------------------

drop function if exists public.admin_pay_driver_now(uuid, text);

create or replace function public.admin_pay_driver_now(
  p_driver_id uuid,
  p_currency text default 'USD'
)
returns table (
  payout_id uuid,
  payout_amount numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_currency text := upper(trim(coalesce(p_currency, 'USD')));
  v_min_cashout numeric := 20;
  v_available numeric := 0;
  v_new_payout_id uuid;
begin
  if p_driver_id is null then
    raise exception 'driver_id required';
  end if;

  if v_currency <> 'USD' then
    raise exception 'unsupported currency: %', v_currency;
  end if;

  if exists (
    select 1
    from public.driver_payouts dp
    where dp.driver_id = p_driver_id
      and dp.status in ('scheduled', 'processing', 'paid')
      and dp.created_at >= (now() - interval '24 hours')
  ) then
    raise exception 'cashout_rate_limited';
  end if;

  select coalesce(sum(line_amount), 0)
  into v_available
  from (
    select
      coalesce(o.driver_delivery_payout, 0)::numeric
      + (greatest(coalesce(o.tip_cents, 0), 0)::numeric / 100.0) as line_amount
    from public.orders o
    where o.driver_id = p_driver_id
      and o.status = 'delivered'
      and coalesce(o.driver_paid_out, false) = false
      and o.driver_payout_id is null

    union all

    select coalesce(dr.driver_delivery_payout, 0)::numeric as line_amount
    from public.delivery_requests dr
    where dr.driver_id = p_driver_id
      and dr.status = 'delivered'
      and coalesce(dr.driver_paid_out, false) = false
      and dr.driver_payout_id is null
  ) balances;

  v_available := round(greatest(v_available, 0), 2);

  if v_available < v_min_cashout then
    return;
  end if;

  insert into public.driver_payouts (
    driver_id,
    amount,
    currency,
    status,
    scheduled_at,
    created_at,
    updated_at
  )
  values (
    p_driver_id,
    v_available,
    v_currency,
    'processing',
    now(),
    now(),
    now()
  )
  returning id into v_new_payout_id;

  update public.orders o
  set
    driver_payout_id = v_new_payout_id,
    updated_at = now()
  where o.driver_id = p_driver_id
    and o.status = 'delivered'
    and coalesce(o.driver_paid_out, false) = false
    and o.driver_payout_id is null;

  update public.delivery_requests dr
  set
    driver_payout_id = v_new_payout_id,
    updated_at = now()
  where dr.driver_id = p_driver_id
    and dr.status = 'delivered'
    and coalesce(dr.driver_paid_out, false) = false
    and dr.driver_payout_id is null;

  payout_id := v_new_payout_id;
  payout_amount := v_available;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) finalize_driver_payout — after Stripe transfer/payout succeeds
-- ---------------------------------------------------------------------------

drop function if exists public.finalize_driver_payout(uuid, text);

create or replace function public.finalize_driver_payout(
  p_payout_id uuid,
  p_stripe_payout_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  if p_payout_id is null then
    raise exception 'payout_id required';
  end if;

  if coalesce(trim(p_stripe_payout_id), '') = '' then
    raise exception 'stripe_payout_id required';
  end if;

  update public.driver_payouts
  set
    status = 'paid',
    stripe_payout_id = p_stripe_payout_id,
    updated_at = v_now
  where id = p_payout_id;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'payout_not_found',
      'payout_id', p_payout_id::text
    );
  end if;

  update public.orders
  set
    driver_paid_out = true,
    driver_paid_out_at = coalesce(driver_paid_out_at, v_now),
    driver_transfer_id = coalesce(driver_transfer_id, p_stripe_payout_id),
    updated_at = v_now
  where driver_payout_id = p_payout_id
    and coalesce(driver_paid_out, false) = false;

  update public.delivery_requests
  set
    driver_paid_out = true,
    driver_paid_out_at = coalesce(driver_paid_out_at, v_now),
    updated_at = v_now
  where driver_payout_id = p_payout_id
    and coalesce(driver_paid_out, false) = false;

  return jsonb_build_object(
    'ok', true,
    'payout_id', p_payout_id::text,
    'stripe_payout_id', p_stripe_payout_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) REVOKE public/authenticated access to payment-critical RPCs
-- ---------------------------------------------------------------------------

revoke all on function public.apply_checkout_paid(
  text, text, boolean, uuid, text, text, jsonb
) from public;

revoke all on function public.apply_checkout_paid(
  text, text, boolean, uuid, text, text, jsonb
) from anon, authenticated;

grant execute on function public.apply_checkout_paid(
  text, text, boolean, uuid, text, text, jsonb
) to service_role;

revoke all on function public.apply_checkout_failed_or_expired(
  text, text, boolean, uuid, text, text, jsonb
) from public;

revoke all on function public.apply_checkout_failed_or_expired(
  text, text, boolean, uuid, text, text, jsonb
) from anon, authenticated;

grant execute on function public.apply_checkout_failed_or_expired(
  text, text, boolean, uuid, text, text, jsonb
) to service_role;

revoke all on function public.compute_order_pricing(
  text, numeric, numeric, text, text
) from public;

revoke all on function public.compute_order_pricing(
  text, numeric, numeric, text, text
) from anon, authenticated;

grant execute on function public.compute_order_pricing(
  text, numeric, numeric, text, text
) to service_role;

revoke all on function public.mark_order_paid(uuid, text, text) from public;
revoke all on function public.mark_order_paid(uuid, text, text) from anon, authenticated;
grant execute on function public.mark_order_paid(uuid, text, text) to service_role;

revoke all on function public.admin_pay_driver_now(uuid, text) from public;
revoke all on function public.admin_pay_driver_now(uuid, text) from anon, authenticated;
grant execute on function public.admin_pay_driver_now(uuid, text) to service_role;

revoke all on function public.finalize_driver_payout(uuid, text) from public;
revoke all on function public.finalize_driver_payout(uuid, text) from anon, authenticated;
grant execute on function public.finalize_driver_payout(uuid, text) to service_role;

commit;
