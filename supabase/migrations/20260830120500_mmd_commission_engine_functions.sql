-- ===========================================================================
-- MMD Central Commission Engine — Phase 4 RPCs
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, search_path=public, service_role only.
-- Does NOT modify loyalty program tables — only READs active benefits.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Resolve the single winning commission rule for a partner context
-- ---------------------------------------------------------------------------
create or replace function public.mmd_resolve_commission(
  p_partner_type text,
  p_partner_user_id uuid,
  p_service text,
  p_country_code text default null,
  p_city text default null,
  p_category text default null,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz := coalesce(p_at, now());
  v_partner_type text := lower(trim(coalesce(p_partner_type, '')));
  v_service text := lower(trim(coalesce(p_service, '')));
  v_country text := nullif(upper(trim(coalesce(p_country_code, ''))), '');
  v_city text := nullif(lower(trim(coalesce(p_city, ''))), '');
  v_category text := nullif(lower(trim(coalesce(p_category, ''))), '');

  v_base_rate numeric(8, 4);
  v_base_fixed integer := 0;
  v_base_type text;
  v_base_id uuid;
  v_base_label text;

  v_rate numeric(8, 4);
  v_fixed integer := 0;
  v_rule_type text;
  v_rule_id uuid;
  v_rule_label text;

  v_loyalty_id uuid;
  v_loyalty_value numeric;
  v_fee_credit integer := 0;
  v_fee_credit_id uuid;

  v_row record;
begin
  if v_partner_type not in ('restaurant', 'seller') then
    return jsonb_build_object('ok', false, 'error', 'invalid_partner_type');
  end if;
  if v_service not in ('food', 'marketplace') then
    return jsonb_build_object('ok', false, 'error', 'invalid_service');
  end if;
  if p_partner_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_partner');
  end if;

  -- ---- Priority 2: partner personalized override ----
  select * into v_row
  from public.partner_commission_overrides o
  where o.partner_type = v_partner_type
    and o.partner_user_id = p_partner_user_id
    and o.status = 'active'
    and (o.service is null or o.service = v_service)
    and (o.starts_at is null or o.starts_at <= v_at)
    and (o.ends_at is null or o.ends_at > v_at)
  order by case when o.service = v_service then 0 else 1 end, o.updated_at desc
  limit 1;

  if found then
    v_base_rate := v_row.rate_pct;
    v_base_fixed := v_row.fixed_fee_cents;
    v_base_type := 'partner_override';
    v_base_id := v_row.id;
    v_base_label := coalesce(v_row.reason, 'Commission personnalisée');
  end if;

  -- ---- Priority 3: commercial contract ----
  if v_base_rate is null then
    select * into v_row
    from public.commercial_contracts c
    where c.partner_type = v_partner_type
      and c.partner_user_id = p_partner_user_id
      and c.status = 'active'
      and (c.starts_at is null or c.starts_at <= v_at)
      and (c.ends_at is null or c.ends_at > v_at)
      and (
        cardinality(c.services) = 0
        or v_service = any (c.services)
      )
      and (
        cardinality(c.categories) = 0
        or v_category is null
        or exists (
          select 1 from unnest(c.categories) as cat
          where lower(cat) = v_category
        )
      )
      and (c.country_code is null or upper(c.country_code) = v_country)
      and (c.city is null or lower(c.city) = v_city)
    order by c.updated_at desc
    limit 1;

    if found then
      v_base_rate := v_row.rate_pct;
      v_base_fixed := v_row.fixed_fee_cents;
      v_base_type := 'commercial_contract';
      v_base_id := v_row.id;
      v_base_label := v_row.name;
    end if;
  end if;

  -- ---- Priority 4: commercial campaign ----
  if v_base_rate is null then
    select * into v_row
    from public.commercial_campaigns c
    where c.status = 'active'
      and (c.partner_type is null or c.partner_type = v_partner_type)
      and (c.service is null or c.service = v_service)
      and (c.category is null or lower(c.category) = v_category)
      and (c.country_code is null or upper(c.country_code) = v_country)
      and (c.city is null or lower(c.city) = v_city)
      and (c.starts_at is null or c.starts_at <= v_at)
      and (c.ends_at is null or c.ends_at > v_at)
    order by
      case when c.partner_type is not null then 0 else 1 end,
      case when c.service is not null then 0 else 1 end,
      c.updated_at desc
    limit 1;

    if found then
      v_base_rate := v_row.rate_pct;
      v_base_fixed := v_row.fixed_fee_cents;
      v_base_type := 'commercial_campaign';
      v_base_id := v_row.id;
      v_base_label := v_row.name;
    end if;
  end if;

  -- ---- Priority 5: service rate ----
  if v_base_rate is null then
    select * into v_row
    from public.commission_service_rates r
    where r.status = 'active'
      and r.service = v_service
      and r.partner_type = v_partner_type
    limit 1;
    if found then
      v_base_rate := v_row.rate_pct;
      v_base_fixed := v_row.fixed_fee_cents;
      v_base_type := 'service_rate';
      v_base_id := v_row.id;
      v_base_label := 'Tarif service ' || v_service;
    end if;
  end if;

  -- ---- Priority 6: category rate ----
  if v_base_rate is null and v_category is not null then
    select * into v_row
    from public.commission_category_rates r
    where r.status = 'active'
      and r.partner_type = v_partner_type
      and lower(r.category) = v_category
      and (r.service is null or r.service = v_service)
      and (r.country_code is null or upper(r.country_code) = v_country)
    order by case when r.service is not null then 0 else 1 end
    limit 1;
    if found then
      v_base_rate := v_row.rate_pct;
      v_base_fixed := v_row.fixed_fee_cents;
      v_base_type := 'category_rate';
      v_base_id := v_row.id;
      v_base_label := 'Tarif catégorie ' || v_category;
    end if;
  end if;

  -- ---- Priority 7: city rate ----
  if v_base_rate is null and v_city is not null and v_country is not null then
    select * into v_row
    from public.commission_city_rates r
    where r.status = 'active'
      and r.partner_type = v_partner_type
      and upper(r.country_code) = v_country
      and lower(r.city) = v_city
      and (r.service is null or r.service = v_service)
    order by case when r.service is not null then 0 else 1 end
    limit 1;
    if found then
      v_base_rate := v_row.rate_pct;
      v_base_fixed := v_row.fixed_fee_cents;
      v_base_type := 'city_rate';
      v_base_id := v_row.id;
      v_base_label := 'Tarif ville ' || v_city;
    end if;
  end if;

  -- ---- Priority 8: country rate ----
  if v_base_rate is null and v_country is not null then
    select * into v_row
    from public.commission_country_rates r
    where r.status = 'active'
      and r.partner_type = v_partner_type
      and upper(r.country_code) = v_country
      and (r.service is null or r.service = v_service)
    order by case when r.service is not null then 0 else 1 end
    limit 1;
    if found then
      v_base_rate := v_row.rate_pct;
      v_base_fixed := v_row.fixed_fee_cents;
      v_base_type := 'country_rate';
      v_base_id := v_row.id;
      v_base_label := 'Tarif pays ' || v_country;
    end if;
  end if;

  -- ---- Priority 9: standard rate ----
  if v_base_rate is null then
    select * into v_row
    from public.commission_standard_rates r
    where r.status = 'active'
      and r.partner_type = v_partner_type
      and r.service = v_service
    limit 1;
    if found then
      v_base_rate := v_row.rate_pct;
      v_base_fixed := v_row.fixed_fee_cents;
      v_base_type := 'standard_rate';
      v_base_id := v_row.id;
      v_base_label := 'Commission standard';
    else
      -- Hard fallback matching legacy defaults
      if v_partner_type = 'restaurant' then
        v_base_rate := 15;
      else
        v_base_rate := 5;
      end if;
      v_base_fixed := 0;
      v_base_type := 'standard_rate';
      v_base_id := null;
      v_base_label := 'Commission standard (fallback)';
    end if;
  end if;

  v_rate := v_base_rate;
  v_fixed := coalesce(v_base_fixed, 0);
  v_rule_type := v_base_type;
  v_rule_id := v_base_id;
  v_rule_label := v_base_label;

  -- ---- Priority 1: active loyalty commission_discount (wins naming) ----
  -- Reads restaurant_active_benefits / marketplace_active_benefits only.
  -- benefit_value = percentage points deducted from the otherwise-winning base rate.
  if v_partner_type = 'restaurant' then
    select b.id, b.benefit_value into v_loyalty_id, v_loyalty_value
    from public.restaurant_active_benefits b
    where b.restaurant_user_id = p_partner_user_id
      and b.benefit_type = 'commission_discount'
      and b.status = 'active'
      and b.starts_at <= v_at
      and (b.expires_at is null or b.expires_at > v_at)
      and (b.uses_limit is null or b.uses_count < b.uses_limit)
    order by b.created_at desc
    limit 1;

    if v_loyalty_id is not null then
      v_rate := greatest(0, v_base_rate - coalesce(v_loyalty_value, 0));
      v_rule_type := 'loyalty_benefit';
      v_rule_id := v_loyalty_id;
      v_rule_label := 'Avantage fidélité — réduction de commission';
    end if;

    select b.id, greatest(0, round(coalesce(b.benefit_value, 0)))::integer
      into v_fee_credit_id, v_fee_credit
    from public.restaurant_active_benefits b
    where b.restaurant_user_id = p_partner_user_id
      and b.benefit_type = 'service_fee_credit'
      and b.status = 'active'
      and b.starts_at <= v_at
      and (b.expires_at is null or b.expires_at > v_at)
      and (b.uses_limit is null or b.uses_count < b.uses_limit)
    order by b.created_at desc
    limit 1;

  elsif v_partner_type = 'seller' then
    select b.id, b.benefit_value into v_loyalty_id, v_loyalty_value
    from public.marketplace_active_benefits b
    where b.seller_user_id = p_partner_user_id
      and b.benefit_type = 'commission_discount'
      and b.status = 'active'
      and b.starts_at <= v_at
      and (b.expires_at is null or b.expires_at > v_at)
      and (b.uses_limit is null or b.uses_count < b.uses_limit)
    order by b.created_at desc
    limit 1;

    if v_loyalty_id is not null then
      v_rate := greatest(0, v_base_rate - coalesce(v_loyalty_value, 0));
      v_rule_type := 'loyalty_benefit';
      v_rule_id := v_loyalty_id;
      v_rule_label := 'Avantage fidélité — réduction de commission';
    end if;

    select b.id, greatest(0, round(coalesce(b.benefit_value, 0)))::integer
      into v_fee_credit_id, v_fee_credit
    from public.marketplace_active_benefits b
    where b.seller_user_id = p_partner_user_id
      and b.benefit_type = 'marketplace_fee_credit'
      and b.status = 'active'
      and b.starts_at <= v_at
      and (b.expires_at is null or b.expires_at > v_at)
      and (b.uses_limit is null or b.uses_count < b.uses_limit)
    order by b.created_at desc
    limit 1;
  end if;

  v_fee_credit := coalesce(v_fee_credit, 0);

  return jsonb_build_object(
    'ok', true,
    'partner_type', v_partner_type,
    'partner_user_id', p_partner_user_id,
    'service', v_service,
    'rate_pct', v_rate,
    'fixed_fee_cents', v_fixed,
    'fee_credit_cents', v_fee_credit,
    'base_rate_pct', v_base_rate,
    'base_rule_type', v_base_type,
    'base_rule_id', v_base_id,
    'rule_type', v_rule_type,
    'rule_id', v_rule_id,
    'rule_label', v_rule_label,
    'loyalty_benefit_id', v_loyalty_id,
    'fee_credit_benefit_id', v_fee_credit_id,
    'country_code', v_country,
    'city', v_city,
    'category', v_category,
    'resolved_at', v_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Snapshot once per order — never overwrite a frozen snapshot
-- ---------------------------------------------------------------------------
create or replace function public.mmd_snapshot_commission(
  p_order_kind text,
  p_order_id uuid,
  p_partner_type text,
  p_partner_user_id uuid,
  p_service text,
  p_currency text default 'USD',
  p_country_code text default null,
  p_city text default null,
  p_category text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.commission_snapshots%rowtype;
  v_resolved jsonb;
  v_id uuid;
begin
  if p_order_id is null or p_partner_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;
  if p_order_kind not in ('food', 'marketplace') then
    return jsonb_build_object('ok', false, 'error', 'invalid_order_kind');
  end if;

  select * into v_existing
  from public.commission_snapshots
  where order_kind = p_order_kind and order_id = p_order_id;

  if found then
    -- Completed / already snapshotted orders are never recalculated.
    return jsonb_build_object(
      'ok', true,
      'already_snapshotted', true,
      'snapshot_id', v_existing.id,
      'rate_pct', v_existing.rate_pct,
      'fixed_fee_cents', v_existing.fixed_fee_cents,
      'fee_credit_cents', v_existing.fee_credit_cents,
      'rule_type', v_existing.rule_type,
      'rule_id', v_existing.rule_id,
      'rule_label', v_existing.rule_label,
      'currency', v_existing.currency,
      'frozen', v_existing.frozen
    );
  end if;

  v_resolved := public.mmd_resolve_commission(
    p_partner_type, p_partner_user_id, p_service,
    p_country_code, p_city, p_category, now()
  );

  if coalesce((v_resolved ->> 'ok')::boolean, false) is not true then
    return v_resolved;
  end if;

  insert into public.commission_snapshots (
    order_kind, order_id, partner_type, partner_user_id, currency,
    rate_pct, fixed_fee_cents, fee_credit_cents, base_rate_pct,
    rule_type, rule_id, rule_label, country_code, city, category, service,
    loyalty_benefit_id, frozen, metadata
  ) values (
    p_order_kind, p_order_id, p_partner_type, p_partner_user_id,
    upper(coalesce(nullif(trim(p_currency), ''), 'USD')),
    (v_resolved ->> 'rate_pct')::numeric,
    coalesce((v_resolved ->> 'fixed_fee_cents')::integer, 0),
    coalesce((v_resolved ->> 'fee_credit_cents')::integer, 0),
    (v_resolved ->> 'base_rate_pct')::numeric,
    v_resolved ->> 'rule_type',
    nullif(v_resolved ->> 'rule_id', '')::uuid,
    v_resolved ->> 'rule_label',
    nullif(v_resolved ->> 'country_code', ''),
    nullif(v_resolved ->> 'city', ''),
    nullif(v_resolved ->> 'category', ''),
    p_service,
    nullif(v_resolved ->> 'loyalty_benefit_id', '')::uuid,
    true,
    jsonb_build_object(
      'base_rule_type', v_resolved ->> 'base_rule_type',
      'base_rule_id', v_resolved ->> 'base_rule_id',
      'fee_credit_benefit_id', v_resolved ->> 'fee_credit_benefit_id'
    )
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'snapshot_id', v_id,
    'rate_pct', (v_resolved ->> 'rate_pct')::numeric,
    'fixed_fee_cents', coalesce((v_resolved ->> 'fixed_fee_cents')::integer, 0),
    'fee_credit_cents', coalesce((v_resolved ->> 'fee_credit_cents')::integer, 0),
    'rule_type', v_resolved ->> 'rule_type',
    'rule_id', v_resolved ->> 'rule_id',
    'rule_label', v_resolved ->> 'rule_label',
    'currency', upper(coalesce(nullif(trim(p_currency), ''), 'USD')),
    'frozen', true,
    'already_snapshotted', false
  );
exception when unique_violation then
  select * into v_existing
  from public.commission_snapshots
  where order_kind = p_order_kind and order_id = p_order_id;
  return jsonb_build_object(
    'ok', true,
    'already_snapshotted', true,
    'snapshot_id', v_existing.id,
    'rate_pct', v_existing.rate_pct,
    'fixed_fee_cents', v_existing.fixed_fee_cents,
    'fee_credit_cents', v_existing.fee_credit_cents,
    'rule_type', v_existing.rule_type,
    'rule_id', v_existing.rule_id,
    'rule_label', v_existing.rule_label,
    'currency', v_existing.currency,
    'frozen', v_existing.frozen
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Expire due contracts / campaigns / overrides (batched, idempotent)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_commission_expire_due_batch(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 5000));
  v_contracts integer := 0;
  v_campaigns integer := 0;
  v_overrides integer := 0;
  v_scheduled integer := 0;
begin
  with due as (
    select id from public.commercial_contracts
    where status = 'active'
      and ends_at is not null and ends_at <= now()
    order by ends_at
    limit v_limit
    for update skip locked
  )
  update public.commercial_contracts c
  set status = 'expired', updated_at = now()
  from due where c.id = due.id;
  get diagnostics v_contracts = row_count;

  with due as (
    select id from public.commercial_campaigns
    where status = 'active'
      and ends_at is not null and ends_at <= now()
    order by ends_at
    limit v_limit
    for update skip locked
  )
  update public.commercial_campaigns c
  set status = 'ended', updated_at = now()
  from due where c.id = due.id;
  get diagnostics v_campaigns = row_count;

  with due as (
    select id from public.partner_commission_overrides
    where status in ('active', 'scheduled')
      and ends_at is not null and ends_at <= now()
    order by ends_at
    limit v_limit
    for update skip locked
  )
  update public.partner_commission_overrides o
  set status = 'ended', updated_at = now()
  from due where o.id = due.id;
  get diagnostics v_overrides = row_count;

  -- Activate scheduled overrides whose start date has arrived.
  update public.partner_commission_overrides
  set status = 'active', updated_at = now()
  where status = 'scheduled'
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now());
  get diagnostics v_scheduled = row_count;

  return jsonb_build_object(
    'ok', true,
    'expired_contracts', v_contracts,
    'ended_campaigns', v_campaigns,
    'ended_overrides', v_overrides,
    'activated_overrides', v_scheduled
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Patch refresh_order_commissions to honour frozen food snapshots
-- ---------------------------------------------------------------------------
-- When a commission_snapshots row exists for a food order, use its platform
-- rate_pct (and derive restaurant_pct = 100 - platform) instead of pricing_config.
-- Delivery split / service fee math stays unchanged. Snapshot is never rewritten.
-- Based on 20260807130000_fix_refresh_order_commissions_enum_coalesce.sql.
create or replace function public.refresh_order_commissions(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order public.orders%rowtype;
  v_cfg public.pricing_config%rowtype;
  v_snap public.commission_snapshots%rowtype;
  v_has_snap boolean := false;
  v_order_type text;
  v_config_key text;
  v_subtotal numeric := 0;
  v_delivery_fee numeric := 0;
  v_total numeric := 0;
  v_service_fee numeric := 0;
  v_restaurant_pct numeric := 0;
  v_platform_pct numeric := 0;
  v_delivery_driver_pct numeric := 80;
  v_delivery_platform_pct numeric := 20;
  v_restaurant_amount numeric := 0;
  v_driver_amount numeric := 0;
  v_platform_amount numeric := 0;
  v_client_amount numeric := 0;
  v_currency text := 'USD';
  v_has_restaurant boolean := false;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'order_id_required');
  end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  -- CRITICAL: cast both enums to text before COALESCE (order_type ≠ order_kind).
  v_order_type := lower(trim(coalesce(v_order.order_type::text, v_order.kind::text, 'food')));
  v_config_key := case
    when v_order_type in ('errand', 'pickup_dropoff', 'delivery_request') then 'errand_default'
    else 'food_default'
  end;

  select * into v_cfg
  from public.pricing_config
  where config_key = v_config_key and active = true
  limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'pricing_config_not_found');
  end if;

  v_subtotal := greatest(coalesce(v_order.subtotal, 0), 0);
  v_delivery_fee := greatest(coalesce(v_order.delivery_fee, 0), 0);
  v_total := greatest(coalesce(v_order.grand_total, v_order.total, 0), 0);
  v_service_fee := greatest(coalesce(v_order.service_fee, 0), 0);
  v_currency := upper(coalesce(v_order.currency, v_cfg.currency, 'USD'));
  v_restaurant_pct := coalesce(v_cfg.restaurant_pct, 0);
  v_platform_pct := coalesce(v_cfg.platform_pct, 0);
  v_delivery_driver_pct := coalesce(v_cfg.delivery_driver_pct, v_cfg.driver_pct, 80);
  v_delivery_platform_pct := coalesce(v_cfg.delivery_platform_pct, 20);

  -- Honour frozen Phase-4 snapshot when present (rates never recalculated).
  select * into v_snap
  from public.commission_snapshots
  where order_kind = 'food' and order_id = p_order_id;
  if found then
    v_has_snap := true;
    v_platform_pct := coalesce(v_snap.rate_pct, v_platform_pct);
    v_restaurant_pct := greatest(0, 100 - v_platform_pct);
  end if;

  v_has_restaurant :=
    v_order.restaurant_user_id is not null
    or v_order.restaurant_id is not null;

  if v_order_type in ('errand', 'pickup_dropoff', 'delivery_request') then
    v_driver_amount := round(
      greatest(coalesce(v_order.delivery_pay, 0), v_total * coalesce(v_cfg.driver_pct, 80) / 100.0),
      2
    );
    v_platform_amount := round(greatest(v_total - v_driver_amount - v_service_fee, 0), 2);
    v_restaurant_amount := 0;
    v_client_amount := round(v_total, 2);
  elsif v_has_restaurant then
    v_restaurant_amount := round(v_subtotal * v_restaurant_pct / 100.0, 2);
    v_driver_amount := round(
      greatest(
        coalesce(v_order.delivery_pay, 0),
        v_delivery_fee * v_delivery_driver_pct / 100.0
      ),
      2
    );
    v_platform_amount := round(
      greatest(
        v_subtotal * v_platform_pct / 100.0
          + v_delivery_fee * v_delivery_platform_pct / 100.0
          + v_service_fee
          + (case when v_has_snap then coalesce(v_snap.fixed_fee_cents, 0) / 100.0 else 0 end)
          - (case when v_has_snap then coalesce(v_snap.fee_credit_cents, 0) / 100.0 else 0 end),
        0
      ),
      2
    );
    v_client_amount := round(v_total, 2);

    if v_restaurant_amount + v_driver_amount + v_platform_amount > v_total + 0.02 then
      v_platform_amount := round(
        greatest(v_total - v_restaurant_amount - v_driver_amount, 0),
        2
      );
    end if;
  else
    v_driver_amount := round(
      greatest(coalesce(v_order.delivery_pay, 0), v_delivery_fee * v_delivery_driver_pct / 100.0),
      2
    );
    v_platform_amount := round(greatest(v_total - v_driver_amount - v_service_fee, 0), 2);
    v_restaurant_amount := 0;
    v_client_amount := round(v_total, 2);
  end if;

  insert into public.order_commissions (
    order_id, currency,
    client_amount, driver_amount, restaurant_amount, platform_amount,
    client_pct, driver_pct, restaurant_pct, platform_pct,
    client_cents, driver_cents, restaurant_cents, platform_cents,
    client, driver, restaurant, platform, updated_at
  )
  values (
    p_order_id, v_currency,
    v_client_amount, v_driver_amount, v_restaurant_amount, v_platform_amount,
    coalesce(v_cfg.service_fee_pct, v_cfg.client_pct, 0),
    v_delivery_driver_pct, v_restaurant_pct, v_platform_pct,
    (round(v_client_amount * 100))::integer,
    (round(v_driver_amount * 100))::integer,
    (round(v_restaurant_amount * 100))::integer,
    (round(v_platform_amount * 100))::integer,
    v_client_amount, v_driver_amount, v_restaurant_amount, v_platform_amount,
    now()
  )
  on conflict (order_id) do update set
    currency = excluded.currency,
    client_amount = excluded.client_amount,
    driver_amount = excluded.driver_amount,
    restaurant_amount = excluded.restaurant_amount,
    platform_amount = excluded.platform_amount,
    client_pct = excluded.client_pct,
    driver_pct = excluded.driver_pct,
    restaurant_pct = excluded.restaurant_pct,
    platform_pct = excluded.platform_pct,
    client_cents = excluded.client_cents,
    driver_cents = excluded.driver_cents,
    restaurant_cents = excluded.restaurant_cents,
    platform_cents = excluded.platform_cents,
    client = excluded.client,
    driver = excluded.driver,
    restaurant = excluded.restaurant,
    platform = excluded.platform,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'currency', v_currency,
    'client_amount', v_client_amount,
    'driver_amount', v_driver_amount,
    'restaurant_amount', v_restaurant_amount,
    'platform_amount', v_platform_amount,
    'service_fee', v_service_fee,
    'snapshot_applied', v_has_snap
  );
end;
$$;

-- Preserve existing authenticated + service_role grants on refresh_order_commissions.
revoke all on function public.refresh_order_commissions(uuid) from public;
revoke all on function public.refresh_order_commissions(uuid) from anon;
grant execute on function public.refresh_order_commissions(uuid) to authenticated;
grant execute on function public.refresh_order_commissions(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Hardening for NEW engine RPCs only (service_role)
-- ---------------------------------------------------------------------------
do $harden$
declare
  v_sig text;
  v_sigs text[] := array[
    'public.mmd_resolve_commission(text, uuid, text, text, text, text, timestamptz)',
    'public.mmd_snapshot_commission(text, uuid, text, uuid, text, text, text, text, text)',
    'public.mmd_commission_expire_due_batch(integer)'
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
