-- Commercial production hardening v2 (SAFE for existing prod)
-- DO NOT apply 20260603120000_commercial_production_hardening.sql (deprecated).
--
-- Principles:
-- - Schema-aware (information_schema / to_regclass)
-- - Never DROP/replace prod RPCs that already exist (commissions, set_order_status)
-- - join_order: member→client, driver only if already assigned, shared orders preserved
-- - order_messages RLS: only columns that exist
-- - verify_order_code: per-step code requirement only

begin;

-- ---------------------------------------------------------------------------
-- 5) order_payouts: ensure status CHECK includes 'locked' (non-destructive)
-- ---------------------------------------------------------------------------

do $$
declare
  v_conname text;
  v_def text;
begin
  if to_regclass('public.order_payouts') is null then
    return;
  end if;

  select c.conname, pg_get_constraintdef(c.oid)
  into v_conname, v_def
  from pg_constraint c
  where c.conrelid = 'public.order_payouts'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%status%'
  limit 1;

  if v_def is not null and v_def not ilike '%locked%' then
    execute format('alter table public.order_payouts drop constraint %I', v_conname);
    alter table public.order_payouts
      add constraint order_payouts_status_check
      check (status in ('pending', 'locked', 'succeeded', 'failed'));
  elsif v_def is null then
    alter table public.order_payouts
      add constraint order_payouts_status_check
      check (status in ('pending', 'locked', 'succeeded', 'failed'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A1: reserve_order_payout — pending → locked when p_locked_by set
-- ---------------------------------------------------------------------------

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
  v_locked_by text := nullif(trim(coalesce(p_locked_by, '')), '');
  v_initial_status text := 'pending';
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

  if v_locked_by is not null then
    v_initial_status := 'locked';
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
    if v_existing.status = 'pending'
       and v_initial_status = 'locked'
       and v_locked_by is not null then
      update public.order_payouts
      set
        status = 'locked',
        locked_by = v_locked_by,
        locked_at = coalesce(locked_at, now()),
        updated_at = now()
      where id = v_existing.id
        and status = 'pending'
      returning * into v_row;

      if found then
        return v_row;
      end if;
    end if;

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
    v_initial_status,
    upper(trim(coalesce(p_currency, 'USD'))),
    greatest(coalesce(p_amount_cents, 0), 0),
    p_destination_account_id,
    p_source_charge_id,
    p_idempotency_key,
    v_locked_by,
    case when v_initial_status = 'locked' then now() else null end,
    now()
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.reserve_order_payout(
  uuid, text, integer, text, text, text, text, text
) from public;
grant execute on function public.reserve_order_payout(
  uuid, text, integer, text, text, text, text, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 2) join_order — member, shared orders, driver only if already assigned
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
  v_role_in text := lower(trim(coalesce(p_role, 'client')));
  v_role text;
  v_order public.orders%rowtype;
  v_is_owner boolean := false;
  v_has_members boolean := false;
  v_already_member boolean := false;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_order_id');
  end if;

  -- Legacy UI uses "member" (JoinButton) — treat as client membership
  if v_role_in = 'member' then
    v_role := 'client';
  elsif v_role_in in ('client', 'restaurant', 'driver', 'admin') then
    v_role := v_role_in;
  else
    return jsonb_build_object('ok', false, 'error', 'invalid_role');
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  select exists (
    select 1
    from public.order_members om
    where om.order_id = p_order_id
      and om.user_id = v_user_id
  )
  into v_already_member;

  select exists (
    select 1
    from public.order_members om
    where om.order_id = p_order_id
  )
  into v_has_members;

  v_is_owner :=
    v_order.created_by = v_user_id
    or v_order.client_user_id = v_user_id;

  if not v_is_owner
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'orders'
         and column_name = 'user_id'
     ) then
    select v_is_owner or exists (
      select 1 from public.orders o
      where o.id = p_order_id and o.user_id = v_user_id
    )
    into v_is_owner;
  end if;

  if not v_is_owner
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'orders'
         and column_name = 'client_id'
     ) then
    select v_is_owner or exists (
      select 1 from public.orders o
      where o.id = p_order_id and o.client_id = v_user_id
    )
    into v_is_owner;
  end if;

  if v_role = 'driver' then
    -- Never self-assign: only join chat/membership if already assigned on the order
    if v_order.driver_id is null then
      return jsonb_build_object(
        'ok', false,
        'error', 'driver_not_assigned',
        'message', 'Use driver_accept_ready_order or driver_accept_order_offer first'
      );
    end if;

    if v_order.driver_id is distinct from v_user_id then
      return jsonb_build_object('ok', false, 'error', 'forbidden_driver');
    end if;
  elsif v_role = 'client' then
    if not v_is_owner
       and not v_already_member
       and not v_has_members then
      return jsonb_build_object('ok', false, 'error', 'forbidden_client');
    end if;
  elsif v_role = 'restaurant' then
    if not (
      v_order.restaurant_user_id = v_user_id
      or (
        exists (
          select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = 'orders'
            and column_name = 'restaurant_id'
        )
        and v_order.restaurant_id = v_user_id
      )
      or (
        to_regclass('public.restaurant_profiles') is not null
        and exists (
          select 1
          from public.restaurant_profiles rp
          where rp.user_id = v_user_id
            and (
              (
                exists (
                  select 1 from information_schema.columns
                  where table_schema = 'public'
                    and table_name = 'restaurant_profiles'
                    and column_name = 'id'
                )
                and rp.id = v_order.restaurant_id
              )
              or rp.user_id = v_order.restaurant_user_id
            )
        )
      )
      or v_already_member
    ) then
      return jsonb_build_object('ok', false, 'error', 'forbidden_restaurant');
    end if;
  elsif v_role = 'admin' then
    if to_regclass('public.profiles') is null
       or not exists (
         select 1
         from public.profiles p
         where p.id = v_user_id
           and lower(trim(coalesce(p.role::text, ''))) in ('admin', 'super_admin')
       ) then
      return jsonb_build_object('ok', false, 'error', 'forbidden_admin');
    end if;
  end if;

  insert into public.order_members (order_id, user_id, role, joined_at)
  values (p_order_id, v_user_id, v_role, now())
  on conflict (order_id, user_id) do update
  set role = excluded.role,
      joined_at = coalesce(public.order_members.joined_at, excluded.joined_at);

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'role', v_role);
end;
$$;

