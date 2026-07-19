-- Phase 7.1 — Marketing engine finalization
-- Cashback → Crédit MMD, driver wallet bonuses, taxi legacy bridge,
-- cashback ledger recovery states. No Production apply from this file alone.

-- ---------------------------------------------------------------------------
-- 1) Cashback ledger: credit refs + recovery states
-- ---------------------------------------------------------------------------
alter table public.marketing_cashback_ledger
  drop constraint if exists marketing_cashback_ledger_status_check;

alter table public.marketing_cashback_ledger
  add constraint marketing_cashback_ledger_status_check check (
    status in (
      'pending',
      'available',
      'credited',
      'expired',
      'clawed_back',
      'failed',
      'pending_recovery'
    )
  );

alter table public.marketing_cashback_ledger
  add column if not exists mmd_credit_ledger_id uuid,
  add column if not exists credit_idempotency_key text,
  add column if not exists clawback_idempotency_key text,
  add column if not exists last_error text,
  add column if not exists credited_balance_after_cents bigint;

create unique index if not exists marketing_cashback_credit_idem_uq
  on public.marketing_cashback_ledger (credit_idempotency_key)
  where credit_idempotency_key is not null;

create index if not exists marketing_cashback_available_idx
  on public.marketing_cashback_ledger (status, available_at)
  where status = 'available';

-- ---------------------------------------------------------------------------
-- 2) Driver progress: qualification / reverse metadata
-- ---------------------------------------------------------------------------
alter table public.marketing_driver_progress
  drop constraint if exists marketing_driver_progress_status_check;

alter table public.marketing_driver_progress
  add constraint marketing_driver_progress_status_check check (
    status in (
      'in_progress',
      'completed',
      'qualified',
      'rewarded',
      'reversed',
      'expired'
    )
  );

alter table public.marketing_driver_progress
  add column if not exists reward_idempotency_key text,
  add column if not exists wallet_ledger_id uuid,
  add column if not exists reverse_wallet_ledger_id uuid,
  add column if not exists reverse_reason text,
  add column if not exists reversed_at timestamptz,
  add column if not exists qualification_period text;

create unique index if not exists marketing_driver_progress_reward_idem_uq
  on public.marketing_driver_progress (reward_idempotency_key)
  where reward_idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- 3) Taxi legacy bridge columns
-- ---------------------------------------------------------------------------
alter table public.taxi_promotions
  add column if not exists marketing_campaign_id uuid
    references public.marketing_campaigns (id) on delete set null,
  add column if not exists bridge_status text not null default 'legacy_active'
    check (
      bridge_status in (
        'legacy_active',
        'bridged',
        'migrated',
        'retired',
        'incompatible',
        'manual_review_required',
        'skipped'
      )
    ),
  add column if not exists bridged_at timestamptz,
  add column if not exists bridge_report jsonb not null default '{}'::jsonb;

create index if not exists taxi_promotions_bridge_status_idx
  on public.taxi_promotions (bridge_status, active);

