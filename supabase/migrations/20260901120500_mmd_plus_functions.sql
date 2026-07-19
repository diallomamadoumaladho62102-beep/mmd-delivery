-- ===========================================================================
-- MMD+ — Phase 6 RPCs (SECURITY DEFINER, service_role only)
-- ---------------------------------------------------------------------------
-- Independent from loyalty / credit / commissions / partner subscriptions.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Sync plan features → mmd_plus_active_benefits (config-driven, no product ifs)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_plus_sync_benefits(p_subscription_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.mmd_plus_subscriptions%rowtype;
  v_feat record;
  v_count integer := 0;
begin
  select * into v_sub from public.mmd_plus_subscriptions where id = p_subscription_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription_not_found');
  end if;

  update public.mmd_plus_active_benefits
  set status = 'canceled', updated_at = now()
  where subscription_id = p_subscription_id
    and status in ('scheduled', 'active', 'suspended');

  if v_sub.status not in ('active', 'trialing') then
    return jsonb_build_object('ok', true, 'synced', 0, 'skipped', 'not_active');
  end if;

  for v_feat in
    select pf.*, f.apply_as, f.service_scopes
    from public.mmd_plus_plan_features pf
    join public.mmd_plus_features f on f.key = pf.feature_key
    where pf.plan_id = v_sub.plan_id
      and pf.enabled = true
      and f.active = true
  loop
    insert into public.mmd_plus_active_benefits (
      subscription_id, user_id, feature_key, apply_as, service_scopes,
      value_boolean, value_integer, value_numeric, value_text, value_json,
      starts_at, expires_at, status
    ) values (
      p_subscription_id, v_sub.user_id, v_feat.feature_key, v_feat.apply_as, v_feat.service_scopes,
      coalesce(v_feat.value_boolean, v_feat.enabled),
      v_feat.value_integer, v_feat.value_numeric, v_feat.value_text, v_feat.value_json,
      coalesce(v_sub.current_period_start, v_sub.starts_at, now()),
      v_sub.current_period_end,
      'active'
    );
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'synced', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- Activate
-- ---------------------------------------------------------------------------
create or replace function public.mmd_plus_activate(
  p_user_id uuid,
  p_plan_id uuid,
  p_stripe_subscription_id text default null,
  p_stripe_customer_id text default null,
  p_is_trial boolean default false,
  p_trial_days integer default null,
  p_offered_by_admin boolean default false,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.mmd_plus_plans%rowtype;
  v_existing uuid;
  v_sub_id uuid;
  v_now timestamptz := now();
  v_period_end timestamptz;
  v_trial_end timestamptz;
  v_status text;
  v_key text;
begin
  if p_user_id is null or p_plan_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  if p_stripe_subscription_id is not null then
    select id into v_existing
    from public.mmd_plus_subscriptions
    where stripe_subscription_id = p_stripe_subscription_id;
    if found then
      return jsonb_build_object('ok', true, 'already_active', true, 'subscription_id', v_existing);
    end if;
  end if;

  v_key := p_idempotency_key;
  if v_key is not null then
    select id into v_existing
    from public.mmd_plus_subscriptions
    where metadata ->> 'idempotency_key' = v_key;
    if found then
      return jsonb_build_object('ok', true, 'already_active', true, 'subscription_id', v_existing);
    end if;
  end if;

  select * into v_plan from public.mmd_plus_plans where id = p_plan_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'plan_not_found');
  end if;
  if v_plan.status <> 'active' and not coalesce(p_offered_by_admin, false) then
    return jsonb_build_object('ok', false, 'error', 'plan_not_active');
  end if;

  update public.mmd_plus_subscriptions
  set status = 'canceled',
      canceled_at = v_now,
      cancel_reason = 'replaced_by_new_subscription',
      renews = false,
      updated_at = v_now
  where user_id = p_user_id
    and status in ('active', 'trialing', 'past_due', 'paused');

  update public.mmd_plus_active_benefits b
  set status = 'canceled', updated_at = v_now
  from public.mmd_plus_subscriptions s
  where b.subscription_id = s.id
    and s.user_id = p_user_id
    and b.status in ('scheduled', 'active', 'suspended');

  if coalesce(p_is_trial, false) or (v_plan.trial_enabled and coalesce(p_trial_days, v_plan.trial_days, 0) > 0) then
    v_status := 'trialing';
    v_trial_end := v_now + make_interval(days => greatest(coalesce(p_trial_days, v_plan.trial_days, 0), 1));
    v_period_end := v_trial_end;
  else
    v_status := 'active';
    v_trial_end := null;
    if v_plan.billing_period = 'yearly' then
      v_period_end := v_now + interval '1 year';
    else
      v_period_end := v_now + interval '1 month';
    end if;
  end if;

  insert into public.mmd_plus_subscriptions (
    user_id, plan_id, status,
    starts_at, ends_at, trial_ends_at,
    current_period_start, current_period_end,
    renews, is_trial, price_cents, currency,
    stripe_subscription_id, stripe_customer_id, stripe_price_id,
    offered_by_admin, metadata
  ) values (
    p_user_id, p_plan_id, v_status,
    v_now, null, v_trial_end,
    v_now, v_period_end,
    true, (v_status = 'trialing'), v_plan.price_cents, v_plan.currency,
    p_stripe_subscription_id, p_stripe_customer_id, v_plan.stripe_price_id,
    coalesce(p_offered_by_admin, false),
    coalesce(p_metadata, '{}'::jsonb)
      || case when v_key is not null then jsonb_build_object('idempotency_key', v_key) else '{}'::jsonb end
  )
  returning id into v_sub_id;

  perform public.mmd_plus_sync_benefits(v_sub_id);

  return jsonb_build_object(
    'ok', true,
    'subscription_id', v_sub_id,
    'status', v_status,
    'current_period_end', v_period_end,
    'is_trial', (v_status = 'trialing')
  );
end;
$$;

create or replace function public.mmd_plus_cancel(
  p_subscription_id uuid,
  p_at_period_end boolean default true,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.mmd_plus_subscriptions%rowtype;
begin
  select * into v_sub from public.mmd_plus_subscriptions where id = p_subscription_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription_not_found');
  end if;

  if coalesce(p_at_period_end, true) then
    update public.mmd_plus_subscriptions
    set cancel_at_period_end = true,
        cancel_reason = p_reason,
        renews = false,
        updated_at = now()
    where id = p_subscription_id;
    return jsonb_build_object('ok', true, 'cancel_at_period_end', true);
  end if;

  update public.mmd_plus_subscriptions
  set status = 'canceled',
      canceled_at = now(),
      cancel_reason = p_reason,
      renews = false,
      cancel_at_period_end = false,
      updated_at = now()
  where id = p_subscription_id;

  update public.mmd_plus_active_benefits
  set status = 'canceled', updated_at = now()
  where subscription_id = p_subscription_id and status in ('scheduled', 'active', 'suspended');

  return jsonb_build_object('ok', true, 'canceled', true);
end;
$$;

create or replace function public.mmd_plus_resume(p_subscription_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.mmd_plus_subscriptions%rowtype;
begin
  select * into v_sub from public.mmd_plus_subscriptions where id = p_subscription_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription_not_found');
  end if;

  if v_sub.status = 'canceled' and (v_sub.current_period_end is null or v_sub.current_period_end <= now()) then
    return jsonb_build_object('ok', false, 'error', 'subscription_expired');
  end if;

  update public.mmd_plus_subscriptions
  set status = case when is_trial and trial_ends_at > now() then 'trialing' else 'active' end,
      cancel_at_period_end = false,
      canceled_at = null,
      renews = true,
      updated_at = now()
  where id = p_subscription_id;

  perform public.mmd_plus_sync_benefits(p_subscription_id);
  return jsonb_build_object('ok', true, 'resumed', true);
end;
$$;

create or replace function public.mmd_plus_change_plan(
  p_subscription_id uuid,
  p_new_plan_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.mmd_plus_subscriptions%rowtype;
  v_plan public.mmd_plus_plans%rowtype;
begin
  select * into v_sub from public.mmd_plus_subscriptions where id = p_subscription_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription_not_found');
  end if;
  if v_sub.status not in ('active', 'trialing', 'past_due', 'paused') then
    return jsonb_build_object('ok', false, 'error', 'subscription_not_changeable');
  end if;

  select * into v_plan from public.mmd_plus_plans where id = p_new_plan_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_plan');
  end if;

  update public.mmd_plus_subscriptions
  set plan_id = p_new_plan_id,
      price_cents = v_plan.price_cents,
      currency = v_plan.currency,
      stripe_price_id = v_plan.stripe_price_id,
      metadata = metadata || jsonb_build_object(
        'previous_plan_id', v_sub.plan_id,
        'change_reason', p_reason,
        'changed_at', now()
      ),
      updated_at = now()
  where id = p_subscription_id;

  perform public.mmd_plus_sync_benefits(p_subscription_id);
  return jsonb_build_object('ok', true, 'plan_id', p_new_plan_id);
end;
$$;

create or replace function public.mmd_plus_extend(
  p_subscription_id uuid,
  p_days integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.mmd_plus_subscriptions%rowtype;
  v_new_end timestamptz;
begin
  if p_days is null or p_days <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_days');
  end if;
  select * into v_sub from public.mmd_plus_subscriptions where id = p_subscription_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription_not_found');
  end if;

  v_new_end := coalesce(v_sub.current_period_end, now()) + make_interval(days => p_days);

  update public.mmd_plus_subscriptions
  set current_period_end = v_new_end,
      ends_at = null,
      status = case when status in ('expired', 'canceled') then 'active' else status end,
      metadata = metadata || jsonb_build_object('extended_days', p_days, 'extend_reason', p_reason),
      updated_at = now()
  where id = p_subscription_id;

  update public.mmd_plus_active_benefits
  set expires_at = v_new_end, status = 'active', updated_at = now()
  where subscription_id = p_subscription_id
    and status in ('active', 'expired', 'canceled', 'suspended');

  return jsonb_build_object('ok', true, 'current_period_end', v_new_end);
end;
$$;

create or replace function public.mmd_plus_suspend(
  p_subscription_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.mmd_plus_subscriptions
  set status = 'suspended',
      cancel_reason = p_reason,
      updated_at = now()
  where id = p_subscription_id
    and status in ('active', 'trialing', 'past_due', 'paused');

  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription_not_found_or_not_suspendable');
  end if;

  update public.mmd_plus_active_benefits
  set status = 'suspended', updated_at = now()
  where subscription_id = p_subscription_id and status = 'active';

  return jsonb_build_object('ok', true, 'suspended', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Load entitlements (single optimized read for checkout cache)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_plus_load_entitlements(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_sub public.mmd_plus_subscriptions%rowtype;
  v_benefits jsonb;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', true, 'active', false);
  end if;

  select * into v_sub
  from public.mmd_plus_subscriptions
  where user_id = p_user_id
    and status in ('active', 'trialing')
  order by updated_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'active', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'feature_key', b.feature_key,
    'apply_as', b.apply_as,
    'service_scopes', to_jsonb(b.service_scopes),
    'value_boolean', b.value_boolean,
    'value_integer', b.value_integer,
    'value_numeric', b.value_numeric,
    'value_text', b.value_text,
    'value_json', b.value_json
  ) order by b.feature_key), '[]'::jsonb)
  into v_benefits
  from public.mmd_plus_active_benefits b
  where b.subscription_id = v_sub.id
    and b.status = 'active'
    and (b.expires_at is null or b.expires_at > now())
    and (b.starts_at is null or b.starts_at <= now());

  return jsonb_build_object(
    'ok', true,
    'active', true,
    'subscription_id', v_sub.id,
    'plan_id', v_sub.plan_id,
    'status', v_sub.status,
    'is_trial', v_sub.is_trial,
    'current_period_end', v_sub.current_period_end,
    'benefits', v_benefits
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Resolve checkout adjustments (config-driven via apply_as)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_plus_resolve_checkout_benefits(
  p_user_id uuid,
  p_service text,
  p_subtotal_cents integer default 0,
  p_delivery_fee_cents integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ent jsonb;
  v_ben jsonb;
  v_apply text;
  v_scopes jsonb;
  v_num numeric;
  v_delivery_discount integer := 0;
  v_order_discount integer := 0;
  v_cashback_pct numeric := 0;
  v_loyalty_bonus_pct numeric := 0;
  v_flags jsonb := '{}'::jsonb;
  v_fee integer;
  v_sub integer;
  v_applied jsonb := '[]'::jsonb;
begin
  if p_service is null or p_service not in ('food', 'delivery', 'taxi', 'marketplace') then
    return jsonb_build_object('ok', false, 'error', 'invalid_service');
  end if;

  v_ent := public.mmd_plus_load_entitlements(p_user_id);
  if coalesce((v_ent ->> 'active')::boolean, false) is not true then
    return jsonb_build_object(
      'ok', true, 'active', false,
      'delivery_fee_discount_cents', 0,
      'order_discount_cents', 0,
      'cashback_pct', 0,
      'loyalty_points_bonus_pct', 0,
      'flags', '{}'::jsonb,
      'applied', '[]'::jsonb
    );
  end if;

  v_fee := greatest(coalesce(p_delivery_fee_cents, 0), 0);
  v_sub := greatest(coalesce(p_subtotal_cents, 0), 0);

  for v_ben in select * from jsonb_array_elements(coalesce(v_ent -> 'benefits', '[]'::jsonb))
  loop
    v_apply := coalesce(v_ben ->> 'apply_as', 'none');
    v_scopes := coalesce(v_ben -> 'service_scopes', '["all"]'::jsonb);
    if not (v_scopes ? 'all' or v_scopes ? p_service) then
      continue;
    end if;

    v_num := coalesce((v_ben ->> 'value_numeric')::numeric, 0);

    if v_apply = 'delivery_fee_zero' and coalesce((v_ben ->> 'value_boolean')::boolean, true) then
      v_delivery_discount := greatest(v_delivery_discount, v_fee);
      v_applied := v_applied || jsonb_build_array(jsonb_build_object('key', v_ben ->> 'feature_key', 'as', v_apply));
    elsif v_apply = 'delivery_fee_zero_min_order' and v_sub >= round(v_num * 100) then
      -- value_numeric interpreted as currency units (e.g. 25.00 = $25)
      v_delivery_discount := greatest(v_delivery_discount, v_fee);
      v_applied := v_applied || jsonb_build_array(jsonb_build_object('key', v_ben ->> 'feature_key', 'as', v_apply));
    elsif v_apply = 'delivery_fee_pct' and v_num > 0 then
      v_delivery_discount := greatest(v_delivery_discount, least(v_fee, round(v_fee * v_num / 100.0)::integer));
      v_applied := v_applied || jsonb_build_array(jsonb_build_object('key', v_ben ->> 'feature_key', 'as', v_apply, 'pct', v_num));
    elsif v_apply = 'food_pct' and p_service = 'food' and v_num > 0 then
      v_order_discount := v_order_discount + least(v_sub, round(v_sub * v_num / 100.0)::integer);
      v_applied := v_applied || jsonb_build_array(jsonb_build_object('key', v_ben ->> 'feature_key', 'as', v_apply, 'pct', v_num));
    elsif v_apply = 'delivery_pct' and p_service = 'delivery' and v_num > 0 then
      v_order_discount := v_order_discount + least(v_sub, round(v_sub * v_num / 100.0)::integer);
      v_applied := v_applied || jsonb_build_array(jsonb_build_object('key', v_ben ->> 'feature_key', 'as', v_apply, 'pct', v_num));
    elsif v_apply = 'marketplace_pct' and p_service = 'marketplace' and v_num > 0 then
      v_order_discount := v_order_discount + least(v_sub, round(v_sub * v_num / 100.0)::integer);
      v_applied := v_applied || jsonb_build_array(jsonb_build_object('key', v_ben ->> 'feature_key', 'as', v_apply, 'pct', v_num));
    elsif v_apply = 'taxi_pct' and p_service = 'taxi' and v_num > 0 then
      v_order_discount := v_order_discount + least(v_sub, round(v_sub * v_num / 100.0)::integer);
      v_applied := v_applied || jsonb_build_array(jsonb_build_object('key', v_ben ->> 'feature_key', 'as', v_apply, 'pct', v_num));
    elsif v_apply = 'order_pct' and v_num > 0 then
      v_order_discount := v_order_discount + least(v_sub, round(v_sub * v_num / 100.0)::integer);
      v_applied := v_applied || jsonb_build_array(jsonb_build_object('key', v_ben ->> 'feature_key', 'as', v_apply, 'pct', v_num));
    elsif v_apply = 'cashback_pct' and v_num > 0 then
      v_cashback_pct := greatest(v_cashback_pct, v_num);
      v_applied := v_applied || jsonb_build_array(jsonb_build_object('key', v_ben ->> 'feature_key', 'as', v_apply));
    elsif v_apply = 'loyalty_points_bonus_pct' and v_num > 0 then
      v_loyalty_bonus_pct := greatest(v_loyalty_bonus_pct, v_num);
      v_applied := v_applied || jsonb_build_array(jsonb_build_object('key', v_ben ->> 'feature_key', 'as', v_apply));
    elsif v_apply = 'flag' and coalesce((v_ben ->> 'value_boolean')::boolean, true) then
      v_flags := v_flags || jsonb_build_object(v_ben ->> 'feature_key', true);
      v_applied := v_applied || jsonb_build_array(jsonb_build_object('key', v_ben ->> 'feature_key', 'as', v_apply));
    end if;
  end loop;

  v_delivery_discount := least(greatest(v_delivery_discount, 0), v_fee);
  v_order_discount := least(greatest(v_order_discount, 0), v_sub);

  return jsonb_build_object(
    'ok', true,
    'active', true,
    'subscription_id', v_ent -> 'subscription_id',
    'plan_id', v_ent -> 'plan_id',
    'delivery_fee_discount_cents', v_delivery_discount,
    'order_discount_cents', v_order_discount,
    'cashback_pct', v_cashback_pct,
    'loyalty_points_bonus_pct', v_loyalty_bonus_pct,
    'flags', v_flags,
    'applied', v_applied
  );
end;
$$;

create or replace function public.mmd_plus_record_invoice(
  p_subscription_id uuid,
  p_kind text,
  p_status text,
  p_amount_cents integer,
  p_currency text default 'USD',
  p_tax_cents integer default 0,
  p_stripe_invoice_id text default null,
  p_stripe_payment_intent_id text default null,
  p_idempotency_key text default null,
  p_description text default null,
  p_period_start timestamptz default null,
  p_period_end timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.mmd_plus_subscriptions%rowtype;
  v_id uuid;
begin
  if p_subscription_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  if p_idempotency_key is not null then
    select id into v_id from public.mmd_plus_invoices where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('ok', true, 'already_recorded', true, 'invoice_id', v_id);
    end if;
  end if;
  if p_stripe_invoice_id is not null then
    select id into v_id from public.mmd_plus_invoices where stripe_invoice_id = p_stripe_invoice_id;
    if found then
      return jsonb_build_object('ok', true, 'already_recorded', true, 'invoice_id', v_id);
    end if;
  end if;

  select * into v_sub from public.mmd_plus_subscriptions where id = p_subscription_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription_not_found');
  end if;

  insert into public.mmd_plus_invoices (
    subscription_id, user_id, kind, status,
    amount_cents, tax_cents, currency, description,
    stripe_invoice_id, stripe_payment_intent_id,
    period_start, period_end,
    paid_at, idempotency_key, metadata
  ) values (
    p_subscription_id, v_sub.user_id, p_kind, p_status,
    coalesce(p_amount_cents, 0), coalesce(p_tax_cents, 0), coalesce(p_currency, 'USD'), p_description,
    p_stripe_invoice_id, p_stripe_payment_intent_id,
    p_period_start, p_period_end,
    case when p_status = 'paid' then now() else null end,
    p_idempotency_key, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'invoice_id', v_id);
end;
$$;

create or replace function public.mmd_plus_expire_due_batch(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(least(coalesce(p_limit, 200), 500), 1);
  v_expired_trials integer := 0;
  v_canceled_period integer := 0;
  v_expired_subs integer := 0;
  v_expired_benefits integer := 0;
  v_resumed integer := 0;
begin
  -- Trials that ended without conversion path → expired if still trialing past trial_ends_at
  with due as (
    select id from public.mmd_plus_subscriptions
    where status = 'trialing'
      and trial_ends_at is not null
      and trial_ends_at <= now()
      and cancel_at_period_end = true
    order by trial_ends_at
    limit v_limit
    for update skip locked
  )
  update public.mmd_plus_subscriptions s
  set status = 'expired', renews = false, updated_at = now()
  from due d where s.id = d.id;
  get diagnostics v_expired_trials = row_count;

  -- Cancel at period end
  with due as (
    select id from public.mmd_plus_subscriptions
    where cancel_at_period_end = true
      and status in ('active', 'trialing', 'past_due')
      and current_period_end is not null
      and current_period_end <= now()
    order by current_period_end
    limit v_limit
    for update skip locked
  )
  update public.mmd_plus_subscriptions s
  set status = 'canceled', canceled_at = now(), renews = false, updated_at = now()
  from due d where s.id = d.id;
  get diagnostics v_canceled_period = row_count;

  -- Soft-expire past period without renew
  with due as (
    select id from public.mmd_plus_subscriptions
    where status in ('active', 'past_due')
      and renews = false
      and current_period_end is not null
      and current_period_end <= now()
    order by current_period_end
    limit v_limit
    for update skip locked
  )
  update public.mmd_plus_subscriptions s
  set status = 'expired', updated_at = now()
  from due d where s.id = d.id;
  get diagnostics v_expired_subs = row_count;

  update public.mmd_plus_active_benefits
  set status = 'expired', updated_at = now()
  where status = 'active'
    and expires_at is not null
    and expires_at <= now();
  get diagnostics v_expired_benefits = row_count;

  -- Auto-resume paused past_due cleared externally is left to admin/webhooks;
  -- cleanup suspended with resume_at in metadata
  with due as (
    select id from public.mmd_plus_subscriptions
    where status = 'suspended'
      and (metadata ->> 'resume_at') is not null
      and (metadata ->> 'resume_at')::timestamptz <= now()
    order by updated_at
    limit v_limit
    for update skip locked
  )
  update public.mmd_plus_subscriptions s
  set status = 'active', updated_at = now(),
      metadata = metadata - 'resume_at'
  from due d where s.id = d.id;
  get diagnostics v_resumed = row_count;

  return jsonb_build_object(
    'ok', true,
    'expired_trials', v_expired_trials,
    'canceled_at_period_end', v_canceled_period,
    'expired_subs', v_expired_subs,
    'expired_benefits', v_expired_benefits,
    'resumed', v_resumed
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: service_role only
-- ---------------------------------------------------------------------------
revoke all on function public.mmd_plus_sync_benefits(uuid) from public, anon, authenticated;
revoke all on function public.mmd_plus_activate(uuid, uuid, text, text, boolean, integer, boolean, text, jsonb) from public, anon, authenticated;
revoke all on function public.mmd_plus_cancel(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.mmd_plus_resume(uuid) from public, anon, authenticated;
revoke all on function public.mmd_plus_change_plan(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.mmd_plus_extend(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.mmd_plus_suspend(uuid, text) from public, anon, authenticated;
revoke all on function public.mmd_plus_load_entitlements(uuid) from public, anon, authenticated;
revoke all on function public.mmd_plus_resolve_checkout_benefits(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.mmd_plus_record_invoice(uuid, text, text, integer, text, integer, text, text, text, text, timestamptz, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.mmd_plus_expire_due_batch(integer) from public, anon, authenticated;

grant execute on function public.mmd_plus_sync_benefits(uuid) to service_role;
grant execute on function public.mmd_plus_activate(uuid, uuid, text, text, boolean, integer, boolean, text, jsonb) to service_role;
grant execute on function public.mmd_plus_cancel(uuid, boolean, text) to service_role;
grant execute on function public.mmd_plus_resume(uuid) to service_role;
grant execute on function public.mmd_plus_change_plan(uuid, uuid, text) to service_role;
grant execute on function public.mmd_plus_extend(uuid, integer, text) to service_role;
grant execute on function public.mmd_plus_suspend(uuid, text) to service_role;
grant execute on function public.mmd_plus_load_entitlements(uuid) to service_role;
grant execute on function public.mmd_plus_resolve_checkout_benefits(uuid, text, integer, integer) to service_role;
grant execute on function public.mmd_plus_record_invoice(uuid, text, text, integer, text, integer, text, text, text, text, timestamptz, timestamptz, jsonb) to service_role;
grant execute on function public.mmd_plus_expire_due_batch(integer) to service_role;

commit;
