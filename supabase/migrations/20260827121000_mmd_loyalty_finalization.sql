-- ===========================================================================
-- MMD Loyalty — finalization: Crédit MMD at checkout + refunds/reversals +
-- hardening + legacy taxi de-duplication.
-- ---------------------------------------------------------------------------
-- Everything here is additive and idempotent. It does NOT touch existing data,
-- Stripe keys/webhooks/config, nor the gross amounts used for commissions and
-- payouts. Store credit is modelled as a platform-funded discount:
--   * FOOD / DELIVERY: gross `total_cents` is preserved (payout/commission base);
--     a new `net_charge_cents` carries the reduced amount actually charged.
--   * TAXI: credit is folded into the ride discount (reduces `total_cents`,
--     leaving `gross_total_cents` and `driver_payout_cents` intact) — the same
--     proven model as the existing loyalty/promo discounts.
-- Reservation lifecycle: held -> captured (FIFO spend on payment) | released.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) New columns (idempotent). Gross stays authoritative for payouts.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists mmd_credit_applied_cents integer not null default 0;
alter table public.orders
  add column if not exists net_charge_cents bigint;

alter table public.delivery_requests
  add column if not exists mmd_credit_applied_cents integer not null default 0;
alter table public.delivery_requests
  add column if not exists net_charge_cents bigint;

alter table public.taxi_rides
  add column if not exists mmd_credit_applied_cents integer not null default 0;

-- ---------------------------------------------------------------------------
-- 2) Credit reservations (holds). One active hold per entity.
-- ---------------------------------------------------------------------------
create table if not exists public.mmd_credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  entity_type text not null check (
    entity_type in ('food_order', 'delivery_request', 'taxi_ride')
  ),
  entity_id text not null,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'USD',
  status text not null default 'held' check (status in ('held', 'captured', 'released')),
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mmd_credit_reservations_entity_uq unique (entity_type, entity_id)
);

create index if not exists mmd_credit_reservations_user_status_idx
  on public.mmd_credit_reservations (user_id, status);

drop trigger if exists trg_mmd_credit_reservations_updated_at on public.mmd_credit_reservations;
create trigger trg_mmd_credit_reservations_updated_at
before update on public.mmd_credit_reservations
for each row execute function public.taxi_set_updated_at();

alter table public.mmd_credit_reservations enable row level security;

drop policy if exists mmd_credit_reservations_select_own on public.mmd_credit_reservations;
create policy mmd_credit_reservations_select_own
on public.mmd_credit_reservations for select to authenticated
using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

-- ---------------------------------------------------------------------------
-- 3) Spendable balance = wallet balance - sum(held reservations)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_credit_available_cents(p_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    0,
    coalesce((select balance_cents from public.mmd_credit_wallets where user_id = p_user_id), 0)
    - coalesce((
        select sum(amount_cents)
        from public.mmd_credit_reservations
        where user_id = p_user_id and status = 'held'
      ), 0)
  );
$$;