-- ---------------------------------------------------------------------------
-- 4) Helper: append marketing audit
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketing_audit_append(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_campaign_id uuid default null,
  p_reason text default null,
  p_correlation_id text default null,
  p_idempotency_key text default null,
  p_source text default 'service',
  p_context jsonb default '{}'::jsonb,
  p_admin_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.marketing_audit (
    admin_user_id, action, entity_type, entity_id, campaign_id,
    reason, correlation_id, source, context
  ) values (
    p_admin_user_id, p_action, p_entity_type, p_entity_id, p_campaign_id,
    p_reason, p_correlation_id, p_source,
    coalesce(p_context, '{}'::jsonb) || jsonb_build_object(
      'idempotency_key', p_idempotency_key
    )
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.mmd_marketing_audit_append(
  text, text, uuid, uuid, text, text, text, text, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.mmd_marketing_audit_append(
  text, text, uuid, uuid, text, text, text, text, jsonb, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- 5) Credit available cashback → Crédit MMD (service_role only)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketing_credit_cashback(
  p_cashback_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.marketing_cashback_ledger%rowtype;
  v_key text;
  v_credit jsonb;
  v_ledger_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'service_role_required');
  end if;

  select * into v_row
  from public.marketing_cashback_ledger
  where id = p_cashback_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'cashback_not_found');
  end if;

  if v_row.destination is distinct from 'mmd_credit' then
    return jsonb_build_object('ok', false, 'error', 'invalid_destination');
  end if;

  if v_row.status = 'credited' then
    return jsonb_build_object(
      'ok', true,
      'already_credited', true,
      'cashback_id', v_row.id,
      'mmd_credit_ledger_id', v_row.mmd_credit_ledger_id
    );
  end if;

  if v_row.status not in ('available', 'failed') then
    return jsonb_build_object(
      'ok', false,
      'error', 'cashback_not_creditable',
      'status', v_row.status
    );
  end if;

  if v_row.amount_cents is null or v_row.amount_cents <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  if v_row.campaign_id is null or v_row.application_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_marketing_refs');
  end if;

  v_key := coalesce(
    nullif(trim(p_idempotency_key), ''),
    nullif(trim(v_row.credit_idempotency_key), ''),
    'marketing:cashback:' || v_row.id::text || ':credit'
  );

  v_credit := public.mmd_credit_add(
    v_row.user_id,
    v_row.amount_cents::bigint,
    'marketing_cashback',
    'marketing_cashback_ledger',
    v_row.id::text,
    v_key,
    v_row.expires_at,
    'Marketing cashback ' || coalesce(v_row.campaign_id::text, ''),
    null
  );

  if coalesce((v_credit ->> 'ok')::boolean, false) is not true then
    update public.marketing_cashback_ledger
    set status = 'failed',
        last_error = coalesce(v_credit ->> 'error', 'credit_failed'),
        credit_idempotency_key = v_key,
        metadata = metadata || jsonb_build_object(
          'source', 'marketing',
          'campaign_id', v_row.campaign_id,
          'application_id', v_row.application_id,
          'cashback_ledger_id', v_row.id,
          'last_credit_result', v_credit
        )
    where id = v_row.id;

    perform public.mmd_marketing_audit_append(
      'cashback_credit_failed',
      'marketing_cashback_ledger',
      v_row.id,
      v_row.campaign_id,
      v_credit ->> 'error',
      v_row.id::text,
      v_key,
      'mmd_marketing_credit_cashback',
      jsonb_build_object('result', v_credit)
    );

    return jsonb_build_object(
      'ok', false,
      'error', coalesce(v_credit ->> 'error', 'credit_failed'),
      'cashback_id', v_row.id
    );
  end if;

  select id into v_ledger_id
  from public.mmd_credit_ledger
  where idempotency_key = v_key
  order by created_at desc
  limit 1;

  update public.marketing_cashback_ledger
  set status = 'credited',
      credited_at = coalesce(credited_at, now()),
      mmd_credit_ledger_id = v_ledger_id,
      credit_idempotency_key = v_key,
      credited_balance_after_cents = nullif(v_credit ->> 'balance_cents', '')::bigint,
      last_error = null,
      metadata = metadata || jsonb_build_object(
        'source', 'marketing',
        'campaign_id', v_row.campaign_id,
        'application_id', v_row.application_id,
        'cashback_ledger_id', v_row.id,
        'credited_via', 'mmd_credit_add'
      )
  where id = v_row.id;

  perform public.mmd_marketing_audit_append(
    'cashback_credited',
    'marketing_cashback_ledger',
    v_row.id,
    v_row.campaign_id,
    null,
    v_row.id::text,
    v_key,
    'mmd_marketing_credit_cashback',
    jsonb_build_object(
      'mmd_credit_ledger_id', v_ledger_id,
      'amount_cents', v_row.amount_cents,
      'already_applied', coalesce((v_credit ->> 'already_applied')::boolean, false)
    )
  );

  return jsonb_build_object(
    'ok', true,
    'cashback_id', v_row.id,
    'mmd_credit_ledger_id', v_ledger_id,
    'already_applied', coalesce((v_credit ->> 'already_applied')::boolean, false),
    'balance_cents', v_credit -> 'balance_cents'
  );
end;
$$;

create or replace function public.mmd_marketing_credit_cashback_batch(
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
  r record;
  v_res jsonb;
  v_scanned integer := 0;
  v_credited integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_ids uuid[] := '{}';
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'service_role_required');
  end if;

  for r in
    select id
    from public.marketing_cashback_ledger
    where status = 'available'
      and available_at is not null
      and available_at <= now()
      and (expires_at is null or expires_at > now())
    order by available_at
    limit v_limit
    for update skip locked
  loop
    v_scanned := v_scanned + 1;
    v_ids := array_append(v_ids, r.id);
    v_res := public.mmd_marketing_credit_cashback(r.id, null);
    if coalesce((v_res ->> 'ok')::boolean, false) then
      if coalesce((v_res ->> 'already_credited')::boolean, false)
         or coalesce((v_res ->> 'already_applied')::boolean, false) then
        v_skipped := v_skipped + 1;
      else
        v_credited := v_credited + 1;
      end if;
    else
      v_failed := v_failed + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'scanned', v_scanned,
    'credited', v_credited,
    'skipped', v_skipped,
    'failed', v_failed,
    'clawbacks', 0,
    'ids', to_jsonb(v_ids),
    'next_cursor', case when v_scanned >= v_limit then true else false end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Clawback credited cashback (compensating Crédit MMD spend)
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketing_clawback_cashback(
  p_cashback_id uuid,
  p_reason text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.marketing_cashback_ledger%rowtype;
  v_key text;
  v_spend jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'service_role_required');
  end if;

  select * into v_row
  from public.marketing_cashback_ledger
  where id = p_cashback_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'cashback_not_found');
  end if;

  if v_row.status = 'clawed_back' then
    return jsonb_build_object('ok', true, 'already_clawed_back', true);
  end if;

  if v_row.status = 'pending_recovery' then
    return jsonb_build_object('ok', true, 'pending_recovery', true);
  end if;

  -- Not yet credited: mark clawed without touching Crédit MMD balance.
  if v_row.status in ('pending', 'available', 'failed', 'expired') then
    update public.marketing_cashback_ledger
    set status = 'clawed_back',
        last_error = null,
        metadata = metadata || jsonb_build_object(
          'clawback_reason', p_reason,
          'clawback_pre_credit', true
        )
    where id = v_row.id;

    perform public.mmd_marketing_audit_append(
      'cashback_clawback_pre_credit',
      'marketing_cashback_ledger',
      v_row.id,
      v_row.campaign_id,
      p_reason,
      v_row.id::text,
      coalesce(p_idempotency_key, 'marketing:cashback:' || v_row.id::text || ':clawback'),
      'mmd_marketing_clawback_cashback',
      '{}'::jsonb
    );

    return jsonb_build_object('ok', true, 'clawed_back', true, 'pre_credit', true);
  end if;

  if v_row.status <> 'credited' then
    return jsonb_build_object('ok', false, 'error', 'cashback_not_clawable', 'status', v_row.status);
  end if;

  v_key := coalesce(
    nullif(trim(p_idempotency_key), ''),
    nullif(trim(v_row.clawback_idempotency_key), ''),
    'marketing:cashback:' || v_row.id::text || ':clawback'
  );

  v_spend := public.mmd_credit_spend(
    v_row.user_id,
    abs(v_row.amount_cents)::bigint,
    'marketing_cashback_clawback',
    v_row.id::text,
    v_key,
    coalesce(p_reason, 'Marketing cashback clawback')
  );

  if coalesce((v_spend ->> 'ok')::boolean, false) is not true then
    update public.marketing_cashback_ledger
    set status = 'pending_recovery',
        clawback_idempotency_key = v_key,
        last_error = coalesce(v_spend ->> 'error', 'insufficient_credit'),
        metadata = metadata || jsonb_build_object(
          'clawback_reason', p_reason,
          'pending_recovery', true,
          'spend_result', v_spend
        )
    where id = v_row.id;

    perform public.mmd_marketing_audit_append(
      'cashback_clawback_pending_recovery',
      'marketing_cashback_ledger',
      v_row.id,
      v_row.campaign_id,
      coalesce(v_spend ->> 'error', p_reason),
      v_row.id::text,
      v_key,
      'mmd_marketing_clawback_cashback',
      jsonb_build_object('result', v_spend)
    );

    return jsonb_build_object(
      'ok', false,
      'error', coalesce(v_spend ->> 'error', 'insufficient_credit'),
      'pending_recovery', true,
      'cashback_id', v_row.id
    );
  end if;

  update public.marketing_cashback_ledger
  set status = 'clawed_back',
      clawback_idempotency_key = v_key,
      last_error = null,
      metadata = metadata || jsonb_build_object(
        'clawback_reason', p_reason,
        'clawback_credit_spend', v_spend,
        'original_mmd_credit_ledger_id', v_row.mmd_credit_ledger_id
      )
  where id = v_row.id;

  perform public.mmd_marketing_audit_append(
    'cashback_clawback',
    'marketing_cashback_ledger',
    v_row.id,
    v_row.campaign_id,
    p_reason,
    v_row.id::text,
    v_key,
    'mmd_marketing_clawback_cashback',
    jsonb_build_object('spend', v_spend)
  );

  return jsonb_build_object('ok', true, 'clawed_back', true, 'cashback_id', v_row.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Enhance reverse to claw back credited cashback
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
  r record;
  v_cb jsonb;
  v_clawbacks integer := 0;
  v_pending_recovery integer := 0;
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

    for r in
      select id, status
      from public.marketing_cashback_ledger
      where entity_type = p_entity_type
        and entity_id = p_entity_id
        and entry_type = 'accrual'
        and status in ('pending', 'available', 'credited', 'failed', 'pending_recovery')
      for update
    loop
      v_cb := public.mmd_marketing_clawback_cashback(
        r.id,
        coalesce(p_reason, 'marketing_reverse'),
        'marketing:cashback:' || r.id::text || ':clawback:' || v_key
      );
      if coalesce((v_cb ->> 'pending_recovery')::boolean, false) then
        v_pending_recovery := v_pending_recovery + 1;
      else
        v_clawbacks := v_clawbacks + 1;
      end if;
    end loop;
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

  perform public.mmd_marketing_audit_append(
    'marketing_reverse',
    p_entity_type,
    null,
    v_app.campaign_id,
    p_reason,
    v_key,
    v_key,
    'mmd_marketing_reverse',
    jsonb_build_object(
      'entity_id', p_entity_id,
      'application_id', v_app.id,
      'clawbacks', v_clawbacks,
      'pending_recovery', v_pending_recovery
    )
  );

  return jsonb_build_object(
    'ok', true,
    'reversed', true,
    'application_id', v_app.id,
    'clawbacks', v_clawbacks,
    'pending_recovery', v_pending_recovery
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Driver monetary bonus → wallet_ledger
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketing_pay_driver_progress(
  p_progress_id uuid,
  p_idempotency_key text default null,
  p_country_code text default 'US'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prog public.marketing_driver_progress%rowtype;
  v_obj public.marketing_driver_objectives%rowtype;
  v_camp public.marketing_campaigns%rowtype;
  v_key text;
  v_balance bigint;
  v_ledger_id uuid;
  v_country text;
  v_driver_ok boolean;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'service_role_required');
  end if;

  select * into v_prog
  from public.marketing_driver_progress
  where id = p_progress_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'progress_not_found');
  end if;

  if v_prog.status = 'rewarded' and v_prog.wallet_ledger_id is not null then
    return jsonb_build_object(
      'ok', true,
      'already_rewarded', true,
      'wallet_ledger_id', v_prog.wallet_ledger_id
    );
  end if;

  if v_prog.status = 'reversed' then
    return jsonb_build_object('ok', false, 'error', 'progress_reversed');
  end if;

  if v_prog.status not in ('completed', 'qualified', 'rewarded') then
    return jsonb_build_object('ok', false, 'error', 'progress_not_qualified', 'status', v_prog.status);
  end if;

  select * into v_obj from public.marketing_driver_objectives where id = v_prog.objective_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'objective_not_found');
  end if;

  select * into v_camp from public.marketing_campaigns where id = v_obj.campaign_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'campaign_not_found');
  end if;

  if v_camp.status not in ('active', 'ended') then
    return jsonb_build_object('ok', false, 'error', 'campaign_not_eligible', 'status', v_camp.status);
  end if;

  if v_prog.progress_count < v_obj.target_count then
    return jsonb_build_object('ok', false, 'error', 'threshold_not_met');
  end if;

  select exists (
    select 1
    from public.profiles p
    where p.id = v_prog.driver_user_id
  ) into v_driver_ok;

  if v_driver_ok is not true then
    return jsonb_build_object('ok', false, 'error', 'driver_not_eligible');
  end if;

  v_key := coalesce(
    nullif(trim(p_idempotency_key), ''),
    nullif(trim(v_prog.reward_idempotency_key), ''),
    'marketing:driver:' || v_prog.id::text || ':reward'
  );

  -- Points path uses existing loyalty accrue when reward_points > 0 and no cents.
  if coalesce(v_obj.reward_cents, 0) <= 0 then
    if coalesce(v_obj.reward_points, 0) > 0 then
      perform public.mmd_loyalty_accrue(
        v_prog.driver_user_id,
        v_obj.reward_points,
        'driver',
        'marketing_driver_objective',
        v_prog.id::text,
        v_key,
        'Marketing driver objective points',
        null,
        jsonb_build_object(
          'source', 'marketing',
          'campaign_id', v_obj.campaign_id,
          'objective_id', v_obj.id,
          'progress_id', v_prog.id
        ),
        'driver'
      );
    end if;

    update public.marketing_driver_progress
    set status = 'rewarded',
        rewarded_at = coalesce(rewarded_at, now()),
        reward_idempotency_key = v_key,
        reward_ledger_ref = v_key,
        updated_at = now()
    where id = v_prog.id;

    perform public.mmd_marketing_audit_append(
      'driver_reward_points',
      'marketing_driver_progress',
      v_prog.id,
      v_obj.campaign_id,
      null,
      v_prog.id::text,
      v_key,
      'mmd_marketing_pay_driver_progress',
      jsonb_build_object('reward_points', v_obj.reward_points)
    );

    return jsonb_build_object('ok', true, 'rewarded', true, 'kind', 'points');
  end if;

  -- Monetary → wallet_ledger (never mutate balance directly)
  v_country := upper(coalesce(nullif(trim(p_country_code), ''), v_obj.country_code, 'US'));
  if v_country !~ '^[A-Z]{2}$' then
    v_country := 'US';
  end if;

  select coalesce(
    (
      select balance_after_cents
      from public.wallet_ledger
      where account_type = 'driver'
        and account_user_id = v_prog.driver_user_id
        and currency = coalesce(v_camp.currency, 'USD')
      order by created_at desc
      limit 1
    ),
    0
  ) into v_balance;

  v_balance := v_balance + v_obj.reward_cents;

  insert into public.wallet_ledger (
    account_type, account_user_id, country_code, currency, direction,
    amount_cents, balance_after_cents, reference_type, reference_id,
    description, metadata
  ) values (
    'driver',
    v_prog.driver_user_id,
    v_country,
    coalesce(v_camp.currency, 'USD'),
    'credit',
    v_obj.reward_cents,
    v_balance,
    'adjustment',
    v_prog.id,
    'Marketing driver campaign bonus',
    jsonb_build_object(
      'source', 'marketing',
      'campaign_id', v_obj.campaign_id,
      'goal_id', v_obj.id,
      'progress_id', v_prog.id,
      'qualification_period', coalesce(v_prog.qualification_period, v_obj.starts_at::text || '/' || v_obj.ends_at::text),
      'idempotency_key', v_key,
      'amount_cents', v_obj.reward_cents,
      'currency', coalesce(v_camp.currency, 'USD')
    )
  )
  returning id into v_ledger_id;

  update public.marketing_driver_progress
  set status = 'rewarded',
      rewarded_at = coalesce(rewarded_at, now()),
      reward_idempotency_key = v_key,
      wallet_ledger_id = v_ledger_id,
      reward_ledger_ref = v_ledger_id::text,
      updated_at = now()
  where id = v_prog.id;

  perform public.mmd_marketing_audit_append(
    'driver_reward_paid',
    'marketing_driver_progress',
    v_prog.id,
    v_obj.campaign_id,
    null,
    v_prog.id::text,
    v_key,
    'mmd_marketing_pay_driver_progress',
    jsonb_build_object('wallet_ledger_id', v_ledger_id, 'amount_cents', v_obj.reward_cents)
  );

  return jsonb_build_object(
    'ok', true,
    'rewarded', true,
    'kind', 'wallet',
    'wallet_ledger_id', v_ledger_id,
    'amount_cents', v_obj.reward_cents
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', true, 'already_rewarded', true);
end;
$$;

create or replace function public.mmd_marketing_reverse_driver_progress(
  p_progress_id uuid,
  p_reason text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prog public.marketing_driver_progress%rowtype;
  v_obj public.marketing_driver_objectives%rowtype;
  v_key text;
  v_orig public.wallet_ledger%rowtype;
  v_balance bigint;
  v_ledger_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'service_role_required');
  end if;

  select * into v_prog
  from public.marketing_driver_progress
  where id = p_progress_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'progress_not_found');
  end if;

  if v_prog.status = 'reversed' then
    return jsonb_build_object('ok', true, 'already_reversed', true);
  end if;

  if v_prog.status <> 'rewarded' or v_prog.wallet_ledger_id is null then
    update public.marketing_driver_progress
    set status = 'reversed',
        reverse_reason = p_reason,
        reversed_at = now(),
        updated_at = now()
    where id = v_prog.id;
    return jsonb_build_object('ok', true, 'reversed', true, 'wallet', false);
  end if;

  select * into v_obj from public.marketing_driver_objectives where id = v_prog.objective_id;
  select * into v_orig from public.wallet_ledger where id = v_prog.wallet_ledger_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'wallet_ledger_missing');
  end if;

  v_key := coalesce(
    nullif(trim(p_idempotency_key), ''),
    'marketing:driver:' || v_prog.id::text || ':reverse'
  );

  select coalesce(
    (
      select balance_after_cents
      from public.wallet_ledger
      where account_type = 'driver'
        and account_user_id = v_prog.driver_user_id
        and currency = v_orig.currency
      order by created_at desc
      limit 1
    ),
    0
  ) into v_balance;

  v_balance := v_balance - v_orig.amount_cents;

  insert into public.wallet_ledger (
    account_type, account_user_id, country_code, currency, direction,
    amount_cents, balance_after_cents, reference_type, reference_id,
    description, metadata
  ) values (
    'driver',
    v_prog.driver_user_id,
    v_orig.country_code,
    v_orig.currency,
    'debit',
    v_orig.amount_cents,
    v_balance,
    'adjustment',
    v_prog.id,
    'Marketing driver bonus reversal',
    jsonb_build_object(
      'source', 'marketing',
      'reverses_wallet_ledger_id', v_orig.id,
      'campaign_id', v_obj.campaign_id,
      'goal_id', v_obj.id,
      'progress_id', v_prog.id,
      'idempotency_key', v_key,
      'reason', p_reason
    )
  )
  returning id into v_ledger_id;

  update public.marketing_driver_progress
  set status = 'reversed',
      reverse_wallet_ledger_id = v_ledger_id,
      reverse_reason = p_reason,
      reversed_at = now(),
      updated_at = now()
  where id = v_prog.id;

  perform public.mmd_marketing_audit_append(
    'driver_reward_reversed',
    'marketing_driver_progress',
    v_prog.id,
    v_obj.campaign_id,
    p_reason,
    v_prog.id::text,
    v_key,
    'mmd_marketing_reverse_driver_progress',
    jsonb_build_object(
      'original_wallet_ledger_id', v_orig.id,
      'reverse_wallet_ledger_id', v_ledger_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'reversed', true,
    'wallet_ledger_id', v_ledger_id
  );
end;
$$;

create or replace function public.mmd_marketing_process_driver_objectives_batch(
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
  r record;
  v_res jsonb;
  v_scanned integer := 0;
  v_qualified integer := 0;
  v_paid integer := 0;
  v_failed integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'service_role_required');
  end if;

  -- Mark completed when threshold reached
  update public.marketing_driver_progress p
  set status = 'qualified',
      updated_at = now()
  from public.marketing_driver_objectives o
  where p.objective_id = o.id
    and p.status = 'in_progress'
    and p.progress_count >= o.target_count
    and o.status in ('active', 'ended');

  get diagnostics v_qualified = row_count;

  for r in
    select p.id
    from public.marketing_driver_progress p
    join public.marketing_driver_objectives o on o.id = p.objective_id
    where p.status in ('completed', 'qualified')
      and (o.reward_cents > 0 or o.reward_points > 0)
    order by p.updated_at
    limit v_limit
    for update of p skip locked
  loop
    v_scanned := v_scanned + 1;
    v_res := public.mmd_marketing_pay_driver_progress(r.id, null, 'US');
    if coalesce((v_res ->> 'ok')::boolean, false) then
      v_paid := v_paid + 1;
    else
      v_failed := v_failed + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'scanned', v_scanned,
    'qualified', v_qualified,
    'paid', v_paid,
    'failed', v_failed,
    'next_cursor', case when v_scanned >= v_limit then true else false end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) Bridge / migrate taxi_promotions → marketing_campaigns
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketing_bridge_taxi_promotions(
  p_dry_run boolean default true,
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 200), 1000));
  r record;
  v_migrated integer := 0;
  v_bridged integer := 0;
  v_skipped integer := 0;
  v_incompatible integer := 0;
  v_manual integer := 0;
  v_campaign_id uuid;
  v_code text;
  v_type text;
  v_report jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'service_role_required');
  end if;

  for r in
    select *
    from public.taxi_promotions
    where bridge_status in ('legacy_active', 'manual_review_required')
      and (
        active = true
        or (starts_at > now())
        or (ends_at is not null and ends_at > now())
      )
    order by created_at
    limit v_limit
    for update skip locked
  loop
    v_code := upper(trim(r.code));
    if v_code is null or v_code = '' then
      v_incompatible := v_incompatible + 1;
      if not p_dry_run then
        update public.taxi_promotions
        set bridge_status = 'incompatible',
            bridge_report = jsonb_build_object('reason', 'missing_code')
        where id = r.id;
      end if;
      continue;
    end if;

    if r.promotion_type not in ('percent', 'fixed', 'first_ride') then
      v_manual := v_manual + 1;
      if not p_dry_run then
        update public.taxi_promotions
        set bridge_status = 'manual_review_required',
            bridge_report = jsonb_build_object('reason', 'unsupported_type', 'type', r.promotion_type)
        where id = r.id;
      end if;
      continue;
    end if;

    -- Already have marketing code with same value → bridge only
    if exists (
      select 1 from public.marketing_promo_codes mpc
      where mpc.code_normalized = v_code
    ) then
      v_bridged := v_bridged + 1;
      if not p_dry_run then
        update public.taxi_promotions
        set bridge_status = 'bridged',
            bridged_at = now(),
            active = false,
            bridge_report = jsonb_build_object('reason', 'existing_marketing_code')
        where id = r.id;
      end if;
      continue;
    end if;

    if p_dry_run then
      v_migrated := v_migrated + 1;
      continue;
    end if;

    v_type := case
      when r.promotion_type = 'percent' then 'percentage_discount'
      when r.promotion_type = 'fixed' then 'fixed_discount'
      else 'percentage_discount'
    end;

    insert into public.marketing_campaigns (
      code, name, campaign_type, status, services,
      discount_percent, discount_cents,
      auto_apply, requires_code, starts_at, ends_at,
      metadata
    ) values (
      'TAXI_LEGACY_' || replace(r.id::text, '-', ''),
      coalesce(nullif(trim(r.title), ''), 'Taxi legacy ' || v_code),
      v_type,
      case when r.active and (r.ends_at is null or r.ends_at > now()) then 'active' else 'scheduled' end,
      array['taxi']::text[],
      r.discount_percent,
      r.discount_cents,
      false,
      true,
      r.starts_at,
      r.ends_at,
      jsonb_build_object(
        'source', 'taxi_legacy',
        'taxi_promotion_id', r.id,
        'legacy_type', r.promotion_type,
        'max_redemptions', r.max_redemptions,
        'max_redemptions_per_user', r.max_redemptions_per_user
      )
    )
    returning id into v_campaign_id;

    insert into public.marketing_promo_codes (
      campaign_id, code_normalized, code_display, kind, status,
      max_redemptions, per_user_limit, starts_at, ends_at, metadata
    ) values (
      v_campaign_id,
      v_code,
      v_code,
      'public',
      'active',
      r.max_redemptions,
      r.max_redemptions_per_user,
      r.starts_at,
      r.ends_at,
      jsonb_build_object('source', 'taxi_legacy', 'taxi_promotion_id', r.id)
    );

    update public.taxi_promotions
    set marketing_campaign_id = v_campaign_id,
        bridge_status = 'migrated',
        bridged_at = now(),
        active = false,
        bridge_report = jsonb_build_object(
          'marketing_campaign_id', v_campaign_id,
          'code', v_code
        )
    where id = r.id;

    perform public.mmd_marketing_audit_append(
      'taxi_legacy_migrated',
      'taxi_promotions',
      r.id,
      v_campaign_id,
      'phase_7_1_bridge',
      r.id::text,
      'marketing:taxi_legacy:' || r.id::text || ':migrate',
      'mmd_marketing_bridge_taxi_promotions',
      jsonb_build_object('code', v_code)
    );

    v_migrated := v_migrated + 1;
  end loop;

  v_report := jsonb_build_object(
    'ok', true,
    'dry_run', p_dry_run,
    'migrated', v_migrated,
    'bridged', v_bridged,
    'skipped', v_skipped,
    'incompatible', v_incompatible,
    'manual_review_required', v_manual
  );

  return v_report;
