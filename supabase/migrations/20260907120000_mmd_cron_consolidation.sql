-- Consolidate DB-centric cron work onto pg_cron so Vercel Hobby only needs
-- 2 daily app/Stripe orchestrators (no hourly Vercel schedules).
-- Individual Next.js /api/cron/* routes remain for manual/ops invocation.

begin;

create extension if not exists pg_cron with schema extensions;

-- Impersonate service_role for auth.role() checks inside SECURITY DEFINER RPCs.
create or replace function public.mmd_cron_set_service_role()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end;
$$;

revoke all on function public.mmd_cron_set_service_role() from public, anon, authenticated;
grant execute on function public.mmd_cron_set_service_role() to service_role;

create or replace function public.mmd_cron_db_daily_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job text := 'db-daily-maintenance';
  v_by text := 'pg_cron:db-daily-maintenance';
  v_lock jsonb;
  v_out jsonb := '{}'::jsonb;
  v_tmp jsonb;
  v_i integer;
begin
  perform public.mmd_cron_set_service_role();

  v_lock := public.try_acquire_cron_job_lock(v_job, v_by, 900);
  if coalesce(v_lock->>'ok', '') is distinct from 'true' then
    return jsonb_build_object(
      'ok', true,
      'skipped', coalesce(v_lock->>'error', 'lock_busy'),
      'job', v_job
    );
  end if;

  begin
    -- Bounded multi-batch loops (same spirit as Next.js cron routes).
    for v_i in 1..20 loop
      v_tmp := public.mmd_credit_expire_due_batch(500);
      v_out := jsonb_set(v_out, '{loyalty}', coalesce(v_tmp, '{}'::jsonb));
      exit when coalesce((v_tmp->>'expired_lots')::int, 0) = 0
             or coalesce((v_tmp->>'remaining')::int, 0) = 0;
    end loop;

    for v_i in 1..10 loop
      v_tmp := public.mmd_restaurant_expire_due_batch(500);
      v_out := jsonb_set(v_out, '{restaurant_benefits}', coalesce(v_tmp, '{}'::jsonb));
      exit when coalesce((v_tmp->>'remaining_benefits')::int, 0) = 0;
    end loop;

    for v_i in 1..10 loop
      v_tmp := public.mmd_marketplace_expire_due_batch(500);
      v_out := jsonb_set(v_out, '{marketplace_benefits}', coalesce(v_tmp, '{}'::jsonb));
      exit when coalesce((v_tmp->>'remaining_benefits')::int, 0) = 0;
    end loop;

    v_tmp := public.mmd_commission_expire_due_batch(500);
    v_out := jsonb_set(v_out, '{commission}', coalesce(v_tmp, '{}'::jsonb));

    v_tmp := public.mmd_subscription_expire_due_batch(500);
    v_out := jsonb_set(v_out, '{subscriptions}', coalesce(v_tmp, '{}'::jsonb));

    begin
      perform public.refresh_taxi_monitoring_snapshot();
      v_out := jsonb_set(v_out, '{taxi_monitoring}', '{"ok":true}'::jsonb);
    exception when others then
      v_out := jsonb_set(
        v_out,
        '{taxi_monitoring}',
        jsonb_build_object('ok', false, 'error', SQLERRM)
      );
    end;

    perform public.release_cron_job_lock(v_job, v_by, null);
    return jsonb_build_object('ok', true, 'job', v_job, 'results', v_out);
  exception when others then
    perform public.release_cron_job_lock(v_job, v_by, SQLERRM);
    return jsonb_build_object('ok', false, 'job', v_job, 'error', SQLERRM, 'partial', v_out);
  end;
end;
$$;

create or replace function public.mmd_cron_finance_hourly()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job text := 'finance-hourly';
  v_by text := 'pg_cron:finance-hourly';
  v_lock jsonb;
  v_process jsonb := '{}'::jsonb;
  v_balances jsonb := '{}'::jsonb;
  v_recognize jsonb := '{}'::jsonb;
  v_as_of date := (timezone('utc', now()))::date;
  v_i integer;
begin
  perform public.mmd_cron_set_service_role();

  v_lock := public.try_acquire_cron_job_lock(v_job, v_by, 500);
  if coalesce(v_lock->>'ok', '') is distinct from 'true' then
    return jsonb_build_object(
      'ok', true,
      'skipped', coalesce(v_lock->>'error', 'lock_busy'),
      'job', v_job
    );
  end if;

  begin
    for v_i in 1..8 loop
      v_process := public.mmd_finance_process_pending_batch(200);
      exit when coalesce((v_process->>'scanned')::int, 0) = 0
             or coalesce((v_process->>'next_cursor')::boolean, false) is not true;
    end loop;

    begin
      v_balances := public.mmd_finance_refresh_balances(v_as_of);
    exception when others then
      v_balances := jsonb_build_object('ok', false, 'error', SQLERRM);
    end;

    if to_regclass('public.finance_report_exports') is not null then
      update public.finance_report_exports
      set status = 'expired'
      where status = 'ready'
        and expires_at is not null
        and expires_at < timezone('utc', now());
    end if;

    begin
      v_recognize := public.mmd_finance_recognize_revenue_batch(v_as_of, 200);
    exception when others then
      v_recognize := jsonb_build_object('ok', false, 'error', SQLERRM);
    end;

    perform public.release_cron_job_lock(v_job, v_by, null);
    return jsonb_build_object(
      'ok', true,
      'job', v_job,
      'process', v_process,
      'balances', v_balances,
      'recognize', v_recognize,
      'as_of', v_as_of
    );
  exception when others then
    perform public.release_cron_job_lock(v_job, v_by, SQLERRM);
    return jsonb_build_object('ok', false, 'job', v_job, 'error', SQLERRM);
  end;
end;
$$;

create or replace function public.mmd_cron_analytics_hourly()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job text := 'analytics-hourly';
  v_by text := 'pg_cron:analytics-hourly';
  v_lock jsonb;
  v_today date := (timezone('utc', now()))::date;
  v_yesterday date := v_today - 1;
  v_a jsonb;
  v_b jsonb;
begin
  perform public.mmd_cron_set_service_role();

  v_lock := public.try_acquire_cron_job_lock(v_job, v_by, 400);
  if coalesce(v_lock->>'ok', '') is distinct from 'true' then
    return jsonb_build_object(
      'ok', true,
      'skipped', coalesce(v_lock->>'error', 'lock_busy'),
      'job', v_job
    );
  end if;

  begin
    v_a := public.mmd_analytics_refresh_daily(v_yesterday, null);
    v_b := public.mmd_analytics_refresh_daily(v_today, null);
    perform public.release_cron_job_lock(v_job, v_by, null);
    return jsonb_build_object(
      'ok', true,
      'job', v_job,
      'yesterday', v_a,
      'today', v_b
    );
  exception when others then
    perform public.release_cron_job_lock(v_job, v_by, SQLERRM);
    return jsonb_build_object('ok', false, 'job', v_job, 'error', SQLERRM);
  end;
end;
$$;

revoke all on function public.mmd_cron_db_daily_maintenance() from public, anon, authenticated;
revoke all on function public.mmd_cron_finance_hourly() from public, anon, authenticated;
revoke all on function public.mmd_cron_analytics_hourly() from public, anon, authenticated;
grant execute on function public.mmd_cron_db_daily_maintenance() to service_role;
grant execute on function public.mmd_cron_finance_hourly() to service_role;
grant execute on function public.mmd_cron_analytics_hourly() to service_role;

-- Schedules (idempotent by job name)
do $$
declare
  r record;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron cron.job missing — schedules skipped';
    return;
  end if;

  for r in
    select jobid
    from cron.job
    where jobname in (
      'mmd-db-daily-maintenance',
      'mmd-finance-hourly',
      'mmd-analytics-hourly'
    )
  loop
    perform cron.unschedule(r.jobid);
  end loop;

  perform cron.schedule(
    'mmd-db-daily-maintenance',
    '20 5 * * *',
    $cron$select public.mmd_cron_db_daily_maintenance()$cron$
  );

  perform cron.schedule(
    'mmd-finance-hourly',
    '25 * * * *',
    $cron$select public.mmd_cron_finance_hourly()$cron$
  );

  perform cron.schedule(
    'mmd-analytics-hourly',
    '15 * * * *',
    $cron$select public.mmd_cron_analytics_hourly()$cron$
  );
exception
  when undefined_table then
    raise notice 'pg_cron unavailable — schedules skipped';
  when undefined_function then
    raise notice 'cron.schedule unavailable — schedules skipped';
  when others then
    raise notice 'pg_cron schedule error: %', SQLERRM;
end;
$$;

commit;