drop function if exists public.join_order_rpc(uuid, uuid, text);

create or replace function public.join_order_rpc(
  p_order_id uuid,
  p_user_id uuid,
  p_role text default 'client'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_user_id is distinct from auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'user_mismatch');
  end if;

  return public.join_order(p_order_id, p_role);
end;
$$;

-- ---------------------------------------------------------------------------
-- A3: confirm_order_* — no impersonation; API/service_role only
-- ---------------------------------------------------------------------------

drop function if exists public.confirm_order_pickup(uuid);
drop function if exists public.confirm_order_pickup(uuid, uuid);

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
  v_actor uuid;
  v_jwt_role text := coalesce(auth.jwt() ->> 'role', '');
begin
  if v_jwt_role = 'service_role' then
    v_actor := coalesce(p_driver_user_id, auth.uid());
  else
    v_actor := auth.uid();
    if v_actor is null then
      return jsonb_build_object('ok', false, 'error', 'not_authenticated');
    end if;
    if p_driver_user_id is not null and p_driver_user_id <> v_actor then
      return jsonb_build_object('ok', false, 'error', 'forbidden_impersonation');
    end if;
  end if;

  if v_actor is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  update public.orders
  set
    status = 'picked_up',
    picked_up_at = coalesce(picked_up_at, now()),
    updated_at = now()
  where id = p_order_id
    and driver_id = v_actor
    and lower(coalesce(status, '')) in ('dispatched', 'ready');

  if not found then
    return jsonb_build_object('ok', false, 'error', 'pickup_not_allowed');
  end if;

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'status', 'picked_up');
end;
$$;

drop function if exists public.confirm_order_delivery(uuid);
drop function if exists public.confirm_order_delivery(uuid, uuid);

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
  v_actor uuid;
  v_jwt_role text := coalesce(auth.jwt() ->> 'role', '');
