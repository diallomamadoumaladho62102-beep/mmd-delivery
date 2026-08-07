-- Pre-launch controlled cleanup (no real production accounts).
--
-- SAFE deletes only:
--   - orphan profiles without auth.users (QA vehicle RLS debris + empty restaurant husk)
--   - all verified zero orders / addresses / tokens / seller links before delete
--
-- NOT deleted (documented for Founder decision):
--   - +cert-* staff certification admins (still useful for role smoke)
--   - *@mmd.test e2e clients (may hold certification trip history)
--
-- Also extends observability retention to additional technical journals.

begin;

-- ---------------------------------------------------------------------------
-- 1) Extend retention policy
-- ---------------------------------------------------------------------------
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
  v_stripe_deleted bigint := 0;
  v_ai_deleted bigint := 0;
  v_calls_deleted bigint := 0;
begin
  if to_regclass('cron.job_run_details') is not null then
    delete from cron.job_run_details
    where end_time < now() - interval '7 days';
    get diagnostics v_cron_deleted = row_count;
  end if;

  if to_regclass('auth.audit_log_entries') is not null then
    delete from auth.audit_log_entries
    where created_at < now() - interval '30 days';
    get diagnostics v_auth_deleted = row_count;
  end if;

  if to_regclass('public.notification_logs') is not null then
    delete from public.notification_logs
    where
      (archived_at is not null and archived_at < now() - interval '30 days')
      or created_at < now() - interval '90 days';
    get diagnostics v_notif_deleted = row_count;
  end if;

  if to_regclass('public.road_safety_events') is not null then
    delete from public.road_safety_events
    where
      (expires_at is not null and expires_at < now())
      or (is_active = false and updated_at < now() - interval '90 days');
    get diagnostics v_road_deleted = row_count;
  end if;

  -- Processed Stripe webhook receipts (idempotency keys older than 90d).
  -- NOTE: location_points are user saved places — never auto-purged here.
  if to_regclass('public.stripe_webhook_events') is not null then
    delete from public.stripe_webhook_events
    where received_at < now() - interval '90 days';
    get diagnostics v_stripe_deleted = row_count;
  end if;

  if to_regclass('public.ai_events') is not null then
    delete from public.ai_events
    where created_at < now() - interval '90 days';
    get diagnostics v_ai_deleted = row_count;
  end if;

  if to_regclass('public.call_sessions') is not null then
    delete from public.call_sessions
    where coalesce(ended_at, created_at) < now() - interval '90 days';
    get diagnostics v_calls_deleted = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'purged_at', now(),
    'cron_job_run_details', v_cron_deleted,
    'auth_audit_log_entries', v_auth_deleted,
    'notification_logs', v_notif_deleted,
    'road_safety_events', v_road_deleted,
    'stripe_webhook_events', v_stripe_deleted,
    'ai_events', v_ai_deleted,
    'call_sessions', v_calls_deleted
  );
end;
$$;

revoke all on function public.mmd_purge_observability_retention() from public, anon, authenticated;
grant execute on function public.mmd_purge_observability_retention() to service_role;

-- ---------------------------------------------------------------------------
-- 2) Delete clearly orphan QA / husk profiles (no auth.users row)
-- ---------------------------------------------------------------------------
do $$
declare
  v_ids uuid[] := array[
    '69e36e0f-f7bf-438c-a2f1-920496dfc702'::uuid, -- qa-vehicle-rls-…@example.com
    '13cf3386-1546-4b82-a5af-506f20e66de0'::uuid, -- qa-vehicle-rls-…@example.com
    '473a8e71-321a-4544-a9bd-ddb04307de69'::uuid, -- qa-vehicle-rls-…@example.com
    '306ef52d-aa3c-4475-a7f3-abe0f9f6817c'::uuid  -- restaurant husk, no email/auth/orders
  ];
  v_id uuid;
  v_has_auth boolean;
  v_orders bigint;
  v_deleted int := 0;
begin
  foreach v_id in array v_ids loop
    select exists(select 1 from auth.users u where u.id = v_id) into v_has_auth;
    if v_has_auth then
      raise notice 'skip % — auth.users still present', v_id;
      continue;
    end if;

    select count(*) into v_orders
    from public.orders o
    where o.client_id = v_id or o.driver_id = v_id;
    if v_orders > 0 then
      raise notice 'skip % — has orders', v_id;
      continue;
    end if;

    delete from public.profiles where id = v_id;
    if found then
      v_deleted := v_deleted + 1;
      raise notice 'deleted orphan profile %', v_id;
    end if;
  end loop;

  raise notice 'orphan_profile_cleanup_deleted=%', v_deleted;
end;
$$;

-- Run extended retention once at deploy.
do $$
declare
  v_result jsonb;
begin
  v_result := public.mmd_purge_observability_retention();
  raise notice 'mmd_purge_observability_retention: %', v_result;
end;
$$;

commit;
