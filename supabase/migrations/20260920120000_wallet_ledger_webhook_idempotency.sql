-- P0 financial idempotency:
-- 1) wallet_ledger unique key (account + reference + direction)
-- 2) atomic inbound credit+debit RPC
-- 3) recoverable payment_webhook_events state machine
--
-- Does NOT modify older migrations. Safe to apply after duplicate quarantine.
-- Do NOT apply to production without explicit approval.

begin;

-- ---------------------------------------------------------------------------
-- 1) Quarantine table — never silently destroy financial rows
-- ---------------------------------------------------------------------------

create table if not exists public.wallet_ledger_idempotency_quarantine (
  quarantine_id uuid primary key default gen_random_uuid(),
  original_ledger_id uuid not null,
  conflict_key text not null,
  payload jsonb not null,
  kept_ledger_id uuid,
  quarantined_at timestamptz not null default now(),
  note text not null default 'duplicate_before_wallet_ledger_idempotency_uidx'
);

comment on table public.wallet_ledger_idempotency_quarantine is
  'Preserves wallet_ledger rows removed as duplicates when enforcing idempotency unique index. Manual finance review required.';

alter table public.wallet_ledger_idempotency_quarantine enable row level security;

-- Migration owner is not JWT service_role; immutability trigger blocks UPDATE/DELETE.
-- Disable only for the quarantine + backfill window below, then re-enable.
do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgname = 'trg_guard_wallet_ledger_immutable'
      and tgrelid = 'public.wallet_ledger'::regclass
  ) then
    execute 'alter table public.wallet_ledger disable trigger trg_guard_wallet_ledger_immutable';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) Detect + quarantine duplicates (keep earliest created_at, then id)
-- ---------------------------------------------------------------------------

do $$
declare
  v_dup_count integer := 0;
  v_moved integer := 0;
