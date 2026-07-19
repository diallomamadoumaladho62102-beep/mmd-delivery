-- Phase 10 — Stabilization (idempotent corrective migration)
-- Preview / local only — do not apply to Production without explicit approval.

begin;

-- ---------------------------------------------------------------------------
-- 1) Marketplace refund metadata
-- ---------------------------------------------------------------------------
alter table public.seller_orders
  add column if not exists stripe_refund_id text,
  add column if not exists stripe_refunded_at timestamptz;

create index if not exists seller_orders_stripe_refund_id_idx
  on public.seller_orders (stripe_refund_id)
  where stripe_refund_id is not null;

create index if not exists seller_orders_stripe_pi_idx
  on public.seller_orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- ---------------------------------------------------------------------------
-- 2) Driver bonus eligibility helper
-- ---------------------------------------------------------------------------
create or replace function public.mmd_marketing_driver_is_eligible(
  p_driver_user_id uuid,
  p_require_payout boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile_status text;
  v_dp record;
begin
  if p_driver_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'driver_missing');
  end if;

  if not exists (select 1 from public.profiles p where p.id = p_driver_user_id) then
    return jsonb_build_object('ok', false, 'error', 'driver_profile_missing');
  end if;

  begin
    select coalesce(lower(status), '') into v_profile_status
    from public.profiles
    where id = p_driver_user_id;
  exception
    when undefined_column then
      v_profile_status := '';
  end;

  if v_profile_status in ('suspended', 'banned', 'disabled', 'blocked', 'fraud') then
    return jsonb_build_object('ok', false, 'error', 'driver_account_blocked', 'status', v_profile_status);
  end if;

  select *
  into v_dp
  from public.driver_profiles
  where user_id = p_driver_user_id
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'driver_profiles_missing');
  end if;

  if coalesce(lower(v_dp.status), '') in ('suspended', 'banned', 'disabled', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'driver_status_blocked', 'status', v_dp.status);
  end if;

  if coalesce(v_dp.is_locked, false) is true then
    return jsonb_build_object('ok', false, 'error', 'driver_locked');
  end if;

  if coalesce(lower(v_dp.onboarding_status), '') not in ('completed', 'approved', 'active', 'done')
     and coalesce(lower(v_dp.status), '') not in ('approved', 'active') then
    return jsonb_build_object(
      'ok', false,
      'error', 'driver_onboarding_incomplete',
      'onboarding_status', v_dp.onboarding_status,
      'status', v_dp.status
    );
  end if;

  if p_require_payout
     and coalesce(v_dp.payout_enabled, false) is not true
     and coalesce(v_dp.stripe_onboarded, false) is not true
     and coalesce(nullif(trim(v_dp.stripe_account_id), ''), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'driver_payout_method_missing');
  end if;

  return jsonb_build_object('ok', true, 'driver_user_id', p_driver_user_id);
end;
$$;

