-- =============================================================================
-- Payment Intent Integrity — PRODUCTION PRE-VERIFICATION AUDIT (READ ONLY)
-- =============================================================================
--
-- Purpose
--   Detect whether it is safe to add partial UNIQUE indexes on
--   `stripe_payment_intent_id` (one PaymentIntent == one paid resource) for the
--   payment-bearing tables, BEFORE applying migration
--   `20260804120000_payment_intent_uniqueness.sql`.
--
-- Guarantees
--   * STRICTLY READ ONLY. It performs only SELECT / aggregation.
--   * No table, row, index, grant or setting is created or modified.
--   * Drift-safe: every table/column reference is guarded via
--     information_schema, so the script never aborts if a column is missing
--     (e.g. delivery_requests may not yet have the Stripe columns).
--
-- How to run
--   Paste the whole file into the Supabase SQL editor (or psql) and execute.
--   Read the output in the "Messages" / NOTICE panel. The final block prints:
--       SAFE_TO_APPLY_UNIQUE_CONSTRAINTS = true | false
--   plus, per table, which unique index can be created and what must be fixed
--   first.
--
-- Business model reminder (verified in code, 2026-07-13)
--   * orders                : 1 PaymentIntent -> 1 order          (unique OK)
--   * taxi_rides            : 1 PaymentIntent -> 1 ride           (unique ALREADY exists:
--                                                                   taxi_rides_stripe_pi_uq)
--   * seller_orders         : 1 checkout session / PI -> 1 seller_order
--                             (metadata.seller_order_id; NOT shared across a cart) -> unique OK
--   * delivery_requests     : 1 PaymentIntent -> 1 delivery request (unique OK)
--   A single PaymentIntent must NEVER be shared across two rows of the same
--   table, nor across two different service tables, nor across two users.
-- =============================================================================

do $$
declare
  -- (table, pi column, payment_status col, status col, created col, refund col, user col candidates)
  rec record;
  v_tbl text;
  v_pi_col text := 'stripe_payment_intent_id';
  v_has_tbl boolean;
  v_has_pi boolean;
  v_status_col text;
  v_paystatus_col text;
  v_created_col text;
  v_refund_col text;
  v_user_col text;
  v_total bigint;
  v_with_pi bigint;
  v_distinct_pi bigint;
  v_dup_groups bigint;
  v_dup_rows bigint;
  v_malformed bigint;
  v_paid_no_pi bigint;
  v_pi_on_terminal bigint;
  v_multi_user bigint;
  v_sample text;
  v_sql text;
  v_safe boolean := true;
  v_report text := '';
  v_line text;

  -- candidate columns we opportunistically use if present
  c_status_candidates text[] := array['status'];
  c_paystatus_candidates text[] := array['payment_status'];
  c_created_candidates text[] := array['created_at','inserted_at','created'];
  c_refund_candidates text[] := array['refund_status','refunded_at'];
  c_user_candidates text[] := array['user_id','client_user_id','created_by','rider_id','customer_id'];

  -- tables to inspect
  c_tables text[] := array['orders','seller_orders','taxi_rides','delivery_requests'];
