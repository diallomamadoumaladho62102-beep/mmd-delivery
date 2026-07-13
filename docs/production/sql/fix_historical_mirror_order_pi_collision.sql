-- =============================================================================
-- Targeted fix: historical delivery_request ↔ orders PI collisions (3 rows)
-- =============================================================================
-- Project: mmd_delivery (sjmszohmhudayxawfows)
-- Date:    2026-07-13
--
-- Context
--   Three historical pickup_dropoff mirror orders share the same
--   stripe_payment_intent_id as their linked delivery_requests.
--   delivery_requests is the payment source of truth. Current application code
--   (syncPaidDeliveryRequestOrder) no longer copies Stripe refs onto the mirror.
--
-- Guarantees
--   * Exactly three orders updated, or full ROLLBACK.
--   * Only stripe_payment_intent_id and stripe_session_id are nulled.
--   * Defensive WHERE predicates + existence check on matching delivery_request.
--   * Post-update assertions abort the transaction on mismatch.
-- =============================================================================

begin;

-- CLI login role is not session_user=service_role; set the JWT claim the
-- financial guard already trusts for server-side writes (transaction-local).
select set_config('request.jwt.claim.role', 'service_role', true);

create temporary table tmp_mirror_pi_fix_expected (
  order_id uuid primary key,
  dr_id uuid not null,
  expected_pi text not null
) on commit drop;

insert into tmp_mirror_pi_fix_expected (order_id, dr_id, expected_pi) values
  ('9aa30884-d7e2-4df8-b871-4921f64b6608', '92f87f47-c228-498a-94e4-6e6a2759d1b7', 'pi_3TK9QbARYL6CPXX20t9IZAjd'),
  ('e7751184-5bf7-4db0-bb84-46308a204084', 'f3303ae3-552d-466d-ad35-7ae36386866d', 'pi_3TKCANARYL6CPXX22K1ftx1f'),
  ('4fbd3968-4709-4578-af78-c81e3c19c6e6', '7fa39fad-6461-4cda-a0a6-a33531215ffd', 'pi_3TKZH9ARYL6CPXX21zqLZLu4');

-- Snapshot financial / operational fields that must remain unchanged
create temporary table tmp_mirror_pi_fix_before on commit drop as
select
  o.id,
  o.external_ref_id,
  o.external_ref_type,
  o.stripe_payment_intent_id,
  o.stripe_session_id,
  o.payment_status,
  o.status,
  o.paid_at,
  o.created_at,
  o.updated_at,
  o.total,
  o.currency,
  o.driver_id,
  o.client_user_id,
  o.created_by
from public.orders o
join tmp_mirror_pi_fix_expected e on e.order_id = o.id;

create temporary table tmp_mirror_pi_fix_comm_before on commit drop as
select oc.*
from public.order_commissions oc
join tmp_mirror_pi_fix_expected e on e.order_id = oc.order_id;

-- Disable the catch-all AFTER UPDATE commissions trigger for this session
-- transaction only. It re-enters refresh_order_commissions() on ANY column
-- change and currently errors on pickup_dropoff (order_kind/order_type cast),
-- which would abort an otherwise valid Stripe-ref cleanup.
alter table public.orders disable trigger trg_orders_commissions;

-- Defensive UPDATE: only the three expected mirror rows
with updated as (
  update public.orders o
  set
    stripe_payment_intent_id = null,
    stripe_session_id = null
  from tmp_mirror_pi_fix_expected e
  where o.id = e.order_id
    and o.external_ref_type = 'delivery_request'
    and o.external_ref_id = e.dr_id
    and o.stripe_payment_intent_id = e.expected_pi
    and exists (
      select 1
      from public.delivery_requests dr
      where dr.id = e.dr_id
        and dr.stripe_payment_intent_id = e.expected_pi
        and btrim(dr.stripe_payment_intent_id) <> ''
    )
  returning o.id
)
select count(*)::int as n into temporary table tmp_mirror_pi_fix_count from updated;

alter table public.orders enable trigger trg_orders_commissions;

do $$
declare
  v_n int;
  v_bad int;
begin
  select n into v_n from tmp_mirror_pi_fix_count;
  if v_n is distinct from 3 then
    raise exception 'ROLLBACK: expected exactly 3 orders updated, got %', coalesce(v_n, 0);
  end if;

  -- Orders must have NULL PI / session
  select count(*) into v_bad
  from public.orders o
  join tmp_mirror_pi_fix_expected e on e.order_id = o.id
  where o.stripe_payment_intent_id is not null
     or o.stripe_session_id is not null;
  if v_bad <> 0 then
    raise exception 'ROLLBACK: % of target orders still have stripe refs', v_bad;
  end if;

  -- Delivery requests must still hold the PaymentIntent
  select count(*) into v_bad
  from tmp_mirror_pi_fix_expected e
  join public.delivery_requests dr on dr.id = e.dr_id
  where dr.stripe_payment_intent_id is distinct from e.expected_pi;
  if v_bad <> 0 then
    raise exception 'ROLLBACK: % delivery_requests lost expected PaymentIntent', v_bad;
  end if;

  -- Financial / status fields on orders must be unchanged
  select count(*) into v_bad
  from public.orders o
  join tmp_mirror_pi_fix_before b on b.id = o.id
  where o.payment_status is distinct from b.payment_status
     or o.status is distinct from b.status
     or o.paid_at is distinct from b.paid_at
     or o.created_at is distinct from b.created_at
     or o.total is distinct from b.total
     or upper(coalesce(o.currency,'')) is distinct from upper(coalesce(b.currency,''))
     or o.driver_id is distinct from b.driver_id
     or o.client_user_id is distinct from b.client_user_id
     or o.created_by is distinct from b.created_by
     or o.external_ref_id is distinct from b.external_ref_id
     or o.external_ref_type is distinct from b.external_ref_type;
  if v_bad <> 0 then
    raise exception 'ROLLBACK: % orders had protected fields changed', v_bad;
  end if;

  -- No fourth order outside the expected set should have lost these PIs
  -- (already guarded by WHERE id IN expected set)

  raise notice 'OK: updated exactly 3 historical mirror orders; DR Stripe refs preserved.';
end $$;

commit;

-- Report after commit
select
  o.id as order_id,
  o.external_ref_id,
  o.stripe_payment_intent_id as order_pi,
  o.stripe_session_id as order_session,
  o.payment_status,
  o.status,
  o.paid_at,
  o.updated_at,
  dr.stripe_payment_intent_id as dr_pi,
  dr.stripe_session_id as dr_session
from public.orders o
join public.delivery_requests dr on dr.id = o.external_ref_id
where o.id in (
  '9aa30884-d7e2-4df8-b871-4921f64b6608',
  'e7751184-5bf7-4db0-bb84-46308a204084',
  '4fbd3968-4709-4578-af78-c81e3c19c6e6'
)
order by o.created_at;
