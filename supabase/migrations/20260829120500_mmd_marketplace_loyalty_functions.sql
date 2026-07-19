-- ===========================================================================
-- MMD Marketplace Loyalty — Phase 3 server engine (SECURITY DEFINER RPCs)
-- ---------------------------------------------------------------------------
-- All attribution/redemption/referral logic runs server-side, atomically, and
-- idempotently. Functions are granted to service_role ONLY. Nothing here touches
-- the commission/payout engines.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketplace_period_key(p_period text, p_at timestamptz)
returns text
language sql
immutable
as $$
  select case coalesce(p_period, 'once')
    when 'daily' then to_char(p_at, 'YYYY-MM-DD')
    when 'weekly' then to_char(p_at, 'IYYY-"W"IW')
    when 'monthly' then to_char(p_at, 'YYYY-MM')
    when 'lifetime' then 'lifetime'
    else 'once'
  end;
$$;

create or replace function public.mmd_marketplace_period_start(p_period text, p_at timestamptz)
returns timestamptz
language sql
immutable
as $$
  select case coalesce(p_period, 'once')
    when 'daily' then date_trunc('day', p_at)
    when 'weekly' then date_trunc('week', p_at)
    when 'monthly' then date_trunc('month', p_at)
    else 'epoch'::timestamptz
  end;
$$;

