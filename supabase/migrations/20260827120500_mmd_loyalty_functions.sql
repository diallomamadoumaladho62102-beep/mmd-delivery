-- ===========================================================================
-- MMD Loyalty Program — server-side RPCs (all SECURITY DEFINER, atomic)
-- ---------------------------------------------------------------------------
-- Every points/credit mutation runs inside one of these functions so that:
--   * operations are atomic (single transaction / row locks),
--   * accrual is exactly-once (unique idempotency_key on the ledgers),
--   * business rules (eligibility, anti-fraud, anti double-reward) are enforced
--     on the server and cannot be bypassed by the client.
-- Grants: service_role only. The Next.js API authenticates the user, then calls
-- these with the service-role client.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Tier resolution
-- ---------------------------------------------------------------------------
create or replace function public.mmd_loyalty_tier_for(p_lifetime integer)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select code
      from public.loyalty_tiers
      where active = true
        and min_lifetime_points <= greatest(0, coalesce(p_lifetime, 0))
      order by min_lifetime_points desc, sort_order desc
      limit 1
    ),
    'bronze'
  );
$$;

-- ---------------------------------------------------------------------------
-- Account / wallet bootstrap
-- ---------------------------------------------------------------------------
create or replace function public.mmd_loyalty_ensure_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;
  insert into public.loyalty_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
end;
$$;

