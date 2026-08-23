-- Atomic manual Cash Out: max 1 successful claim per recipient per America/New_York calendar day.
-- Prevents concurrent double cash outs (Driver / Restaurant / Seller).
-- Partial unique index allows retry after failed/released claims.

create table if not exists public.manual_cashout_daily_claims (
  id uuid primary key default gen_random_uuid(),
  recipient_type text not null
    check (recipient_type in ('driver', 'restaurant', 'seller')),
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  et_date date not null,
  status text not null default 'claimed'
    check (status in ('claimed', 'processing', 'paid', 'failed', 'released')),
  payout_transaction_id uuid references public.payout_transactions (id) on delete set null,
  amount_cents integer,
  stripe_payout_id text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists manual_cashout_daily_claims_active_uidx
  on public.manual_cashout_daily_claims (recipient_type, recipient_user_id, et_date)
  where status in ('claimed', 'processing', 'paid');

create index if not exists manual_cashout_daily_claims_user_idx
  on public.manual_cashout_daily_claims (recipient_user_id, et_date desc);

comment on table public.manual_cashout_daily_claims is
  'MMD manual Cash Out daily lock (America/New_York). One active claim per role/user/day.';

alter table public.manual_cashout_daily_claims enable row level security;

drop policy if exists manual_cashout_daily_claims_select_own on public.manual_cashout_daily_claims;
create policy manual_cashout_daily_claims_select_own
  on public.manual_cashout_daily_claims
  for select
  to authenticated
  using (recipient_user_id = auth.uid());

-- No insert/update/delete for authenticated — service role / SECURITY DEFINER RPC only.

create or replace function public.claim_manual_cashout_day(
  p_recipient_type text,
  p_recipient_user_id uuid,
  p_et_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_existing public.manual_cashout_daily_claims%rowtype;
begin
  if p_recipient_type is null
     or p_recipient_type not in ('driver', 'restaurant', 'seller') then
    return jsonb_build_object('ok', false, 'error', 'invalid_recipient_type');
  end if;

  if p_recipient_user_id is null or p_et_date is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_args');
  end if;

  -- Serialize concurrent claimants for the same user+role (session-level advisory lock).
  perform pg_advisory_xact_lock(
    hashtext('manual_cashout:' || p_recipient_type || ':' || p_recipient_user_id::text)
  );

  select *
    into v_existing
  from public.manual_cashout_daily_claims
  where recipient_type = p_recipient_type
    and recipient_user_id = p_recipient_user_id
    and et_date = p_et_date
    and status in ('claimed', 'processing', 'paid')
  order by created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', false,
      'error', 'cashout_rate_limited',
      'claim_id', v_existing.id,
      'status', v_existing.status,
      'stripe_payout_id', v_existing.stripe_payout_id,
      'payout_transaction_id', v_existing.payout_transaction_id,
      'created_at', v_existing.created_at
    );
  end if;

  insert into public.manual_cashout_daily_claims (
    recipient_type,
    recipient_user_id,
    et_date,
    status
  ) values (
    p_recipient_type,
    p_recipient_user_id,
    p_et_date,
    'claimed'
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'claim_id', v_id,
    'et_date', p_et_date
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'cashout_rate_limited');
end;
$$;

revoke all on function public.claim_manual_cashout_day(text, uuid, date) from public;
revoke all on function public.claim_manual_cashout_day(text, uuid, date) from anon, authenticated;
grant execute on function public.claim_manual_cashout_day(text, uuid, date) to service_role;

create or replace function public.finalize_manual_cashout_day(
  p_claim_id uuid,
  p_status text,
  p_payout_transaction_id uuid default null,
  p_stripe_payout_id text default null,
  p_amount_cents integer default null,
  p_failure_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.manual_cashout_daily_claims%rowtype;
begin
  if p_status is null
     or p_status not in ('processing', 'paid', 'failed', 'released') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  update public.manual_cashout_daily_claims
  set
    status = p_status,
    payout_transaction_id = coalesce(p_payout_transaction_id, payout_transaction_id),
    stripe_payout_id = coalesce(p_stripe_payout_id, stripe_payout_id),
    amount_cents = coalesce(p_amount_cents, amount_cents),
    failure_reason = case
      when p_status in ('failed', 'released') then p_failure_reason
      else failure_reason
    end,
    updated_at = now()
  where id = p_claim_id
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'claim_not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'claim_id', v_row.id,
    'status', v_row.status
  );
end;
$$;

revoke all on function public.finalize_manual_cashout_day(uuid, text, uuid, text, integer, text) from public;
revoke all on function public.finalize_manual_cashout_day(uuid, text, uuid, text, integer, text) from anon, authenticated;
grant execute on function public.finalize_manual_cashout_day(uuid, text, uuid, text, integer, text) to service_role;
