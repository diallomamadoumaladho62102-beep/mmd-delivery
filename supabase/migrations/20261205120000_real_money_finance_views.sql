-- Real-money reporting views (reversible, non-destructive).
-- Does NOT delete or rewrite existing rows.
-- Live visibility already lives in v_orders_live / is_user_visible_trip_row.
-- These views add the paid-payment gate for financial reporting.
--
-- Timestamp 20261205120000 is intentional: ordered after
-- 20261204120000_partner_transfer_recoveries. Do not rename.

create or replace view public.v_orders_real_money
with (security_invoker = true)
as
select o.*
from public.orders o
where public.is_user_visible_trip_row(o.archived_at, o.is_test, o.hidden_from_user)
  and lower(coalesce(o.payment_status, '')) in ('paid', 'succeeded');

comment on view public.v_orders_real_money is
  'Live paid orders only. Test/demo/archived/hidden/unpaid rows are excluded from real-money reporting.';

create or replace view public.v_taxi_rides_real_money
with (security_invoker = true)
as
select r.*
from public.taxi_rides r
where public.is_user_visible_trip_row(r.archived_at, r.is_test, r.hidden_from_user)
  and lower(coalesce(r.payment_status, '')) in ('paid', 'succeeded');

comment on view public.v_taxi_rides_real_money is
  'Live paid taxi rides only. Test/demo/archived/hidden/unpaid rows are excluded from real-money reporting.';