end;
$$;

-- Guard: refuse legacy apply when marketing already owns the code.
-- Preserves sprint2 apply body (validate + recalculate).
create or replace function public.apply_taxi_promotion_to_ride(
  p_ride_id uuid,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.taxi_rides%rowtype;
  v_validation jsonb;
  v_discount integer;
  v_code text := upper(trim(coalesce(p_code, '')));
begin
  if v_code = '' then
    return jsonb_build_object('ok', false, 'message', 'missing_code');
  end if;

  -- Phase 7.1: marketing engine is source of truth for overlapping codes
  if exists (
    select 1
    from public.marketing_promo_codes mpc
    join public.marketing_campaigns mc on mc.id = mpc.campaign_id
    where mpc.code_normalized = v_code
      and mpc.status = 'active'
      and mc.status in ('active', 'scheduled')
      and 'taxi' = any (mc.services)
  ) then
    return jsonb_build_object(
      'ok', false,
      'message', 'promo_handled_by_marketing_engine',
      'error', 'promo_handled_by_marketing_engine',
      'source', 'taxi_legacy_blocked'
    );
  end if;

  -- Retired / migrated legacy rows must not apply
  if exists (
    select 1
    from public.taxi_promotions tp
    where upper(tp.code) = v_code
      and tp.bridge_status in ('migrated', 'bridged', 'retired')
  ) and not exists (
    select 1
    from public.taxi_promotions tp2
    where upper(tp2.code) = v_code
      and tp2.active = true
      and tp2.bridge_status in ('legacy_active', 'manual_review_required')
  ) then
    return jsonb_build_object(
      'ok', false,
      'message', 'legacy_promotion_retired',
      'error', 'legacy_promotion_retired',
      'source', 'taxi_legacy'
    );
  end if;

  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if lower(coalesce(v_ride.payment_status, '')) <> 'unpaid' then
    return jsonb_build_object('ok', false, 'message', 'ride_not_editable');
  end if;

  if lower(coalesce(v_ride.status, '')) not in ('quoted', 'draft', 'pending_payment', 'scheduled') then
    return jsonb_build_object('ok', false, 'message', 'ride_not_editable');
  end if;

  v_validation := public.validate_taxi_promotion(
    p_code,
    v_ride.client_user_id,
    coalesce(v_ride.gross_total_cents, v_ride.total_cents),
    p_ride_id,
    v_ride.vehicle_class,
    v_ride.country_code,
    v_ride.currency
  );

  if coalesce((v_validation->>'ok')::boolean, false) is not true then
    return v_validation;
  end if;

  v_discount := greatest(0, coalesce((v_validation->>'discount_cents')::integer, 0));

  update public.taxi_rides
  set
    gross_total_cents = coalesce(gross_total_cents, total_cents + discount_cents + loyalty_discount_cents),
    discount_cents = v_discount,
    promotion_id = (v_validation->>'promotion_id')::uuid,
    promo_code = v_validation->>'code',
    updated_at = now()
  where id = p_ride_id;

  perform public.recalculate_taxi_ride_totals(p_ride_id);

  perform public.log_taxi_event(
    p_ride_id,
    'promotion_applied',
    v_ride.status,
    v_ride.status,
    v_ride.client_user_id,
    'client',
    'Taxi promotion applied to ride',
    v_validation
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', p_ride_id,
    'promotion_id', v_validation->>'promotion_id',
    'code', v_validation->>'code',
    'discount_cents', v_discount,
    'source', 'taxi_legacy'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.mmd_marketing_credit_cashback(uuid, text) from public, anon, authenticated;
revoke all on function public.mmd_marketing_credit_cashback_batch(integer) from public, anon, authenticated;
revoke all on function public.mmd_marketing_clawback_cashback(uuid, text, text) from public, anon, authenticated;
revoke all on function public.mmd_marketing_pay_driver_progress(uuid, text, text) from public, anon, authenticated;
revoke all on function public.mmd_marketing_reverse_driver_progress(uuid, text, text) from public, anon, authenticated;
revoke all on function public.mmd_marketing_process_driver_objectives_batch(integer) from public, anon, authenticated;
revoke all on function public.mmd_marketing_bridge_taxi_promotions(boolean, integer) from public, anon, authenticated;

grant execute on function public.mmd_marketing_credit_cashback(uuid, text) to service_role;
grant execute on function public.mmd_marketing_credit_cashback_batch(integer) to service_role;
grant execute on function public.mmd_marketing_clawback_cashback(uuid, text, text) to service_role;
grant execute on function public.mmd_marketing_pay_driver_progress(uuid, text, text) to service_role;
grant execute on function public.mmd_marketing_reverse_driver_progress(uuid, text, text) to service_role;
grant execute on function public.mmd_marketing_process_driver_objectives_batch(integer) to service_role;
grant execute on function public.mmd_marketing_bridge_taxi_promotions(boolean, integer) to service_role;

-- Re-assert reverse + taxi apply grants
revoke all on function public.mmd_marketing_reverse(text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.mmd_marketing_reverse(text, text, boolean, text, text) to service_role;
revoke all on function public.apply_taxi_promotion_to_ride(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_taxi_promotion_to_ride(uuid, text) to service_role;
