-- Phase 10.5 — Communications production hardening
-- call_sessions + notification_logs CREATE, marketplace call participants, chat RPC fixes

begin;

-- ---------------------------------------------------------------------------
-- call_sessions (masked Twilio proxy calls)
-- ---------------------------------------------------------------------------

create table if not exists public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  caller_user_id uuid not null references auth.users (id) on delete cascade,
  caller_role text not null
    check (caller_role in ('client', 'driver', 'restaurant', 'admin')),
  target_user_id uuid not null references auth.users (id) on delete cascade,
  target_role text not null
    check (target_role in ('client', 'driver', 'restaurant', 'admin')),
  proxy_number text not null,
  caller_phone text not null,
  target_phone text not null,
  twilio_call_sid text,
  status text not null default 'active'
    check (
      status in (
        'active',
        'ringing',
        'connected',
        'completed',
        'expired',
        'failed',
        'missed',
        'declined'
      )
    ),
  started_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists call_sessions_caller_phone_active_idx
  on public.call_sessions (caller_phone, status, expires_at desc);

create index if not exists call_sessions_order_id_idx
  on public.call_sessions (order_id, created_at desc);

alter table public.call_sessions enable row level security;

drop policy if exists call_sessions_select_staff on public.call_sessions;
create policy call_sessions_select_staff
  on public.call_sessions
  for select
  to authenticated
  using (public.is_staff_user(auth.uid()));

drop policy if exists call_sessions_select_participant on public.call_sessions;
create policy call_sessions_select_participant
  on public.call_sessions
  for select
  to authenticated
  using (
    caller_user_id = auth.uid()
    or target_user_id = auth.uid()
  );

grant select on public.call_sessions to authenticated;
grant all on public.call_sessions to service_role;

-- ---------------------------------------------------------------------------
-- notification_logs (push audit + dedup)
-- ---------------------------------------------------------------------------

create table if not exists public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  role text,
  title text,
  body text,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  error_message text,
  dedup_key text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.notification_logs
  add column if not exists dedup_key text;

alter table public.notification_logs
  add column if not exists error_message text;

alter table public.notification_logs
  add column if not exists sent_at timestamptz;

alter table public.notification_logs
  add column if not exists data jsonb not null default '{}'::jsonb;

create index if not exists notification_logs_user_created_idx
  on public.notification_logs (user_id, created_at desc);

create index if not exists notification_logs_dedup_idx
  on public.notification_logs (dedup_key, created_at desc)
  where dedup_key is not null;

alter table public.notification_logs enable row level security;

drop policy if exists notification_logs_staff_select on public.notification_logs;
create policy notification_logs_staff_select
  on public.notification_logs
  for select
  to authenticated
  using (public.is_staff_user(auth.uid()));

grant select on public.notification_logs to authenticated;
grant all on public.notification_logs to service_role;

-- ---------------------------------------------------------------------------
-- Marketplace masked-call participants
-- ---------------------------------------------------------------------------

create or replace function public.marketplace_delivery_job_participant_ids(p_job_id uuid)
returns table (user_id uuid, role text)
language sql
stable
security definer
set search_path = public
as $$
  select j.client_id, 'client'::text
  from public.marketplace_delivery_jobs j
  where j.id = p_job_id
    and j.client_id is not null
  union all
  select j.assigned_driver_id, 'driver'::text
  from public.marketplace_delivery_jobs j
  where j.id = p_job_id
    and j.assigned_driver_id is not null
  union all
  select s.user_id, 'restaurant'::text
  from public.marketplace_delivery_jobs j
  join public.sellers s on s.id = j.seller_id
  where j.id = p_job_id;
$$;

revoke all on function public.marketplace_delivery_job_participant_ids(uuid) from public;
grant execute on function public.marketplace_delivery_job_participant_ids(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Chat resource participant check (orders, delivery, taxi, marketplace)
-- ---------------------------------------------------------------------------

create or replace function public.is_order_message_participant(
  p_resource_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_user_id is null or p_resource_id is null then
    return false;
  end if;

  if public.is_staff_user(p_user_id) then
    return true;
  end if;

  if exists (select 1 from public.orders o where o.id = p_resource_id) then
    return exists (
      select 1
      from public.order_participant_ids(p_resource_id) p
      where p.user_id = p_user_id
    );
  end if;

  if exists (select 1 from public.delivery_requests dr where dr.id = p_resource_id) then
    return exists (
      select 1
      from public.delivery_request_participant_ids(p_resource_id) p
      where p.user_id = p_user_id
    );
  end if;

  if exists (select 1 from public.taxi_rides tr where tr.id = p_resource_id) then
    return exists (
      select 1
      from public.taxi_ride_participant_ids(p_resource_id) p
      where p.user_id = p_user_id
    );
  end if;

  if exists (
    select 1 from public.marketplace_delivery_jobs mj where mj.id = p_resource_id
  ) then
    return exists (
      select 1
      from public.marketplace_delivery_job_participant_ids(p_resource_id) p
      where p.user_id = p_user_id
    );
  end if;

  return false;
end;
$$;

revoke all on function public.is_order_message_participant(uuid, uuid) from public;
grant execute on function public.is_order_message_participant(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- delete_order_message — author-only delete + image_path for storage cleanup
-- ---------------------------------------------------------------------------

drop function if exists public.delete_order_message(uuid);

create or replace function public.delete_order_message(p_msg_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order_id uuid;
  v_author_id uuid;
  v_image_path text;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select order_id, user_id, image_path
  into v_order_id, v_author_id, v_image_path
  from public.order_messages
  where id = p_msg_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'message_not_found');
  end if;

  if not public.is_order_message_participant(v_order_id, v_user_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_author_id is distinct from v_user_id and not public.is_staff_user(v_user_id) then
    return jsonb_build_object('ok', false, 'error', 'delete_forbidden');
  end if;

  delete from public.order_messages where id = p_msg_id;

  return jsonb_build_object(
    'ok',
    true,
    'message_id',
    p_msg_id,
    'image_path',
    v_image_path,
    'bucket',
    'chat-images'
  );
end;
$$;

revoke all on function public.delete_order_message(uuid) from public;
grant execute on function public.delete_order_message(uuid) to authenticated;

commit;
