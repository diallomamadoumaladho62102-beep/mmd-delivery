-- Version critical RPCs used by mobile/web/API (idempotent, safe on existing prod definitions)

begin;

-- ---------------------------------------------------------------------------
-- Schema guards
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists pickup_code text;

alter table public.orders
  add column if not exists dropoff_code text;

alter table public.orders
  add column if not exists picked_up_at timestamptz;

alter table public.orders
  add column if not exists delivered_at timestamptz;

alter table public.orders
  add column if not exists delivered_confirmed_at timestamptz;

alter table public.order_members
  add column if not exists joined_at timestamptz default now();

create table if not exists public.order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  sender_id uuid,
  body text,
  created_at timestamptz not null default now()
);

create table if not exists public.order_payouts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  target text not null check (target in ('restaurant', 'driver')),
  status text not null default 'pending'
    check (status in ('pending', 'locked', 'succeeded', 'failed')),
  currency text not null default 'USD',
  amount_cents integer not null check (amount_cents >= 0),
  destination_account_id text,
  source_charge_id text,
  stripe_transfer_id text,
  idempotency_key text not null,
  locked_by text,
  locked_at timestamptz,
  failure_code text,
  failure_message text,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  succeeded_at timestamptz,
  failed_at timestamptz
);

create unique index if not exists order_payouts_idempotency_key_uq
  on public.order_payouts (idempotency_key);

create unique index if not exists order_payouts_order_target_uq
  on public.order_payouts (order_id, target);

-- ---------------------------------------------------------------------------
-- join_order / leave_order
-- ---------------------------------------------------------------------------

drop function if exists public.join_order(uuid, text);

create or replace function public.join_order(
  p_order_id uuid,
  p_role text default 'client'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_order_id');
  end if;

  insert into public.order_members (order_id, user_id, role, joined_at)
  values (p_order_id, v_user_id, coalesce(nullif(trim(p_role), ''), 'client'), now())
  on conflict (order_id, user_id) do update
  set role = excluded.role;

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'role', p_role);
end;
$$;

drop function if exists public.leave_order(uuid);

