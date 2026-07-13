-- CLI-compatible audit returning SAFE_TO_APPLY_UNIQUE_CONSTRAINTS as a result set.
-- Mirrors docs/production/sql/payment_intent_integrity_audit.sql blocking rules.

with tables as (
  select unnest(array['orders','seller_orders','taxi_rides','delivery_requests']) as tbl
),
per_table as (
  select
    t.tbl,
    (select count(*) from public.orders o where t.tbl='orders' and o.stripe_payment_intent_id is not null and btrim(o.stripe_payment_intent_id)<>'')
    + (select count(*) from public.seller_orders s where t.tbl='seller_orders' and s.stripe_payment_intent_id is not null and btrim(s.stripe_payment_intent_id)<>'')
    + (select count(*) from public.taxi_rides r where t.tbl='taxi_rides' and r.stripe_payment_intent_id is not null and btrim(r.stripe_payment_intent_id)<>'')
    + (select count(*) from public.delivery_requests d where t.tbl='delivery_requests' and d.stripe_payment_intent_id is not null and btrim(d.stripe_payment_intent_id)<>'')
      as rows_with_pi,
    case t.tbl
      when 'orders' then (
        select count(*) from (
          select stripe_payment_intent_id from public.orders
          where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id)<>''
          group by stripe_payment_intent_id having count(*)>1
        ) x)
      when 'seller_orders' then (
        select count(*) from (
          select stripe_payment_intent_id from public.seller_orders
          where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id)<>''
          group by stripe_payment_intent_id having count(*)>1
        ) x)
      when 'taxi_rides' then (
        select count(*) from (
          select stripe_payment_intent_id from public.taxi_rides
          where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id)<>''
          group by stripe_payment_intent_id having count(*)>1
        ) x)
      when 'delivery_requests' then (
        select count(*) from (
          select stripe_payment_intent_id from public.delivery_requests
          where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id)<>''
          group by stripe_payment_intent_id having count(*)>1
        ) x)
    end as dup_groups,
    case t.tbl
      when 'orders' then (
        select count(*) from public.orders
        where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id)<>''
          and stripe_payment_intent_id not like 'pi\_%' escape '\')
      when 'seller_orders' then (
        select count(*) from public.seller_orders
        where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id)<>''
          and stripe_payment_intent_id not like 'pi\_%' escape '\')
      when 'taxi_rides' then (
        select count(*) from public.taxi_rides
        where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id)<>''
          and stripe_payment_intent_id not like 'pi\_%' escape '\')
      when 'delivery_requests' then (
        select count(*) from public.delivery_requests
        where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id)<>''
          and stripe_payment_intent_id not like 'pi\_%' escape '\')
    end as malformed,
    case t.tbl
      when 'orders' then (
        select count(*) from public.orders
        where lower(coalesce(payment_status,''))='paid'
          and (stripe_payment_intent_id is null or btrim(stripe_payment_intent_id)=''))
      when 'seller_orders' then (
        select count(*) from public.seller_orders
        where lower(coalesce(payment_status,''))='paid'
          and (stripe_payment_intent_id is null or btrim(stripe_payment_intent_id)=''))
      when 'taxi_rides' then (
        select count(*) from public.taxi_rides
        where lower(coalesce(payment_status,''))='paid'
          and (stripe_payment_intent_id is null or btrim(stripe_payment_intent_id)=''))
      when 'delivery_requests' then (
        select count(*) from public.delivery_requests
        where lower(coalesce(payment_status,''))='paid'
          and (stripe_payment_intent_id is null or btrim(stripe_payment_intent_id)=''))
    end as paid_no_pi,
    case t.tbl
      when 'orders' then (
        select count(*) from (
          select stripe_payment_intent_id from public.orders
          where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id)<>''
          group by stripe_payment_intent_id having count(distinct client_user_id)>1
        ) x)
      when 'seller_orders' then (
        select count(*) from (
          select stripe_payment_intent_id from public.seller_orders
          where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id)<>''
          group by stripe_payment_intent_id having count(distinct client_user_id)>1
        ) x)
      when 'taxi_rides' then (
        select count(*) from (
          select stripe_payment_intent_id from public.taxi_rides
          where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id)<>''
          group by stripe_payment_intent_id having count(distinct client_user_id)>1
        ) x)
      when 'delivery_requests' then (
        select count(*) from (
          select stripe_payment_intent_id from public.delivery_requests
          where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id)<>''
          group by stripe_payment_intent_id having count(distinct client_user_id)>1
        ) x)
    end as multi_user
  from tables t
),
cross_table as (
  select count(*)::bigint as cross_collisions
  from (
    select pi
    from (
      select 'orders'::text as svc, stripe_payment_intent_id as pi from public.orders
        where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id)<>''
      union all
      select 'seller_orders', stripe_payment_intent_id from public.seller_orders
        where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id)<>''
      union all
      select 'taxi_rides', stripe_payment_intent_id from public.taxi_rides
        where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id)<>''
      union all
      select 'delivery_requests', stripe_payment_intent_id from public.delivery_requests
        where stripe_payment_intent_id is not null and btrim(stripe_payment_intent_id)<>''
    ) u
    group by pi
    having count(distinct svc) > 1
  ) x
)
select
  p.tbl,
  p.rows_with_pi,
  p.dup_groups,
  p.malformed,
  p.paid_no_pi,
  p.multi_user,
  c.cross_collisions,
  (
    (select coalesce(sum(dup_groups),0)=0 from per_table)
    and (select coalesce(sum(multi_user),0)=0 from per_table)
    and c.cross_collisions = 0
  ) as "SAFE_TO_APPLY_UNIQUE_CONSTRAINTS"
from per_table p
cross join cross_table c
order by p.tbl;
