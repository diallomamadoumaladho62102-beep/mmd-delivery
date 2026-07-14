-- Non-blocking cron locks: avoid hung serverless transactions stalling FOR UPDATE.
-- Timestamp is migration order after 20260805130000 (not civil date).

begin;

create or replace function public.try_acquire_cron_job_lock(
  p_job_name text,
  p_locked_by text,
  p_ttl_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_ttl integer := greatest(coalesce(p_ttl_seconds, 300), 30);
  v_until timestamptz := v_now + make_interval(secs => v_ttl);
  v_row public.cron_job_locks%rowtype;
  v_locked_by text := nullif(btrim(coalesce(p_locked_by, '')), '');
begin
  if p_job_name is null or btrim(p_job_name) = '' then
    return jsonb_build_object('ok', false, 'error', 'job_name_required');
  end if;

  perform set_config('lock_timeout', '2000', true);

  insert into public.cron_job_locks (job_name, locked_by, locked_at, locked_until, updated_at)
  values (btrim(p_job_name), null, null, null, v_now)
  on conflict (job_name) do nothing;

  select * into v_row
  from public.cron_job_locks
  where job_name = btrim(p_job_name)
  for update skip locked;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'lock_busy',
      'message', 'row_locked_by_other_transaction'
    );
  end if;

  if v_row.locked_until is not null
     and v_row.locked_until > v_now
     and coalesce(v_row.locked_by, '') is distinct from coalesce(v_locked_by, '')
  then
    return jsonb_build_object(
      'ok', false,
      'error', 'lock_busy',
      'locked_by', v_row.locked_by,
      'locked_until', v_row.locked_until
    );
  end if;

  update public.cron_job_locks
  set
    locked_by = v_locked_by,
    locked_at = v_now,
    locked_until = v_until,
    updated_at = v_now
  where job_name = btrim(p_job_name);

  return jsonb_build_object(
    'ok', true,
    'job_name', btrim(p_job_name),
    'locked_by', v_locked_by,
    'locked_until', v_until
  );
exception
  when lock_not_available then
    return jsonb_build_object('ok', false, 'error', 'lock_busy', 'message', 'lock_timeout');
  when others then
    return jsonb_build_object(
      'ok', false,
      'error', 'lock_acquire_failed',
      'message', SQLERRM
    );
end;
$$;

revoke all on function public.try_acquire_cron_job_lock(text, text, integer) from public;
revoke all on function public.try_acquire_cron_job_lock(text, text, integer) from anon, authenticated;
grant execute on function public.try_acquire_cron_job_lock(text, text, integer) to service_role;

-- Clear any leases left behind by hung serverless runs.
update public.cron_job_locks
set
  locked_by = null,
  locked_at = null,
  locked_until = null,
  last_error = 'cleared_by_migration_20260805140000',
  updated_at = now()
where locked_until is not null;

commit;
