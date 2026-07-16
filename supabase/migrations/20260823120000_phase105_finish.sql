-- Phase 10.5 finish: Twilio call history, chat receipts, badge counts, secured chat RPCs

begin;

-- ---------------------------------------------------------------------------
-- call_events — full Twilio status history
-- ---------------------------------------------------------------------------

create table if not exists public.call_events (
  id uuid primary key default gen_random_uuid(),
  call_session_id uuid references public.call_sessions (id) on delete set null,
  twilio_call_sid text,
  dial_call_sid text,
  event_source text not null default 'status_callback',
  twilio_status text not null,
  mapped_status text,
  from_phone text,
  to_phone text,
  duration_seconds integer,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists call_events_session_idx
  on public.call_events (call_session_id, created_at desc);

create index if not exists call_events_call_sid_idx
  on public.call_events (twilio_call_sid, created_at desc);

alter table public.call_events enable row level security;

drop policy if exists call_events_staff_select on public.call_events;
create policy call_events_staff_select
  on public.call_events
  for select
  to authenticated
  using (public.is_staff_user(auth.uid()));

grant select on public.call_events to authenticated;
grant all on public.call_events to service_role;

-- ---------------------------------------------------------------------------
-- Chat delivery receipts
-- ---------------------------------------------------------------------------

alter table public.order_messages
  add column if not exists delivery_status text not null default 'sent';

alter table public.order_messages
  add column if not exists delivered_at timestamptz;

alter table public.order_messages
  add column if not exists read_at timestamptz;

do $check$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_messages_delivery_status_check'
  ) then
    alter table public.order_messages
      add constraint order_messages_delivery_status_check
      check (delivery_status in ('sent', 'delivered', 'read'));
  end if;
end;
$check$;

-- ---------------------------------------------------------------------------
-- Push badge counter
-- ---------------------------------------------------------------------------

create table if not exists public.user_push_badge_counts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  unread_count integer not null default 0 check (unread_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.user_push_badge_counts enable row level security;

drop policy if exists user_push_badge_counts_self_select on public.user_push_badge_counts;
create policy user_push_badge_counts_self_select
  on public.user_push_badge_counts
  for select
  to authenticated
  using (user_id = auth.uid());

grant select on public.user_push_badge_counts to authenticated;
grant all on public.user_push_badge_counts to service_role;

create or replace function public.adjust_user_push_badge(
  p_user_id uuid,
  p_delta integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
begin
  if p_user_id is null then
    return 0;
  end if;

  insert into public.user_push_badge_counts (user_id, unread_count, updated_at)
  values (p_user_id, greatest(p_delta, 0), now())
  on conflict (user_id) do update
  set unread_count = greatest(public.user_push_badge_counts.unread_count + p_delta, 0),
      updated_at = now()
  returning unread_count into v_next;

  return coalesce(v_next, 0);
end;
$$;

revoke all on function public.adjust_user_push_badge(uuid, integer) from public;
grant execute on function public.adjust_user_push_badge(uuid, integer) to service_role;

create or replace function public.get_user_push_badge_count(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select unread_count from public.user_push_badge_counts where user_id = p_user_id),
    0
  );
$$;

revoke all on function public.get_user_push_badge_count(uuid) from public;
grant execute on function public.get_user_push_badge_count(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- send_order_message — secured insert with anti-spam
-- ---------------------------------------------------------------------------

create or replace function public.send_order_message(
  p_order_id uuid,
  p_text text,
  p_image_path text default null,
  p_sender_role text default null,
  p_target_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_trimmed text := nullif(trim(p_text), '');
  v_recent_count integer;
  v_message public.order_messages%rowtype;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_order_id');
  end if;

  if v_trimmed is null and coalesce(nullif(trim(p_image_path), ''), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_message');
  end if;

  if not public.is_order_message_participant(p_order_id, v_user_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select count(*)::integer
  into v_recent_count
  from public.order_messages m
  where m.user_id = v_user_id
    and m.created_at >= now() - interval '1 minute';

  if v_recent_count >= 12 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  insert into public.order_messages (
    order_id,
    user_id,
    text,
    image_path,
    sender_role,
    target_role,
    delivery_status
  )
  values (
    p_order_id,
    v_user_id,
    v_trimmed,
    nullif(trim(p_image_path), ''),
    nullif(trim(p_sender_role), ''),
    nullif(trim(p_target_role), ''),
    'sent'
  )
  returning * into v_message;

  return jsonb_build_object(
    'ok',
    true,
    'message',
    jsonb_build_object(
      'id', v_message.id,
      'order_id', v_message.order_id,
      'user_id', v_message.user_id,
      'text', v_message.text,
      'image_path', v_message.image_path,
      'sender_role', v_message.sender_role,
      'target_role', v_message.target_role,
      'delivery_status', v_message.delivery_status,
      'delivered_at', v_message.delivered_at,
      'read_at', v_message.read_at,
      'created_at', v_message.created_at
    )
  );
end;
$$;

revoke all on function public.send_order_message(uuid, text, text, text, text) from public;
grant execute on function public.send_order_message(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- mark_order_message_delivered / mark_order_messages_read
-- ---------------------------------------------------------------------------

create or replace function public.mark_order_message_delivered(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order_id uuid;
  v_sender_id uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select order_id, user_id
  into v_order_id, v_sender_id
  from public.order_messages
  where id = p_message_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'message_not_found');
  end if;

  if v_sender_id = v_user_id then
    return jsonb_build_object('ok', false, 'error', 'sender_cannot_ack');
  end if;

  if not public.is_order_message_participant(v_order_id, v_user_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.order_messages
  set delivery_status = 'delivered',
      delivered_at = coalesce(delivered_at, now())
  where id = p_message_id
    and delivery_status = 'sent';

  return jsonb_build_object('ok', true, 'message_id', p_message_id);
end;
$$;

create or replace function public.mark_order_messages_read(
  p_order_id uuid,
  p_target_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_marked integer := 0;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if not public.is_order_message_participant(p_order_id, v_user_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.order_messages m
  set delivery_status = 'read',
      read_at = coalesce(read_at, now()),
      delivered_at = coalesce(delivered_at, now())
  where m.order_id = p_order_id
    and m.user_id is distinct from v_user_id
    and m.delivery_status in ('sent', 'delivered')
    and (
      coalesce(nullif(trim(p_target_role), ''), '') = ''
      or m.target_role = nullif(trim(p_target_role), '')
      or m.sender_role = nullif(trim(p_target_role), '')
    );

  get diagnostics v_marked = row_count;

  return jsonb_build_object('ok', true, 'marked', v_marked);
end;
$$;

revoke all on function public.mark_order_message_delivered(uuid) from public;
revoke all on function public.mark_order_messages_read(uuid, text) from public;
grant execute on function public.mark_order_message_delivered(uuid) to authenticated;
grant execute on function public.mark_order_messages_read(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Block direct inserts — RPC only
-- ---------------------------------------------------------------------------

drop policy if exists order_messages_insert_participants on public.order_messages;

drop policy if exists order_messages_select_participants on public.order_messages;
create policy order_messages_select_participants
  on public.order_messages
  for select
  to authenticated
  using (public.is_order_message_participant(order_id, auth.uid()));

commit;
