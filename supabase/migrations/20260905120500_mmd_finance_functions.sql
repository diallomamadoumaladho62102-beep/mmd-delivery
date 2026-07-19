-- Phase 9 — Finance center RPCs (service_role only)

create or replace function public.mmd_finance_default_entity()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.finance_legal_entities where code = 'MMD_US' and status = 'active' limit 1;
$$;

create or replace function public.mmd_finance_account_id(p_code text, p_entity uuid default null)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.id
  from public.finance_accounts a
  where a.code = p_code
    and a.legal_entity_id = coalesce(p_entity, public.mmd_finance_default_entity())
    and a.status = 'active'
  limit 1;
$$;

create or replace function public.mmd_finance_open_period(
  p_entity uuid,
  p_on date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_code text := to_char(p_on, 'YYYY-MM');
  v_start date := date_trunc('month', p_on::timestamp)::date;
  v_end date := (date_trunc('month', p_on::timestamp) + interval '1 month - 1 day')::date;
begin
  select id into v_id
  from public.finance_periods
  where legal_entity_id = p_entity
    and starts_on <= p_on and ends_on >= p_on
    and status in ('open', 'soft_closed')
  order by starts_on desc
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.finance_periods (legal_entity_id, code, period_type, starts_on, ends_on, status)
  values (p_entity, v_code, 'month', v_start, v_end, 'open')
  on conflict (legal_entity_id, code) do update set status = public.finance_periods.status
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.mmd_finance_audit_append(
  p_action text,
  p_entity_type text default null,
  p_entity_id text default null,
  p_reason text default null,
  p_correlation_id text default null,
  p_idempotency_key text default null,
  p_admin_user_id uuid default null,
  p_old jsonb default null,
  p_new jsonb default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.finance_audit (
    admin_user_id, action, entity_type, entity_id, reason,
    correlation_id, idempotency_key, old_value, new_value, metadata
  ) values (
    p_admin_user_id, p_action, p_entity_type, p_entity_id, p_reason,
    p_correlation_id, p_idempotency_key, p_old, p_new, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Enqueue source event (idempotent)
create or replace function public.mmd_finance_enqueue_event(
  p_source_type text,
  p_source_id text,
  p_event_type text,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now(),
  p_vertical text default null,
  p_country_code text default null,
  p_currency text default 'USD',
  p_correlation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.finance_source_events%rowtype;
  v_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'service_role_required');
  end if;

  if coalesce(nullif(trim(p_idempotency_key), ''), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_idempotency_key');
  end if;

  select * into v_existing
  from public.finance_source_events
  where idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'ok', true,
      'already_exists', true,
      'event_id', v_existing.id,
      'status', v_existing.status
    );
  end if;

  insert into public.finance_source_events (
    source_type, source_id, event_type, occurred_at, status,
    idempotency_key, payload_snapshot, correlation_id,
    vertical, country_code, currency
  ) values (
    p_source_type, p_source_id, p_event_type, coalesce(p_occurred_at, now()), 'pending',
    p_idempotency_key, coalesce(p_payload, '{}'::jsonb), p_correlation_id,
    p_vertical, p_country_code, coalesce(p_currency, 'USD')
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'event_id', v_id, 'status', 'pending');
exception when unique_violation then
  select id, status into v_id, v_existing.status
  from public.finance_source_events where idempotency_key = p_idempotency_key;
  return jsonb_build_object('ok', true, 'already_exists', true, 'event_id', v_id, 'status', v_existing.status);
end;
$$;

-- Post balanced journal entry
create or replace function public.mmd_finance_post_entry(
  p_event_type text,
  p_idempotency_key text,
  p_lines jsonb,
  p_description text default null,
  p_source_type text default null,
  p_source_id text default null,
  p_source_event_id uuid default null,
  p_vertical text default null,
  p_country_code text default null,
  p_currency text default 'USD',
  p_accounting_date date default (timezone('utc', now()))::date,
  p_correlation_id text default null,
  p_created_by uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity uuid := public.mmd_finance_default_entity();
  v_period uuid;
  v_entry uuid;
  v_existing uuid;
  v_line jsonb;
  v_i integer := 0;
  v_debit bigint := 0;
  v_credit bigint := 0;
  v_account uuid;
  v_d bigint;
  v_c bigint;
  v_period_status text;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'service_role_required');
  end if;
  if v_entity is null then
    return jsonb_build_object('ok', false, 'error', 'legal_entity_missing');
  end if;
  if p_idempotency_key is null or trim(p_idempotency_key) = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_idempotency_key');
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    return jsonb_build_object('ok', false, 'error', 'invalid_lines');
  end if;

  select id into v_existing from public.finance_journal_entries where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'already_posted', true, 'journal_entry_id', v_existing);
  end if;

  v_period := public.mmd_finance_open_period(v_entity, p_accounting_date);
  select status into v_period_status from public.finance_periods where id = v_period;
  if v_period_status in ('closed', 'locked') then
    return jsonb_build_object('ok', false, 'error', 'period_closed');
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_d := greatest(0, coalesce((v_line ->> 'debit_cents')::bigint, 0));
    v_c := greatest(0, coalesce((v_line ->> 'credit_cents')::bigint, 0));
    v_debit := v_debit + v_d;
    v_credit := v_credit + v_c;
  end loop;

  if v_debit <= 0 or v_debit <> v_credit then
    return jsonb_build_object('ok', false, 'error', 'unbalanced_entry', 'debit', v_debit, 'credit', v_credit);
  end if;

  insert into public.finance_journal_entries (
    legal_entity_id, period_id, accounting_date, transaction_date,
    event_type, source_type, source_id, source_event_id, vertical,
    country_code, currency, status, description, correlation_id,
    idempotency_key, metadata, created_by, posted_at
  ) values (
    v_entity, v_period, p_accounting_date, now(),
    p_event_type, p_source_type, p_source_id, p_source_event_id, p_vertical,
    p_country_code, coalesce(p_currency, 'USD'), 'posted', p_description, p_correlation_id,
    p_idempotency_key, coalesce(p_metadata, '{}'::jsonb), p_created_by, now()
  )
  returning id into v_entry;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_i := v_i + 1;
    if v_line ? 'account_code' then
      v_account := public.mmd_finance_account_id(v_line ->> 'account_code', v_entity);
    else
      v_account := nullif(v_line ->> 'account_id', '')::uuid;
    end if;
    if v_account is null then
      raise exception 'account_not_found:%', coalesce(v_line ->> 'account_code', v_line ->> 'account_id');
    end if;
    v_d := greatest(0, coalesce((v_line ->> 'debit_cents')::bigint, 0));
    v_c := greatest(0, coalesce((v_line ->> 'credit_cents')::bigint, 0));

    insert into public.finance_journal_lines (
      journal_entry_id, line_no, account_id, debit_cents, credit_cents, currency,
      partner_type, partner_user_id, user_id, entity_type, entity_id, cost_center, memo, dimensions
    ) values (
      v_entry, v_i, v_account, v_d, v_c, coalesce(p_currency, 'USD'),
      nullif(v_line ->> 'partner_type', ''),
      nullif(v_line ->> 'partner_user_id', '')::uuid,
      nullif(v_line ->> 'user_id', '')::uuid,
      nullif(v_line ->> 'entity_type', ''),
      nullif(v_line ->> 'entity_id', ''),
      nullif(v_line ->> 'cost_center', ''),
      nullif(v_line ->> 'memo', ''),
      coalesce(v_line -> 'dimensions', '{}'::jsonb)
    );
  end loop;

  if p_source_event_id is not null then
    update public.finance_source_events
    set status = 'posted',
        processed_at = now(),
        journal_entry_id = v_entry,
        updated_at = now(),
        last_error = null
    where id = p_source_event_id;
  end if;

  perform public.mmd_finance_audit_append(
    'journal_posted', 'finance_journal_entries', v_entry::text, null,
    p_correlation_id, p_idempotency_key, p_created_by, null,
    jsonb_build_object('event_type', p_event_type, 'debit', v_debit, 'credit', v_credit),
    '{}'::jsonb
  );

  return jsonb_build_object(
    'ok', true,
    'journal_entry_id', v_entry,
    'debit_cents', v_debit,
    'credit_cents', v_credit
  );
exception when unique_violation then
  select id into v_existing from public.finance_journal_entries where idempotency_key = p_idempotency_key;
  return jsonb_build_object('ok', true, 'already_posted', true, 'journal_entry_id', v_existing);
end;
$$;

-- Process one payment-like source event into double-entry
create or replace function public.mmd_finance_process_source_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ev public.finance_source_events%rowtype;
  v_payload jsonb;
  v_gross bigint;
  v_fee bigint;
  v_commission bigint;
  v_partner bigint;
  v_tax bigint;
  v_service bigint;
  v_lines jsonb := '[]'::jsonb;
  v_post jsonb;
  v_rev_acct text;
  v_pay_acct text;
  v_credits bigint;
  v_debits bigint;
  v_gap bigint;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'service_role_required');
  end if;

  select * into v_ev from public.finance_source_events where id = p_event_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'event_not_found');
  end if;
  if v_ev.status = 'posted' then
    return jsonb_build_object('ok', true, 'already_posted', true, 'journal_entry_id', v_ev.journal_entry_id);
  end if;
  if v_ev.status = 'skipped' then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;

  update public.finance_source_events
  set status = 'processing', attempts = attempts + 1, updated_at = now()
  where id = v_ev.id;

  v_payload := coalesce(v_ev.payload_snapshot, '{}'::jsonb);
  v_gross := greatest(0, coalesce((v_payload ->> 'gross_cents')::bigint, (v_payload ->> 'amount_cents')::bigint, 0));
  v_fee := greatest(0, coalesce((v_payload ->> 'provider_fee_cents')::bigint, 0));
  v_commission := greatest(0, coalesce((v_payload ->> 'commission_cents')::bigint, 0));
  v_partner := greatest(0, coalesce((v_payload ->> 'partner_cents')::bigint, 0));
  v_tax := greatest(0, coalesce((v_payload ->> 'tax_cents')::bigint, 0));
  v_service := greatest(0, coalesce((v_payload ->> 'service_fee_cents')::bigint, 0));

  if v_ev.event_type in ('payment_succeeded', 'food_paid', 'delivery_paid', 'taxi_paid', 'marketplace_paid') then
    if v_gross <= 0 then
      update public.finance_source_events
      set status = 'skipped', last_error = 'zero_amount', processed_at = now(), updated_at = now()
      where id = v_ev.id;
      return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'zero_amount');
    end if;

    v_rev_acct := case coalesce(v_ev.vertical, '')
      when 'food' then '4010'
      when 'delivery' then '4020'
      when 'taxi' then '4030'
      when 'marketplace' then '4040'
      else '4900'
    end;
    v_pay_acct := case coalesce(v_ev.vertical, '')
      when 'food' then '2020'
      when 'marketplace' then '2030'
      else '2010'
    end;

    -- DR cash/transit = gross - fee; DR fee expense
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', '1020', 'debit_cents', greatest(v_gross - v_fee, 0), 'credit_cents', 0,
      'entity_type', v_ev.source_type, 'entity_id', v_ev.source_id, 'cost_center', v_ev.vertical
    ));

    if v_fee > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_code', '5010', 'debit_cents', v_fee, 'credit_cents', 0, 'cost_center', v_ev.vertical
      ));
    end if;

    if v_commission > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_code', v_rev_acct, 'debit_cents', 0, 'credit_cents', v_commission, 'cost_center', v_ev.vertical
      ));
    end if;
    if v_service > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_code', '4100', 'debit_cents', 0, 'credit_cents', v_service, 'cost_center', v_ev.vertical
      ));
    end if;
    if v_tax > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_code', '2300', 'debit_cents', 0, 'credit_cents', v_tax, 'cost_center', v_ev.vertical
      ));
    end if;
    if v_partner > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_code', v_pay_acct, 'debit_cents', 0, 'credit_cents', v_partner,
        'partner_user_id', v_payload ->> 'partner_user_id',
        'entity_type', v_ev.source_type, 'entity_id', v_ev.source_id, 'cost_center', v_ev.vertical
      ));
    end if;

    -- Balance remainder to commission revenue or suspense
    v_credits := v_commission + v_service + v_tax + v_partner;
    v_debits := greatest(v_gross - v_fee, 0) + v_fee;
    v_gap := v_debits - v_credits;
    if v_gap > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_code', v_rev_acct, 'debit_cents', 0, 'credit_cents', v_gap, 'cost_center', v_ev.vertical, 'memo', 'balancing'
      ));
    elsif v_gap < 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_code', '2600', 'debit_cents', abs(v_gap), 'credit_cents', 0, 'memo', 'suspense_balance'
      ));
    end if;

  elsif v_ev.event_type in ('refund_succeeded', 'charge_refunded') then
    v_gross := greatest(v_gross, 1);
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '5400', 'debit_cents', v_gross, 'credit_cents', 0, 'cost_center', v_ev.vertical),
      jsonb_build_object('account_code', '1020', 'debit_cents', 0, 'credit_cents', v_gross, 'cost_center', v_ev.vertical)
    );

  elsif v_ev.event_type in ('payout_paid') then
    v_partner := greatest(v_gross, coalesce((v_payload ->> 'net_cents')::bigint, 0), 1);
    v_pay_acct := case coalesce(v_payload ->> 'recipient_type', v_ev.vertical, '')
      when 'restaurant' then '2020'
      when 'seller' then '2030'
      else '2010'
    end;
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', v_pay_acct, 'debit_cents', v_partner, 'credit_cents', 0),
      jsonb_build_object('account_code', '1030', 'debit_cents', 0, 'credit_cents', v_partner)
    );

  elsif v_ev.event_type in ('mmd_credit_issued', 'cashback_credited') then
    v_gross := greatest(v_gross, 1);
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', case when v_ev.event_type = 'cashback_credited' then '5200' else '5100' end,
        'debit_cents', v_gross, 'credit_cents', 0),
      jsonb_build_object('account_code', case when v_ev.event_type = 'cashback_credited' then '2110' else '2100' end,
        'debit_cents', 0, 'credit_cents', v_gross)
    );

  elsif v_ev.event_type in ('mmd_credit_spent') then
    v_gross := greatest(v_gross, 1);
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '2100', 'debit_cents', v_gross, 'credit_cents', 0),
      jsonb_build_object('account_code', '1020', 'debit_cents', 0, 'credit_cents', v_gross)
    );

  elsif v_ev.event_type in ('driver_bonus_paid') then
    v_gross := greatest(v_gross, 1);
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '5300', 'debit_cents', v_gross, 'credit_cents', 0),
      jsonb_build_object('account_code', '2010', 'debit_cents', 0, 'credit_cents', v_gross)
    );

  elsif v_ev.event_type in ('subscription_paid') then
    v_gross := greatest(v_gross, 1);
    -- annual: defer; monthly: recognize
    if coalesce((v_payload ->> 'billing_interval')::text, 'month') = 'year' then
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code', '1020', 'debit_cents', v_gross, 'credit_cents', 0),
        jsonb_build_object('account_code', '2200', 'debit_cents', 0, 'credit_cents', v_gross)
      );
    else
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code', '1020', 'debit_cents', v_gross, 'credit_cents', 0),
        jsonb_build_object('account_code', case when coalesce(v_payload ->> 'kind', '') = 'partner' then '4210' else '4200' end,
          'debit_cents', 0, 'credit_cents', v_gross)
      );
    end if;

  else
    update public.finance_source_events
    set status = 'manual_review',
        last_error = 'unsupported_event_type',
        updated_at = now()
    where id = v_ev.id;
    return jsonb_build_object('ok', false, 'error', 'unsupported_event_type', 'manual_review', true);
  end if;

  begin
    v_post := public.mmd_finance_post_entry(
      v_ev.event_type,
      'finance:journal:' || v_ev.idempotency_key,
      v_lines,
      coalesce(v_payload ->> 'description', v_ev.event_type),
      v_ev.source_type,
      v_ev.source_id,
      v_ev.id,
      v_ev.vertical,
      v_ev.country_code,
      coalesce(v_ev.currency, 'USD'),
      (coalesce(v_ev.occurred_at, now()))::date,
      v_ev.correlation_id,
      null,
      v_payload
    );
  exception when others then
    update public.finance_source_events
    set status = 'failed', last_error = SQLERRM, updated_at = now()
    where id = v_ev.id;
    return jsonb_build_object('ok', false, 'error', SQLERRM, 'failed', true);
  end;

  if coalesce((v_post ->> 'ok')::boolean, false) is not true then
    update public.finance_source_events
    set status = 'failed', last_error = v_post ->> 'error', updated_at = now()
    where id = v_ev.id;
    return v_post;
  end if;

  return v_post;
