-- ===========================================================================
-- MMD Subscriptions — Phase 5 RPCs (SECURITY DEFINER, service_role only)
-- ---------------------------------------------------------------------------
-- Does NOT touch loyalty or commission engines. Benefits are written only to
-- subscription_active_benefits.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Sync plan features → subscription_active_benefits for an active subscription
-- ---------------------------------------------------------------------------
create or replace function public.mmd_subscription_sync_benefits(p_subscription_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.partner_subscriptions%rowtype;
  v_feat record;
  v_benefit_type text;
  v_value numeric;
  v_count integer := 0;
begin
  select * into v_sub from public.partner_subscriptions where id = p_subscription_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription_not_found');
  end if;

  -- Expire prior benefits for this subscription
  update public.subscription_active_benefits
  set status = 'canceled', updated_at = now()
  where subscription_id = p_subscription_id
    and status in ('scheduled', 'active', 'suspended');

  if v_sub.status not in ('active', 'trialing') then
    return jsonb_build_object('ok', true, 'synced', 0, 'skipped', 'not_active');
  end if;

  for v_feat in
    select pf.*, f.category
    from public.subscription_plan_features pf
    join public.subscription_features f on f.key = pf.feature_key
    where pf.plan_id = v_sub.plan_id and pf.enabled = true
  loop
    v_benefit_type := null;
    v_value := 0;

    if v_feat.feature_key = 'commission_discount_pct' then
      v_benefit_type := 'commission_discount';
      v_value := coalesce(v_feat.value_numeric, 0);
    elsif v_feat.feature_key = 'fee_discount_pct' then
      v_benefit_type := 'fee_discount';
      v_value := coalesce(v_feat.value_numeric, 0);
    elsif v_feat.feature_key = 'premium_badge' and coalesce(v_feat.value_boolean, v_feat.enabled, false) then
      v_benefit_type := 'premium_badge';
      v_value := 1;
    elsif v_feat.feature_key = 'priority_visibility' and coalesce(v_feat.value_boolean, v_feat.enabled, false) then
      v_benefit_type := 'priority_visibility';
      v_value := 1;
    elsif v_feat.feature_key = 'sponsored_campaigns' and coalesce(v_feat.value_boolean, v_feat.enabled, false) then
      v_benefit_type := 'sponsored_campaigns';
      v_value := 1;
    elsif v_feat.feature_key = 'advanced_stats' and coalesce(v_feat.value_boolean, v_feat.enabled, false) then
      v_benefit_type := 'advanced_stats';
      v_value := 1;
    end if;

    if v_benefit_type is not null then
      insert into public.subscription_active_benefits (
        subscription_id, partner_type, partner_user_id, benefit_type,
        benefit_value, starts_at, expires_at, status, source_feature_key
      ) values (
        p_subscription_id, v_sub.partner_type, v_sub.partner_user_id, v_benefit_type,
        v_value, coalesce(v_sub.current_period_start, v_sub.starts_at, now()),
        v_sub.current_period_end, 'active', v_feat.feature_key
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'synced', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- Activate / create subscription (admin grant or post-Stripe confirmation)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_subscription_activate(
  p_partner_type text,
  p_partner_user_id uuid,
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
  v_plan public.subscription_plans%rowtype;
  v_existing uuid;
  v_sub_id uuid;
  v_now timestamptz := now();
  v_period_end timestamptz;
  v_trial_end timestamptz;
  v_status text;
  v_key text;
begin
  if p_partner_type not in ('restaurant', 'seller', 'driver', 'business') then
    return jsonb_build_object('ok', false, 'error', 'invalid_partner_type');
  end if;
  if p_partner_user_id is null or p_plan_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  -- Idempotency via stripe subscription id or custom key in metadata
  if p_stripe_subscription_id is not null then
    select id into v_existing
    from public.partner_subscriptions
    where stripe_subscription_id = p_stripe_subscription_id;
    if found then
      return jsonb_build_object('ok', true, 'already_active', true, 'subscription_id', v_existing);
    end if;
  end if;

  v_key := coalesce(p_idempotency_key, null);
  if v_key is not null then
    select id into v_existing
    from public.partner_subscriptions
    where metadata ->> 'idempotency_key' = v_key;
    if found then
      return jsonb_build_object('ok', true, 'already_active', true, 'subscription_id', v_existing);
    end if;
  end if;

  select * into v_plan from public.subscription_plans where id = p_plan_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'plan_not_found');
  end if;
  if v_plan.partner_type <> p_partner_type then
    return jsonb_build_object('ok', false, 'error', 'plan_partner_mismatch');
  end if;
  if v_plan.status <> 'active' and not coalesce(p_offered_by_admin, false) then
    return jsonb_build_object('ok', false, 'error', 'plan_not_active');
  end if;

  -- End any current active subscription for this partner (plan change / replace)
  update public.partner_subscriptions
  set status = 'canceled',
      canceled_at = v_now,
      cancel_reason = 'replaced_by_new_subscription',
      renews = false,
      updated_at = v_now
  where partner_type = p_partner_type
    and partner_user_id = p_partner_user_id
    and status in ('active', 'trialing', 'past_due', 'paused');

  update public.subscription_active_benefits b
  set status = 'canceled', updated_at = v_now
  from public.partner_subscriptions s
  where b.subscription_id = s.id
    and s.partner_type = p_partner_type
    and s.partner_user_id = p_partner_user_id
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

  insert into public.partner_subscriptions (
    partner_type, partner_user_id, plan_id, status,
    starts_at, ends_at, trial_ends_at,
    current_period_start, current_period_end,
    renews, is_trial, price_cents, currency,
    stripe_subscription_id, stripe_customer_id, stripe_price_id,
    offered_by_admin, metadata
  ) values (
    p_partner_type, p_partner_user_id, p_plan_id, v_status,
    v_now, null, v_trial_end,
    v_now, v_period_end,
    true, (v_status = 'trialing'), v_plan.price_cents, v_plan.currency,
    p_stripe_subscription_id, p_stripe_customer_id, v_plan.stripe_price_id,
    coalesce(p_offered_by_admin, false),
    coalesce(p_metadata, '{}'::jsonb)
      || case when v_key is not null then jsonb_build_object('idempotency_key', v_key) else '{}'::jsonb end
  )
  returning id into v_sub_id;

  perform public.mmd_subscription_sync_benefits(v_sub_id);

  return jsonb_build_object(
    'ok', true,
    'subscription_id', v_sub_id,
    'status', v_status,
    'current_period_end', v_period_end,
    'is_trial', (v_status = 'trialing')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancel / resume / change status
-- ---------------------------------------------------------------------------
create or replace function public.mmd_subscription_cancel(
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
  v_sub public.partner_subscriptions%rowtype;
begin
  select * into v_sub from public.partner_subscriptions where id = p_subscription_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription_not_found');
  end if;

  if coalesce(p_at_period_end, true) then
    update public.partner_subscriptions
    set cancel_at_period_end = true,
        cancel_reason = p_reason,
        renews = false,
        updated_at = now()
    where id = p_subscription_id;
    return jsonb_build_object('ok', true, 'cancel_at_period_end', true);
  end if;

  update public.partner_subscriptions
  set status = 'canceled',
      canceled_at = now(),
      cancel_reason = p_reason,
      renews = false,
      cancel_at_period_end = false,
      updated_at = now()
  where id = p_subscription_id;

  update public.subscription_active_benefits
  set status = 'canceled', updated_at = now()
  where subscription_id = p_subscription_id and status in ('scheduled', 'active', 'suspended');

  return jsonb_build_object('ok', true, 'canceled', true);
end;
$$;

create or replace function public.mmd_subscription_resume(p_subscription_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.partner_subscriptions%rowtype;
begin
  select * into v_sub from public.partner_subscriptions where id = p_subscription_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription_not_found');
  end if;

  if v_sub.status = 'canceled' and (v_sub.current_period_end is null or v_sub.current_period_end <= now()) then
    return jsonb_build_object('ok', false, 'error', 'subscription_expired');
  end if;

  update public.partner_subscriptions
  set status = case when is_trial and trial_ends_at > now() then 'trialing' else 'active' end,
      cancel_at_period_end = false,
      canceled_at = null,
      renews = true,
      updated_at = now()
  where id = p_subscription_id;

  perform public.mmd_subscription_sync_benefits(p_subscription_id);
  return jsonb_build_object('ok', true, 'resumed', true);
end;
$$;

create or replace function public.mmd_subscription_change_plan(
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
  v_sub public.partner_subscriptions%rowtype;
  v_plan public.subscription_plans%rowtype;
begin
  select * into v_sub from public.partner_subscriptions where id = p_subscription_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription_not_found');
  end if;
  if v_sub.status not in ('active', 'trialing', 'past_due', 'paused') then
    return jsonb_build_object('ok', false, 'error', 'subscription_not_changeable');
  end if;

  select * into v_plan from public.subscription_plans where id = p_new_plan_id;
  if not found or v_plan.partner_type <> v_sub.partner_type then
    return jsonb_build_object('ok', false, 'error', 'invalid_plan');
  end if;

  update public.partner_subscriptions
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

  perform public.mmd_subscription_sync_benefits(p_subscription_id);
  return jsonb_build_object('ok', true, 'plan_id', p_new_plan_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Record invoice / payment (idempotent)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_subscription_record_invoice(
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
  v_sub public.partner_subscriptions%rowtype;
  v_id uuid;
begin
  if p_subscription_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  if p_idempotency_key is not null then
    select id into v_id from public.subscription_invoices where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('ok', true, 'already_recorded', true, 'invoice_id', v_id);
    end if;
  end if;
  if p_stripe_invoice_id is not null then
    select id into v_id from public.subscription_invoices where stripe_invoice_id = p_stripe_invoice_id;
    if found then
      return jsonb_build_object('ok', true, 'already_recorded', true, 'invoice_id', v_id);
    end if;
  end if;

  select * into v_sub from public.partner_subscriptions where id = p_subscription_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'subscription_not_found');
  end if;

  insert into public.subscription_invoices (
    subscription_id, partner_type, partner_user_id, kind, status,
    amount_cents, tax_cents, currency, description,
    stripe_invoice_id, stripe_payment_intent_id,
    period_start, period_end,
    paid_at, idempotency_key, metadata
  ) values (
    p_subscription_id, v_sub.partner_type, v_sub.partner_user_id, p_kind, p_status,
    coalesce(p_amount_cents, 0), coalesce(p_tax_cents, 0),
    upper(coalesce(p_currency, v_sub.currency, 'USD')),
    p_description, p_stripe_invoice_id, p_stripe_payment_intent_id,
    p_period_start, p_period_end,
    case when p_status = 'paid' then now() else null end,
    p_idempotency_key, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'invoice_id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Feature entitlement lookup (config-driven)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_subscription_has_feature(
  p_partner_type text,
  p_partner_user_id uuid,
  p_feature_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.partner_subscriptions%rowtype;
  v_feat public.subscription_plan_features%rowtype;
begin
  select * into v_sub
  from public.partner_subscriptions
  where partner_type = p_partner_type
    and partner_user_id = p_partner_user_id
    and status in ('active', 'trialing')
  order by updated_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'entitled', false, 'reason', 'no_active_subscription');
  end if;

  select * into v_feat
  from public.subscription_plan_features
  where plan_id = v_sub.plan_id and feature_key = p_feature_key and enabled = true;

  if not found then
    return jsonb_build_object('ok', true, 'entitled', false, 'reason', 'feature_not_on_plan',
      'subscription_id', v_sub.id, 'plan_id', v_sub.plan_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'entitled', true,
    'subscription_id', v_sub.id,
    'plan_id', v_sub.plan_id,
    'value_boolean', v_feat.value_boolean,
    'value_integer', v_feat.value_integer,
    'value_numeric', v_feat.value_numeric,
    'value_text', v_feat.value_text,
    'value_json', v_feat.value_json
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Cron batch: expire trials, cancel_at_period_end, expire benefits
-- ---------------------------------------------------------------------------
create or replace function public.mmd_subscription_expire_due_batch(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 5000));
  v_trials integer := 0;
  v_canceled integer := 0;
  v_expired integer := 0;
  v_benefits integer := 0;
  v_past_due integer := 0;
begin
  -- End trials that expired without conversion (no stripe renewal handled yet)
  with due as (
    select id from public.partner_subscriptions
    where status = 'trialing'
      and trial_ends_at is not null and trial_ends_at <= now()
      and (stripe_subscription_id is null or cancel_at_period_end = true)
    order by trial_ends_at
    limit v_limit
    for update skip locked
  )
  update public.partner_subscriptions s
  set status = 'expired', renews = false, updated_at = now()
  from due where s.id = due.id;
  get diagnostics v_trials = row_count;

  -- Cancel at period end
  with due as (
    select id from public.partner_subscriptions
    where cancel_at_period_end = true
      and status in ('active', 'trialing', 'past_due')
      and current_period_end is not null and current_period_end <= now()
    order by current_period_end
    limit v_limit
    for update skip locked
  )
  update public.partner_subscriptions s
  set status = 'canceled', canceled_at = coalesce(canceled_at, now()), renews = false, updated_at = now()
  from due where s.id = due.id;
  get diagnostics v_canceled = row_count;

  -- Expire ended periods without renewal
  with due as (
    select id from public.partner_subscriptions
    where status in ('active', 'past_due')
      and renews = false
      and current_period_end is not null and current_period_end <= now()
    order by current_period_end
    limit v_limit
    for update skip locked
  )
  update public.partner_subscriptions s
  set status = 'expired', updated_at = now()
  from due where s.id = due.id;
  get diagnostics v_expired = row_count;

  -- Expire benefits past expires_at
  with due as (
    select id from public.subscription_active_benefits
    where status in ('scheduled', 'active')
      and expires_at is not null and expires_at <= now()
    order by expires_at
    limit v_limit
    for update skip locked
  )
  update public.subscription_active_benefits b
  set status = 'expired', updated_at = now()
  from due where b.id = due.id;
  get diagnostics v_benefits = row_count;

  -- Cancel benefits for expired/canceled subs
  update public.subscription_active_benefits b
  set status = 'canceled', updated_at = now()
  from public.partner_subscriptions s
  where b.subscription_id = s.id
    and s.status in ('canceled', 'expired', 'suspended')
    and b.status in ('scheduled', 'active', 'suspended');

  return jsonb_build_object(
    'ok', true,
    'expired_trials', v_trials,
    'canceled_at_period_end', v_canceled,
    'expired_subs', v_expired,
    'expired_benefits', v_benefits,
    'past_due_touched', v_past_due
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Hardening
-- ---------------------------------------------------------------------------
do $harden$
declare
  v_sig text;
  v_sigs text[] := array[
    'public.mmd_subscription_sync_benefits(uuid)',
    'public.mmd_subscription_activate(text, uuid, uuid, text, text, boolean, integer, boolean, text, jsonb)',
    'public.mmd_subscription_cancel(uuid, boolean, text)',
    'public.mmd_subscription_resume(uuid)',
    'public.mmd_subscription_change_plan(uuid, uuid, text)',
    'public.mmd_subscription_record_invoice(uuid, text, text, integer, text, integer, text, text, text, text, timestamptz, timestamptz, jsonb)',
    'public.mmd_subscription_has_feature(text, uuid, text)',
    'public.mmd_subscription_expire_due_batch(integer)'
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
