-- =============================================================================
-- Payment integrity: one Stripe PaymentIntent == one paid resource.
-- =============================================================================
--
-- NOTE ON THIS FILE'S TIMESTAMP (20260804120000)
--   This repository currently uses FORWARD-DATED migration timestamps: at the
--   time of writing (civil date 2026-07-13) the newest existing migration was
--   `20260803120000_road_safety_events.sql`. `20260804120000` was chosen only
--   to stay strictly greater than that last identifier so this migration keeps
--   running LAST and never becomes out-of-order in environments where the
--   August migrations are already applied. The timestamp therefore represents
--   MIGRATION ORDER, not the real civil creation date.
--

-- Goal
--   Prevent the SAME stripe_payment_intent_id from settling more than one
--   order / seller_order / delivery_request / taxi_ride, by adding partial
--   UNIQUE indexes (WHERE stripe_payment_intent_id IS NOT NULL).
--
-- Safety contract (do NOT skip the pre-check)
--   * BEFORE running this migration, run the READ-ONLY audit:
--       docs/production/sql/payment_intent_integrity_audit.sql
--     and confirm SAFE_TO_APPLY_UNIQUE_CONSTRAINTS = true.
--   * This migration is defensive: it re-checks for in-table duplicate PIs and
--     FAILS LOUDLY with an explicit message rather than silently succeeding or
--     corrupting data. It never deletes, merges, or rewrites any row.
--   * It is idempotent where reasonable (add column if not exists,
--     create unique index if not exists).
--
-- Business model (verified in code 2026-07-13)
--   * orders / delivery_requests / taxi_rides : 1 PaymentIntent -> 1 row.
--   * seller_orders : each seller_order gets its OWN Stripe Checkout Session and
--     PaymentIntent (metadata.seller_order_id). A cart's sub-orders do NOT share
--     one parent PaymentIntent, so a seller_order-level unique index is correct.
--   * taxi_rides already carries taxi_rides_stripe_pi_uq (created in
--     20260609120000). This migration only adds the missing three.
--
-- ROLLBACK
--   Run, in a transaction:
--     drop index if exists public.orders_stripe_pi_uq;
--     drop index if exists public.seller_orders_stripe_pi_uq;
--     drop index if exists public.delivery_requests_stripe_pi_uq;
--   (Dropping these indexes fully reverts this migration. The
--    add-column-if-not-exists on delivery_requests is intentionally NOT rolled
--    back — dropping payment columns would destroy financial data.)
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0) delivery_requests Stripe columns.
--    The app (apps/web/app/api/stripe/mark-delivery-request-paid/route.ts and
--    the delivery webhook) already reads/writes these columns; several
--    environments have them only via out-of-band changes (schema drift). Add
--    them idempotently so the unique index below has a column to target.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.delivery_requests') is not null then
    alter table public.delivery_requests
      add column if not exists stripe_payment_intent_id text;
    alter table public.delivery_requests
      add column if not exists stripe_session_id text;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Defensive duplicate pre-check. Abort with a clear message if any target
--    table has the same non-null PI on more than one row. This protects
--    against applying the migration on data that was never audited.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_tbl text;
  v_dups bigint;
  v_offenders text := '';
  c_tables text[] := array['orders','seller_orders','delivery_requests'];
begin
  foreach v_tbl in array c_tables loop
    if to_regclass(format('public.%I', v_tbl)) is null then
      continue;
    end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = v_tbl
        and column_name = 'stripe_payment_intent_id'
    ) then
      continue;
    end if;

    execute format(
      'select count(*) from (
         select stripe_payment_intent_id
         from public.%I
         where stripe_payment_intent_id is not null
           and btrim(stripe_payment_intent_id) <> ''''
         group by stripe_payment_intent_id
         having count(*) > 1
       ) d',
      v_tbl
    ) into v_dups;

    if v_dups > 0 then
      v_offenders := v_offenders || format('%s (%s dup group(s)); ', v_tbl, v_dups);
    end if;
  end loop;

  if v_offenders <> '' then
    raise exception using
      errcode = 'raise_exception',
      message = format(
        'MMD payment integrity: duplicate stripe_payment_intent_id detected in: %s',
        v_offenders),
      hint = 'Run docs/production/sql/payment_intent_integrity_audit.sql, then resolve '
             'duplicates using docs/production/sql/payment_intent_integrity_repair_suggestions.sql '
             'BEFORE re-applying this migration. No data was modified.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Partial unique indexes (only enforced when a PI is present, so legacy
--    unpaid/NULL rows are never impacted). Idempotent.
-- ---------------------------------------------------------------------------
create unique index if not exists orders_stripe_pi_uq
  on public.orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create unique index if not exists seller_orders_stripe_pi_uq
  on public.seller_orders (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

do $$
begin
  if to_regclass('public.delivery_requests') is not null then
    create unique index if not exists delivery_requests_stripe_pi_uq
      on public.delivery_requests (stripe_payment_intent_id)
      where stripe_payment_intent_id is not null;
  end if;
end $$;

-- taxi_rides_stripe_pi_uq already exists (20260609120000). Re-assert idempotently.
create unique index if not exists taxi_rides_stripe_pi_uq
  on public.taxi_rides (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- ---------------------------------------------------------------------------
-- 3) RPC hardening: mark_taxi_ride_paid must be server/webhook only.
--    20260609120000 revoked it FROM public but — unlike mark_order_paid — never
--    explicitly revoked anon/authenticated. It is SECURITY DEFINER, so lock it
--    down to service_role for parity with the other payment RPCs. Idempotent.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'mark_taxi_ride_paid'
  ) then
    revoke all on function public.mark_taxi_ride_paid(uuid, text, text) from public;
    revoke all on function public.mark_taxi_ride_paid(uuid, text, text) from anon, authenticated;
    grant execute on function public.mark_taxi_ride_paid(uuid, text, text) to service_role;
  end if;
end $$;

commit;
