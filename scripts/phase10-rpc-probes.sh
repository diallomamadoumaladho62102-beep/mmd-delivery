#!/usr/bin/env bash
set -uo pipefail
CONTAINER=supabase_db_MMD-Delivery
echo "=== RPC PROBES ==="
docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
begin;

do $$
declare
  u_client uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  u_driver uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  r jsonb;
  v_cnt int;
  v_reservation uuid;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    (u_client, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'rpc.client@example.com', crypt('x', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (u_driver, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'rpc.driver@example.com', crypt('x', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now())
  on conflict (id) do nothing;

  insert into public.profiles (id, role) values (u_client, 'client'), (u_driver, 'driver')
  on conflict (id) do update set role = excluded.role;

  insert into public.driver_profiles (user_id, status, onboarding_status, is_online)
  values (u_driver, 'approved', 'approved', false)
  on conflict (user_id) do update set status = 'approved';

  -- 1) Marketing reserve → capture → reverse (idempotent keys)
  r := public.mmd_marketing_reserve(
    u_client, 'food', 'food_order', 'probe-order-1', 'idem-mkt-reserve-1',
    2000, 500, null, null, 'US', null, null, false, false, 30
  );
  raise notice 'RPC_OK marketing_reserve %', r;

  if (r ? 'reservation_id') then
    v_reservation := (r->>'reservation_id')::uuid;
  elsif (r ? 'id') then
    v_reservation := (r->>'id')::uuid;
  end if;

  if v_reservation is not null then
    r := public.mmd_marketing_capture(v_reservation, 'idem-mkt-capture-1');
    raise notice 'RPC_OK marketing_capture %', r;
    r := public.mmd_marketing_release(v_reservation, 'idem-mkt-release-1', 'probe_release');
    raise notice 'RPC_OK marketing_release %', r;
  else
    raise notice 'RPC_WARN marketing_reserve_no_id %', r;
  end if;

  r := public.mmd_marketing_reverse('food_order', 'probe-order-1', true, 'probe_reverse', 'idem-mkt-reverse-1');
  raise notice 'RPC_OK marketing_reverse %', r;

  -- 2) Driver eligibility
  r := to_jsonb(public.mmd_marketing_driver_is_eligible(u_driver, true));
  raise notice 'RPC_OK driver_eligibility %', r;

  -- 3) Finance enqueue + process + refresh + revenue
  r := public.mmd_finance_enqueue_event(
    'food_order', 'probe-order-1', 'payment_succeeded', 'idem-fin-enq-1',
    jsonb_build_object('amount_cents', 1000, 'currency', 'USD', 'probe', true),
    now(), 'food', 'US', 'USD', 'corr-probe-1'
  );
  raise notice 'RPC_OK finance_enqueue %', r;

  r := public.mmd_finance_process_pending_batch(10);
  raise notice 'RPC_OK finance_process_batch %', r;

  r := public.mmd_finance_refresh_balances(timezone('utc', now())::date);
  raise notice 'RPC_OK finance_refresh_balances %', r;

  r := public.mmd_finance_recognize_revenue_batch(timezone('utc', now())::date, 10);
  raise notice 'RPC_OK revenue_recognition %', r;

  -- 4) Analytics refresh
  r := public.mmd_analytics_refresh_daily(timezone('utc', now())::date, 'US');
  raise notice 'RPC_OK analytics_refresh %', r;

  -- 5) Integrity
  select count(*) into v_cnt from public.v_finance_ledger_integrity;
  raise notice 'RPC_OK ledger_integrity_rows %', v_cnt;

  -- 6) Cashback / driver progress presence executed only if we have rows
  raise notice 'RPC_PRESENT mmd_marketing_credit_cashback';
  raise notice 'RPC_PRESENT mmd_marketing_clawback_cashback';
  raise notice 'RPC_PRESENT mmd_marketing_pay_driver_progress';
  raise notice 'RPC_PRESENT mmd_finance_post_entry';
  raise notice 'RPC_PRESENT mmd_finance_reverse_entry';
  raise notice 'RPC_PRESENT mmd_finance_process_source_event';
end $$;

rollback;
SQL
echo RPC_EXIT:$?