begin
  if to_regclass('public.wallet_ledger') is null then
    raise notice 'wallet_ledger missing — skip duplicate quarantine';
    return;
  end if;

  select count(*) into v_dup_count
  from (
    select 1
    from public.wallet_ledger
    group by
      account_type,
      coalesce(account_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
      reference_type,
      reference_id,
      direction
    having count(*) > 1
  ) d;

  raise notice 'wallet_ledger idempotency duplicate groups: %', v_dup_count;

  with ranked as (
    select
      id,
      account_type,
      account_user_id,
      reference_type,
      reference_id,
      direction,
      created_at,
      to_jsonb(wallet_ledger.*) as payload,
      first_value(id) over (
        partition by
          account_type,
          coalesce(account_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
          reference_type,
          reference_id,
          direction
        order by created_at asc nulls last, id asc
      ) as kept_id,
      row_number() over (
        partition by
          account_type,
          coalesce(account_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
          reference_type,
          reference_id,
          direction
        order by created_at asc nulls last, id asc
      ) as rn
    from public.wallet_ledger
  ),
  dups as (
    select * from ranked where rn > 1
  ),
  inserted as (
    insert into public.wallet_ledger_idempotency_quarantine (
      original_ledger_id, conflict_key, payload, kept_ledger_id, note
    )
    select
      d.id,
      concat_ws(
        '|',
        d.account_type,
        coalesce(d.account_user_id::text, 'null'),
        d.reference_type,
        d.reference_id::text,
        d.direction
      ),
      d.payload,
      d.kept_id,
      'duplicate_before_wallet_ledger_idempotency_uidx'
    from dups d
    returning quarantine_id
  )
  select count(*) into v_moved from inserted;

  raise notice 'wallet_ledger rows quarantined: %', v_moved;

  delete from public.wallet_ledger wl
  using public.wallet_ledger_idempotency_quarantine q
  where wl.id = q.original_ledger_id
    and q.note = 'duplicate_before_wallet_ledger_idempotency_uidx'
    and q.quarantined_at >= now() - interval '1 minute';
end;
$$;

-- Explicit key so ON CONFLICT / app code can target a real column.
alter table public.wallet_ledger
  add column if not exists idempotency_key text;

update public.wallet_ledger
set idempotency_key = concat_ws(
  '|',
  account_type,
  coalesce(account_user_id::text, 'null'),
  reference_type,
  reference_id::text,
  direction
)
where idempotency_key is null;

alter table public.wallet_ledger
  alter column idempotency_key set not null;

create unique index if not exists wallet_ledger_idempotency_uidx
  on public.wallet_ledger (idempotency_key);

comment on index public.wallet_ledger_idempotency_uidx is
  'Idempotency: one ledger row per account_type|account_user_id|reference_type|reference_id|direction.';

create or replace function public.wallet_ledger_set_idempotency_key()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.idempotency_key := concat_ws(
    '|',
    new.account_type,
    coalesce(new.account_user_id::text, 'null'),
    new.reference_type,
    new.reference_id::text,
    new.direction
  );
  return new;
end;
$$;

drop trigger if exists trg_wallet_ledger_set_idempotency_key on public.wallet_ledger;
create trigger trg_wallet_ledger_set_idempotency_key
before insert or update of account_type, account_user_id, reference_type, reference_id, direction
on public.wallet_ledger
for each row execute function public.wallet_ledger_set_idempotency_key();

-- Restore immutability guard after structural backfill.
do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgname = 'trg_guard_wallet_ledger_immutable'
      and tgrelid = 'public.wallet_ledger'::regclass
  ) then
    execute 'alter table public.wallet_ledger enable trigger trg_guard_wallet_ledger_immutable';
  end if;
end;
$$;
-- ---------------------------------------------------------------------------
-- 3) Atomic inbound payment wallet pair (platform credit + client debit)
-- ---------------------------------------------------------------------------

create or replace function public.record_inbound_payment_wallet_entries(
  p_transaction_id uuid,
  p_user_id uuid,
  p_country_code text,
  p_currency text,
  p_amount_cents integer,
  p_entity_type text default null,
  p_entity_id text default null,
  p_provider text default null,
  p_credit_description text default null,
  p_debit_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credit public.wallet_ledger%rowtype;
  v_debit public.wallet_ledger%rowtype;
  v_platform_balance bigint;
  v_client_balance bigint;
  v_created boolean := false;
  v_country text := upper(trim(coalesce(p_country_code, 'US')));
  v_currency text := lower(trim(coalesce(p_currency, 'usd')));
begin
  if p_transaction_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_transaction_id');
  end if;
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_user_id');
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount_cents');
  end if;
  if v_country !~ '^[A-Z]{2}$' then
    v_country := 'US';
  end if;

  select * into v_credit
  from public.wallet_ledger
  where account_type = 'platform'
    and account_user_id is null
    and reference_type = 'payment_transaction'
    and reference_id = p_transaction_id
    and direction = 'credit'
  limit 1;

  select * into v_debit
  from public.wallet_ledger
  where account_type = 'client'
    and account_user_id = p_user_id
    and reference_type = 'payment_transaction'
    and reference_id = p_transaction_id
    and direction = 'debit'
  limit 1;

  if v_credit.id is not null and v_debit.id is not null then
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'credit_id', v_credit.id,
      'debit_id', v_debit.id
    );
  end if;

  -- Complete a partial pair without double-writing the existing side.
  if v_credit.id is null then
    select coalesce(
      (
        select balance_after_cents
        from public.wallet_ledger
        where account_type = 'platform'
          and account_user_id is null
          and currency = v_currency
        order by created_at desc
        limit 1
      ),
      0
    ) into v_platform_balance;

    begin
      insert into public.wallet_ledger (
        account_type, account_user_id, country_code, currency, direction,
        amount_cents, balance_after_cents, reference_type, reference_id,
        description, metadata
      ) values (
        'platform', null, v_country, v_currency, 'credit',
        p_amount_cents, v_platform_balance + p_amount_cents,
        'payment_transaction', p_transaction_id,
        coalesce(p_credit_description, 'Inbound payment'),
        jsonb_build_object(
          'entity_type', p_entity_type,
          'entity_id', p_entity_id,
          'provider', p_provider
        )
      )
      returning * into v_credit;
      v_created := true;
    exception
      when unique_violation then
        select * into v_credit
        from public.wallet_ledger
        where account_type = 'platform'
          and account_user_id is null
          and reference_type = 'payment_transaction'
          and reference_id = p_transaction_id
          and direction = 'credit'
        limit 1;
    end;
  end if;

  if v_debit.id is null then
    select coalesce(
      (
        select balance_after_cents
        from public.wallet_ledger
        where account_type = 'client'
          and account_user_id = p_user_id
          and currency = v_currency
        order by created_at desc
        limit 1
      ),
      0
    ) into v_client_balance;

    begin
      insert into public.wallet_ledger (
        account_type, account_user_id, country_code, currency, direction,
        amount_cents, balance_after_cents, reference_type, reference_id,
        description, metadata
      ) values (
        'client', p_user_id, v_country, v_currency, 'debit',
        p_amount_cents, greatest(0, v_client_balance - p_amount_cents),
        'payment_transaction', p_transaction_id,
        coalesce(p_debit_description, 'Client payment captured by MMD'),
        jsonb_build_object(
          'entity_type', p_entity_type,
          'entity_id', p_entity_id
        )
      )
      returning * into v_debit;
      v_created := true;
    exception
      when unique_violation then
        select * into v_debit
        from public.wallet_ledger
        where account_type = 'client'
          and account_user_id = p_user_id
          and reference_type = 'payment_transaction'
          and reference_id = p_transaction_id
          and direction = 'debit'
        limit 1;
    end;
  end if;

  if v_credit.id is null or v_debit.id is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'wallet_ledger_pair_incomplete',
      'credit_id', v_credit.id,
      'debit_id', v_debit.id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'credit_id', v_credit.id,
    'debit_id', v_debit.id
  );