begin
  raise notice '==================================================================';
  raise notice 'PAYMENT INTENT INTEGRITY AUDIT (read only) @ %', now();
  raise notice '==================================================================';

  foreach v_tbl in array c_tables loop
    v_has_tbl := to_regclass(format('public.%I', v_tbl)) is not null;
    if not v_has_tbl then
      raise notice '';
      raise notice '[%] table ABSENT — skipped.', v_tbl;
      continue;
    end if;

    select exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=v_tbl and column_name=v_pi_col
    ) into v_has_pi;

    raise notice '';
    raise notice '------------------------------------------------------------------';
    raise notice 'TABLE: public.% ', v_tbl;
    raise notice '------------------------------------------------------------------';

    if not v_has_pi then
      raise notice '  stripe_payment_intent_id column: ABSENT.';
      raise notice '  -> migration will ADD it (add column if not exists) then the';
      raise notice '     partial unique index will be creatable on an empty column.';
      continue;
    end if;

    -- resolve optional companion columns (first present wins)
    v_status_col := null; v_paystatus_col := null; v_created_col := null;
    v_refund_col := null; v_user_col := null;

    select c.column_name into v_paystatus_col from information_schema.columns c
      where c.table_schema='public' and c.table_name=v_tbl
        and c.column_name = any(c_paystatus_candidates) limit 1;
    select c.column_name into v_status_col from information_schema.columns c
      where c.table_schema='public' and c.table_name=v_tbl
        and c.column_name = any(c_status_candidates) limit 1;
    select c.column_name into v_created_col from information_schema.columns c
      where c.table_schema='public' and c.table_name=v_tbl
        and c.column_name = any(c_created_candidates) limit 1;
    select c.column_name into v_refund_col from information_schema.columns c
      where c.table_schema='public' and c.table_name=v_tbl
        and c.column_name = any(c_refund_candidates) limit 1;
    select c.column_name into v_user_col from information_schema.columns c
      where c.table_schema='public' and c.table_name=v_tbl
        and c.column_name = any(c_user_candidates) limit 1;

    -- totals
    execute format('select count(*) from public.%I', v_tbl) into v_total;
    execute format(
      'select count(*) from public.%I where %I is not null and btrim(%I) <> ''''',
      v_tbl, v_pi_col, v_pi_col
    ) into v_with_pi;
    execute format(
      'select count(distinct %I) from public.%I where %I is not null and btrim(%I) <> ''''',
      v_pi_col, v_tbl, v_pi_col, v_pi_col
    ) into v_distinct_pi;

    -- duplicate groups (same PI on >1 rows of THIS table) — blocks unique index
    execute format(
      'select count(*), coalesce(sum(c),0) from (
         select %I as pi, count(*) c from public.%I
         where %I is not null and btrim(%I) <> ''''
         group by %I having count(*) > 1
       ) d',
      v_pi_col, v_tbl, v_pi_col, v_pi_col, v_pi_col
    ) into v_dup_groups, v_dup_rows;

    -- sample of duplicate PIs (masked: only last 6 chars) + row ids
    v_sample := null;
    if v_dup_groups > 0 then
      execute format(
        'select string_agg(''…'' || right(pi,6) || '' x'' || c::text, ''  |  '')
           from (
             select %I as pi, count(*) c from public.%I
             where %I is not null and btrim(%I) <> ''''
             group by %I having count(*) > 1
             order by c desc limit 15
           ) d',
        v_pi_col, v_tbl, v_pi_col, v_pi_col, v_pi_col
      ) into v_sample;
    end if;

    -- malformed PI values (not shaped like pi_...)
    execute format(
      'select count(*) from public.%I where %I is not null and btrim(%I) <> '''' and %I not like ''pi\_%%'' escape ''\''',
      v_tbl, v_pi_col, v_pi_col, v_pi_col
    ) into v_malformed;

    -- paid rows WITHOUT a PaymentIntent
    v_paid_no_pi := 0;
    if v_paystatus_col is not null then
      execute format(
        'select count(*) from public.%I where lower(coalesce(%I,'''')) = ''paid'' and (%I is null or btrim(%I) = '''')',
        v_tbl, v_paystatus_col, v_pi_col, v_pi_col
      ) into v_paid_no_pi;
    end if;

    -- PI present on terminal / refunded rows
    v_pi_on_terminal := 0;
    if v_status_col is not null then
      execute format(
        'select count(*) from public.%I where %I is not null and btrim(%I) <> '''' and lower(coalesce(%I,'''')) in (''cancelled'',''canceled'',''expired'',''refunded'',''payment_failed'')',
        v_tbl, v_pi_col, v_pi_col, v_status_col
      ) into v_pi_on_terminal;
    end if;
    if v_refund_col is not null then
      execute format(
        'select %s + count(*) from public.%I where %I is not null and btrim(%I) <> '''' and %I is not null',
        v_pi_on_terminal, v_tbl, v_pi_col, v_pi_col, v_refund_col
      ) into v_pi_on_terminal;
    end if;

    -- same PI referenced by more than one distinct user (within this table)
    v_multi_user := 0;
    if v_user_col is not null then
      execute format(
        'select count(*) from (
           select %I as pi from public.%I
           where %I is not null and btrim(%I) <> ''''
           group by %I having count(distinct %I) > 1
         ) d',
        v_pi_col, v_tbl, v_pi_col, v_pi_col, v_pi_col, v_user_col
      ) into v_multi_user;
    end if;

    raise notice '  rows total ................. %', v_total;
    raise notice '  rows with PI ............... %', v_with_pi;
    raise notice '  distinct PI ................ %', v_distinct_pi;
    raise notice '  DUPLICATE PI groups ........ %  (rows involved: %)', v_dup_groups, v_dup_rows;
    if v_sample is not null then
      raise notice '    dup samples (…last6 x count): %', v_sample;
    end if;
    raise notice '  malformed PI (not pi_*) .... %', v_malformed;
    raise notice '  PAID rows without PI ....... %  %', v_paid_no_pi,
      case when v_paystatus_col is null then '(no payment_status col)' else '' end;
    raise notice '  PI on terminal/refunded .... %', v_pi_on_terminal;
    raise notice '  PI shared by >1 user ....... %  %', v_multi_user,
      case when v_user_col is null then '(no user col detected)' else '' end;

    if v_dup_groups > 0 then
      v_safe := false;
      v_report := v_report || format(
        E'\n  [%s] BLOCKED: %s duplicate PI group(s) -> unique index will fail. Resolve first.',
        v_tbl, v_dup_groups);
    elsif v_multi_user > 0 then
      v_safe := false;
      v_report := v_report || format(
        E'\n  [%s] BLOCKED: PI shared across users -> investigate before unique index.',
        v_tbl);
    else
      v_report := v_report || format(
        E'\n  [%s] OK: no in-table PI duplicates. Partial unique index is safe.',
        v_tbl);
    end if;
  end loop;

  -- ---------------------------------------------------------------------------
  -- CROSS-TABLE: same PaymentIntent used by more than one service table
  -- ---------------------------------------------------------------------------
  raise notice '';
  raise notice '------------------------------------------------------------------';
  raise notice 'CROSS-TABLE PaymentIntent collisions';
  raise notice '------------------------------------------------------------------';

  v_sql := '';
  foreach v_tbl in array c_tables loop
    if to_regclass(format('public.%I', v_tbl)) is null then continue; end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=v_tbl and column_name=v_pi_col
    ) then continue; end if;
    if v_sql <> '' then v_sql := v_sql || ' union all '; end if;
    v_sql := v_sql || format(
      'select %L::text as svc, %I as pi from public.%I where %I is not null and btrim(%I) <> ''''',
      v_tbl, v_pi_col, v_tbl, v_pi_col, v_pi_col);
  end loop;

  if v_sql = '' then
    raise notice '  no PI-bearing tables present — skipped.';
    v_dup_groups := 0;
  else
    execute format(
      'select count(*), string_agg(''…'' || right(pi,6) || '' ['' || svcs || '']'', ''  |  '')
         from (
           select pi, count(distinct svc) n, string_agg(distinct svc, '','') svcs
           from ( %s ) u
           group by pi having count(distinct svc) > 1
           limit 25
         ) x',
      v_sql
    ) into v_dup_groups, v_sample;
    raise notice '  PIs used by >1 table ....... %', v_dup_groups;
    if v_dup_groups > 0 then
      v_safe := false;
      raise notice '    collisions: %', v_sample;
      v_report := v_report || format(
        E'\n  [cross-table] BLOCKED: %s PaymentIntent(s) shared across services. Must be resolved.',
        v_dup_groups);
    else
      v_report := v_report || E'\n  [cross-table] OK: no PaymentIntent shared across service tables.';
    end if;
  end if;

  -- ---------------------------------------------------------------------------
  -- FINAL VERDICT
  -- ---------------------------------------------------------------------------
  raise notice '';
  raise notice '==================================================================';
  raise notice 'SUMMARY';
  raise notice '==================================================================';
  raise notice '%', v_report;
  raise notice '';
  raise notice 'SAFE_TO_APPLY_UNIQUE_CONSTRAINTS = %', v_safe;
  raise notice '';
  if v_safe then
    raise notice 'You may apply supabase/migrations/20260804120000_payment_intent_uniqueness.sql.';
    raise notice 'It will create partial unique indexes on:';
    raise notice '  - public.orders (stripe_payment_intent_id) WHERE not null';
    raise notice '  - public.seller_orders (stripe_payment_intent_id) WHERE not null';
    raise notice '  - public.delivery_requests (stripe_payment_intent_id) WHERE not null';
    raise notice '  (taxi_rides already has taxi_rides_stripe_pi_uq)';
  else
    raise notice 'DO NOT apply the unique-index migration yet. Resolve the BLOCKED items';
    raise notice 'above using the reviewed statements in';
    raise notice '  docs/production/sql/payment_intent_integrity_repair_suggestions.sql';
    raise notice '(those are proposals to run MANUALLY after review — never automatically).';
  end if;
  raise notice '==================================================================';
end $$;
