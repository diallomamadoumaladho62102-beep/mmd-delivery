-- ===========================================================================
-- MMD Marketing Engine — Phase 7 RPCs
-- SECURITY DEFINER, service_role only
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Helpers: normalize promo code
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketing_normalize_code(p_code text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(trim(coalesce(p_code, '')), '\s+', '', 'g'));
$$;

-- ---------------------------------------------------------------------------
-- Resolve eligible campaigns + compute discounts (preview / quote)
-- Fail-open for automatic; caller enforces fail-closed for private codes.
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketing_resolve(
  p_user_id uuid,
  p_service text,
  p_subtotal_cents integer default 0,
  p_delivery_fee_cents integer default 0,
  p_promo_code text default null,
  p_coupon_id uuid default null,
  p_country_code text default null,
  p_city text default null,
  p_partner_user_id uuid default null,
  p_has_mmd_plus boolean default false,
  p_is_first_order boolean default false,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_code text := public.mmd_marketing_normalize_code(p_promo_code);
  v_sub integer := greatest(coalesce(p_subtotal_cents, 0), 0);
  v_fee integer := greatest(coalesce(p_delivery_fee_cents, 0), 0);
  v_campaigns jsonb := '[]'::jsonb;
  v_camp record;
  v_code_row public.marketing_promo_codes%rowtype;
  v_coupon public.marketing_coupons%rowtype;
  v_disc integer;
  v_fee_disc integer;
  v_cashback integer;
  v_points integer;
  v_total_disc integer := 0;
  v_total_fee_disc integer := 0;
  v_total_cashback integer := 0;
  v_total_points integer := 0;
  v_applied jsonb := '[]'::jsonb;
  v_rejected jsonb := '[]'::jsonb;
  v_policy public.marketing_stack_policies%rowtype;
  v_day int;
  v_time time;
  v_ok boolean;
  v_reason text;
  v_mmd_fund integer;
  v_partner_fund integer;
begin
  if p_service is null or p_service not in ('food', 'delivery', 'taxi', 'marketplace') then
    return jsonb_build_object('ok', false, 'error', 'invalid_service');
  end if;

  select * into v_policy
  from public.marketing_stack_policies
  where code = 'default' and active = true
  limit 1;

  v_day := extract(dow from v_now at time zone coalesce(
    (select timezone from public.marketing_campaigns where status = 'active' limit 1),
    'America/New_York'
  ))::int;
  v_time := (v_now at time zone 'America/New_York')::time;

  -- Optional explicit coupon
  if p_coupon_id is not null then
    select * into v_coupon from public.marketing_coupons
    where id = p_coupon_id and user_id = p_user_id;
    if not found or v_coupon.status <> 'available' then
      return jsonb_build_object('ok', false, 'error', 'coupon_unavailable', 'fail_closed', true);
    end if;
    if v_coupon.expires_at is not null and v_coupon.expires_at <= v_now then
      return jsonb_build_object('ok', false, 'error', 'coupon_expired', 'fail_closed', true);
    end if;
  end if;

  -- Optional promo code (fail-closed if provided but invalid)
  if v_code <> '' then
    select * into v_code_row
    from public.marketing_promo_codes
    where code_normalized = v_code;
    if not found then
      return jsonb_build_object('ok', false, 'error', 'promo_code_not_found', 'fail_closed', true);
    end if;
    if v_code_row.status <> 'active' then
      return jsonb_build_object('ok', false, 'error', 'promo_code_inactive', 'fail_closed', true);
    end if;
    if v_code_row.starts_at is not null and v_code_row.starts_at > v_now then
      return jsonb_build_object('ok', false, 'error', 'promo_code_not_started', 'fail_closed', true);
    end if;
    if v_code_row.ends_at is not null and v_code_row.ends_at <= v_now then
      return jsonb_build_object('ok', false, 'error', 'promo_code_expired', 'fail_closed', true);
    end if;
    if v_code_row.max_redemptions is not null
       and (v_code_row.redemption_count + v_code_row.reserved_count) >= v_code_row.max_redemptions then
      return jsonb_build_object('ok', false, 'error', 'promo_code_exhausted', 'fail_closed', true);
    end if;
    if v_code_row.assigned_user_id is not null and v_code_row.assigned_user_id <> p_user_id then
      return jsonb_build_object('ok', false, 'error', 'promo_code_not_assigned', 'fail_closed', true);
    end if;
  end if;

  for v_camp in
    select c.*
    from public.marketing_campaigns c
    where c.status = 'active'
      and (c.starts_at is null or c.starts_at <= v_now)
      and (c.ends_at is null or c.ends_at > v_now)
      and (
        c.services && array['all']::text[]
        or c.services && array[p_service]::text[]
      )
      and (
        v_code = ''
        or exists (
          select 1 from public.marketing_promo_codes pc
          where pc.campaign_id = c.id and pc.code_normalized = v_code and pc.status = 'active'
        )
        or (c.auto_apply = true and c.requires_code = false)
      )
      and (
        p_coupon_id is null
        or c.id = v_coupon.campaign_id
        or (c.auto_apply = true and c.requires_code = false)
      )
    order by c.priority asc, c.created_at asc
    limit 40
  loop
    v_ok := true;
    v_reason := null;

    -- Audience / MMD+
    if v_camp.requires_mmd_plus and not coalesce(p_has_mmd_plus, false) then
      v_ok := false; v_reason := 'requires_mmd_plus';
    end if;
    if v_ok and v_camp.first_order_only and not coalesce(p_is_first_order, false) then
      v_ok := false; v_reason := 'first_order_only';
    end if;
    if v_ok and p_country_code is not null and v_camp.country_code is not null
       and upper(v_camp.country_code) <> upper(p_country_code) then
      v_ok := false; v_reason := 'country_mismatch';
    end if;
    if v_ok and p_city is not null and v_camp.city is not null
       and lower(v_camp.city) <> lower(p_city) then
      v_ok := false; v_reason := 'city_mismatch';
    end if;
    if v_ok and v_camp.partner_user_id is not null and p_partner_user_id is not null
       and v_camp.partner_user_id <> p_partner_user_id then
      v_ok := false; v_reason := 'partner_mismatch';
    end if;
    if v_ok and v_sub < coalesce(v_camp.min_order_cents, 0) then
      v_ok := false; v_reason := 'min_order_not_met';
    end if;
    if v_ok and v_camp.max_order_cents is not null and v_sub > v_camp.max_order_cents then
      v_ok := false; v_reason := 'max_order_exceeded';
    end if;
    if v_ok and cardinality(v_camp.active_days) > 0 and not (v_day = any (v_camp.active_days)) then
      v_ok := false; v_reason := 'inactive_day';
    end if;
    if v_ok and v_camp.active_hours_start is not null and v_camp.active_hours_end is not null then
      if v_time < v_camp.active_hours_start or v_time > v_camp.active_hours_end then
        v_ok := false; v_reason := 'inactive_hour';
      end if;
    end if;
    if v_ok and v_camp.budget_total_cents is not null then
      if (v_camp.budget_spent_cents + v_camp.budget_reserved_cents) >= v_camp.budget_total_cents then
        v_ok := false; v_reason := 'budget_exhausted';
      end if;
    end if;
    if v_ok and v_camp.global_usage_limit is not null then
      if (
        select count(*) from public.marketing_applications a
        where a.campaign_id = v_camp.id and a.kind = 'capture'
      ) >= v_camp.global_usage_limit then
        v_ok := false; v_reason := 'global_limit';
      end if;
    end if;
    if v_ok and v_camp.per_user_limit is not null and p_user_id is not null then
      if (
        select count(*) from public.marketing_applications a
        where a.campaign_id = v_camp.id and a.user_id = p_user_id and a.kind = 'capture'
      ) >= v_camp.per_user_limit then
        v_ok := false; v_reason := 'per_user_limit';
      end if;
    end if;

    -- Code-required campaigns without matching code
    if v_ok and v_camp.requires_code and v_code = '' and (p_coupon_id is null or v_coupon.campaign_id <> v_camp.id) then
      continue; -- skip silently for auto scan
    end if;

    if not v_ok then
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
        'campaign_id', v_camp.id, 'code', v_camp.code, 'reason', v_reason
      ));
      continue;
    end if;

    v_disc := 0;
    v_fee_disc := 0;
    v_cashback := 0;
    v_points := 0;

    if v_camp.campaign_type in (
      'percentage_discount', 'food_discount', 'marketplace_discount',
      'taxi_discount', 'first_order_offer', 'first_ride_offer',
      'first_marketplace_order_offer', 'reactivation_offer', 'birthday_offer',
      'happy_hour', 'geographic_offer', 'subscription_exclusive_offer',
      'category_discount', 'product_discount', 'restaurant_discount', 'seller_discount'
    ) and coalesce(v_camp.discount_percent, 0) > 0 then
      v_disc := least(
        v_sub,
        round(v_sub * v_camp.discount_percent / 100.0)::integer,
        coalesce(v_camp.max_discount_cents, v_sub)
      );
    elsif v_camp.campaign_type in ('fixed_discount') and coalesce(v_camp.discount_cents, 0) > 0 then
      v_disc := least(v_sub, v_camp.discount_cents, coalesce(v_camp.max_discount_cents, v_camp.discount_cents));
    elsif v_camp.campaign_type = 'free_delivery' then
      v_fee_disc := v_fee;
    elsif v_camp.campaign_type = 'delivery_fee_discount' then
      if coalesce(v_camp.discount_percent, 0) > 0 then
        v_fee_disc := least(v_fee, round(v_fee * v_camp.discount_percent / 100.0)::integer);
      else
        v_fee_disc := least(v_fee, coalesce(v_camp.discount_cents, 0));
      end if;
    elsif v_camp.campaign_type = 'cashback' then
      if coalesce(v_camp.discount_percent, 0) > 0 then
        v_cashback := least(
          coalesce(v_camp.max_discount_cents, v_sub),
          round(v_sub * v_camp.discount_percent / 100.0)::integer
        );
      else
        v_cashback := least(coalesce(v_camp.max_discount_cents, v_camp.discount_cents), coalesce(v_camp.discount_cents, 0));
      end if;
    elsif v_camp.campaign_type = 'loyalty_points_bonus' then
      if coalesce(v_camp.discount_percent, 0) > 0 then
        v_points := greatest(round(v_camp.discount_percent)::integer, 0); -- treated as multiplier pct stored as integer points boost pct
      else
        v_points := greatest(coalesce(v_camp.discount_cents, 0), 0); -- fixed points when stored in discount_cents
      end if;
    end if;

    -- Stacking: if non-stackable and we already applied a discount campaign, skip further order discounts
    if not v_camp.stackable and (v_total_disc > 0 or v_total_fee_disc > 0)
       and (v_disc > 0 or v_fee_disc > 0) then
      v_rejected := v_rejected || jsonb_build_array(jsonb_build_object(
        'campaign_id', v_camp.id, 'code', v_camp.code, 'reason', 'not_stackable'
      ));
      continue;
    end if;

    if v_disc = 0 and v_fee_disc = 0 and v_cashback = 0 and v_points = 0 then
      continue;
    end if;

    v_mmd_fund := round((v_disc + v_fee_disc) * coalesce(v_camp.mmd_funding_pct, 100) / 100.0)::integer;
    v_partner_fund := (v_disc + v_fee_disc) - v_mmd_fund;

    v_total_disc := v_total_disc + v_disc;
    v_total_fee_disc := least(v_fee, v_total_fee_disc + v_fee_disc);
    v_total_cashback := v_total_cashback + v_cashback;
    v_total_points := v_total_points + v_points;

    v_applied := v_applied || jsonb_build_array(jsonb_build_object(
      'campaign_id', v_camp.id,
      'code', v_camp.code,
      'type', v_camp.campaign_type,
      'discount_cents', v_disc,
      'delivery_fee_discount_cents', v_fee_disc,
      'cashback_cents', v_cashback,
      'points_bonus', v_points,
      'mmd_funded_cents', v_mmd_fund,
      'partner_funded_cents', v_partner_fund,
      'auto_apply', v_camp.auto_apply,
      'requires_code', v_camp.requires_code,
      'funder', v_camp.funder
    ));

    -- Prefer single best code/coupon campaign then continue autos if stackable
    if v_code <> '' and v_camp.requires_code and not v_camp.stackable then
      exit;
    end if;
  end loop;

  -- Cap by stack policy
  if v_policy.max_total_discount_cents is not null then
    v_total_disc := least(v_total_disc, v_policy.max_total_discount_cents);
  end if;
  if v_policy.max_total_discount_pct is not null and v_sub > 0 then
    v_total_disc := least(
      v_total_disc,
      round(v_sub * v_policy.max_total_discount_pct / 100.0)::integer
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'service', p_service,
    'order_discount_cents', least(v_total_disc, v_sub),
    'delivery_fee_discount_cents', least(v_total_fee_disc, v_fee),
    'cashback_cents', v_total_cashback,
    'points_bonus', v_total_points,
    'applied', v_applied,
    'rejected', v_rejected,
    'stack_policy', coalesce(v_policy.code, 'default'),
    'promo_code', nullif(v_code, ''),
    'coupon_id', p_coupon_id,
    'engine_version', 'marketing_v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Reserve
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketing_reserve(
  p_user_id uuid,
  p_service text,
  p_entity_type text,
  p_entity_id text,
  p_idempotency_key text,
  p_subtotal_cents integer default 0,
  p_delivery_fee_cents integer default 0,
  p_promo_code text default null,
  p_coupon_id uuid default null,
  p_country_code text default null,
  p_city text default null,
  p_partner_user_id uuid default null,
  p_has_mmd_plus boolean default false,
  p_is_first_order boolean default false,
  p_ttl_minutes integer default 45
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_resolve jsonb;
  v_item jsonb;
  v_campaign_id uuid;
  v_res_id uuid;
  v_code_id uuid;
  v_ttl integer := greatest(coalesce(p_ttl_minutes, 45), 5);
  v_discount integer;
  v_fee_disc integer;
  v_cashback integer;
  v_points integer;
  v_budget integer;
  v_first boolean := true;
begin
  if p_idempotency_key is null or p_user_id is null or p_entity_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  select id into v_existing
  from public.marketing_reservations
  where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'already_reserved', true, 'reservation_id', v_existing);
  end if;

  v_resolve := public.mmd_marketing_resolve(
    p_user_id, p_service, p_subtotal_cents, p_delivery_fee_cents,
    p_promo_code, p_coupon_id, p_country_code, p_city, p_partner_user_id,
    p_has_mmd_plus, p_is_first_order, now()
  );

  if coalesce((v_resolve ->> 'ok')::boolean, false) is not true then
    return v_resolve;
  end if;

  if jsonb_array_length(coalesce(v_resolve -> 'applied', '[]'::jsonb)) = 0 then
    return jsonb_build_object('ok', true, 'reserved', false, 'resolve', v_resolve);
  end if;

  -- Reserve primary (first) applied campaign for budget/quota; store full explanation
  v_item := (v_resolve -> 'applied') -> 0;
  v_campaign_id := (v_item ->> 'campaign_id')::uuid;
  v_discount := coalesce((v_resolve ->> 'order_discount_cents')::integer, 0);
  v_fee_disc := coalesce((v_resolve ->> 'delivery_fee_discount_cents')::integer, 0);
  v_cashback := coalesce((v_resolve ->> 'cashback_cents')::integer, 0);
  v_points := coalesce((v_resolve ->> 'points_bonus')::integer, 0);
  v_budget := v_discount + v_fee_disc;

  if p_promo_code is not null and length(trim(p_promo_code)) > 0 then
    select id into v_code_id
    from public.marketing_promo_codes
    where code_normalized = public.mmd_marketing_normalize_code(p_promo_code);
  end if;

  insert into public.marketing_reservations (
    idempotency_key, user_id, campaign_id, promo_code_id, coupon_id,
    service, entity_type, entity_id, status,
    discount_cents, delivery_fee_discount_cents, cashback_cents, points_bonus,
    currency, budget_reserved_cents, explanation, expires_at
  ) values (
    p_idempotency_key, p_user_id, v_campaign_id, v_code_id, p_coupon_id,
    p_service, p_entity_type, p_entity_id, 'reserved',
    v_discount, v_fee_disc, v_cashback, v_points,
    'USD', v_budget, v_resolve, now() + make_interval(mins => v_ttl)
  )
  returning id into v_res_id;

  update public.marketing_campaigns
  set budget_reserved_cents = budget_reserved_cents + v_budget,
      updated_at = now()
  where id = v_campaign_id;

  if v_code_id is not null then
    update public.marketing_promo_codes
    set reserved_count = reserved_count + 1, updated_at = now()
    where id = v_code_id;
  end if;

  if p_coupon_id is not null then
    update public.marketing_coupons
    set status = 'reserved', updated_at = now()
    where id = p_coupon_id and user_id = p_user_id and status = 'available';
  end if;

  insert into public.marketing_campaign_stats (campaign_id, reservations)
  values (v_campaign_id, 1)
  on conflict (campaign_id) do update
  set reservations = public.marketing_campaign_stats.reservations + 1,
      updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'reserved', true,
    'reservation_id', v_res_id,
    'order_discount_cents', v_discount,
    'delivery_fee_discount_cents', v_fee_disc,
    'cashback_cents', v_cashback,
    'points_bonus', v_points,
    'resolve', v_resolve
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Capture
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketing_capture(
  p_reservation_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.marketing_reservations%rowtype;
  v_app_id uuid;
  v_item jsonb;
  v_mmd integer := 0;
  v_partner integer := 0;
begin
  if p_reservation_id is not null then
    select * into v_res from public.marketing_reservations where id = p_reservation_id for update;
  elsif p_idempotency_key is not null then
    select * into v_res from public.marketing_reservations where idempotency_key = p_idempotency_key for update;
  else
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'reservation_not_found');
  end if;
  if v_res.status = 'captured' then
    return jsonb_build_object('ok', true, 'already_captured', true, 'reservation_id', v_res.id);
  end if;
  if v_res.status <> 'reserved' then
    return jsonb_build_object('ok', false, 'error', 'reservation_not_capturable', 'status', v_res.status);
  end if;

  v_item := coalesce((v_res.explanation -> 'applied') -> 0, '{}'::jsonb);
  v_mmd := coalesce((v_item ->> 'mmd_funded_cents')::integer, v_res.discount_cents + v_res.delivery_fee_discount_cents);
  v_partner := coalesce((v_item ->> 'partner_funded_cents')::integer, 0);

  update public.marketing_reservations
  set status = 'captured', captured_at = now(), updated_at = now()
  where id = v_res.id;

  insert into public.marketing_applications (
    reservation_id, user_id, campaign_id, promo_code_id, coupon_id,
    service, entity_type, entity_id, kind,
    discount_cents, delivery_fee_discount_cents, cashback_cents, points_bonus,
    mmd_funded_cents, partner_funded_cents, currency, explanation,
    idempotency_key
  ) values (
    v_res.id, v_res.user_id, v_res.campaign_id, v_res.promo_code_id, v_res.coupon_id,
    v_res.service, v_res.entity_type, v_res.entity_id, 'capture',
    v_res.discount_cents, v_res.delivery_fee_discount_cents, v_res.cashback_cents, v_res.points_bonus,
    v_mmd, v_partner, v_res.currency, v_res.explanation,
    'capture:' || v_res.idempotency_key
  )
  returning id into v_app_id;

  update public.marketing_campaigns
  set budget_reserved_cents = greatest(budget_reserved_cents - v_res.budget_reserved_cents, 0),
      budget_spent_cents = budget_spent_cents + v_res.budget_reserved_cents,
      updated_at = now()
  where id = v_res.campaign_id;

  if v_res.promo_code_id is not null then
    update public.marketing_promo_codes
    set reserved_count = greatest(reserved_count - 1, 0),
        redemption_count = redemption_count + 1,
        updated_at = now()
    where id = v_res.promo_code_id;
  end if;

  if v_res.coupon_id is not null then
    update public.marketing_coupons
    set status = 'used', used_at = now(), usage_count = usage_count + 1, updated_at = now()
    where id = v_res.coupon_id;
  end if;

  if v_res.cashback_cents > 0 then
    insert into public.marketing_cashback_ledger (
      user_id, campaign_id, application_id, service, entity_type, entity_id,
      entry_type, amount_cents, currency, destination, status,
      available_at, expires_at, idempotency_key
    ) values (
      v_res.user_id, v_res.campaign_id, v_app_id, v_res.service, v_res.entity_type, v_res.entity_id,
      'accrual', v_res.cashback_cents, v_res.currency, 'mmd_credit', 'pending',
      now() + interval '7 days', now() + interval '180 days',
      'cashback:' || v_res.idempotency_key
    )
    on conflict do nothing;
  end if;

  insert into public.marketing_campaign_stats (campaign_id, captures, discount_cents_total, mmd_funded_cents_total, partner_funded_cents_total)
  values (v_res.campaign_id, 1, v_res.discount_cents + v_res.delivery_fee_discount_cents, v_mmd, v_partner)
  on conflict (campaign_id) do update
  set captures = public.marketing_campaign_stats.captures + 1,
      discount_cents_total = public.marketing_campaign_stats.discount_cents_total + excluded.discount_cents_total,
      mmd_funded_cents_total = public.marketing_campaign_stats.mmd_funded_cents_total + excluded.mmd_funded_cents_total,
      partner_funded_cents_total = public.marketing_campaign_stats.partner_funded_cents_total + excluded.partner_funded_cents_total,
      updated_at = now();

  insert into public.marketing_order_snapshots (
    service, entity_type, entity_id, user_id, currency,
    catalog_cents, promo_discount_cents, total_discount_cents,
    amount_paid_cents, mmd_funded_cents, partner_funded_cents,
    campaigns_applied, stack_policy_code, engine_version
  ) values (
    v_res.service, v_res.entity_type, v_res.entity_id, v_res.user_id, v_res.currency,
    0, v_res.discount_cents, v_res.discount_cents + v_res.delivery_fee_discount_cents,
    0, v_mmd, v_partner,
    coalesce(v_res.explanation -> 'applied', '[]'::jsonb),
    coalesce(v_res.explanation ->> 'stack_policy', 'default'),
    'marketing_v1'
  )
  on conflict (entity_type, entity_id) do nothing;

  return jsonb_build_object('ok', true, 'captured', true, 'application_id', v_app_id, 'reservation_id', v_res.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Release
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketing_release(
  p_reservation_id uuid default null,
  p_idempotency_key text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.marketing_reservations%rowtype;
begin
  if p_reservation_id is not null then
    select * into v_res from public.marketing_reservations where id = p_reservation_id for update;
  elsif p_idempotency_key is not null then
    select * into v_res from public.marketing_reservations where idempotency_key = p_idempotency_key for update;
  else
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  if not found then
    return jsonb_build_object('ok', true, 'released', false, 'reason', 'not_found');
  end if;
  if v_res.status in ('released', 'expired', 'reversed') then
    return jsonb_build_object('ok', true, 'already_released', true);
  end if;
  if v_res.status = 'captured' then
    return jsonb_build_object('ok', false, 'error', 'already_captured_use_reverse');
  end if;

  update public.marketing_reservations
  set status = 'released', released_at = now(),
      metadata = metadata || jsonb_build_object('release_reason', p_reason),
      updated_at = now()
  where id = v_res.id;

  update public.marketing_campaigns
  set budget_reserved_cents = greatest(budget_reserved_cents - v_res.budget_reserved_cents, 0),
      updated_at = now()
  where id = v_res.campaign_id;

  if v_res.promo_code_id is not null then
    update public.marketing_promo_codes
    set reserved_count = greatest(reserved_count - 1, 0), updated_at = now()
    where id = v_res.promo_code_id;
  end if;

  if v_res.coupon_id is not null then
    update public.marketing_coupons
    set status = 'available', updated_at = now()
    where id = v_res.coupon_id and status = 'reserved';
  end if;

  return jsonb_build_object('ok', true, 'released', true, 'reservation_id', v_res.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reverse / refund (compensating entries only)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketing_reverse(
  p_entity_type text,
  p_entity_id text,
  p_restore_coupon boolean default false,
  p_reason text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app public.marketing_applications%rowtype;
  v_key text := coalesce(p_idempotency_key, 'reverse:' || p_entity_type || ':' || p_entity_id);
  v_existing uuid;
begin
  select id into v_existing from public.marketing_applications where idempotency_key = v_key;
  if found then
    return jsonb_build_object('ok', true, 'already_reversed', true);
  end if;

  select * into v_app
  from public.marketing_applications
  where entity_type = p_entity_type and entity_id = p_entity_id and kind = 'capture'
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'reversed', false, 'reason', 'no_capture');
  end if;

  insert into public.marketing_applications (
    reservation_id, user_id, campaign_id, promo_code_id, coupon_id,
    service, entity_type, entity_id, kind,
    discount_cents, delivery_fee_discount_cents, cashback_cents, points_bonus,
    mmd_funded_cents, partner_funded_cents, currency, explanation, idempotency_key
  ) values (
    v_app.reservation_id, v_app.user_id, v_app.campaign_id, v_app.promo_code_id, v_app.coupon_id,
    v_app.service, v_app.entity_type, v_app.entity_id, 'refund',
    -abs(v_app.discount_cents), -abs(v_app.delivery_fee_discount_cents),
    -abs(v_app.cashback_cents), -abs(v_app.points_bonus),
    -abs(v_app.mmd_funded_cents), -abs(v_app.partner_funded_cents),
    v_app.currency,
    jsonb_build_object('reason', p_reason, 'source_application_id', v_app.id),
    v_key
  );

  if v_app.cashback_cents > 0 then
    insert into public.marketing_cashback_ledger (
      user_id, campaign_id, application_id, service, entity_type, entity_id,
      entry_type, amount_cents, currency, destination, status, idempotency_key
    ) values (
      v_app.user_id, v_app.campaign_id, v_app.id, v_app.service, v_app.entity_type, v_app.entity_id,
      'clawback', -abs(v_app.cashback_cents), v_app.currency, 'mmd_credit', 'clawed_back',
      'cashback-clawback:' || v_key
    )
    on conflict do nothing;

    update public.marketing_cashback_ledger
    set status = 'clawed_back'
    where entity_type = p_entity_type and entity_id = p_entity_id
      and entry_type = 'accrual' and status in ('pending', 'available', 'credited');
  end if;

  if p_restore_coupon and v_app.coupon_id is not null then
    update public.marketing_coupons
    set status = 'available', used_at = null, updated_at = now()
    where id = v_app.coupon_id and status = 'used';
  end if;

  insert into public.marketing_campaign_stats (campaign_id, refunds)
  values (v_app.campaign_id, 1)
  on conflict (campaign_id) do update
  set refunds = public.marketing_campaign_stats.refunds + 1, updated_at = now();

  return jsonb_build_object('ok', true, 'reversed', true, 'application_id', v_app.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grant coupon to user
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketing_grant_coupon(
  p_user_id uuid,
  p_campaign_id uuid,
  p_expires_at timestamptz default null,
  p_source text default 'admin',
  p_reason text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_camp public.marketing_campaigns%rowtype;
  v_id uuid;
  v_existing uuid;
begin
  if p_idempotency_key is not null then
    select id into v_existing
    from public.marketing_coupons
    where metadata ->> 'idempotency_key' = p_idempotency_key;
    if found then
      return jsonb_build_object('ok', true, 'already_granted', true, 'coupon_id', v_existing);
    end if;
  end if;

  select * into v_camp from public.marketing_campaigns where id = p_campaign_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'campaign_not_found');
  end if;

  insert into public.marketing_coupons (
    user_id, campaign_id, status, services, value_cents, value_percent,
    source, reason, expires_at, metadata
  ) values (
    p_user_id, p_campaign_id, 'available', v_camp.services,
    v_camp.discount_cents, v_camp.discount_percent,
    coalesce(p_source, 'admin'), p_reason,
    coalesce(p_expires_at, v_camp.ends_at),
    case when p_idempotency_key is not null
      then jsonb_build_object('idempotency_key', p_idempotency_key)
      else '{}'::jsonb end
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'coupon_id', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Cron batch
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketing_expire_due_batch(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(least(coalesce(p_limit, 200), 500), 1);
  v_activated integer := 0;
  v_ended integer := 0;
  v_coupons integer := 0;
  v_reservations integer := 0;
  v_cashback_ready integer := 0;
begin
  -- Activate scheduled
  with due as (
    select id from public.marketing_campaigns
    where status = 'scheduled'
      and starts_at is not null and starts_at <= now()
      and (ends_at is null or ends_at > now())
    order by starts_at
    limit v_limit
    for update skip locked
  )
  update public.marketing_campaigns c
  set status = 'active', updated_at = now()
  from due d where c.id = d.id;
  get diagnostics v_activated = row_count;

  -- End expired campaigns
  with due as (
    select id from public.marketing_campaigns
    where status in ('active', 'scheduled', 'suspended')
      and ends_at is not null and ends_at <= now()
    order by ends_at
    limit v_limit
    for update skip locked
  )
  update public.marketing_campaigns c
  set status = 'ended', updated_at = now()
  from due d where c.id = d.id;
  get diagnostics v_ended = row_count;

  update public.marketing_coupons
  set status = 'expired', updated_at = now()
  where status = 'available'
    and expires_at is not null and expires_at <= now();
  get diagnostics v_coupons = row_count;

  -- Expire stale reservations via release semantics
  with due as (
    select id from public.marketing_reservations
    where status = 'reserved' and expires_at <= now()
    order by expires_at
    limit v_limit
    for update skip locked
  )
  select count(*) into v_reservations from due;

  perform public.mmd_marketing_release(d.id, null, 'reservation_expired')
  from (
    select id from public.marketing_reservations
    where status = 'reserved' and expires_at <= now()
    order by expires_at
    limit v_limit
  ) d;

  -- Mark cashback available (credit to MMD credit is done in app layer)
  update public.marketing_cashback_ledger
  set status = 'available'
  where status = 'pending'
    and available_at is not null
    and available_at <= now();
  get diagnostics v_cashback_ready = row_count;

  update public.marketing_cashback_ledger
  set status = 'expired'
  where status in ('pending', 'available')
    and expires_at is not null and expires_at <= now();

  update public.marketing_promo_codes
  set status = 'expired', updated_at = now()
  where status = 'active' and ends_at is not null and ends_at <= now();

  return jsonb_build_object(
    'ok', true,
    'activated', v_activated,
    'ended', v_ended,
    'expired_coupons', v_coupons,
    'expired_reservations', v_reservations,
    'cashback_available', v_cashback_ready
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.mmd_marketing_normalize_code(text) from public, anon, authenticated;
revoke all on function public.mmd_marketing_resolve(uuid, text, integer, integer, text, uuid, text, text, uuid, boolean, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.mmd_marketing_reserve(uuid, text, text, text, text, integer, integer, text, uuid, text, text, uuid, boolean, boolean, integer) from public, anon, authenticated;
revoke all on function public.mmd_marketing_capture(uuid, text) from public, anon, authenticated;
revoke all on function public.mmd_marketing_release(uuid, text, text) from public, anon, authenticated;
revoke all on function public.mmd_marketing_reverse(text, text, boolean, text, text) from public, anon, authenticated;
revoke all on function public.mmd_marketing_grant_coupon(uuid, uuid, timestamptz, text, text, text) from public, anon, authenticated;
revoke all on function public.mmd_marketing_expire_due_batch(integer) from public, anon, authenticated;

grant execute on function public.mmd_marketing_normalize_code(text) to service_role;
grant execute on function public.mmd_marketing_resolve(uuid, text, integer, integer, text, uuid, text, text, uuid, boolean, boolean, timestamptz) to service_role;
grant execute on function public.mmd_marketing_reserve(uuid, text, text, text, text, integer, integer, text, uuid, text, text, uuid, boolean, boolean, integer) to service_role;
grant execute on function public.mmd_marketing_capture(uuid, text) to service_role;
grant execute on function public.mmd_marketing_release(uuid, text, text) to service_role;
grant execute on function public.mmd_marketing_reverse(text, text, boolean, text, text) to service_role;
grant execute on function public.mmd_marketing_grant_coupon(uuid, uuid, timestamptz, text, text, text) to service_role;
grant execute on function public.mmd_marketing_expire_due_batch(integer) to service_role;

commit;
