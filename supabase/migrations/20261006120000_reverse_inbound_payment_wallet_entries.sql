-- Wave 2b: reverse inbound payment wallet ledger entries on Stripe refunds.
-- Compensating pair: platform debit + client credit (reference_type = 'refund').
-- Idempotent on refund id (reference_id / trigger-built idempotency_key).
-- Does NOT modify older migrations.

create or replace function public.reverse_inbound_payment_wallet_entries(
  p_transaction_id uuid,
  p_refund_id text,
  p_amount_cents integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_country text;
  v_currency text;
  v_debit public.wallet_ledger%rowtype;
  v_credit public.wallet_ledger%rowtype;
  v_platform_balance bigint;
  v_client_balance bigint;
  v_created boolean := false;
  v_refund_id text := nullif(trim(coalesce(p_refund_id, '')), '');
begin
  if p_transaction_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_transaction_id');
  end if;
  if v_refund_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_refund_id');
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount_cents');
  end if;

  select
    user_id,
    upper(trim(coalesce(country_code, 'US'))),
    lower(trim(coalesce(currency, 'usd')))
  into v_user_id, v_country, v_currency
  from public.payment_transactions
  where id = p_transaction_id
  limit 1;

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'payment_transaction_not_found');
  end if;

  if v_country !~ '^[A-Z]{2}$' then
    v_country := 'US';
  end if;

  -- Idempotency: existing reverse pair for this refund id.
  select * into v_debit
  from public.wallet_ledger
  where account_type = 'platform'
    and account_user_id is null
    and reference_type = 'refund'
    and reference_id = v_refund_id
    and direction = 'debit'
  limit 1;

  select * into v_credit
  from public.wallet_ledger
  where account_type = 'client'
    and account_user_id = v_user_id
    and reference_type = 'refund'
    and reference_id = v_refund_id
    and direction = 'credit'
  limit 1;

  if v_debit.id is not null and v_credit.id is not null then
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'debit_id', v_debit.id,
      'credit_id', v_credit.id
    );
  end if;

  if v_debit.id is null then
    v_platform_balance := public.wallet_ledger_balance_cents('platform', null, v_currency);

    begin
      insert into public.wallet_ledger (
        account_type, account_user_id, country_code, currency, direction,
        amount_cents, balance_after_cents, reference_type, reference_id,
        description, metadata
      ) values (
        'platform', null, v_country, v_currency, 'debit',
        p_amount_cents, v_platform_balance - p_amount_cents,
        'refund', v_refund_id,
        'Inbound payment refund (platform reverse)',
        jsonb_build_object(
          'payment_transaction_id', p_transaction_id,
          'refund_id', v_refund_id,
          'source', 'reverse_inbound_payment_wallet_entries'
        )
      )
      returning * into v_debit;
      v_created := true;
    exception
      when unique_violation then
        select * into v_debit
        from public.wallet_ledger
        where account_type = 'platform'
          and account_user_id is null
          and reference_type = 'refund'
          and reference_id = v_refund_id
          and direction = 'debit'
        limit 1;
    end;
  end if;

  if v_credit.id is null then
    v_client_balance := public.wallet_ledger_balance_cents('client', v_user_id, v_currency);

    begin
      insert into public.wallet_ledger (
        account_type, account_user_id, country_code, currency, direction,
        amount_cents, balance_after_cents, reference_type, reference_id,
        description, metadata
      ) values (
        'client', v_user_id, v_country, v_currency, 'credit',
        p_amount_cents, v_client_balance + p_amount_cents,
        'refund', v_refund_id,
        'Client payment refund credit',
        jsonb_build_object(
          'payment_transaction_id', p_transaction_id,
          'refund_id', v_refund_id,
          'source', 'reverse_inbound_payment_wallet_entries'
        )
      )
      returning * into v_credit;
      v_created := true;
    exception
      when unique_violation then
        select * into v_credit
        from public.wallet_ledger
        where account_type = 'client'
          and account_user_id = v_user_id
          and reference_type = 'refund'
          and reference_id = v_refund_id
          and direction = 'credit'
        limit 1;
    end;
  end if;

  if v_debit.id is null or v_credit.id is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'wallet_ledger_reverse_pair_incomplete',
      'debit_id', v_debit.id,
      'credit_id', v_credit.id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'debit_id', v_debit.id,
    'credit_id', v_credit.id
  );
exception
  when unique_violation then
    select * into v_debit
    from public.wallet_ledger
    where account_type = 'platform'
      and account_user_id is null
      and reference_type = 'refund'
      and reference_id = v_refund_id
      and direction = 'debit'
    limit 1;
    select * into v_credit
    from public.wallet_ledger
    where account_type = 'client'
      and account_user_id = v_user_id
      and reference_type = 'refund'
      and reference_id = v_refund_id
      and direction = 'credit'
    limit 1;
    if v_debit.id is not null and v_credit.id is not null then
      return jsonb_build_object(
        'ok', true,
        'created', false,
        'debit_id', v_debit.id,
        'credit_id', v_credit.id
      );
    end if;
    return jsonb_build_object('ok', false, 'error', 'wallet_ledger_unique_violation');
end;
$$;

revoke all on function public.reverse_inbound_payment_wallet_entries(
  uuid, text, integer
) from public, anon, authenticated;
grant execute on function public.reverse_inbound_payment_wallet_entries(
  uuid, text, integer
) to service_role;
