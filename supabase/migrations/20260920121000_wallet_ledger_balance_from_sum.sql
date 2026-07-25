-- P0 follow-up: available wallet balance must not use stale balance_after_cents.
-- After duplicate quarantine, max(balance_after_cents) can remain inflated while
-- Σ(credit) − Σ(debit) is the real ledger position.
-- Does NOT modify older migrations.

create or replace function public.wallet_ledger_balance_cents(
  p_account_type text,
  p_account_user_id uuid,
  p_currency text
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
    case
      when direction = 'credit' then amount_cents
      when direction = 'debit' then -amount_cents
      else 0
    end
  ), 0)::bigint
  from public.wallet_ledger
  where account_type = p_account_type
    and currency = lower(trim(coalesce(p_currency, 'usd')))
    and (
      (p_account_user_id is null and account_user_id is null)
      or (p_account_user_id is not null and account_user_id = p_account_user_id)
    );
$$;

revoke all on function public.wallet_ledger_balance_cents(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.wallet_ledger_balance_cents(text, uuid, text)
  to service_role;

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

  if v_credit.id is null then
    v_platform_balance := public.wallet_ledger_balance_cents('platform', null, v_currency);

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
    v_client_balance := public.wallet_ledger_balance_cents('client', p_user_id, v_currency);

    begin
      insert into public.wallet_ledger (
        account_type, account_user_id, country_code, currency, direction,
        amount_cents, balance_after_cents, reference_type, reference_id,
        description, metadata
      ) values (
        'client', p_user_id, v_country, v_currency, 'debit',
        p_amount_cents, v_client_balance - p_amount_cents,
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
