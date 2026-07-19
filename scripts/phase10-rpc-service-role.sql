begin;
select set_config('role', 'service_role', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role","ref":"local"}', true);
select auth.role() as auth_role;

select public.mmd_finance_enqueue_event(
  'food_order', 'probe-order-3', 'payment_succeeded', 'idem-fin-enq-3',
  jsonb_build_object('amount_cents', 1000, 'currency', 'USD'),
  now(), 'food', 'US', 'USD', 'corr-3'
) as finance_enqueue;

select public.mmd_finance_process_pending_batch(10) as finance_process_batch;
select public.mmd_finance_refresh_balances(timezone('utc', now())::date) as finance_refresh;
select public.mmd_finance_recognize_revenue_batch(timezone('utc', now())::date, 10) as revenue_recognition;
select public.mmd_analytics_refresh_daily(timezone('utc', now())::date, 'US') as analytics_refresh;

rollback;