-- ---------------------------------------------------------------------------
-- 4) Reserve credit for an entity (idempotent, currency-checked, clamped)
-- p_max_applicable_cents = the largest credit the entity total can absorb.
-- ---------------------------------------------------------------------------
create or replace function public.mmd_credit_reserve(
  p_user_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_requested_cents bigint,
  p_max_applicable_cents bigint,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_available bigint;
  v_wallet_currency text;
  v_existing public.mmd_credit_reservations%rowtype;
  v_amount bigint;
begin
  if p_user_id is null or p_entity_id is null or p_entity_type is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;
  if p_requested_cents is null or p_requested_cents <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  -- currency guard: never spend a wallet of another currency without an
  -- explicit conversion rule (none configured => refuse).
  select currency into v_wallet_currency from public.mmd_credit_wallets where user_id = p_user_id;
  if v_wallet_currency is not null
     and upper(coalesce(p_currency, '')) <> upper(v_wallet_currency) then
    return jsonb_build_object('ok', false, 'error', 'currency_mismatch',
      'wallet_currency', v_wallet_currency, 'requested_currency', p_currency);
  end if;

  -- existing hold for this entity: return it (idempotent), captured => locked
  select * into v_existing
  from public.mmd_credit_reservations
  where entity_type = p_entity_type and entity_id = p_entity_id;

  if found then
    if v_existing.status = 'captured' then
      return jsonb_build_object('ok', false, 'error', 'already_captured');
    end if;
    if v_existing.status = 'held' then
      return jsonb_build_object('ok', true, 'reservation_id', v_existing.id,
        'amount_cents', v_existing.amount_cents, 'already_held', true);
    end if;
    -- released: allow re-reserve by deleting the stale row
    delete from public.mmd_credit_reservations where id = v_existing.id;
  end if;

  perform public.mmd_credit_ensure_wallet(p_user_id);

  -- lock wallet to serialize concurrent reservations for this user
  perform 1 from public.mmd_credit_wallets where user_id = p_user_id for update;

  v_available := public.mmd_credit_available_cents(p_user_id);

  v_amount := least(
    p_requested_cents,
    v_available,
    greatest(0, coalesce(p_max_applicable_cents, 0))
  );

  if v_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'no_credit_available',
      'available_cents', v_available);
  end if;

  insert into public.mmd_credit_reservations (
    user_id, entity_type, entity_id, amount_cents, currency, status, idempotency_key
  ) values (
    p_user_id, p_entity_type, p_entity_id, v_amount, upper(coalesce(p_currency, 'USD')),
    'held', 'reserve:' || p_entity_type || ':' || p_entity_id
  );

  return jsonb_build_object('ok', true, 'amount_cents', v_amount,
    'available_after_cents', public.mmd_credit_available_cents(p_user_id));
