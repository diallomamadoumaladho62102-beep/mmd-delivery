-- Observability / disk hygiene before any compute upgrade.
--
-- Findings (prod sjmszohmhudayxawfows, 2026-08-05):
--   - cron.job_run_details ≈ 25 MB / ~100k rows (~34% of 73 MB DB)
--   - ~99% of those rows from mmd-dispatch-fallback-every-minute (* * * * *)
--   - Duplicate weekly payout schedules (jobids 2 and 4, same command/schedule)
--
-- Safe retention (operational history only; no business ledger rows):
--   cron.job_run_details     > 7 days
--   auth.audit_log_entries   > 30 days
--   notification_logs        archived > 30 days, or any > 90 days
--   road_safety_events       expired (expires_at < now), or inactive > 90 days

begin;

create or replace function public.mmd_purge_observability_retention()
returns jsonb
language plpgsql
security definer
set search_path = public, cron, auth
as $$
declare
  v_cron_deleted bigint := 0;
  v_auth_deleted bigint := 0;
  v_notif_deleted bigint := 0;
  v_road_deleted bigint := 0;
begin
  -- pg_cron history (official recommendation: keep ~7 days).
  if to_regclass('cron.job_run_details') is not null then
    delete from cron.job_run_details
    where end_time < now() - interval '7 days';
    get diagnostics v_cron_deleted = row_count;
  end if;

  -- GoTrue audit trail — keep one month for security review.
  if to_regclass('auth.audit_log_entries') is not null then
    delete from auth.audit_log_entries
    where created_at < now() - interval '30 days';
    get diagnostics v_auth_deleted = row_count;
  end if;

  -- Inbox / push audit. Keep recent unread; drop old archived + absolute age.
  if to_regclass('public.notification_logs') is not null then
    delete from public.notification_logs
    where
      (archived_at is not null and archived_at < now() - interval '30 days')
      or created_at < now() - interval '90 days';
    get diagnostics v_notif_deleted = row_count;
  end if;

  -- Provider cache / inactive road-safety points (manual active rows kept).
  if to_regclass('public.road_safety_events') is not null then
    delete from public.road_safety_events
    where
      (expires_at is not null and expires_at < now())
      or (is_active = false and updated_at < now() - interval '90 days');
    get diagnostics v_road_deleted = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'purged_at', now(),
    'cron_job_run_details', v_cron_deleted,
    'auth_audit_log_entries', v_auth_deleted,
    'notification_logs', v_notif_deleted,
    'road_safety_events', v_road_deleted
  );
end;
$$;

revoke all on function public.mmd_purge_observability_retention() from public, anon, authenticated;
grant execute on function public.mmd_purge_observability_retention() to service_role;

-- One-shot cleanup at deploy time.
do $$
declare
  v_result jsonb;
begin
  v_result := public.mmd_purge_observability_retention();
  raise notice 'mmd_purge_observability_retention: %', v_result;
end;
$$;

-- Daily retention job (idempotent schedule by name).
do $$
declare
  r record;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron unavailable — retention schedule skipped';
    return;
  end if;

  for r in
    select jobid from cron.job where jobname = 'mmd-observability-retention-daily'
  loop
    perform cron.unschedule(r.jobid);
  end loop;

  perform cron.schedule(
    'mmd-observability-retention-daily',
    '10 6 * * *',
    $cron$select public.mmd_purge_observability_retention()$cron$
  );
exception
  when others then
    raise notice 'retention schedule error: %', SQLERRM;
end;
$$;

-- Remove duplicate weekly payout cron (same command + schedule as job 2).
-- Keep the older jobname weekly_driver_payouts; drop weekly_driver_payouts_create.
do $$
declare
  r record;
begin
  if to_regclass('cron.job') is null then
    return;
  end if;

  for r in
    select jobid
    from cron.job
    where jobname = 'weekly_driver_payouts_create'
  loop
    perform cron.unschedule(r.jobid);
    raise notice 'unscheduled duplicate cron job weekly_driver_payouts_create (jobid=%)', r.jobid;
  end loop;
exception
  when others then
    raise notice 'duplicate payout unschedule skipped: %', SQLERRM;
end;
$$;

commit;