revoke all on function public.mmd_marketing_driver_is_eligible(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.mmd_marketing_driver_is_eligible(uuid, boolean)
  to service_role;

-- Patch eligibility inside pay_driver_progress (body aligned with 20260903120000)
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
  v_elig jsonb;
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

  v_elig := public.mmd_marketing_driver_is_eligible(
    v_prog.driver_user_id,
    coalesce(v_obj.reward_cents, 0) > 0
  );
  if coalesce((v_elig ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object(
      'ok', false,
      'error', coalesce(v_elig ->> 'error', 'driver_not_eligible'),
      'eligibility', v_elig
    );
  end if;

  if v_camp.partner_user_id is not null
     and v_camp.partner_user_id = v_prog.driver_user_id then
    return jsonb_build_object('ok', false, 'error', 'self_referral_blocked');
  end if;

  v_key := coalesce(
    nullif(trim(p_idempotency_key), ''),
    nullif(trim(v_prog.reward_idempotency_key), ''),
    'marketing:driver:' || v_prog.id::text || ':reward'
  );

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

revoke all on function public.mmd_marketing_pay_driver_progress(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.mmd_marketing_pay_driver_progress(uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3) Analytics tops + time series (daily aggregates, not live heavy scans)
-- ---------------------------------------------------------------------------
create table if not exists public.analytics_daily_tops (
  id uuid primary key default gen_random_uuid(),
  metric_day date not null,
  module text not null,
  top_key text not null,
  items jsonb not null default '[]'::jsonb,
  country_code text not null default '',
  created_at timestamptz not null default now(),
  constraint analytics_daily_tops_uq unique (metric_day, module, top_key, country_code)
);

create table if not exists public.analytics_time_series (
  id uuid primary key default gen_random_uuid(),
  bucket_start timestamptz not null,
  granularity text not null check (granularity in ('hour', 'day', 'week', 'month')),
  module text not null,
  metric_key text not null,
  value_numeric numeric not null default 0,
  country_code text not null default '',
  created_at timestamptz not null default now(),
  constraint analytics_time_series_uq unique (bucket_start, granularity, module, metric_key, country_code)
);

create index if not exists analytics_daily_tops_day_module_idx
  on public.analytics_daily_tops (metric_day desc, module);
create index if not exists analytics_time_series_bucket_idx
  on public.analytics_time_series (bucket_start desc, granularity, module);

alter table public.analytics_daily_tops enable row level security;
alter table public.analytics_time_series enable row level security;

drop policy if exists analytics_daily_tops_deny_all on public.analytics_daily_tops;
create policy analytics_daily_tops_deny_all on public.analytics_daily_tops
  for all to authenticated, anon using (false) with check (false);

drop policy if exists analytics_time_series_deny_all on public.analytics_time_series;
create policy analytics_time_series_deny_all on public.analytics_time_series
  for all to authenticated, anon using (false) with check (false);

revoke all on table public.analytics_daily_tops from public, anon, authenticated;
revoke all on table public.analytics_time_series from public, anon, authenticated;
grant select, insert, update, delete on table public.analytics_daily_tops to service_role;
grant select, insert, update, delete on table public.analytics_time_series to service_role;

-- ---------------------------------------------------------------------------
-- 4) Finance revenue recognition (uses finance_revenue_schedules columns)
-- ---------------------------------------------------------------------------
alter table public.finance_revenue_schedules
  add column if not exists last_recognized_on date,
  add column if not exists vertical text;

create or replace function public.mmd_finance_recognize_revenue_batch(
  p_as_of date default (timezone('utc', now()))::date,
  p_limit integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_processed int := 0;
  v_posted int := 0;
  v_errors int := 0;
  v_amount bigint;
  v_days int;
  v_target bigint;
  v_recognized bigint;
  v_to_recognize bigint;
  v_entity uuid;
  v_period uuid;
  v_deferred uuid;
  v_revenue uuid;
  v_entry uuid;
  v_key text;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'service_role_required');
  end if;

  select id into v_entity from public.finance_legal_entities where code = 'MMD_US' limit 1;
  if v_entity is null then
    return jsonb_build_object('ok', false, 'error', 'legal_entity_missing');
  end if;

  select id into v_deferred
  from public.finance_accounts
  where legal_entity_id = v_entity and code = '2200'
  limit 1;
  select id into v_revenue
  from public.finance_accounts
  where legal_entity_id = v_entity and code = '4200'
  limit 1;

  if v_deferred is null or v_revenue is null then
    return jsonb_build_object('ok', false, 'error', 'accounts_missing');
  end if;

  for r in
    select *
    from public.finance_revenue_schedules
    where status = 'active'
      and starts_on <= p_as_of
      and ends_on >= p_as_of
    order by starts_on asc
    limit greatest(1, least(coalesce(p_limit, 200), 500))
    for update skip locked
  loop
    v_processed := v_processed + 1;
    begin
      v_amount := greatest(0, coalesce(r.total_billed_cents, 0));
      v_recognized := greatest(0, coalesce(r.recognized_cents, 0));
      if v_recognized >= v_amount then
        update public.finance_revenue_schedules
        set status = 'completed'
        where id = r.id;
        continue;
      end if;

      v_days := greatest(1, (r.ends_on - r.starts_on) + 1);
      v_target := least(
        v_amount,
        (v_amount * greatest(1, (p_as_of - r.starts_on) + 1)) / v_days
      );
      v_to_recognize := greatest(0, v_target - v_recognized);
      if v_to_recognize <= 0 then
        continue;
      end if;

      v_key := 'finance:revrec:' || r.id::text || ':' || p_as_of::text;

      select id into v_period
      from public.finance_periods
      where legal_entity_id = v_entity
        and status = 'open'
        and starts_on <= p_as_of
        and ends_on >= p_as_of
      order by starts_on desc
      limit 1;

      insert into public.finance_journal_entries (
        legal_entity_id,
        period_id,
        accounting_date,
        transaction_date,
        event_type,
        source_type,
        source_id,
        vertical,
        currency,
        status,
        description,
        idempotency_key,
        metadata
      )
      values (
        v_entity,
        v_period,
        p_as_of,
        p_as_of,
        'revenue_recognition',
        'finance_revenue_schedule',
        r.id::text,
        coalesce(r.vertical, 'subscription'),
        coalesce(r.currency, 'USD'),
        'posted',
        'Revenue recognition ' || r.id::text,
        v_key,
        jsonb_build_object('schedule_id', r.id, 'amount_cents', v_to_recognize)
      )
      on conflict (idempotency_key) do nothing
      returning id into v_entry;

      if v_entry is null then
        continue;
      end if;

      insert into public.finance_journal_lines (
        journal_entry_id, account_id, debit_cents, credit_cents, currency, description
      ) values
        (v_entry, v_deferred, v_to_recognize, 0, coalesce(r.currency, 'USD'), 'Release deferred'),
        (v_entry, v_revenue, 0, v_to_recognize, coalesce(r.currency, 'USD'), 'Recognize revenue');

      update public.finance_revenue_schedules
      set recognized_cents = v_recognized + v_to_recognize,
          deferred_cents = greatest(0, v_amount - (v_recognized + v_to_recognize)),
          last_recognized_on = p_as_of,
          status = case
            when v_recognized + v_to_recognize >= v_amount then 'completed'
            else 'active'
          end
      where id = r.id;

      v_posted := v_posted + 1;
    exception when others then
      v_errors := v_errors + 1;
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'processed', v_processed,
    'posted', v_posted,
    'errors', v_errors,
    'as_of', p_as_of
  );
end;
$$;

revoke all on function public.mmd_finance_recognize_revenue_batch(date, integer)
  from public, anon, authenticated;
grant execute on function public.mmd_finance_recognize_revenue_batch(date, integer)
  to service_role;

create or replace function public.mmd_finance_ensure_subscription_schedule(
  p_source_type text,
  p_source_id text,
  p_total_cents bigint,
  p_currency text,
  p_interval text,
  p_vertical text default 'subscription',
  p_starts_on date default (timezone('utc', now()))::date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity uuid;
  v_id uuid;
  v_ends date;
  v_total bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role_required';
  end if;

  select id into v_entity from public.finance_legal_entities where code = 'MMD_US' limit 1;
  if v_entity is null then
    return null;
  end if;

  v_total := greatest(0, coalesce(p_total_cents, 0));
  if lower(coalesce(p_interval, 'month')) in ('year', 'annual', 'yearly') then
    v_ends := p_starts_on + 364;
  else
    v_ends := p_starts_on + 29;
  end if;

  insert into public.finance_revenue_schedules (
    legal_entity_id,
    source_type,
    source_id,
    currency,
    total_billed_cents,
    recognized_cents,
    deferred_cents,
    recognition_method,
    starts_on,
    ends_on,
    status,
    vertical,
    metadata
  )
  values (
    v_entity,
    p_source_type,
    p_source_id,
    coalesce(p_currency, 'USD'),
    v_total,
    0,
    v_total,
    'straight_line',
    p_starts_on,
    v_ends,
    'active',
    p_vertical,
    jsonb_build_object('interval', p_interval)
  )
  on conflict (source_type, source_id) do update
    set total_billed_cents = excluded.total_billed_cents,
        deferred_cents = greatest(0, excluded.total_billed_cents - public.finance_revenue_schedules.recognized_cents),
        ends_on = excluded.ends_on,
        vertical = excluded.vertical
  returning id into v_id;

  return v_id;
exception
  when others then
    return null;
end;
$$;

revoke all on function public.mmd_finance_ensure_subscription_schedule(text, text, bigint, text, text, text, date)
  from public, anon, authenticated;
grant execute on function public.mmd_finance_ensure_subscription_schedule(text, text, bigint, text, text, text, date)
  to service_role;

create or replace view public.v_finance_ledger_integrity as
select
  e.id as journal_entry_id,
  e.idempotency_key,
  e.status,
  e.event_type,
  e.currency,
  coalesce(sum(l.debit_cents), 0) as debit_total,
  coalesce(sum(l.credit_cents), 0) as credit_total,
  coalesce(sum(l.debit_cents), 0) - coalesce(sum(l.credit_cents), 0) as imbalance_cents,
  count(l.id) as line_count
from public.finance_journal_entries e
left join public.finance_journal_lines l on l.journal_entry_id = e.id
where e.status = 'posted'
group by e.id, e.idempotency_key, e.status, e.event_type, e.currency
having coalesce(sum(l.debit_cents), 0) <> coalesce(sum(l.credit_cents), 0)
    or count(l.id) = 0;

revoke all on public.v_finance_ledger_integrity from public, anon, authenticated;
grant select on public.v_finance_ledger_integrity to service_role;

-- ---------------------------------------------------------------------------
-- 5) Indexes
-- ---------------------------------------------------------------------------
create index if not exists finance_source_events_status_created_idx
  on public.finance_source_events (status, created_at desc);

create index if not exists finance_journal_entries_accounting_date_idx
  on public.finance_journal_entries (accounting_date desc, status);

create index if not exists marketing_applications_entity_idx
  on public.marketing_applications (entity_type, entity_id);

commit;
