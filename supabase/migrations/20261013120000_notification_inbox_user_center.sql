-- Notification inbox: user-facing read/archive on notification_logs
-- Prefer SECURITY DEFINER RPCs so clients never need broad UPDATE on the table.

begin;

alter table public.notification_logs
  add column if not exists read_at timestamptz;

alter table public.notification_logs
  add column if not exists archived_at timestamptz;

create index if not exists notification_logs_user_inbox_idx
  on public.notification_logs (user_id, created_at desc)
  where archived_at is null;

create index if not exists notification_logs_user_unread_idx
  on public.notification_logs (user_id, created_at desc)
  where archived_at is null and read_at is null;

-- Own-row SELECT for authenticated users (staff policy remains)
drop policy if exists notification_logs_owner_select on public.notification_logs;
create policy notification_logs_owner_select
  on public.notification_logs
  for select
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RPCs (SECURITY DEFINER, search_path=public)
-- ---------------------------------------------------------------------------

create or replace function public.notification_inbox_list(
  p_limit int default 50,
  p_include_archived boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 100));
  v_items jsonb;
  v_unread int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select coalesce(
    jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc),
    '[]'::jsonb
  )
  into v_items
  from (
    select
      id,
      title,
      body,
      data,
      status,
      role,
      sent_at,
      created_at,
      read_at,
      archived_at
    from public.notification_logs
    where user_id = v_uid
      and (p_include_archived or archived_at is null)
    order by created_at desc
    limit v_limit
  ) x;

  select count(*)::int
  into v_unread
  from public.notification_logs
  where user_id = v_uid
    and archived_at is null
    and read_at is null;

  return jsonb_build_object(
    'ok', true,
    'items', v_items,
    'unread_count', coalesce(v_unread, 0)
  );
end;
$$;

create or replace function public.notification_inbox_mark_read(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.notification_logs%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_id');
  end if;

  update public.notification_logs
  set read_at = coalesce(read_at, now())
  where id = p_id
    and user_id = v_uid
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'read_at', v_row.read_at
  );
end;
$$;

create or replace function public.notification_inbox_archive(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.notification_logs%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_id');
  end if;

  update public.notification_logs
  set
    archived_at = coalesce(archived_at, now()),
    read_at = coalesce(read_at, now())
  where id = p_id
    and user_id = v_uid
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_row.id,
    'archived_at', v_row.archived_at,
    'read_at', v_row.read_at
  );
end;
$$;

revoke all on function public.notification_inbox_list(int, boolean) from public;
revoke all on function public.notification_inbox_mark_read(uuid) from public;
revoke all on function public.notification_inbox_archive(uuid) from public;

grant execute on function public.notification_inbox_list(int, boolean) to authenticated, service_role;
grant execute on function public.notification_inbox_mark_read(uuid) to authenticated, service_role;
grant execute on function public.notification_inbox_archive(uuid) to authenticated, service_role;

commit;