-- ---------------------------------------------------------------------------
-- Core award — one atomic, idempotent attribution for (rule, seller, period)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketplace_award_rule(
  p_rule_id uuid,
  p_seller_user_id uuid,
  p_metric numeric,
  p_source text default 'system',
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.marketplace_loyalty_rules%rowtype;
  v_settings public.marketplace_loyalty_settings%rowtype;
  v_period_key text;
  v_idem text;
  v_acc_status text;
  v_seller_status text;
  v_seller_city text;
  v_seller_country text;
  v_per_seller_count integer;
  v_ledger uuid;
begin
  if p_rule_id is null or p_seller_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  select * into v_settings from public.marketplace_loyalty_settings where singleton = true;
  if not coalesce(v_settings.enabled, false) then
    return jsonb_build_object('ok', true, 'skipped', 'program_disabled');
  end if;

  select * into v_rule from public.marketplace_loyalty_rules where id = p_rule_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'rule_not_found');
  end if;
  if v_rule.status <> 'active' then
    return jsonb_build_object('ok', true, 'skipped', 'rule_not_active');
  end if;
  if v_rule.starts_at is not null and now() < v_rule.starts_at then
    return jsonb_build_object('ok', true, 'skipped', 'rule_not_started');
  end if;
  if v_rule.ends_at is not null and now() > v_rule.ends_at then
    return jsonb_build_object('ok', true, 'skipped', 'rule_ended');
  end if;
  if v_rule.seller_user_id is not null and v_rule.seller_user_id <> p_seller_user_id then
    return jsonb_build_object('ok', true, 'skipped', 'seller_not_targeted');
  end if;

  -- Eligibility: seller must exist and be approved.
  select lower(coalesce(status, '')), lower(coalesce(city, '')), upper(coalesce(country_code, ''))
    into v_seller_status, v_seller_city, v_seller_country
  from public.sellers
  where user_id = p_seller_user_id;
  if v_seller_status is null then
    return jsonb_build_object('ok', true, 'skipped', 'seller_missing');
  end if;
  if v_seller_status <> 'approved' then
    return jsonb_build_object('ok', true, 'skipped', 'seller_not_approved');
  end if;
  if v_rule.country_code is not null and upper(v_rule.country_code) <> v_seller_country then
    return jsonb_build_object('ok', true, 'skipped', 'country_mismatch');
  end if;
  if v_rule.city is not null and lower(v_rule.city) <> v_seller_city then
    return jsonb_build_object('ok', true, 'skipped', 'city_mismatch');
  end if;

  -- Loyalty account must be active (not admin-suspended for fraud).
  perform public.mmd_loyalty_ensure_account(p_seller_user_id, 'seller');
  select status into v_acc_status
  from public.loyalty_accounts
  where user_id = p_seller_user_id and role = 'seller';
  if coalesce(v_acc_status, 'active') <> 'active' then
    return jsonb_build_object('ok', true, 'skipped', 'account_suspended');
  end if;

  if p_metric is null or p_metric < coalesce(v_rule.threshold, 0) then
    return jsonb_build_object('ok', true, 'skipped', 'threshold_not_met',
      'metric', p_metric, 'threshold', v_rule.threshold);
  end if;

  if v_rule.global_quota is not null and v_rule.awarded_count >= v_rule.global_quota then
    return jsonb_build_object('ok', true, 'skipped', 'global_quota_reached');
  end if;

  if v_rule.per_seller_quota is not null then
    select count(*) into v_per_seller_count
    from public.marketplace_loyalty_awards
    where rule_id = p_rule_id and seller_user_id = p_seller_user_id;
    if v_per_seller_count >= v_rule.per_seller_quota then
      return jsonb_build_object('ok', true, 'skipped', 'per_seller_quota_reached');
    end if;
  end if;

  v_period_key := public.mmd_marketplace_period_key(v_rule.period, now());
  v_idem := 'mrule:' || p_rule_id::text || ':' || p_seller_user_id::text || ':' || v_period_key;

  begin
    insert into public.marketplace_loyalty_awards (
      rule_id, seller_user_id, period_key, metric_value, threshold,
      points_awarded, idempotency_key, source, metadata
    ) values (
      p_rule_id, p_seller_user_id, v_period_key, p_metric, v_rule.threshold,
      v_rule.points, v_idem, coalesce(p_source, 'system'),
      coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('criterion', v_rule.criterion)
    );
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'already_awarded', true, 'period_key', v_period_key);
  end;

  if v_rule.points > 0 then
    perform public.mmd_loyalty_accrue(
      p_seller_user_id, v_rule.points, 'bonus', 'marketplace_rule', p_rule_id::text,
      v_idem, coalesce(v_rule.name, 'Bonus performance vendeur'), null,
      jsonb_build_object('rule_id', p_rule_id, 'period_key', v_period_key,
        'metric', p_metric, 'criterion', v_rule.criterion),
      'seller'
    );
    select id into v_ledger from public.loyalty_ledger where idempotency_key = v_idem;
    update public.marketplace_loyalty_awards
    set ledger_id = v_ledger
    where rule_id = p_rule_id and seller_user_id = p_seller_user_id and period_key = v_period_key;
  end if;

  update public.marketplace_loyalty_rules
  set awarded_count = awarded_count + 1
  where id = p_rule_id;

  perform public.mmd_marketplace_recompute_tier(p_seller_user_id);

  return jsonb_build_object('ok', true, 'awarded', true, 'points', v_rule.points,
    'period_key', v_period_key);
end;
$$;