exception
  when unique_violation then
    -- Concurrent insert of the same pair — treat as already recorded.
    select * into v_credit
    from public.wallet_ledger
    where account_type = 'platform'
      and account_user_id is null
      and reference_type = 'payment_transaction'
      and reference_id = p_transaction_id
      and direction = 'credit'
    limit 1;
    select * into v_debit
    from public.wallet_ledger
    where account_type = 'client'
      and account_user_id = p_user_id
      and reference_type = 'payment_transaction'
      and reference_id = p_transaction_id
      and direction = 'debit'
    limit 1;
    if v_credit.id is not null and v_debit.id is not null then
      return jsonb_build_object(
        'ok', true,
        'created', false,
        'credit_id', v_credit.id,
        'debit_id', v_debit.id
      );
    end if;
    return jsonb_build_object('ok', false, 'error', 'wallet_ledger_unique_violation');
end;
$$;

revoke all on function public.record_inbound_payment_wallet_entries(
  uuid, uuid, text, text, integer, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.record_inbound_payment_wallet_entries(
  uuid, uuid, text, text, integer, text, text, text, text, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 4) payment_webhook_events recoverable state machine
-- ---------------------------------------------------------------------------

alter table public.payment_webhook_events
  add column if not exists status text,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processed_at timestamptz,
  add column if not exists last_error text,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_retry_at timestamptz;

-- Existing rows: paid linked txs → processed; otherwise retryable for recovery.
update public.payment_webhook_events e
set status = 'processed',
    processed_at = coalesce(e.processed_at, e.received_at)
where e.status is null
  and e.payment_transaction_id is not null
  and exists (
    select 1
    from public.payment_transactions t
    where t.id = e.payment_transaction_id
      and t.status = 'paid'
  );

update public.payment_webhook_events
set status = 'retryable'
where status is null;

alter table public.payment_webhook_events
  alter column status set default 'received';

alter table public.payment_webhook_events
  alter column status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payment_webhook_events_status_check'
  ) then
    alter table public.payment_webhook_events
      add constraint payment_webhook_events_status_check
      check (status in ('received', 'processing', 'processed', 'failed', 'retryable'));
  end if;
end;
$$;

create index if not exists payment_webhook_events_status_idx
  on public.payment_webhook_events (status, next_retry_at nulls first);

