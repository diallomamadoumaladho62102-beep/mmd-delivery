-- Smoke: consolidated pg_cron wrappers exist and are callable under service_role claim.
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

do $$
declare
  v jsonb;
begin
  if to_regprocedure('public.mmd_cron_db_daily_maintenance()') is null then
    raise exception 'missing mmd_cron_db_daily_maintenance';
  end if;
  if to_regprocedure('public.mmd_cron_finance_hourly()') is null then
    raise exception 'missing mmd_cron_finance_hourly';
  end if;
  if to_regprocedure('public.mmd_cron_analytics_hourly()') is null then
    raise exception 'missing mmd_cron_analytics_hourly';
  end if;

  v := public.mmd_cron_db_daily_maintenance();
  if coalesce((v->>'ok')::boolean, false) is not true
     and coalesce(v->>'skipped', '') = '' then
    raise exception 'db daily maintenance failed: %', v;
  end if;

  v := public.mmd_cron_finance_hourly();
  if coalesce((v->>'ok')::boolean, false) is not true
     and coalesce(v->>'skipped', '') = '' then
    raise exception 'finance hourly failed: %', v;
  end if;

  v := public.mmd_cron_analytics_hourly();
  if coalesce((v->>'ok')::boolean, false) is not true
     and coalesce(v->>'skipped', '') = '' then
    raise exception 'analytics hourly failed: %', v;
  end if;

  raise notice 'PASS mmd_cron_consolidation';
end;
$$;

rollback;