-- ---------------------------------------------------------------------------
-- Tier recompute (server-side)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketplace_recompute_tier(p_seller_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points integer;
  v_sales integer;
  v_revenue bigint;
  v_tenure_days integer;
  v_code text;
begin
  if p_seller_user_id is null then
    return null;
  end if;

  select coalesce(lifetime_points, 0) into v_points
  from public.loyalty_accounts
  where user_id = p_seller_user_id and role = 'seller';
  v_points := coalesce(v_points, 0);

  select coalesce(completed_sales, 0), coalesce(revenue_cents, 0)
    into v_sales, v_revenue
  from public.marketplace_loyalty_stats
  where seller_user_id = p_seller_user_id;
  v_sales := coalesce(v_sales, 0);
  v_revenue := coalesce(v_revenue, 0);

  select coalesce(extract(day from (now() - created_at))::integer, 0) into v_tenure_days
  from public.sellers
  where user_id = p_seller_user_id;
  v_tenure_days := coalesce(v_tenure_days, 0);

  -- Rating / cancellation / refund thresholds are treated as satisfied when
  -- null (those seller metrics are not yet modelled — see Phase 3 dependencies).
  select code into v_code
  from public.marketplace_loyalty_tiers
  where active = true
    and country_code is null
    and v_points >= min_points
    and v_sales >= min_completed_sales
    and v_revenue >= min_revenue_cents
    and v_tenure_days >= min_tenure_days
  order by sort_order desc
  limit 1;

  v_code := coalesce(v_code, 'standard');

  update public.loyalty_accounts
  set tier_code = v_code, updated_at = now()
  where user_id = p_seller_user_id and role = 'seller';

  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Order-completion event hook — updates stats once, evaluates sale-driven rules
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketplace_on_order_completed(p_seller_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_json jsonb;
  v_seller uuid;
  v_status text;
  v_pay text;
  v_total bigint;
  v_first boolean := false;
  v_rule public.marketplace_loyalty_rules%rowtype;
  v_metric numeric;
  v_win_start timestamptz;
begin
  if p_seller_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  select to_jsonb(o.*) into v_json from public.seller_orders o where o.id = p_seller_order_id;
  if v_json is null then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  v_status := lower(coalesce(v_json ->> 'status', ''));
  v_pay := lower(coalesce(v_json ->> 'payment_status', ''));
  -- Eligible = paid and not in a cancelled/failed/pending state (mirrors the
  -- existing client marketplace accrual eligibility).
  if v_pay <> 'paid'
     or v_status in ('cancelled', 'canceled', 'payment_failed', 'draft', 'pending',
                     'pending_checkout', 'pending_payment') then
    return jsonb_build_object('ok', true, 'skipped', 'not_eligible');
  end if;

  -- Resolve the seller owner (auth user id) from the seller_orders.seller_id FK.
  select s.user_id into v_seller
  from public.sellers s
  where s.id = nullif(v_json ->> 'seller_id', '')::uuid;
  if v_seller is null then
    return jsonb_build_object('ok', true, 'skipped', 'no_seller');
  end if;

  v_total := coalesce(nullif(v_json ->> 'total_cents', '')::bigint, 0);

  begin
    insert into public.marketplace_order_loyalty_processed (seller_order_id, seller_user_id)
    values (p_seller_order_id, v_seller);

    insert into public.marketplace_loyalty_stats as s (
      seller_user_id, completed_sales, revenue_cents, first_sale_at, last_sale_at
    ) values (
      v_seller, 1, greatest(v_total, 0), now(), now()
    )
    on conflict (seller_user_id) do update
    set completed_sales = s.completed_sales + 1,
        revenue_cents = s.revenue_cents + greatest(v_total, 0),
        last_sale_at = now();

    select (completed_sales = 1) into v_first
    from public.marketplace_loyalty_stats where seller_user_id = v_seller;
  exception when unique_violation then
    null;
  end;

  for v_rule in
    select * from public.marketplace_loyalty_rules
    where status = 'active'
      and criterion in ('first_completed_sale', 'completed_sales_count', 'revenue_reached')
      and (seller_user_id is null or seller_user_id = v_seller)
  loop
    v_win_start := public.mmd_marketplace_period_start(v_rule.period, now());

    if v_rule.criterion = 'first_completed_sale' then
      select coalesce(completed_sales, 0) into v_metric
      from public.marketplace_loyalty_stats where seller_user_id = v_seller;

    elsif v_rule.criterion = 'completed_sales_count' then
      if v_rule.period in ('once', 'lifetime') then
        select coalesce(completed_sales, 0) into v_metric
        from public.marketplace_loyalty_stats where seller_user_id = v_seller;
      else
        select count(*) into v_metric
        from public.seller_orders o
        join public.sellers s on s.id = o.seller_id
        where s.user_id = v_seller
          and lower(coalesce(o.payment_status, '')) = 'paid'
          and lower(coalesce(o.status, '')) not in
            ('cancelled', 'canceled', 'payment_failed', 'draft', 'pending', 'pending_checkout', 'pending_payment')
          and o.created_at >= v_win_start;
      end if;

    elsif v_rule.criterion = 'revenue_reached' then
      if v_rule.period in ('once', 'lifetime') then
        select coalesce(revenue_cents, 0) into v_metric
        from public.marketplace_loyalty_stats where seller_user_id = v_seller;
      else
        select coalesce(sum(coalesce(o.total_cents, 0)), 0) into v_metric
        from public.seller_orders o
        join public.sellers s on s.id = o.seller_id
        where s.user_id = v_seller
          and lower(coalesce(o.payment_status, '')) = 'paid'
          and lower(coalesce(o.status, '')) not in
            ('cancelled', 'canceled', 'payment_failed', 'draft', 'pending', 'pending_checkout', 'pending_payment')
          and o.created_at >= v_win_start;
      end if;
    end if;

    perform public.mmd_marketplace_award_rule(
      v_rule.id, v_seller, coalesce(v_metric, 0), 'sale_completed',
      jsonb_build_object('seller_order_id', p_seller_order_id)
    );
  end loop;

  perform public.mmd_marketplace_recompute_tier(v_seller);

  return jsonb_build_object('ok', true, 'seller_user_id', v_seller, 'first_sale', v_first);
end;
$$;

-- ---------------------------------------------------------------------------
-- Redemption — atomic points -> reward exchange creating an active benefit
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketplace_redeem_reward(
  p_seller_user_id uuid,
  p_reward_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings public.marketplace_loyalty_settings%rowtype;
  v_reward public.marketplace_rewards%rowtype;
  v_acc_status text;
  v_balance integer;
  v_seller_status text;
  v_seller_city text;
  v_seller_country text;
  v_key text;
  v_redemption uuid;
  v_ledger uuid;
  v_expires timestamptz;
begin
  if p_seller_user_id is null or p_reward_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  select * into v_settings from public.marketplace_loyalty_settings where singleton = true;
  if not coalesce(v_settings.enabled, false) then
    return jsonb_build_object('ok', false, 'error', 'program_disabled');
  end if;

  v_key := coalesce(p_idempotency_key, gen_random_uuid()::text);
  if exists (select 1 from public.marketplace_loyalty_redemptions where idempotency_key = v_key) then
    return jsonb_build_object('ok', true, 'already_redeemed', true);
  end if;

  select * into v_reward from public.marketplace_rewards where id = p_reward_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'reward_not_found');
  end if;
  if v_reward.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'reward_not_active');
  end if;
  if v_reward.starts_at is not null and now() < v_reward.starts_at then
    return jsonb_build_object('ok', false, 'error', 'reward_not_started');
  end if;
  if v_reward.ends_at is not null and now() > v_reward.ends_at then
    return jsonb_build_object('ok', false, 'error', 'reward_expired');
  end if;
  if v_reward.max_redemptions is not null and v_reward.redemptions_count >= v_reward.max_redemptions then
    return jsonb_build_object('ok', false, 'error', 'reward_quota_reached');
  end if;

  select lower(coalesce(status, '')), lower(coalesce(city, '')), upper(coalesce(country_code, ''))
    into v_seller_status, v_seller_city, v_seller_country
  from public.sellers where user_id = p_seller_user_id;
  if coalesce(v_seller_status, '') <> 'approved' then
    return jsonb_build_object('ok', false, 'error', 'seller_not_eligible');
  end if;
  if v_reward.country_code is not null and upper(v_reward.country_code) <> v_seller_country then
    return jsonb_build_object('ok', false, 'error', 'seller_not_eligible');
  end if;
  if v_reward.city is not null and lower(v_reward.city) <> v_seller_city then
    return jsonb_build_object('ok', false, 'error', 'seller_not_eligible');
  end if;
  if v_reward.eligible_seller_ids is not null
     and not (p_seller_user_id = any (v_reward.eligible_seller_ids)) then
    return jsonb_build_object('ok', false, 'error', 'seller_not_eligible');
  end if;

  perform public.mmd_loyalty_ensure_account(p_seller_user_id, 'seller');
  select status, points_balance into v_acc_status, v_balance
  from public.loyalty_accounts
  where user_id = p_seller_user_id and role = 'seller'
  for update;
  if coalesce(v_acc_status, 'active') <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'account_suspended');
  end if;
  if coalesce(v_balance, 0) < v_reward.points_cost then
    return jsonb_build_object('ok', false, 'error', 'insufficient_points',
      'balance', coalesce(v_balance, 0), 'needed', v_reward.points_cost);
  end if;

  insert into public.marketplace_loyalty_redemptions (
    seller_user_id, reward_id, points_spent, status, idempotency_key, metadata
  ) values (
    p_seller_user_id, p_reward_id, v_reward.points_cost, 'active', v_key,
    jsonb_build_object('benefit_type', v_reward.benefit_type)
  )
  returning id into v_redemption;

  perform public.mmd_loyalty_accrue(
    p_seller_user_id, -v_reward.points_cost, 'redemption', 'marketplace_reward',
    p_reward_id::text, 'mredeem:' || v_key, 'Échange contre ' || coalesce(v_reward.name, 'récompense'),
    null, jsonb_build_object('reward_id', p_reward_id, 'redemption_id', v_redemption),
    'seller'
  );
  select id into v_ledger from public.loyalty_ledger where idempotency_key = 'mredeem:' || v_key;
  update public.marketplace_loyalty_redemptions set ledger_id = v_ledger where id = v_redemption;

  v_expires := case
    when v_reward.duration_days is not null and v_reward.duration_days > 0
    then now() + make_interval(days => v_reward.duration_days)
    else null
  end;

  insert into public.marketplace_active_benefits (
    seller_user_id, reward_id, redemption_id, benefit_type, benefit_value,
    benefit_currency, starts_at, expires_at, status, reference, metadata
  ) values (
    p_seller_user_id, p_reward_id, v_redemption, v_reward.benefit_type, v_reward.benefit_value,
    v_reward.benefit_currency, now(), v_expires, 'active', v_key,
    jsonb_build_object('reward_name', v_reward.name)
  );

  update public.marketplace_rewards
  set redemptions_count = redemptions_count + 1
  where id = p_reward_id;

  return jsonb_build_object('ok', true, 'redeemed', true, 'redemption_id', v_redemption,
    'points_spent', v_reward.points_cost, 'benefit_type', v_reward.benefit_type,
    'expires_at', v_expires);