create or replace function public.leave_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  delete from public.order_members
  where order_id = p_order_id
    and user_id = v_user_id;

  return jsonb_build_object('ok', true, 'order_id', p_order_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- driver_accept_ready_order
-- ---------------------------------------------------------------------------

drop function if exists public.driver_accept_ready_order(uuid);

create or replace function public.driver_accept_ready_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  update public.orders
  set
    driver_id = v_driver_id,
    status = 'dispatched',
    updated_at = now()
  where id = p_order_id
    and driver_id is null
    and lower(coalesce(payment_status, '')) = 'paid'
    and lower(coalesce(status, '')) = 'ready';

  if not found then
    return jsonb_build_object('ok', false, 'message', 'order_not_available');
  end if;

  insert into public.order_members (order_id, user_id, role)
  values (p_order_id, v_driver_id, 'driver')
  on conflict (order_id, user_id) do update set role = 'driver';

  return jsonb_build_object('ok', true, 'order_id', p_order_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- verify_order_code
-- ---------------------------------------------------------------------------

drop function if exists public.verify_order_code(uuid, text, text);

create or replace function public.verify_order_code(
  p_order_id uuid,
  p_input_code text,
  p_code_type text default 'pickup'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_row public.orders%rowtype;
  v_expected text;
  v_input text := nullif(trim(p_input_code), '');
  v_kind text := lower(trim(coalesce(p_code_type, 'pickup')));
begin
  if v_driver_id is null then
    return jsonb_build_object('success', false, 'message', 'not_authenticated');
  end if;

  select *
  into v_row
  from public.orders
  where id = p_order_id
    and driver_id = v_driver_id;

  if not found then
    return jsonb_build_object('success', false, 'message', 'order_not_found');
  end if;

  if v_kind = 'dropoff' then
    v_expected := nullif(trim(v_row.dropoff_code), '');
  else
    v_expected := nullif(trim(v_row.pickup_code), '');
  end if;

  if v_expected is null then
    return jsonb_build_object('success', true, 'message', 'code_not_required');
  end if;

  if v_input is null or v_input <> v_expected then
    return jsonb_build_object('success', false, 'message', 'invalid_code');
  end if;

  return jsonb_build_object('success', true, 'message', 'verified');
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_order_pickup / confirm_order_delivery
-- ---------------------------------------------------------------------------

drop function if exists public.confirm_order_pickup(uuid, uuid);
drop function if exists public.confirm_order_pickup(uuid);

create or replace function public.confirm_order_pickup(
  p_order_id uuid,
  p_driver_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := coalesce(p_driver_user_id, auth.uid());
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  update public.orders
  set
    status = 'picked_up',
    picked_up_at = coalesce(picked_up_at, now()),
    updated_at = now()
  where id = p_order_id
    and driver_id = v_driver_id
    and lower(coalesce(status, '')) in ('dispatched', 'ready');

  if not found then
    return jsonb_build_object('ok', false, 'error', 'pickup_not_allowed');
  end if;

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'status', 'picked_up');
end;
$$;

drop function if exists public.confirm_order_delivery(uuid, uuid);
drop function if exists public.confirm_order_delivery(uuid);

create or replace function public.confirm_order_delivery(
  p_order_id uuid,
  p_owner_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := coalesce(p_owner_user_id, auth.uid());
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  update public.orders
  set
    status = 'delivered',
    delivered_at = coalesce(delivered_at, now()),
    delivered_confirmed_at = coalesce(delivered_confirmed_at, now()),
    updated_at = now()
  where id = p_order_id
    and (
      driver_id = v_actor
      or exists (
        select 1 from public.order_participant_ids(p_order_id) p
        where p.user_id = v_actor
      )
    )
    and lower(coalesce(status, '')) in ('picked_up', 'dispatched');

  if not found then
    return jsonb_build_object('ok', false, 'error', 'delivery_not_allowed');
  end if;

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'status', 'delivered');
end;
$$;

-- ---------------------------------------------------------------------------
-- delete_order_message
-- ---------------------------------------------------------------------------

drop function if exists public.delete_order_message(uuid);

create or replace function public.delete_order_message(p_msg_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order_id uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select order_id
  into v_order_id
  from public.order_messages
  where id = p_msg_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'message_not_found');
  end if;

  if not exists (
    select 1
    from public.order_participant_ids(v_order_id) p
    where p.user_id = v_user_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  delete from public.order_messages where id = p_msg_id;

  return jsonb_build_object('ok', true, 'message_id', p_msg_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- accept_referral_code (no-op safe default)
-- ---------------------------------------------------------------------------

drop function if exists public.accept_referral_code(text);

create or replace function public.accept_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if coalesce(nullif(trim(p_code), ''), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_code');
  end if;

  return jsonb_build_object('ok', true, 'code', upper(trim(p_code)));
end;
$$;

-- ---------------------------------------------------------------------------
-- create_errand_order (minimal)
-- ---------------------------------------------------------------------------

drop function if exists public.create_errand_order(
  text, text, text, text, text, numeric, text
);

create or replace function public.create_errand_order(
  p_pickup_address text,
  p_dropoff_address text,
  p_pickup_contact text default null,
  p_dropoff_contact text default null,
  p_description text default null,
  p_subtotal numeric default 0,
  p_promo_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order_id uuid := gen_random_uuid();
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  insert into public.orders (
    id,
    kind,
    status,
    payment_status,
    pickup_address,
    dropoff_address,
    subtotal,
    total,
    created_by,
    client_user_id
  )
  values (
    v_order_id,
    'errand',
    'pending',
    'unpaid',
    p_pickup_address,
    p_dropoff_address,
    coalesce(p_subtotal, 0),
    coalesce(p_subtotal, 0),
    v_user_id,
    v_user_id
  );

  insert into public.order_members (order_id, user_id, role)
  values (v_order_id, v_user_id, 'client')
  on conflict (order_id, user_id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'promo_code', p_promo_code
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- reserve_order_payout (Stripe transfers/run)
-- ---------------------------------------------------------------------------

drop function if exists public.reserve_order_payout(
  uuid, text, integer, text, text, text, text, text
);

create or replace function public.reserve_order_payout(
  p_order_id uuid,
  p_target text,
  p_amount_cents integer,
  p_currency text,
  p_destination_account_id text,
  p_source_charge_id text,
  p_idempotency_key text,
  p_locked_by text default null
)
returns public.order_payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.order_payouts%rowtype;
  v_row public.order_payouts%rowtype;
  v_target text := lower(trim(coalesce(p_target, '')));
begin
  if p_order_id is null then
    raise exception 'order_id required';
  end if;

  if v_target not in ('restaurant', 'driver') then
    raise exception 'invalid target';
  end if;

  if coalesce(nullif(trim(p_idempotency_key), ''), '') = '' then
    raise exception 'idempotency_key required';
  end if;

  select *
  into v_existing
  from public.order_payouts
  where idempotency_key = p_idempotency_key
  limit 1;

  if found then
    return v_existing;
  end if;

  select *
  into v_existing
  from public.order_payouts
  where order_id = p_order_id
    and target = v_target
  limit 1;

  if found then
    return v_existing;
  end if;

  insert into public.order_payouts (
    order_id,
    target,
    status,
    currency,
    amount_cents,
    destination_account_id,
    source_charge_id,
    idempotency_key,
    locked_by,
    locked_at,
    updated_at
  )
  values (
    p_order_id,
    v_target,
    'pending',
    upper(trim(coalesce(p_currency, 'USD'))),
    greatest(coalesce(p_amount_cents, 0), 0),
    p_destination_account_id,
    p_source_charge_id,
    p_idempotency_key,
    p_locked_by,
    now(),
    now()
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.join_order(uuid, text) from public;
revoke all on function public.leave_order(uuid) from public;
revoke all on function public.driver_accept_ready_order(uuid) from public;
revoke all on function public.verify_order_code(uuid, text, text) from public;
revoke all on function public.confirm_order_pickup(uuid, uuid) from public;
revoke all on function public.confirm_order_delivery(uuid, uuid) from public;
revoke all on function public.delete_order_message(uuid) from public;
revoke all on function public.accept_referral_code(text) from public;
revoke all on function public.create_errand_order(
  text, text, text, text, text, numeric, text
) from public;
revoke all on function public.reserve_order_payout(
  uuid, text, integer, text, text, text, text, text
) from public;

grant execute on function public.join_order(uuid, text) to authenticated;
grant execute on function public.leave_order(uuid) to authenticated;
grant execute on function public.driver_accept_ready_order(uuid) to authenticated;
grant execute on function public.verify_order_code(uuid, text, text) to authenticated;
grant execute on function public.confirm_order_pickup(uuid, uuid) to authenticated;
grant execute on function public.confirm_order_delivery(uuid, uuid) to authenticated;
grant execute on function public.delete_order_message(uuid) to authenticated;
grant execute on function public.accept_referral_code(text) to authenticated;
grant execute on function public.create_errand_order(
  text, text, text, text, text, numeric, text
) to authenticated;
grant execute on function public.reserve_order_payout(
  uuid, text, integer, text, text, text, text, text
) to service_role;

commit;
