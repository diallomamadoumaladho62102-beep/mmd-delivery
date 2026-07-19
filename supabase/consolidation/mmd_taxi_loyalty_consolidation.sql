-- ===========================================================================
-- MMD Loyalty — legacy taxi_loyalty_* -> unified consolidation (MANUAL)
-- ---------------------------------------------------------------------------
-- This file is INTENTIONALLY NOT under supabase/migrations/ so it is NOT run
-- automatically. Run it ONCE, manually, on a controlled environment, only AFTER:
--   1. the unified program migrations are applied and validated in Preview, and
--   2. you have confirmed that legacy `taxi_loyalty_accounts` actually holds
--      production balances worth migrating (otherwise skip entirely).
--
-- What it does (safe, idempotent, non-destructive):
--   * For each legacy account with a positive points_balance whose user also
--     exists in `profiles` (unified FK target), it grants the SAME number of
--     points into the unified program via mmd_loyalty_accrue(), using a stable
--     idempotency_key so re-running does nothing.
--   * It does NOT delete or modify any legacy row. Legacy balances remain
--     redeemable until you formally retire the legacy tables in a later,
--     separately reviewed step.
--
-- After migrating points you may choose to zero the legacy balances in the same
-- controlled step; that is left commented out on purpose.
-- ===========================================================================

begin;

do $$
declare
  v_row record;
  v_migrated integer := 0;
begin
  for v_row in
    select a.user_id, a.points_balance
    from public.taxi_loyalty_accounts a
    join public.profiles p on p.id = a.user_id
    where a.points_balance > 0
  loop
    perform public.mmd_loyalty_accrue(
      v_row.user_id,
      v_row.points_balance,
      'admin_adjust',
      'admin',
      'legacy_taxi_loyalty',
      'consolidate:taxi_loyalty:' || v_row.user_id::text,
      'Consolidation solde fidélité taxi (ancien système)',
      null,
      jsonb_build_object('source', 'taxi_loyalty_accounts', 'legacy_points', v_row.points_balance)
    );
    v_migrated := v_migrated + 1;
  end loop;

  raise notice 'Consolidated % legacy taxi loyalty balances into the unified program', v_migrated;

  -- OPTIONAL (leave commented until explicitly approved): zero legacy balances
  -- so users cannot double-benefit from both systems after consolidation.
  -- update public.taxi_loyalty_accounts set points_balance = 0, updated_at = now()
  -- where points_balance > 0
  --   and user_id in (select id from public.profiles);
end
$$;

-- Review the NOTICE output, then COMMIT manually if satisfied. Default = safe.
rollback;