end;
$$;

-- ---------------------------------------------------------------------------
-- Referral — apply code (anti-fraud), set verification flags, qualify + reward
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketplace_referral_apply(
  p_referred_user_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer uuid;
  v_clean text := upper(trim(coalesce(p_code, '')));
begin
  if p_referred_user_id is null or v_clean = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;
  if exists (select 1 from public.marketplace_referrals where referred_user_id = p_referred_user_id) then
    return jsonb_build_object('ok', false, 'error', 'already_referred');
  end if;

  select user_id into v_referrer
  from public.loyalty_referral_codes
  where code = v_clean and role = 'seller';
  if v_referrer is null then
    return jsonb_build_object('ok', false, 'error', 'code_not_found');
  end if;
  if v_referrer = p_referred_user_id then
    return jsonb_build_object('ok', false, 'error', 'self_referral');
  end if;

  insert into public.marketplace_referrals (referrer_user_id, referred_user_id, code, status)
  values (v_referrer, p_referred_user_id, v_clean, 'pending')
  on conflict (referred_user_id) do nothing;

  return jsonb_build_object('ok', true, 'status', 'pending');
end;
$$;

create or replace function public.mmd_marketplace_referral_mark(
  p_referred_user_id uuid,
  p_step text,
  p_value boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.marketplace_referrals%rowtype;
begin
  select * into v_ref from public.marketplace_referrals
  where referred_user_id = p_referred_user_id for update;
  if not found then
    return jsonb_build_object('ok', true, 'no_referral', true);
  end if;
  if v_ref.status in ('rewarded', 'rejected', 'reversed') then
    return jsonb_build_object('ok', true, 'terminal', v_ref.status);
  end if;

  update public.marketplace_referrals
  set verified_at = case when p_step = 'verified' and p_value then now() else verified_at end,
      approved_at = case when p_step = 'approved' and p_value then now() else approved_at end,
      product_published_at = case when p_step = 'product_published' and p_value then now() else product_published_at end,
      first_sale_at = case when p_step = 'first_sale' and p_value then now() else first_sale_at end,
      phone_verified = case when p_step = 'phone' then p_value else phone_verified end,
      business_verified = case when p_step = 'business' then p_value else business_verified end,
      documents_verified = case when p_step = 'documents' then p_value else documents_verified end,
      device_verified = case when p_step = 'device' then p_value else device_verified end,
      status = case
        when p_step = 'verified' and p_value and status = 'pending' then 'verified'
        when p_step = 'approved' and p_value and status in ('pending', 'verified') then 'approved'
        else status
      end
  where referred_user_id = p_referred_user_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.mmd_marketplace_referral_qualify(p_referred_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref public.marketplace_referrals%rowtype;
  v_settings public.marketplace_loyalty_settings%rowtype;
begin
  if p_referred_user_id is null then
    return jsonb_build_object('ok', true, 'no_referral', true);
  end if;

  select * into v_ref from public.marketplace_referrals
  where referred_user_id = p_referred_user_id for update;
  if not found then
    return jsonb_build_object('ok', true, 'no_referral', true);
  end if;
  if v_ref.status in ('rewarded', 'rejected', 'reversed') then
    return jsonb_build_object('ok', true, 'terminal', v_ref.status);
  end if;

  -- All configurable qualification steps + anti-fraud verifications required.
  if v_ref.approved_at is null
     or v_ref.product_published_at is null
     or v_ref.first_sale_at is null
     or not v_ref.phone_verified
     or not v_ref.business_verified
     or not v_ref.documents_verified
     or not v_ref.device_verified then
    return jsonb_build_object('ok', true, 'not_qualified', true);
  end if;

  select * into v_settings from public.marketplace_loyalty_settings where singleton = true;

  if coalesce(v_settings.referral_points_referred, 0) > 0 then
    perform public.mmd_loyalty_accrue(
      v_ref.referred_user_id, v_settings.referral_points_referred, 'referral',
      'marketplace_referral', v_ref.id::text,
      'mref:' || v_ref.id::text || ':referred', 'Bonus parrainage vendeur (invité)',
      null, jsonb_build_object('side', 'referred'), 'seller'
    );
  end if;
  if coalesce(v_settings.referral_points_referrer, 0) > 0 then
    perform public.mmd_loyalty_accrue(
      v_ref.referrer_user_id, v_settings.referral_points_referrer, 'referral',
      'marketplace_referral', v_ref.id::text,
      'mref:' || v_ref.id::text || ':referrer', 'Bonus parrainage vendeur (parrain)',
      null, jsonb_build_object('side', 'referrer'), 'seller'
    );
  end if;

  update public.marketplace_referrals
  set status = 'rewarded', qualified_at = coalesce(qualified_at, now()), rewarded_at = now()
  where id = v_ref.id and status not in ('rewarded', 'rejected', 'reversed');

  perform public.mmd_marketplace_recompute_tier(v_ref.referred_user_id);
  perform public.mmd_marketplace_recompute_tier(v_ref.referrer_user_id);

  return jsonb_build_object('ok', true, 'rewarded', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin operations
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketplace_loyalty_admin_adjust(
  p_admin_user_id uuid,
  p_seller_user_id uuid,
  p_delta_points integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res jsonb;
begin
  if p_seller_user_id is null or p_delta_points is null or p_delta_points = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'reason_required');
  end if;

  v_res := public.mmd_loyalty_admin_adjust(
    p_admin_user_id, p_seller_user_id, p_delta_points, p_reason, 'seller'
  );
  perform public.mmd_marketplace_recompute_tier(p_seller_user_id);
  return v_res;
end;
$$;

create or replace function public.mmd_marketplace_loyalty_set_account_status(
  p_admin_user_id uuid,
  p_seller_user_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_seller_user_id is null or p_status not in ('active', 'suspended') then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;
  perform public.mmd_loyalty_ensure_account(p_seller_user_id, 'seller');
  update public.loyalty_accounts
  set status = p_status, updated_at = now()
  where user_id = p_seller_user_id and role = 'seller';
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

create or replace function public.mmd_marketplace_cancel_redemption(
  p_admin_user_id uuid,
  p_redemption_id uuid,
  p_reason text,
  p_reverse_points boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_red public.marketplace_loyalty_redemptions%rowtype;
begin
  select * into v_red from public.marketplace_loyalty_redemptions
  where id = p_redemption_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'redemption_not_found');
  end if;

  update public.marketplace_loyalty_redemptions
  set status = 'fraud_reversed', reason = p_reason, updated_at = now()
  where id = p_redemption_id;

  update public.marketplace_active_benefits
  set status = 'canceled', updated_at = now()
  where redemption_id = p_redemption_id and status in ('scheduled', 'active', 'suspended');

  if p_reverse_points and v_red.points_spent > 0 then
    perform public.mmd_loyalty_accrue(
      v_red.seller_user_id, v_red.points_spent, 'admin_adjust', 'marketplace_reward',
      v_red.reward_id::text, 'mredeem-cancel:' || p_redemption_id::text,
      coalesce(p_reason, 'Annulation récompense frauduleuse'), p_admin_user_id,
      jsonb_build_object('redemption_id', p_redemption_id, 'reversal', true), 'seller'
    );
  end if;

  perform public.mmd_marketplace_recompute_tier(v_red.seller_user_id);
  return jsonb_build_object('ok', true, 'reversed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Expiry / lifecycle cron (idempotent, batched)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketplace_expire_due_batch(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_benefits integer := 0;
  v_rewards integer := 0;
  v_rules integer := 0;
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 5000));
begin
  with due as (
    select id from public.marketplace_active_benefits
    where status in ('scheduled', 'active')
      and expires_at is not null and expires_at <= now()
    order by expires_at
    limit v_limit
    for update skip locked
  )
  update public.marketplace_active_benefits b
  set status = 'expired', updated_at = now()
  from due where b.id = due.id;
  get diagnostics v_benefits = row_count;

  update public.marketplace_active_benefits
  set status = 'active', updated_at = now()
  where status = 'scheduled' and starts_at <= now()
    and (expires_at is null or expires_at > now());

  update public.marketplace_rewards
  set status = 'ended', updated_at = now()
  where status = 'active' and ends_at is not null and ends_at <= now();
  get diagnostics v_rewards = row_count;

  update public.marketplace_loyalty_rules
  set status = 'ended', updated_at = now()
  where status = 'active' and ends_at is not null and ends_at <= now();
  get diagnostics v_rules = row_count;

  return jsonb_build_object('ok', true, 'expired_benefits', v_benefits,
    'ended_rewards', v_rewards, 'ended_rules', v_rules,
    'remaining_benefits', (
      select count(*) from public.marketplace_active_benefits
      where status in ('scheduled', 'active')
        and expires_at is not null and expires_at <= now()
    ));
end;
$$;

-- ---------------------------------------------------------------------------
-- Hardening — service_role only for every marketplace loyalty RPC
-- ---------------------------------------------------------------------------
do $harden$
declare
  v_sig text;
  v_sigs text[] := array[
    'public.mmd_marketplace_award_rule(uuid, uuid, numeric, text, jsonb)',
    'public.mmd_marketplace_recompute_tier(uuid)',
    'public.mmd_marketplace_on_order_completed(uuid)',
    'public.mmd_marketplace_redeem_reward(uuid, uuid, text)',
    'public.mmd_marketplace_referral_apply(uuid, text)',
    'public.mmd_marketplace_referral_mark(uuid, text, boolean)',
    'public.mmd_marketplace_referral_qualify(uuid)',
    'public.mmd_marketplace_loyalty_admin_adjust(uuid, uuid, integer, text)',
    'public.mmd_marketplace_loyalty_set_account_status(uuid, uuid, text, text)',
    'public.mmd_marketplace_cancel_redemption(uuid, uuid, text, boolean)',
    'public.mmd_marketplace_expire_due_batch(integer)'
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
