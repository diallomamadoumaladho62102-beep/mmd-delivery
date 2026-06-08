-- Client P0: unified chat schema, client RLS (delivery_requests, user_push_tokens), cancel audit columns.
-- order_messages backfill is schema-aware (never references missing columns).

begin;

-- ---------------------------------------------------------------------------
-- 1) order_messages — canonical columns (text, user_id, image_path, roles)
-- ---------------------------------------------------------------------------

alter table public.order_messages
  add column if not exists user_id uuid;

alter table public.order_messages
  add column if not exists text text;

alter table public.order_messages
  add column if not exists image_path text;

alter table public.order_messages
  add column if not exists sender_role text;

alter table public.order_messages
  add column if not exists target_role text;

alter table public.order_messages
  add column if not exists content text;

alter table public.order_messages
  add column if not exists message text;

alter table public.order_messages
  add column if not exists body text;

do $backfill$
declare
  v_user_candidates constant text[] := array[
    'user_id',
    'sender_id',
    'sender_user_id',
    'author_id',
    'created_by'
  ];
  v_text_candidates constant text[] := array[
    'text',
    'body',
    'content',
    'message'
  ];
  v_user_parts text[] := array[]::text[];
  v_text_parts text[] := array[]::text[];
  v_user_fallback_parts text[] := array[]::text[];
  v_set_parts text[] := array[]::text[];
  v_where_parts text[] := array[]::text[];
  v_col text;
  v_has_user_id boolean := false;
  v_has_text boolean := false;
  v_sql text;
begin
  if to_regclass('public.order_messages') is null then
    return;
  end if;

  foreach v_col in array v_user_candidates loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'order_messages'
        and column_name = v_col
    ) then
      v_user_parts := array_append(v_user_parts, v_col);
      if v_col = 'user_id' then
        v_has_user_id := true;
      else
        v_user_fallback_parts := array_append(v_user_fallback_parts, v_col);
      end if;
    end if;
  end loop;

  foreach v_col in array v_text_candidates loop
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'order_messages'
        and column_name = v_col
    ) then
      if v_col = 'text' then
        v_has_text := true;
      end if;
      v_text_parts := array_append(
        v_text_parts,
        format('nullif(trim(%I), '''')', v_col)
      );
    end if;
  end loop;

  if v_has_user_id and coalesce(array_length(v_user_fallback_parts, 1), 0) > 0 then
    v_set_parts := array_append(
      v_set_parts,
      format(
        'user_id = coalesce(%s)',
        array_to_string(v_user_parts, ', ')
      )
    );
    v_where_parts := array_append(v_where_parts, 'user_id is null');
  end if;

  if v_has_text and coalesce(array_length(v_text_parts, 1), 0) > 1 then
    v_set_parts := array_append(
      v_set_parts,
      format('text = coalesce(%s)', array_to_string(v_text_parts, ', '))
    );
    v_where_parts := array_append(
      v_where_parts,
      '(text is null or trim(text) = '''')'
    );
  end if;

  if coalesce(array_length(v_set_parts, 1), 0) = 0 then
    raise notice 'order_messages backfill skipped: no compatible source columns detected';
    return;
  end if;

  v_sql := format(
    'update public.order_messages set %s where %s',
    array_to_string(v_set_parts, ', '),
    array_to_string(v_where_parts, ' or ')
  );

  raise notice 'order_messages backfill SQL: %', v_sql;
  execute v_sql;
end
$backfill$;

-- ---------------------------------------------------------------------------
-- 2) delivery_requests — client cancel / refund columns
-- ---------------------------------------------------------------------------

do $dr_cols$
begin
  if to_regclass('public.delivery_requests') is null then
    return;
  end if;

  alter table public.delivery_requests
    add column if not exists client_user_id uuid;

  alter table public.delivery_requests
    add column if not exists created_by uuid;

  alter table public.delivery_requests
    add column if not exists cancel_reason text;

  alter table public.delivery_requests
    add column if not exists cancelled_by text;

  alter table public.delivery_requests
    add column if not exists cancelled_at timestamptz;

  alter table public.delivery_requests
    add column if not exists refund_status text;

  alter table public.delivery_requests
    add column if not exists stripe_refund_id text;

  alter table public.delivery_requests
    add column if not exists stripe_refunded_at timestamptz;
end
$dr_cols$;

-- ---------------------------------------------------------------------------
-- 3) delivery_requests — participants can read their own requests
-- ---------------------------------------------------------------------------

do $dr_rls$
begin
  if to_regclass('public.delivery_requests') is null then
    return;
  end if;

  if to_regprocedure('public.delivery_request_participant_ids(uuid)') is null then
    raise notice 'delivery_request_participant_ids(uuid) missing — skip delivery_requests_select_participants';
    return;
  end if;

  alter table public.delivery_requests enable row level security;

  drop policy if exists delivery_requests_select_participants on public.delivery_requests;
  execute $pol$
    create policy delivery_requests_select_participants
      on public.delivery_requests
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.delivery_request_participant_ids(delivery_requests.id) p
          where p.user_id = auth.uid()
        )
      )
  $pol$;
end
$dr_rls$;

-- ---------------------------------------------------------------------------
-- 4) user_push_tokens — own rows only (+ staff read for admin comms)
-- ---------------------------------------------------------------------------

create table if not exists public.user_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id text not null default 'default',
  role text,
  expo_push_token text not null,
  platform text,
  app_version text,
  disabled boolean default false,
  is_active boolean default true,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists user_push_tokens_user_device_role_uq
  on public.user_push_tokens (user_id, device_id, role);

do $push_rls$
begin
  if to_regclass('public.user_push_tokens') is null then
    return;
  end if;

  alter table public.user_push_tokens enable row level security;

  drop policy if exists user_push_tokens_select_own on public.user_push_tokens;
  execute $pol$
    create policy user_push_tokens_select_own
      on public.user_push_tokens
      for select
      to authenticated
      using (
        user_id = auth.uid()
        or public.is_staff_user(auth.uid())
      )
  $pol$;

  drop policy if exists user_push_tokens_insert_own on public.user_push_tokens;
  execute $pol$
    create policy user_push_tokens_insert_own
      on public.user_push_tokens
      for insert
      to authenticated
      with check (user_id = auth.uid())
  $pol$;

  drop policy if exists user_push_tokens_update_own on public.user_push_tokens;
  execute $pol$
    create policy user_push_tokens_update_own
      on public.user_push_tokens
      for update
      to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid())
  $pol$;

  drop policy if exists user_push_tokens_delete_own on public.user_push_tokens;
  execute $pol$
    create policy user_push_tokens_delete_own
      on public.user_push_tokens
      for delete
      to authenticated
      using (user_id = auth.uid())
  $pol$;
end
$push_rls$;

commit;
