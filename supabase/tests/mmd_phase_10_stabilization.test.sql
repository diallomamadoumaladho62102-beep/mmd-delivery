-- Phase 10 SQL smoke checklist (not an automated runner)

-- 1) Marketplace refund columns
-- select column_name from information_schema.columns
--   where table_name='seller_orders' and column_name in ('stripe_refund_id','stripe_refunded_at');

-- 2) Driver eligibility helper
-- select public.mmd_marketing_driver_is_eligible('00000000-0000-0000-0000-000000000000', true);

-- 3) Revenue recognition RPC exists
-- select proname from pg_proc where proname='mmd_finance_recognize_revenue_batch';

-- 4) Ledger integrity view
-- select * from public.v_finance_ledger_integrity limit 5;

-- 5) Analytics aggregate tables
-- select to_regclass('public.analytics_daily_tops');
-- select to_regclass('public.analytics_time_series');