create or replace function public.claim_payment_webhook_event(
  p_provider text,
  p_external_event_id text,
  p_payload jsonb default '{}'::jsonb,
  p_stale_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payment_webhook_events%rowtype;
  v_stale_before timestamptz :=
    now() - make_interval(secs => greatest(coalesce(p_stale_seconds, 300), 60));
begin
  if trim(coalesce(p_provider, '')) = '' or trim(coalesce(p_external_event_id, '')) = '' then
    return jsonb_build_object('ok', false, 'outcome', 'invalid', 'error', 'missing_provider_or_event_id');
  end if;

  insert into public.payment_webhook_events as e (
    provider, external_event_id, payload, status, attempt_count
  )
  values (
    p_provider,
    p_external_event_id,
    coalesce(p_payload, '{}'::jsonb),
    'received',
    0
  )
  on conflict (provider, external_event_id) do update
    set payload = coalesce(excluded.payload, e.payload)
  where e.status is distinct from 'processed'
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
    from public.payment_webhook_events
    where provider = p_provider
      and external_event_id = p_external_event_id;
  end if;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'outcome', 'missing', 'error', 'webhook_event_missing');
  end if;

  if v_row.status = 'processed' then
    return jsonb_build_object(
      'ok', true,
      'outcome', 'already_processed',
      'id', v_row.id,
      'status', v_row.status,
      'attempt_count', v_row.attempt_count
    );
  end if;

  if v_row.status = 'processing'
     and v_row.processing_started_at is not null
     and v_row.processing_started_at > v_stale_before then
    return jsonb_build_object(
      'ok', true,
      'outcome', 'in_progress',
      'id', v_row.id,
      'status', v_row.status,
      'attempt_count', v_row.attempt_count,
      'processing_started_at', v_row.processing_started_at
    );
  end if;

  update public.payment_webhook_events
  set
    status = 'processing',
    processing_started_at = now(),
    attempt_count = coalesce(attempt_count, 0) + 1,
    last_error = null,
    payload = coalesce(p_payload, payload),
    next_retry_at = null
  where id = v_row.id
    and (
      status in ('received', 'failed', 'retryable')
      or (
        status = 'processing'
        and (
          processing_started_at is null
          or processing_started_at <= v_stale_before
        )
      )
    )
  returning * into v_row;

  if v_row.id is null then
    select * into v_row
    from public.payment_webhook_events
    where provider = p_provider
      and external_event_id = p_external_event_id;

    if v_row.status = 'processed' then
      return jsonb_build_object(
        'ok', true,
        'outcome', 'already_processed',
        'id', v_row.id,
        'status', v_row.status,
        'attempt_count', v_row.attempt_count
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'outcome', 'in_progress',
      'id', v_row.id,
      'status', coalesce(v_row.status, 'processing'),
      'attempt_count', v_row.attempt_count
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'outcome', 'claimed',
    'id', v_row.id,
    'status', 'processing',
    'attempt_count', v_row.attempt_count
  );
end;
$$;

create or replace function public.finalize_payment_webhook_event(
  p_event_id uuid,
  p_outcome text,
  p_payment_transaction_id uuid default null,
  p_last_error text default null,
  p_retry_after_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payment_webhook_events%rowtype;
  v_outcome text := lower(trim(coalesce(p_outcome, '')));
begin
  if p_event_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_event_id');
  end if;

  if v_outcome = 'processed' then
    update public.payment_webhook_events
    set
      status = 'processed',
      processed_at = now(),
      payment_transaction_id = coalesce(p_payment_transaction_id, payment_transaction_id),
      last_error = null,
      next_retry_at = null
    where id = p_event_id
    returning * into v_row;
  elsif v_outcome = 'failed' then
    update public.payment_webhook_events
    set
      status = 'failed',
      last_error = left(coalesce(p_last_error, 'failed'), 2000),
      next_retry_at = null
    where id = p_event_id
    returning * into v_row;
  elsif v_outcome = 'retryable' then
    update public.payment_webhook_events
    set
      status = 'retryable',
      last_error = left(coalesce(p_last_error, 'retryable'), 2000),
      next_retry_at = now() + make_interval(secs => greatest(coalesce(p_retry_after_seconds, 60), 5))
    where id = p_event_id
    returning * into v_row;
  else
    return jsonb_build_object('ok', false, 'error', 'invalid_outcome');
  end if;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'webhook_event_not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'status', v_row.status,
    'attempt_count', v_row.attempt_count
  );
end;
$$;

revoke all on function public.claim_payment_webhook_event(text, text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.claim_payment_webhook_event(text, text, jsonb, integer)
  to service_role;

revoke all on function public.finalize_payment_webhook_event(uuid, text, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.finalize_payment_webhook_event(uuid, text, uuid, text, integer)
  to service_role;

commit;