begin
  if v_jwt_role = 'service_role' then
    v_actor := coalesce(p_owner_user_id, auth.uid());
  else
    v_actor := auth.uid();
    if v_actor is null then
      return jsonb_build_object('ok', false, 'error', 'not_authenticated');
    end if;
    if p_owner_user_id is not null and p_owner_user_id <> v_actor then
      return jsonb_build_object('ok', false, 'error', 'forbidden_impersonation');
    end if;
  end if;

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

revoke all on function public.confirm_order_pickup(uuid, uuid) from public;
revoke all on function public.confirm_order_delivery(uuid, uuid) from public;
revoke execute on function public.confirm_order_pickup(uuid, uuid) from authenticated;
revoke execute on function public.confirm_order_delivery(uuid, uuid) from authenticated;
revoke execute on function public.confirm_order_pickup(uuid, uuid) from anon;
revoke execute on function public.confirm_order_delivery(uuid, uuid) from anon;
grant execute on function public.confirm_order_pickup(uuid, uuid) to service_role;
grant execute on function public.confirm_order_delivery(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3) verify_order_code — code required only for the step that has a code
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
-- C3: accept_referral_code — schema-aware profiles update
-- ---------------------------------------------------------------------------

drop function if exists public.accept_referral_code(text);

create or replace function public.accept_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text := upper(trim(coalesce(p_code, '')));
  v_referrer_id uuid;
  v_has_referred_by boolean := false;
  v_has_code_used boolean := false;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if v_code = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_code', 'applied', false);
  end if;

  if to_regclass('public.referral_codes') is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'referral_not_configured',
      'applied', false,
      'code', v_code
    );
  end if;

  select rc.user_id
  into v_referrer_id
  from public.referral_codes rc
  where upper(trim(rc.code)) = v_code
    and coalesce(rc.is_active, true) = true
  limit 1;

  if v_referrer_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_code', 'applied', false);
  end if;

  if v_referrer_id = v_user_id then
    return jsonb_build_object('ok', false, 'error', 'self_referral', 'applied', false);
  end if;

  if to_regclass('public.profiles') is not null then
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'referred_by'
    ) into v_has_referred_by;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'referral_code_used'
    ) into v_has_code_used;

    if v_has_referred_by and v_has_code_used then
      update public.profiles
      set referred_by = coalesce(referred_by, v_referrer_id),
          referral_code_used = coalesce(referral_code_used, v_code),
          updated_at = now()
      where id = v_user_id
        and referred_by is null;
    elsif v_has_referred_by then
      update public.profiles
      set referred_by = coalesce(referred_by, v_referrer_id),
          updated_at = now()
      where id = v_user_id
        and referred_by is null;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'applied', true,
    'code', v_code,
    'referrer_id', v_referrer_id
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'error', 'referral_apply_failed', 'applied', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) refresh_order_commissions* / 8) set_order_status — create ONLY if missing
-- ---------------------------------------------------------------------------

