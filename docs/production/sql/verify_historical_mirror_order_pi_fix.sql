-- Post-correction verification for historical mirror-order PI cleanup (read-only)
select 'orders_after' as check_name, jsonb_agg(jsonb_build_object(
  'id', o.id,
  'pi', o.stripe_payment_intent_id,
  'session', o.stripe_session_id,
  'payment_status', o.payment_status,
  'status', o.status,
  'paid_at', o.paid_at,
  'total', o.total,
  'currency', o.currency,
  'driver_id', o.driver_id,
  'external_ref_id', o.external_ref_id,
  'external_ref_type', o.external_ref_type
) order by o.created_at) as payload
from public.orders o
where o.id in (
  '9aa30884-d7e2-4df8-b871-4921f64b6608'::uuid,
  'e7751184-5bf7-4db0-bb84-46308a204084'::uuid,
  '4fbd3968-4709-4578-af78-c81e3c19c6e6'::uuid
)

union all

select 'delivery_requests_after', jsonb_agg(jsonb_build_object(
  'id', dr.id,
  'pi', dr.stripe_payment_intent_id,
  'session', dr.stripe_session_id,
  'payment_status', dr.payment_status,
  'status', dr.status,
  'paid_at', dr.paid_at,
  'total', dr.total,
  'currency', dr.currency,
  'driver_id', dr.driver_id
) order by dr.created_at)
from public.delivery_requests dr
where dr.id in (
  '92f87f47-c228-498a-94e4-6e6a2759d1b7'::uuid,
  'f3303ae3-552d-466d-ad35-7ae36386866d'::uuid,
  '7fa39fad-6461-4cda-a0a6-a33531215ffd'::uuid
)

union all

select 'orders_null_pi_count', jsonb_build_object(
  'n', count(*)
)
from public.orders o
where o.id in (
  '9aa30884-d7e2-4df8-b871-4921f64b6608'::uuid,
  'e7751184-5bf7-4db0-bb84-46308a204084'::uuid,
  '4fbd3968-4709-4578-af78-c81e3c19c6e6'::uuid
)
and o.stripe_payment_intent_id is null
and o.stripe_session_id is null

union all

select 'dr_still_have_expected_pi', jsonb_build_object(
  'n', count(*)
)
from public.delivery_requests dr
where (dr.id, dr.stripe_payment_intent_id) in (
  ('92f87f47-c228-498a-94e4-6e6a2759d1b7'::uuid, 'pi_3TK9QbARYL6CPXX20t9IZAjd'),
  ('f3303ae3-552d-466d-ad35-7ae36386866d'::uuid, 'pi_3TKCANARYL6CPXX22K1ftx1f'),
  ('7fa39fad-6461-4cda-a0a6-a33531215ffd'::uuid, 'pi_3TKZH9ARYL6CPXX21zqLZLu4')
)

union all

select 'cross_table_collisions_remaining', jsonb_build_object(
  'n', count(*)
)
from (
  select pi
  from (
    select stripe_payment_intent_id as pi from public.orders where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id) <> ''
    union all
    select stripe_payment_intent_id from public.delivery_requests where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id) <> ''
    union all
    select stripe_payment_intent_id from public.taxi_rides where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id) <> ''
    union all
    select stripe_payment_intent_id from public.seller_orders where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id) <> ''
  ) u
  group by pi
  having count(*) > 1
) x

union all

select 'commissions_still_present', jsonb_build_object(
  'n', count(*)
)
from public.order_commissions
where order_id in (
  '9aa30884-d7e2-4df8-b871-4921f64b6608'::uuid,
  'e7751184-5bf7-4db0-bb84-46308a204084'::uuid,
  '4fbd3968-4709-4578-af78-c81e3c19c6e6'::uuid
);