end;
$$;

create or replace function public.mmd_finance_process_pending_batch(p_limit integer default 100)
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
  v_posted integer := 0;
  v_failed integer := 0;
  v_skipped integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'service_role_required');
  end if;

  for r in
    select id from public.finance_source_events
    where status in ('pending', 'failed')
      and attempts < 8
    order by created_at
    limit v_limit
    for update skip locked
  loop
    v_scanned := v_scanned + 1;
    v_res := public.mmd_finance_process_source_event(r.id);
    if coalesce((v_res ->> 'ok')::boolean, false) then
      if coalesce((v_res ->> 'skipped')::boolean, false) then
        v_skipped := v_skipped + 1;
      else
        v_posted := v_posted + 1;
      end if;
    else
      v_failed := v_failed + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'scanned', v_scanned,
    'posted', v_posted,
    'failed', v_failed,
    'skipped', v_skipped,
    'next_cursor', case when v_scanned >= v_limit then true else false end
  );
end;
$$;

create or replace function public.mmd_finance_reverse_entry(
  p_journal_entry_id uuid,
  p_reason text default null,
  p_idempotency_key text default null,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.finance_journal_entries%rowtype;
  v_key text;
  v_lines jsonb := '[]'::jsonb;
  r record;
  v_i integer := 0;
  v_post jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'service_role_required');
  end if;

  select * into v_src from public.finance_journal_entries where id = p_journal_entry_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'entry_not_found');
  end if;
  if v_src.status = 'reversed' then
    return jsonb_build_object('ok', true, 'already_reversed', true);
  end if;
  if v_src.status <> 'posted' then
    return jsonb_build_object('ok', false, 'error', 'entry_not_posted');
  end if;

  v_key := coalesce(nullif(trim(p_idempotency_key), ''), 'finance:reverse:' || v_src.id::text);

  for r in
    select * from public.finance_journal_lines
    where journal_entry_id = v_src.id
    order by line_no
  loop
    v_i := v_i + 1;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', r.account_id,
      'debit_cents', r.credit_cents,
      'credit_cents', r.debit_cents,
      'partner_type', r.partner_type,
      'partner_user_id', r.partner_user_id,
      'user_id', r.user_id,
      'entity_type', r.entity_type,
      'entity_id', r.entity_id,
      'cost_center', r.cost_center,
      'memo', coalesce(p_reason, 'reversal')
    ));
  end loop;

  -- post_entry expects account_code OR account_id — extend to accept account_id in lines already
  -- Rebuild with account codes via join
  v_lines := '[]'::jsonb;
  for r in
    select l.*, a.code as account_code
    from public.finance_journal_lines l
    join public.finance_accounts a on a.id = l.account_id
    where l.journal_entry_id = v_src.id
    order by l.line_no
  loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_code', r.account_code,
      'debit_cents', r.credit_cents,
      'credit_cents', r.debit_cents,
      'memo', coalesce(p_reason, 'reversal')
    ));
  end loop;

  v_post := public.mmd_finance_post_entry(
    'reversal',
    v_key,
    v_lines,
    coalesce(p_reason, 'Reversal of ' || v_src.id::text),
    v_src.source_type,
    v_src.source_id,
    null,
    v_src.vertical,
    v_src.country_code,
    v_src.currency,
    (timezone('utc', now()))::date,
    v_src.correlation_id,
    p_actor,
    jsonb_build_object('reverses', v_src.id)
  );

  if coalesce((v_post ->> 'ok')::boolean, false) then
    update public.finance_journal_entries
    set status = 'reversed',
        reversed_entry_id = nullif(v_post ->> 'journal_entry_id', '')::uuid
    where id = v_src.id;
  end if;

  return v_post;