do $mig$
begin
  if to_regprocedure('public.refresh_order_commissions(uuid)') is null then
    execute $sql$
      create function public.refresh_order_commissions(p_order_id uuid)
      returns jsonb
      language plpgsql
      security definer
      set search_path = public
      as $fn$
      begin
        return jsonb_build_object(
          'ok', true,
          'order_id', p_order_id,
          'refreshed', false,
          'note', 'noop_stub_v2'
        );
      end;
      $fn$;
    $sql$;
  end if;

  if to_regprocedure('public.refresh_order_commissions_rpc(uuid)') is null then
    execute $sql$
      create function public.refresh_order_commissions_rpc(p_order_id uuid)
      returns jsonb
      language plpgsql
      security definer
      set search_path = public
      as $fn$
      begin
        return public.refresh_order_commissions(p_order_id);
      end;
      $fn$;
    $sql$;
  end if;

  if to_regprocedure('public.refresh_order_commissions_for_range(timestamptz,timestamptz)') is null then
    execute $sql$
      create function public.refresh_order_commissions_for_range(
        p_from timestamptz,
        p_to timestamptz
      )
      returns jsonb
      language plpgsql
      security definer
      set search_path = public
      as $fn$
      begin
        return jsonb_build_object(
          'ok', true,
          'from', p_from,
          'to', p_to,
          'refreshed', false,
          'note', 'noop_stub_v2'
        );
      end;
      $fn$;
    $sql$;
  end if;

  if to_regprocedure('public.set_order_status(uuid,text)') is null then
    execute $sql$
      create function public.set_order_status(p_order_id uuid, p_new_status text)
      returns jsonb
      language plpgsql
      security definer
      set search_path = public
      as $fn$
      begin
        if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
          return jsonb_build_object('ok', false, 'error', 'service_role_only');
        end if;

        update public.orders
        set status = p_new_status, updated_at = now()
        where id = p_order_id;

        if not found then
          return jsonb_build_object('ok', false, 'error', 'order_not_found');
        end if;

        return jsonb_build_object('ok', true, 'order_id', p_order_id, 'status', p_new_status);
      end;
      $fn$;
    $sql$;
  end if;

  if to_regprocedure('public.set_order_status_quick(uuid,text)') is null then
    execute $sql$
      create function public.set_order_status_quick(p_order_id uuid, p_new_status text)
      returns jsonb
      language plpgsql
      security definer
      set search_path = public
      as $fn$
      begin
        return public.set_order_status(p_order_id, p_new_status);
      end;
      $fn$;
    $sql$;
  end if;
end;
$mig$;

-- ---------------------------------------------------------------------------
-- B5: helper RPCs — create only if missing
-- ---------------------------------------------------------------------------

do $mig$
begin
  if to_regprocedure('public.get_order_role(uuid,uuid)') is null then
    execute $sql$
      create function public.get_order_role(p_order_id uuid, p_user_id uuid)
      returns text
      language sql
      stable
      security definer
      set search_path = public
      as $fn$
        select om.role
        from public.order_members om
        where om.order_id = p_order_id
          and om.user_id = coalesce(p_user_id, auth.uid())
        limit 1;
      $fn$;
    $sql$;
  end if;

  if to_regprocedure('public.get_driver_benefits(uuid,timestamptz,timestamptz)') is null then
    execute $sql$
      create function public.get_driver_benefits(
        p_driver_id uuid default null,
        p_from timestamptz default null,
        p_to timestamptz default null
      )
      returns jsonb
      language plpgsql
      stable
      security definer
      set search_path = public
      as $fn$
      declare
        v_driver uuid := coalesce(p_driver_id, auth.uid());
      begin
        if v_driver is null then
          return jsonb_build_object('ok', false, 'error', 'not_authenticated');
        end if;
        if p_driver_id is not null and p_driver_id <> auth.uid()
           and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
          return jsonb_build_object('ok', false, 'error', 'forbidden');
        end if;
        return jsonb_build_object(
          'ok', true,
          'driver_id', v_driver,
          'benefits', '[]'::jsonb,
          'challenges', '[]'::jsonb
        );
      end;
      $fn$;
    $sql$;
  end if;

  if to_regprocedure('public.get_driver_stats(uuid,timestamptz,timestamptz)') is null then
    execute $sql$
      create function public.get_driver_stats(
        p_driver_id uuid default null,
        p_from timestamptz default null,
        p_to timestamptz default null
      )
      returns jsonb
      language plpgsql
      stable
      security definer
      set search_path = public
      as $fn$
      declare
        v_driver uuid := coalesce(p_driver_id, auth.uid());
        v_delivered integer := 0;
      begin
        if v_driver is null then
          return jsonb_build_object('ok', false, 'error', 'not_authenticated');
        end if;
        if p_driver_id is not null and p_driver_id <> auth.uid()
           and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
          return jsonb_build_object('ok', false, 'error', 'forbidden');
        end if;

        select count(*)::integer
        into v_delivered
        from public.orders o
        where o.driver_id = v_driver
          and lower(coalesce(o.status, '')) in ('delivered', 'completed')
          and (p_from is null or o.delivered_at >= p_from)
          and (p_to is null or o.delivered_at <= p_to);

        return jsonb_build_object(
          'ok', true,
          'driver_id', v_driver,
          'delivered_count', coalesce(v_delivered, 0),
          'online_minutes', 0,
          'driving_minutes', 0
        );
      end;
      $fn$;
    $sql$;
  end if;