create or replace function public.mmd_credit_ensure_wallet(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;
  insert into public.mmd_credit_wallets (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Core points accrual primitive (idempotent)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_loyalty_accrue(
  p_user_id uuid,
  p_points integer,
  p_entry_type text,
  p_reference_type text,
  p_reference_id text,
  p_idempotency_key text,
  p_description text default null,
  p_actor_user_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_lifetime integer;
  v_new_balance integer;
  v_new_lifetime integer;
  v_tier text;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_user');
  end if;
  if p_points is null or p_points = 0 then
    return jsonb_build_object('ok', false, 'error', 'zero_points');
  end if;

  if p_idempotency_key is not null and exists (
    select 1 from public.loyalty_ledger where idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('ok', true, 'already_awarded', true);
  end if;

  perform public.mmd_loyalty_ensure_account(p_user_id);

  select points_balance, lifetime_points
    into v_balance, v_lifetime
  from public.loyalty_accounts
  where user_id = p_user_id
  for update;

  v_new_balance := greatest(0, v_balance + p_points);
  v_new_lifetime := v_lifetime + greatest(0, p_points);
  v_tier := public.mmd_loyalty_tier_for(v_new_lifetime);

  insert into public.loyalty_ledger (
    user_id, delta_points, balance_after, entry_type, reference_type,
    reference_id, description, idempotency_key, actor_user_id, metadata
  ) values (
    p_user_id, p_points, v_new_balance, p_entry_type, p_reference_type,
    p_reference_id, p_description, p_idempotency_key, p_actor_user_id,
    coalesce(p_metadata, '{}'::jsonb)
  );

  update public.loyalty_accounts
  set points_balance = v_new_balance,
      lifetime_points = v_new_lifetime,
      tier_code = v_tier,
      updated_at = now()
  where user_id = p_user_id;

  return jsonb_build_object(
    'ok', true, 'balance', v_new_balance, 'lifetime', v_new_lifetime, 'tier', v_tier
  );
exception when unique_violation then
  return jsonb_build_object('ok', true, 'already_awarded', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Credit primitives: add (lot + ledger), spend (FIFO), expire (cron)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_credit_add(
  p_user_id uuid,
  p_amount_cents bigint,
  p_entry_type text,
  p_reference_type text,
  p_reference_id text,
  p_idempotency_key text,
  p_expires_at timestamptz default null,
  p_description text default null,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
  v_new bigint;
  v_currency text;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_user');
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  if p_idempotency_key is not null and exists (
    select 1 from public.mmd_credit_ledger where idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('ok', true, 'already_applied', true);
  end if;

  perform public.mmd_credit_ensure_wallet(p_user_id);

  select balance_cents, currency
    into v_balance, v_currency
  from public.mmd_credit_wallets
  where user_id = p_user_id
  for update;

  v_new := v_balance + p_amount_cents;

  insert into public.mmd_credit_lots (user_id, amount_cents, remaining_cents, expires_at, source)
  values (p_user_id, p_amount_cents, p_amount_cents, p_expires_at, coalesce(p_reference_type, p_entry_type));

  insert into public.mmd_credit_ledger (
    user_id, delta_cents, balance_after_cents, entry_type, reference_type,
    reference_id, description, idempotency_key, actor_user_id, currency
  ) values (
    p_user_id, p_amount_cents, v_new, p_entry_type, p_reference_type,
    p_reference_id, p_description, p_idempotency_key, p_actor_user_id, coalesce(v_currency, 'USD')
  );

  update public.mmd_credit_wallets
  set balance_cents = v_new, updated_at = now()
  where user_id = p_user_id;

  return jsonb_build_object('ok', true, 'balance_cents', v_new);
exception when unique_violation then
  return jsonb_build_object('ok', true, 'already_applied', true);
end;
$$;

create or replace function public.mmd_credit_spend(
  p_user_id uuid,
  p_amount_cents bigint,
  p_reference_type text,
  p_reference_id text,
  p_idempotency_key text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
  v_new bigint;
  v_remaining bigint;
  v_lot record;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_user');
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  if p_idempotency_key is not null and exists (
    select 1 from public.mmd_credit_ledger where idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('ok', true, 'already_applied', true);
  end if;

  perform public.mmd_credit_ensure_wallet(p_user_id);

  select balance_cents into v_balance
  from public.mmd_credit_wallets
  where user_id = p_user_id
  for update;

  if v_balance < p_amount_cents then
    return jsonb_build_object('ok', false, 'error', 'insufficient_credit');
  end if;

  v_remaining := p_amount_cents;
  for v_lot in
    select id, remaining_cents
    from public.mmd_credit_lots
    where user_id = p_user_id
      and remaining_cents > 0
      and (expires_at is null or expires_at > now())
    order by expires_at nulls last, created_at
    for update
  loop
    exit when v_remaining <= 0;
    if v_lot.remaining_cents <= v_remaining then
      v_remaining := v_remaining - v_lot.remaining_cents;
      update public.mmd_credit_lots set remaining_cents = 0 where id = v_lot.id;
    else
      update public.mmd_credit_lots
      set remaining_cents = remaining_cents - v_remaining
      where id = v_lot.id;
      v_remaining := 0;
    end if;
  end loop;

  if v_remaining > 0 then
    -- lots didn't cover the balance (expired credit); refuse rather than overspend
    return jsonb_build_object('ok', false, 'error', 'insufficient_active_credit');
  end if;

  v_new := v_balance - p_amount_cents;

  insert into public.mmd_credit_ledger (
    user_id, delta_cents, balance_after_cents, entry_type, reference_type,
    reference_id, description, idempotency_key
  ) values (
    p_user_id, -p_amount_cents, v_new, 'spend', p_reference_type,
    p_reference_id, p_description, p_idempotency_key
  );

  update public.mmd_credit_wallets
  set balance_cents = v_new, updated_at = now()
  where user_id = p_user_id;

  return jsonb_build_object('ok', true, 'balance_cents', v_new);
exception when unique_violation then
  return jsonb_build_object('ok', true, 'already_applied', true);
end;
$$;

create or replace function public.mmd_credit_expire_due()
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
begin
  for v_lot in
    select id, user_id, remaining_cents
    from public.mmd_credit_lots
    where remaining_cents > 0
      and expires_at is not null
      and expires_at <= now()
    order by user_id
    for update
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

  return jsonb_build_object('ok', true, 'expired_lots', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- Points -> Crédit MMD conversion (atomic)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_convert_points(
  p_user_id uuid,
  p_blocks integer default 1,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.loyalty_settings%rowtype;
  v_needed integer;
  v_credit bigint;
  v_balance integer;
  v_expires timestamptz;
  v_key text;
  v_deduct jsonb;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_user');
  end if;
  if p_blocks is null or p_blocks < 1 then
    return jsonb_build_object('ok', false, 'error', 'invalid_blocks');
  end if;

  select * into v_settings from public.loyalty_settings where singleton = true;
  if not coalesce(v_settings.enabled, false) then
    return jsonb_build_object('ok', false, 'error', 'program_disabled');
  end if;

  v_needed := v_settings.conversion_points * p_blocks;
  v_credit := v_settings.conversion_credit_cents::bigint * p_blocks;
  v_key := coalesce(p_idempotency_key, gen_random_uuid()::text);

  perform public.mmd_loyalty_ensure_account(p_user_id);

  select points_balance into v_balance
  from public.loyalty_accounts
  where user_id = p_user_id
  for update;

  if coalesce(v_balance, 0) < v_needed then
    return jsonb_build_object('ok', false, 'error', 'insufficient_points',
      'balance', coalesce(v_balance, 0), 'needed', v_needed);
  end if;

  v_deduct := public.mmd_loyalty_accrue(
    p_user_id, -v_needed, 'conversion', 'conversion', v_key,
    'convert:' || v_key, 'Conversion points vers Crédit MMD', p_user_id,
    jsonb_build_object('blocks', p_blocks, 'credit_cents', v_credit)
  );

  if coalesce((v_deduct ->> 'already_awarded')::boolean, false) then
    return jsonb_build_object('ok', true, 'already_converted', true);
  end if;

  if v_settings.credit_validity_months > 0 then
    v_expires := now() + make_interval(months => v_settings.credit_validity_months);
  else
    v_expires := null;
  end if;

  perform public.mmd_credit_add(
    p_user_id, v_credit, 'conversion', 'conversion', v_key,
    'convert-credit:' || v_key, v_expires, 'Conversion points vers Crédit MMD', p_user_id
  );

  return jsonb_build_object(
    'ok', true,
    'points_spent', v_needed,
    'credit_cents', v_credit,
    'expires_at', v_expires
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin adjustments (audited by the API layer)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_loyalty_admin_adjust(
  p_admin_user_id uuid,
  p_user_id uuid,
  p_delta_points integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_delta_points is null or p_delta_points = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;
  return public.mmd_loyalty_accrue(
    p_user_id, p_delta_points, 'admin_adjust', 'admin', null,
    'admin-adjust:' || gen_random_uuid()::text,
    coalesce(p_reason, 'Ajustement administrateur'), p_admin_user_id,
    jsonb_build_object('reason', p_reason)
  );
end;
$$;

create or replace function public.mmd_credit_admin_adjust(
  p_admin_user_id uuid,
  p_user_id uuid,
  p_delta_cents bigint,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := 'admin-credit:' || gen_random_uuid()::text;
begin
  if p_user_id is null or p_delta_cents is null or p_delta_cents = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  if p_delta_cents > 0 then
    return public.mmd_credit_add(
      p_user_id, p_delta_cents, 'admin_adjust', 'admin', null, v_key, null,
      coalesce(p_reason, 'Ajustement crédit administrateur'), p_admin_user_id
    );
  else
    return public.mmd_credit_spend(
      p_user_id, abs(p_delta_cents), 'admin', null, v_key,
      coalesce(p_reason, 'Retrait crédit administrateur')
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Campaign evaluation — returns bonus points to add, increments uses
-- days_of_week uses PostgreSQL dow: 0=Sunday .. 6=Saturday
-- ---------------------------------------------------------------------------
create or replace function public.mmd_campaign_apply(
  p_audience text,
  p_vertical text,
  p_context jsonb,
  p_base_points integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_flat integer := 0;
  v_mult numeric := 1;
  v_now timestamptz := now();
  v_dow integer := extract(dow from now())::int;
  v_hour integer := extract(hour from now())::int;
begin
  for v_row in
    select *
    from public.loyalty_campaigns c
    where c.active = true
      and (c.audience = p_audience or c.audience = 'both')
      and (c.vertical = p_vertical or c.vertical = 'any')
      and (c.starts_at is null or c.starts_at <= v_now)
      and (c.ends_at is null or c.ends_at >= v_now)
      and (array_length(c.days_of_week, 1) is null or v_dow = any (c.days_of_week))
      and (c.hour_start is null or v_hour >= c.hour_start)
      and (c.hour_end is null or v_hour <= c.hour_end)
      and (c.country_code is null or c.country_code = coalesce(p_context ->> 'country_code', ''))
      and (c.city is null or lower(c.city) = lower(coalesce(p_context ->> 'city', '')))
      and (c.restaurant_id is null or c.restaurant_id = coalesce(p_context ->> 'restaurant_id', ''))
      and (c.category is null or lower(c.category) = lower(coalesce(p_context ->> 'category', '')))
      and (c.max_uses is null or c.uses_count < c.max_uses)
    for update
  loop
    if v_row.bonus_type = 'flat' then
      v_flat := v_flat + v_row.bonus_points;
    else
      v_mult := v_mult * v_row.multiplier;
    end if;
    update public.loyalty_campaigns
    set uses_count = uses_count + 1, updated_at = now()
    where id = v_row.id;
  end loop;

  return v_flat + greatest(0, round(coalesce(p_base_points, 0) * (v_mult - 1))::integer);
end;
$$;

-- ---------------------------------------------------------------------------
-- Referral: codes, apply-on-signup, reward-on-first-order
-- ---------------------------------------------------------------------------
create or replace function public.mmd_loyalty_get_or_create_code(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_try integer := 0;
begin
  if p_user_id is null then
    return null;
  end if;

  select code into v_code from public.loyalty_referral_codes where user_id = p_user_id;
  if v_code is not null then
    return v_code;
  end if;

  loop
    v_try := v_try + 1;
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      insert into public.loyalty_referral_codes (user_id, code) values (p_user_id, v_code);
      return v_code;
    exception when unique_violation then
      if v_try >= 5 then
        -- extremely unlikely; fall back to a longer code
        v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
        insert into public.loyalty_referral_codes (user_id, code) values (p_user_id, v_code)
        on conflict (user_id) do update set code = excluded.code;
        return v_code;
      end if;
    end;
  end loop;
end;
$$;

create or replace function public.mmd_loyalty_apply_referral_code(
  p_referred_user_id uuid,
  p_code text,
  p_audience text default 'client'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer uuid;
  v_clean text := upper(trim(coalesce(p_code, '')));
  v_audience text := case when p_audience = 'driver' then 'driver' else 'client' end;
begin
  if p_referred_user_id is null or v_clean = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  -- anti-fraud: one referral per referred user, ever
  if exists (select 1 from public.loyalty_referrals where referred_user_id = p_referred_user_id) then
    return jsonb_build_object('ok', false, 'error', 'already_referred');
  end if;

  select user_id into v_referrer from public.loyalty_referral_codes where code = v_clean;
  if v_referrer is null then
    return jsonb_build_object('ok', false, 'error', 'code_not_found');
  end if;
  if v_referrer = p_referred_user_id then
    return jsonb_build_object('ok', false, 'error', 'self_referral');
  end if;

  insert into public.loyalty_referrals (referrer_user_id, referred_user_id, code, audience, status)
  values (v_referrer, p_referred_user_id, v_clean, v_audience, 'pending')
  on conflict (referred_user_id) do nothing;

  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

create or replace function public.mmd_process_referral(p_referred_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.loyalty_referrals%rowtype;
  v_settings public.loyalty_settings%rowtype;
  v_points integer;
begin
  if p_referred_user_id is null then
    return jsonb_build_object('ok', true, 'no_pending', true);
  end if;

  select * into v_ref
  from public.loyalty_referrals
  where referred_user_id = p_referred_user_id and status = 'pending'
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'no_pending', true);
  end if;

  select * into v_settings from public.loyalty_settings where singleton = true;

  if v_ref.audience = 'driver' then
    v_points := coalesce(v_settings.referral_points_driver, 0);
  else
    v_points := coalesce(v_settings.referral_points_client, 0);
  end if;

  if v_points > 0 then
    perform public.mmd_loyalty_accrue(
      v_ref.referred_user_id, v_points, 'referral', 'referral', v_ref.id::text,
      'referral:' || v_ref.id::text || ':referred', 'Bonus parrainage (filleul)',
      null, jsonb_build_object('role', 'referred')
    );
    perform public.mmd_loyalty_accrue(
      v_ref.referrer_user_id, v_points, 'referral', 'referral', v_ref.id::text,
      'referral:' || v_ref.id::text || ':referrer', 'Bonus parrainage (parrain)',
      null, jsonb_build_object('role', 'referrer')
    );
  end if;

  update public.loyalty_referrals
  set status = 'rewarded', rewarded_at = now(), updated_at = now()
  where id = v_ref.id and status = 'pending';

  return jsonb_build_object('ok', true, 'rewarded', true, 'points', v_points);
end;
$$;

-- ---------------------------------------------------------------------------
-- Per-vertical accrual (idempotent, guarded by terminal + paid state)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_accrue_taxi_ride(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.taxi_rides%rowtype;
  v_settings public.loyalty_settings%rowtype;
  v_base integer;
  v_bonus integer;
  v_ctx jsonb;
begin
  select * into v_ride from public.taxi_rides where id = p_ride_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ride_not_found');
  end if;
  if lower(coalesce(v_ride.status, '')) <> 'completed'
     or lower(coalesce(v_ride.payment_status, '')) <> 'paid' then
    return jsonb_build_object('ok', false, 'error', 'not_eligible');
  end if;

  select * into v_settings from public.loyalty_settings where singleton = true;
  if not coalesce(v_settings.enabled, false) then
    return jsonb_build_object('ok', true, 'skipped', 'disabled');
  end if;

  v_base := coalesce(v_settings.points_per_ride, 0);
  v_ctx := jsonb_build_object('country_code', coalesce(v_ride.country_code, ''));

  if v_base > 0 and v_ride.client_user_id is not null then
    v_bonus := public.mmd_campaign_apply('client', 'taxi', v_ctx, v_base);
    perform public.mmd_loyalty_accrue(
      v_ride.client_user_id, v_base + v_bonus, 'taxi', 'taxi_ride', p_ride_id::text,
      'taxi:' || p_ride_id::text || ':client', 'Course taxi terminée', null, v_ctx
    );
    perform public.mmd_process_referral(v_ride.client_user_id);
  end if;

  if v_base > 0 and v_ride.driver_id is not null then
    v_bonus := public.mmd_campaign_apply('driver', 'taxi', v_ctx, v_base);
    perform public.mmd_loyalty_accrue(
      v_ride.driver_id, v_base + v_bonus, 'taxi', 'taxi_ride', p_ride_id::text,
      'taxi:' || p_ride_id::text || ':driver', 'Course taxi terminée', null, v_ctx
    );
    perform public.mmd_process_referral(v_ride.driver_id);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.mmd_accrue_marketplace_order(p_seller_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_json jsonb;
  v_client uuid;
  v_status text;
  v_pay text;
  v_settings public.loyalty_settings%rowtype;
  v_base integer;
  v_bonus integer;
  v_ctx jsonb;
begin
  select to_jsonb(o.*) into v_json from public.seller_orders o where o.id = p_seller_order_id;
  if v_json is null then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  v_status := lower(coalesce(v_json ->> 'status', ''));
  v_pay := lower(coalesce(v_json ->> 'payment_status', ''));
  if v_pay <> 'paid' or v_status in ('cancelled', 'canceled', 'payment_failed') then
    return jsonb_build_object('ok', false, 'error', 'not_eligible');
  end if;

  select * into v_settings from public.loyalty_settings where singleton = true;
  if not coalesce(v_settings.enabled, false) then
    return jsonb_build_object('ok', true, 'skipped', 'disabled');
  end if;

  v_base := coalesce(v_settings.points_per_delivery, 0);
  if v_base <= 0 then
    return jsonb_build_object('ok', true, 'skipped', 'zero_points');
  end if;

  v_client := nullif(v_json ->> 'client_user_id', '')::uuid;
  v_ctx := jsonb_build_object('country_code', coalesce(v_json ->> 'country_code', ''));

  if v_client is not null then
    v_bonus := public.mmd_campaign_apply('client', 'marketplace', v_ctx, v_base);
    perform public.mmd_loyalty_accrue(
      v_client, v_base + v_bonus, 'order', 'marketplace_order', p_seller_order_id::text,
      'mp:' || p_seller_order_id::text || ':client', 'Commande marketplace terminée', null, v_ctx
    );
    perform public.mmd_process_referral(v_client);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.mmd_accrue_food_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_json jsonb;
  v_client uuid;
  v_driver uuid;
  v_status text;
  v_pay text;
  v_settings public.loyalty_settings%rowtype;
  v_base integer;
  v_bonus integer;
  v_ctx jsonb;
begin
  select to_jsonb(o.*) into v_json from public.orders o where o.id = p_order_id;
  if v_json is null then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  v_status := lower(coalesce(v_json ->> 'status', ''));
  v_pay := lower(coalesce(v_json ->> 'payment_status', ''));
  if v_status <> 'delivered' or v_pay <> 'paid' then
    return jsonb_build_object('ok', false, 'error', 'not_eligible');
  end if;

  select * into v_settings from public.loyalty_settings where singleton = true;
  if not coalesce(v_settings.enabled, false) then
    return jsonb_build_object('ok', true, 'skipped', 'disabled');
  end if;

  v_base := coalesce(v_settings.points_per_delivery, 0);
  if v_base <= 0 then
    return jsonb_build_object('ok', true, 'skipped', 'zero_points');
  end if;

  v_client := nullif(
    coalesce(v_json ->> 'client_id', v_json ->> 'client_user_id', v_json ->> 'user_id'), ''
  )::uuid;
  v_driver := nullif(v_json ->> 'driver_id', '')::uuid;
  v_ctx := jsonb_build_object(
    'country_code', coalesce(v_json ->> 'country_code', ''),
    'restaurant_id', coalesce(v_json ->> 'restaurant_id', v_json ->> 'restaurant_user_id', '')
  );

  if v_client is not null then
    v_bonus := public.mmd_campaign_apply('client', 'food', v_ctx, v_base);
    perform public.mmd_loyalty_accrue(
      v_client, v_base + v_bonus, 'order', 'food_order', p_order_id::text,
      'food:' || p_order_id::text || ':client', 'Livraison terminée', null, v_ctx
    );
    perform public.mmd_process_referral(v_client);
  end if;

  if v_driver is not null then
    v_bonus := public.mmd_campaign_apply('driver', 'food', v_ctx, v_base);
    perform public.mmd_loyalty_accrue(
      v_driver, v_base + v_bonus, 'order', 'food_order', p_order_id::text,
      'food:' || p_order_id::text || ':driver', 'Livraison terminée', null, v_ctx
    );
    perform public.mmd_process_referral(v_driver);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.mmd_accrue_delivery_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_json jsonb;
  v_client uuid;
  v_driver uuid;
  v_status text;
  v_pay text;
  v_settings public.loyalty_settings%rowtype;
  v_base integer;
  v_bonus integer;
  v_ctx jsonb;
begin
  select to_jsonb(o.*) into v_json from public.delivery_requests o where o.id = p_request_id;
  if v_json is null then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;

  v_status := lower(coalesce(v_json ->> 'status', ''));
  v_pay := lower(coalesce(v_json ->> 'payment_status', ''));
  if v_status <> 'delivered' or v_pay <> 'paid' then
    return jsonb_build_object('ok', false, 'error', 'not_eligible');
  end if;

  select * into v_settings from public.loyalty_settings where singleton = true;
  if not coalesce(v_settings.enabled, false) then
    return jsonb_build_object('ok', true, 'skipped', 'disabled');
  end if;

  v_base := coalesce(v_settings.points_per_delivery, 0);
  if v_base <= 0 then
    return jsonb_build_object('ok', true, 'skipped', 'zero_points');
  end if;

  v_client := nullif(
    coalesce(v_json ->> 'client_id', v_json ->> 'client_user_id', v_json ->> 'user_id'), ''
  )::uuid;
  v_driver := nullif(coalesce(v_json ->> 'driver_id', v_json ->> 'driver_user_id'), '')::uuid;
  v_ctx := jsonb_build_object('country_code', coalesce(v_json ->> 'country_code', ''));

  if v_client is not null then
    v_bonus := public.mmd_campaign_apply('client', 'delivery', v_ctx, v_base);
    perform public.mmd_loyalty_accrue(
      v_client, v_base + v_bonus, 'order', 'delivery_request', p_request_id::text,
      'delivery:' || p_request_id::text || ':client', 'Livraison terminée', null, v_ctx
    );
    perform public.mmd_process_referral(v_client);
  end if;

  if v_driver is not null then
    v_bonus := public.mmd_campaign_apply('driver', 'delivery', v_ctx, v_base);
    perform public.mmd_loyalty_accrue(
      v_driver, v_base + v_bonus, 'order', 'delivery_request', p_request_id::text,
      'delivery:' || p_request_id::text || ':driver', 'Livraison terminée', null, v_ctx
    );
    perform public.mmd_process_referral(v_driver);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants — service_role only (Next.js API authenticates then calls as service)
-- ---------------------------------------------------------------------------
revoke all on function public.mmd_loyalty_tier_for(integer) from public;
revoke all on function public.mmd_loyalty_ensure_account(uuid) from public;
revoke all on function public.mmd_credit_ensure_wallet(uuid) from public;
revoke all on function public.mmd_loyalty_accrue(uuid, integer, text, text, text, text, text, uuid, jsonb) from public;
revoke all on function public.mmd_credit_add(uuid, bigint, text, text, text, text, timestamptz, text, uuid) from public;
revoke all on function public.mmd_credit_spend(uuid, bigint, text, text, text, text) from public;
revoke all on function public.mmd_credit_expire_due() from public;
revoke all on function public.mmd_convert_points(uuid, integer, text) from public;
revoke all on function public.mmd_loyalty_admin_adjust(uuid, uuid, integer, text) from public;
revoke all on function public.mmd_credit_admin_adjust(uuid, uuid, bigint, text) from public;
revoke all on function public.mmd_campaign_apply(text, text, jsonb, integer) from public;
revoke all on function public.mmd_loyalty_get_or_create_code(uuid) from public;
revoke all on function public.mmd_loyalty_apply_referral_code(uuid, text, text) from public;
revoke all on function public.mmd_process_referral(uuid) from public;
revoke all on function public.mmd_accrue_taxi_ride(uuid) from public;
revoke all on function public.mmd_accrue_marketplace_order(uuid) from public;
revoke all on function public.mmd_accrue_food_order(uuid) from public;
revoke all on function public.mmd_accrue_delivery_request(uuid) from public;

grant execute on function public.mmd_loyalty_tier_for(integer) to service_role;
grant execute on function public.mmd_loyalty_ensure_account(uuid) to service_role;
grant execute on function public.mmd_credit_ensure_wallet(uuid) to service_role;
grant execute on function public.mmd_loyalty_accrue(uuid, integer, text, text, text, text, text, uuid, jsonb) to service_role;
grant execute on function public.mmd_credit_add(uuid, bigint, text, text, text, text, timestamptz, text, uuid) to service_role;
grant execute on function public.mmd_credit_spend(uuid, bigint, text, text, text, text) to service_role;
grant execute on function public.mmd_credit_expire_due() to service_role;
grant execute on function public.mmd_convert_points(uuid, integer, text) to service_role;
grant execute on function public.mmd_loyalty_admin_adjust(uuid, uuid, integer, text) to service_role;
grant execute on function public.mmd_credit_admin_adjust(uuid, uuid, bigint, text) to service_role;
grant execute on function public.mmd_campaign_apply(text, text, jsonb, integer) to service_role;
grant execute on function public.mmd_loyalty_get_or_create_code(uuid) to service_role;
grant execute on function public.mmd_loyalty_apply_referral_code(uuid, text, text) to service_role;
grant execute on function public.mmd_process_referral(uuid) to service_role;
grant execute on function public.mmd_accrue_taxi_ride(uuid) to service_role;
grant execute on function public.mmd_accrue_marketplace_order(uuid) to service_role;
grant execute on function public.mmd_accrue_food_order(uuid) to service_role;
grant execute on function public.mmd_accrue_delivery_request(uuid) to service_role;

commit;