end;
$$;

create or replace function public.mmd_finance_refresh_balances(p_as_of date default (timezone('utc', now()))::date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity uuid := public.mmd_finance_default_entity();
  v_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'service_role_required');
  end if;

  insert into public.finance_balances as fb (
    legal_entity_id, account_id, as_of_date, currency, debit_cents, credit_cents, balance_cents, computed_at
  )
  select
    v_entity,
    l.account_id,
    p_as_of,
    l.currency,
    sum(l.debit_cents),
    sum(l.credit_cents),
    sum(l.debit_cents) - sum(l.credit_cents),
    now()
  from public.finance_journal_lines l
  join public.finance_journal_entries e on e.id = l.journal_entry_id
  where e.status = 'posted'
    and e.accounting_date <= p_as_of
    and e.legal_entity_id = v_entity
  group by l.account_id, l.currency
  on conflict (legal_entity_id, account_id, as_of_date, currency)
  do update set
    debit_cents = excluded.debit_cents,
    credit_cents = excluded.credit_cents,
    balance_cents = excluded.balance_cents,
    computed_at = now();

  get diagnostics v_count = row_count;
  return jsonb_build_object('ok', true, 'accounts', v_count, 'as_of', p_as_of);
end;
$$;

-- Grants
revoke all on function public.mmd_finance_default_entity() from public, anon, authenticated;
revoke all on function public.mmd_finance_account_id(text, uuid) from public, anon, authenticated;
revoke all on function public.mmd_finance_open_period(uuid, date) from public, anon, authenticated;
revoke all on function public.mmd_finance_audit_append(text, text, text, text, text, text, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.mmd_finance_enqueue_event(text, text, text, text, jsonb, timestamptz, text, text, text, text) from public, anon, authenticated;
revoke all on function public.mmd_finance_post_entry(text, text, jsonb, text, text, text, uuid, text, text, text, date, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mmd_finance_process_source_event(uuid) from public, anon, authenticated;
revoke all on function public.mmd_finance_process_pending_batch(integer) from public, anon, authenticated;
revoke all on function public.mmd_finance_reverse_entry(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.mmd_finance_refresh_balances(date) from public, anon, authenticated;

grant execute on function public.mmd_finance_default_entity() to service_role;
grant execute on function public.mmd_finance_account_id(text, uuid) to service_role;
grant execute on function public.mmd_finance_open_period(uuid, date) to service_role;
grant execute on function public.mmd_finance_audit_append(text, text, text, text, text, text, uuid, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.mmd_finance_enqueue_event(text, text, text, text, jsonb, timestamptz, text, text, text, text) to service_role;
grant execute on function public.mmd_finance_post_entry(text, text, jsonb, text, text, text, uuid, text, text, text, date, text, uuid, jsonb) to service_role;
grant execute on function public.mmd_finance_process_source_event(uuid) to service_role;
grant execute on function public.mmd_finance_process_pending_batch(integer) to service_role;
grant execute on function public.mmd_finance_reverse_entry(uuid, text, text, uuid) to service_role;
grant execute on function public.mmd_finance_refresh_balances(date) to service_role;