exception when unique_violation then
  -- concurrent insert won the race; return the held row
  select * into v_existing
  from public.mmd_credit_reservations
  where entity_type = p_entity_type and entity_id = p_entity_id;
  return jsonb_build_object('ok', true, 'amount_cents', coalesce(v_existing.amount_cents, 0),
    'already_held', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Capture (finalize spend) on confirmed payment (idempotent)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_credit_capture(
  p_entity_type text,
  p_entity_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.mmd_credit_reservations%rowtype;
  v_spend jsonb;
begin
  select * into v_res
  from public.mmd_credit_reservations
  where entity_type = p_entity_type and entity_id = p_entity_id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'no_reservation', true);
  end if;
  if v_res.status = 'captured' then
    return jsonb_build_object('ok', true, 'already_captured', true);
  end if;
  if v_res.status = 'released' then
    return jsonb_build_object('ok', false, 'error', 'reservation_released');
  end if;

  v_spend := public.mmd_credit_spend(
    v_res.user_id, v_res.amount_cents, p_entity_type, p_entity_id,
    'mmd_credit_spend:' || p_entity_type || ':' || p_entity_id,
    'Crédit MMD utilisé'
  );

  if coalesce((v_spend ->> 'ok')::boolean, false) = false then
    return jsonb_build_object('ok', false, 'error', coalesce(v_spend ->> 'error', 'spend_failed'));
  end if;

  update public.mmd_credit_reservations
  set status = 'captured', updated_at = now()
  where id = v_res.id;

  return jsonb_build_object('ok', true, 'captured_cents', v_res.amount_cents);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Release a hold (payment failed / cancelled before capture)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_credit_release(
  p_entity_type text,
  p_entity_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.mmd_credit_reservations%rowtype;
begin
  select * into v_res
  from public.mmd_credit_reservations
  where entity_type = p_entity_type and entity_id = p_entity_id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'no_reservation', true);
  end if;
  if v_res.status = 'captured' then
    -- already spent: releasing means re-crediting (handled by refund path)
    return jsonb_build_object('ok', false, 'error', 'already_captured');
  end if;

  update public.mmd_credit_reservations
  set status = 'released', updated_at = now()
  where id = v_res.id and status = 'held';

  return jsonb_build_object('ok', true, 'released', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Refund: re-credit captured MMD credit (idempotent by refund ref)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_credit_refund(
  p_entity_type text,
  p_entity_id text,
  p_refund_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.mmd_credit_reservations%rowtype;
  v_expires timestamptz;
  v_settings public.loyalty_settings%rowtype;
begin
  select * into v_res
  from public.mmd_credit_reservations
  where entity_type = p_entity_type and entity_id = p_entity_id;

  if not found or v_res.status <> 'captured' then
    return jsonb_build_object('ok', true, 'nothing_to_refund', true);
  end if;

  select * into v_settings from public.loyalty_settings where singleton = true;
  if coalesce(v_settings.credit_validity_months, 0) > 0 then
    v_expires := now() + make_interval(months => v_settings.credit_validity_months);
  else
    v_expires := null;
  end if;

  return public.mmd_credit_add(
    v_res.user_id, v_res.amount_cents, 'refund', p_entity_type, p_entity_id,
    'mmd_credit_refund:' || p_entity_type || ':' || p_entity_id || ':' || coalesce(p_refund_ref, 'r'),
    v_expires, 'Restauration Crédit MMD (remboursement)', null
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Reverse loyalty points on refund (compensating entries, never delete)
-- Flags underflow (balance would go negative) in metadata for admin review.
-- ---------------------------------------------------------------------------
create or replace function public.mmd_loyalty_reverse(
  p_reference_type text,
  p_reference_id text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_reversed integer := 0;
begin
  if p_reference_type is null or p_reference_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  -- Reverse per (user_id, role): each role's account is independent, so points
  -- awarded to a client and to a driver for the same reference are reversed
  -- against their own separate balances.
  for v_row in
    select user_id, role, sum(delta_points) as net_points
    from public.loyalty_ledger
    where reference_type = p_reference_type
      and reference_id = p_reference_id
      and entry_type in ('order', 'taxi')
      group by user_id, role
    having sum(delta_points) > 0
  loop
    perform public.mmd_loyalty_accrue(
      v_row.user_id,
      (-v_row.net_points)::integer,
      'admin_adjust',
      p_reference_type,
      p_reference_id,
      'reverse:' || p_reference_type || ':' || p_reference_id || ':' || v_row.role || ':' || v_row.user_id::text,
      coalesce(p_reason, 'Annulation/remboursement — reprise des points'),
      null,
      jsonb_build_object(
        'reversal', true,
        'underflow',
        (coalesce((select points_balance from public.loyalty_accounts
          where user_id = v_row.user_id and role = v_row.role), 0)
          < v_row.net_points)
      ),
      v_row.role
    );
    v_reversed := v_reversed + 1;
  end loop;

  return jsonb_build_object('ok', true, 'reversed_accounts', v_reversed);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) Legacy taxi de-duplication — make the unified program canonical.
-- Neutralize the legacy per-ride accrual so a completed ride cannot earn in
-- BOTH taxi_loyalty_* and the unified program. Data is preserved; a separate
-- consolidation migration (documented in the PR) can port balances later.
-- The function keeps its original signature and simply becomes a no-op.
-- ---------------------------------------------------------------------------
do $legacy$
begin
  if to_regprocedure('public.accrue_taxi_loyalty_for_ride(uuid)') is not null then
    execute $fn$
      create or replace function public.accrue_taxi_loyalty_for_ride(p_ride_id uuid)
      returns jsonb
      language plpgsql
      security definer
      set search_path = public
      as $body$
      begin
        -- Deprecated: unified MMD loyalty (mmd_accrue_taxi_ride) is now canonical.
        -- Kept as a no-op to avoid double-awarding on the same ride.
        return jsonb_build_object('ok', true, 'deprecated', true, 'ride_id', p_ride_id);
      end;
      $body$;
    $fn$;
  end if;
end
$legacy$;

-- ---------------------------------------------------------------------------
-- 9b) Batched credit expiry (cron-friendly, idempotent, bounded per call)
-- Returns the number expired this batch and how many due lots remain.
-- ---------------------------------------------------------------------------
create or replace function public.mmd_credit_expire_due_batch(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot record;
  v_balance bigint;
  v_new bigint;
  v_count integer := 0;
  v_remaining integer := 0;
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 5000));
begin
  for v_lot in
    select id, user_id, remaining_cents
    from public.mmd_credit_lots
    where remaining_cents > 0
      and expires_at is not null
      and expires_at <= now()
    order by expires_at
    limit v_limit
    for update skip locked
  loop
    select balance_cents into v_balance
    from public.mmd_credit_wallets
    where user_id = v_lot.user_id
    for update;

    v_new := greatest(0, coalesce(v_balance, 0) - v_lot.remaining_cents);

    insert into public.mmd_credit_ledger (
      user_id, delta_cents, balance_after_cents, entry_type, reference_type, description
    ) values (
      v_lot.user_id, -v_lot.remaining_cents, v_new, 'expire', 'expiry', 'Expiration Crédit MMD'
    );

    update public.mmd_credit_lots set remaining_cents = 0 where id = v_lot.id;
    update public.mmd_credit_wallets set balance_cents = v_new, updated_at = now()
    where user_id = v_lot.user_id;

    v_count := v_count + 1;
  end loop;

  select count(*) into v_remaining
  from public.mmd_credit_lots
  where remaining_cents > 0
    and expires_at is not null
    and expires_at <= now();

  return jsonb_build_object('ok', true, 'expired_lots', v_count, 'remaining', v_remaining);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10) Hardening — explicitly deny direct execution by anon/authenticated on
-- all sensitive loyalty/credit RPCs (financial mutations = service_role only).
-- ---------------------------------------------------------------------------
do $harden$
declare
  v_sig text;
  v_sigs text[] := array[
    'public.mmd_loyalty_accrue(uuid, integer, text, text, text, text, text, uuid, jsonb, text)',
    'public.mmd_credit_add(uuid, bigint, text, text, text, text, timestamptz, text, uuid)',
    'public.mmd_credit_spend(uuid, bigint, text, text, text, text)',
    'public.mmd_credit_expire_due()',
    'public.mmd_credit_expire_due_batch(integer)',
    'public.mmd_convert_points(uuid, integer, text, text)',
    'public.mmd_loyalty_admin_adjust(uuid, uuid, integer, text, text)',
    'public.mmd_credit_admin_adjust(uuid, uuid, bigint, text)',
    'public.mmd_campaign_apply(text, text, jsonb, integer)',
    'public.mmd_loyalty_get_or_create_code(uuid, text)',
    'public.mmd_loyalty_apply_referral_code(uuid, text, text)',
    'public.mmd_process_referral(uuid)',
    'public.mmd_accrue_taxi_ride(uuid)',
    'public.mmd_accrue_marketplace_order(uuid)',
    'public.mmd_accrue_food_order(uuid)',
    'public.mmd_accrue_delivery_request(uuid)',
    'public.mmd_loyalty_tier_for(integer)',
    'public.mmd_loyalty_ensure_account(uuid, text)',
    'public.mmd_credit_ensure_wallet(uuid)',
    'public.mmd_credit_available_cents(uuid)',
    'public.mmd_credit_reserve(uuid, text, text, bigint, bigint, text)',
    'public.mmd_credit_capture(text, text)',
    'public.mmd_credit_release(text, text)',
    'public.mmd_credit_refund(text, text, text)',
    'public.mmd_loyalty_reverse(text, text, text)'
  ];
begin
  foreach v_sig in array v_sigs loop
    if to_regprocedure(v_sig) is not null then
      execute format('revoke all on function %s from public', v_sig);
      execute format('revoke all on function %s from anon', v_sig);
      execute format('revoke all on function %s from authenticated', v_sig);
      execute format('grant execute on function %s to service_role', v_sig);
    end if;
  end loop;
end
$harden$;

commit;