end;
$mig$;

-- ---------------------------------------------------------------------------
-- 1) order_messages RLS — schema-aware policies
-- ---------------------------------------------------------------------------

do $rls$
declare
  v_has_sender_id boolean := false;
  v_insert_expr text;
begin
  if to_regclass('public.order_messages') is null then
    return;
  end if;

  if to_regprocedure('public.order_participant_ids(uuid)') is null then
    raise exception 'order_participant_ids(uuid) is required before applying v2 hardening';
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'order_messages'
      and column_name = 'sender_id'
  )
  into v_has_sender_id;

  if v_has_sender_id then
    v_insert_expr := '(user_id = auth.uid() or sender_id = auth.uid())';
  else
    v_insert_expr := '(user_id = auth.uid())';
  end if;

  alter table public.order_messages enable row level security;

  drop policy if exists order_messages_select_participants on public.order_messages;
  execute $pol$
    create policy order_messages_select_participants
      on public.order_messages
      for select
      to authenticated
      using (
        exists (
          select 1 from public.order_participant_ids(order_messages.order_id) p
          where p.user_id = auth.uid()
        )
      )
  $pol$;

  drop policy if exists order_messages_insert_participants on public.order_messages;
  execute format(
    $pol$
      create policy order_messages_insert_participants
        on public.order_messages
        for insert
        to authenticated
        with check (
          %s
          and exists (
            select 1 from public.order_participant_ids(order_messages.order_id) p
            where p.user_id = auth.uid()
          )
        )
    $pol$,
    v_insert_expr
  );
end;
$rls$;

-- ---------------------------------------------------------------------------
-- order_payouts RLS — service_role only (cron / transfers)
-- ---------------------------------------------------------------------------

do $rls$
begin
  if to_regclass('public.order_payouts') is null then
    return;
  end if;

  alter table public.order_payouts enable row level security;

  drop policy if exists order_payouts_select_service on public.order_payouts;
  create policy order_payouts_select_service
    on public.order_payouts
    for select
    to service_role
    using (true);

  drop policy if exists order_payouts_write_service on public.order_payouts;
  create policy order_payouts_write_service
    on public.order_payouts
    for all
    to service_role
    using (true)
    with check (true);
end;
$rls$;

-- ---------------------------------------------------------------------------
-- C9: driver-documents bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('driver-documents', 'driver-documents', false)
on conflict (id) do update
set public = excluded.public;

drop policy if exists driver_documents_select_own on storage.objects;
create policy driver_documents_select_own
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'driver-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists driver_documents_insert_own on storage.objects;
create policy driver_documents_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'driver-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists driver_documents_update_own on storage.objects;
create policy driver_documents_update_own
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'driver-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'driver-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists driver_documents_delete_own on storage.objects;
create policy driver_documents_delete_own
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'driver-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Grants (strict)
-- ---------------------------------------------------------------------------

revoke all on function public.join_order(uuid, text) from public;
revoke all on function public.join_order_rpc(uuid, uuid, text) from public;
grant execute on function public.join_order(uuid, text) to authenticated;
grant execute on function public.join_order_rpc(uuid, uuid, text) to authenticated;

revoke all on function public.verify_order_code(uuid, text, text) from public;
grant execute on function public.verify_order_code(uuid, text, text) to authenticated;

revoke all on function public.accept_referral_code(text) from public;
grant execute on function public.accept_referral_code(text) to authenticated;

do $grant$
begin
  if to_regprocedure('public.get_order_role(uuid,uuid)') is not null then
    grant execute on function public.get_order_role(uuid, uuid) to authenticated;
  end if;
  if to_regprocedure('public.get_driver_benefits(uuid,timestamptz,timestamptz)') is not null then
    grant execute on function public.get_driver_benefits(uuid, timestamptz, timestamptz) to authenticated;
  end if;
  if to_regprocedure('public.get_driver_stats(uuid,timestamptz,timestamptz)') is not null then
    grant execute on function public.get_driver_stats(uuid, timestamptz, timestamptz) to authenticated;
  end if;
end;
$grant$;

commit;
