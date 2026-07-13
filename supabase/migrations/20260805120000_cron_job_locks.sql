-- Cron job locks for concurrent runner protection (advisory + named rows).
-- Timestamp is migration order after 20260804120000 (not civil date).

begin;

create table if not exists public.cron_job_locks (
  job_name text primary key,
  locked_by text null,
  locked_at timestamptz null,
  locked_until timestamptz null,
  last_success_at timestamptz null,
  last_error text null,
  updated_at timestamptz not null default now()
);

comment on table public.cron_job_locks is
  'Named leases for production cron runners. Stale locks expire via locked_until.';

alter table public.cron_job_locks enable row level security;

drop policy if exists cron_job_locks_service_all on public.cron_job_locks;
create policy cron_job_locks_service_all
  on public.cron_job_locks
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.cron_job_locks from public, anon, authenticated;
grant select, insert, update, delete on table public.cron_job_locks to service_role;

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
begin
  if p_job_name is null or btrim(p_job_name) = '' then
    return jsonb_build_object('ok', false, 'error', 'job_name_required');
  end if;

  insert into public.cron_job_locks (job_name, locked_by, locked_at, locked_until, updated_at)
  values (btrim(p_job_name), nullif(btrim(coalesce(p_locked_by, '')), ''), v_now, v_until, v_now)
  on conflict (job_name) do nothing;

  select * into v_row
  from public.cron_job_locks
  where job_name = btrim(p_job_name)
  for update;

  if v_row.locked_until is not null
     and v_row.locked_until > v_now
     and coalesce(v_row.locked_by, '') is distinct from coalesce(nullif(btrim(coalesce(p_locked_by, '')), ''), '')
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
    locked_by = nullif(btrim(coalesce(p_locked_by, '')), ''),
    locked_at = v_now,
    locked_until = v_until,
    updated_at = v_now
  where job_name = btrim(p_job_name);

  return jsonb_build_object(
    'ok', true,
    'job_name', btrim(p_job_name),
    'locked_by', nullif(btrim(coalesce(p_locked_by, '')), ''),
    'locked_until', v_until
  );
end;
$$;

create or replace function public.release_cron_job_lock(
  p_job_name text,
  p_locked_by text,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_owner text := nullif(btrim(coalesce(p_locked_by, '')), '');
  v_updated integer := 0;
begin
  update public.cron_job_locks
  set
    locked_by = null,
    locked_at = null,
    locked_until = null,
    last_success_at = case when p_error is null then v_now else last_success_at end,
    last_error = nullif(btrim(coalesce(p_error, '')), ''),
    updated_at = v_now
  where job_name = btrim(p_job_name)
    and (
      locked_by is null
      or locked_by = v_owner
      or locked_until is null
      or locked_until <= v_now
    );

  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'ok', v_updated > 0,
    'released', v_updated > 0,
    'job_name', btrim(p_job_name)
  );
end;
$$;

revoke all on function public.try_acquire_cron_job_lock(text, text, integer) from public;
revoke all on function public.try_acquire_cron_job_lock(text, text, integer) from anon, authenticated;
grant execute on function public.try_acquire_cron_job_lock(text, text, integer) to service_role;

revoke all on function public.release_cron_job_lock(text, text, text) from public;
revoke all on function public.release_cron_job_lock(text, text, text) from anon, authenticated;
grant execute on function public.release_cron_job_lock(text, text, text) to service_role;

commit;
