-- Control Center Enterprise: staff geo, presence, internal messaging, calls, attachments
-- Idempotent. No destructive product-data changes.

begin;

-- ---------------------------------------------------------------------------
-- 1) Staff geo + presence on profiles
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists staff_country_code text,
  add column if not exists staff_region_code text,
  add column if not exists staff_county_code text,
  add column if not exists staff_city text,
  add column if not exists staff_timezone text,
  add column if not exists staff_language text,
  add column if not exists staff_department text,
  add column if not exists staff_title text,
  add column if not exists last_seen_at timestamptz,
  add column if not exists presence_status text not null default 'offline'
    check (presence_status in ('online', 'away', 'busy', 'offline'));

create index if not exists profiles_staff_geo_idx
  on public.profiles (staff_country_code, staff_region_code, staff_city)
  where role in ('admin', 'ops', 'finance', 'support', 'review')
     or coalesce(is_founder, false) = true;

create index if not exists profiles_last_seen_idx
  on public.profiles (last_seen_at desc nulls last);

-- ---------------------------------------------------------------------------
-- 2) Internal staff conversations / messages
-- ---------------------------------------------------------------------------
create table if not exists public.staff_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'direct'
    check (kind in ('direct', 'group', 'announcement')),
  title text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_conversation_members (
  conversation_id uuid not null references public.staff_conversations (id) on delete cascade,
  admin_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  typing_at timestamptz,
  primary key (conversation_id, admin_id)
);

create table if not exists public.staff_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.staff_conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text,
  message_type text not null default 'text'
    check (message_type in ('text', 'file', 'image', 'video', 'audio', 'link', 'system')),
  attachment_path text,
  attachment_mime text,
  attachment_bytes bigint,
  link_url text,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.staff_message_receipts (
  message_id uuid not null references public.staff_messages (id) on delete cascade,
  admin_id uuid not null references public.profiles (id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  primary key (message_id, admin_id)
);

create index if not exists staff_messages_conversation_created_idx
  on public.staff_messages (conversation_id, created_at desc);

create index if not exists staff_conversation_members_admin_idx
  on public.staff_conversation_members (admin_id);

-- ---------------------------------------------------------------------------
-- 3) Internal staff calls (audio/video/meetings) — provider-agnostic
-- ---------------------------------------------------------------------------
create table if not exists public.staff_call_sessions (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'audio'
    check (kind in ('audio', 'video', 'screen', 'meeting')),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'ringing', 'active', 'ended', 'failed', 'cancelled')),
  provider text not null default 'none'
    check (provider in ('none', 'twilio_video', 'twilio_voice', 'webrtc')),
  provider_room_sid text,
  provider_room_name text,
  title text,
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  conversation_id uuid references public.staff_conversations (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_call_participants (
  call_id uuid not null references public.staff_call_sessions (id) on delete cascade,
  admin_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'participant'
    check (role in ('host', 'participant')),
  joined_at timestamptz,
  left_at timestamptz,
  primary key (call_id, admin_id)
);

create index if not exists staff_call_sessions_status_idx
  on public.staff_call_sessions (status, scheduled_at);

-- ---------------------------------------------------------------------------
-- 4) Helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_staff_conversation_member(
  p_conversation_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_founder_user(p_user_id)
    or public.is_super_admin_user(p_user_id)
    or exists (
      select 1
      from public.staff_conversation_members m
      where m.conversation_id = p_conversation_id
        and m.admin_id = p_user_id
    );
$$;

revoke all on function public.is_staff_conversation_member(uuid, uuid) from public;
grant execute on function public.is_staff_conversation_member(uuid, uuid) to authenticated;

create or replace function public.touch_staff_presence(
  p_status text default 'online'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff_user(auth.uid()) then
    raise exception 'forbidden';
  end if;
  update public.profiles
  set
    last_seen_at = now(),
    presence_status = case
      when p_status in ('online', 'away', 'busy', 'offline') then p_status
      else 'online'
    end,
    updated_at = now()
  where id = auth.uid();
end;
$$;

revoke all on function public.touch_staff_presence(text) from public;
grant execute on function public.touch_staff_presence(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) RLS
-- ---------------------------------------------------------------------------
alter table public.staff_conversations enable row level security;
alter table public.staff_conversation_members enable row level security;
alter table public.staff_messages enable row level security;
alter table public.staff_message_receipts enable row level security;
alter table public.staff_call_sessions enable row level security;
alter table public.staff_call_participants enable row level security;

revoke all on table public.staff_conversations from anon, public;
revoke all on table public.staff_conversation_members from anon, public;
revoke all on table public.staff_messages from anon, public;
revoke all on table public.staff_message_receipts from anon, public;
revoke all on table public.staff_call_sessions from anon, public;
revoke all on table public.staff_call_participants from anon, public;

grant select, insert, update, delete on table public.staff_conversations to authenticated;
grant select, insert, update, delete on table public.staff_conversation_members to authenticated;
grant select, insert, update, delete on table public.staff_messages to authenticated;
grant select, insert, update, delete on table public.staff_message_receipts to authenticated;
grant select, insert, update, delete on table public.staff_call_sessions to authenticated;
grant select, insert, update, delete on table public.staff_call_participants to authenticated;

drop policy if exists staff_conversations_select on public.staff_conversations;
drop policy if exists staff_conversations_insert on public.staff_conversations;
drop policy if exists staff_conversations_update on public.staff_conversations;
drop policy if exists staff_conversation_members_select on public.staff_conversation_members;
drop policy if exists staff_conversation_members_mutate on public.staff_conversation_members;
drop policy if exists staff_messages_select on public.staff_messages;
drop policy if exists staff_messages_insert on public.staff_messages;
drop policy if exists staff_messages_update on public.staff_messages;
drop policy if exists staff_message_receipts_all on public.staff_message_receipts;
drop policy if exists staff_call_sessions_select on public.staff_call_sessions;
drop policy if exists staff_call_sessions_mutate on public.staff_call_sessions;
drop policy if exists staff_call_participants_select on public.staff_call_participants;
drop policy if exists staff_call_participants_mutate on public.staff_call_participants;

create policy staff_conversations_select on public.staff_conversations
for select to authenticated
using (public.is_staff_conversation_member(id, auth.uid()));

create policy staff_conversations_insert on public.staff_conversations
for insert to authenticated
with check (public.is_staff_user(auth.uid()) and created_by = auth.uid());

create policy staff_conversations_update on public.staff_conversations
for update to authenticated
using (
  public.is_founder_user(auth.uid())
  or public.is_super_admin_user(auth.uid())
  or created_by = auth.uid()
);

create policy staff_conversation_members_select on public.staff_conversation_members
for select to authenticated
using (public.is_staff_conversation_member(conversation_id, auth.uid()));

create policy staff_conversation_members_mutate on public.staff_conversation_members
for all to authenticated
using (
  public.is_founder_user(auth.uid())
  or public.is_super_admin_user(auth.uid())
  or exists (
    select 1 from public.staff_conversations c
    where c.id = conversation_id and c.created_by = auth.uid()
  )
)
with check (public.is_staff_user(auth.uid()));

create policy staff_messages_select on public.staff_messages
for select to authenticated
using (public.is_staff_conversation_member(conversation_id, auth.uid()));

create policy staff_messages_insert on public.staff_messages
for insert to authenticated
with check (
  public.is_staff_conversation_member(conversation_id, auth.uid())
  and sender_id = auth.uid()
);

create policy staff_messages_update on public.staff_messages
for update to authenticated
using (
  sender_id = auth.uid()
  or public.is_founder_user(auth.uid())
  or public.is_super_admin_user(auth.uid())
);

create policy staff_message_receipts_all on public.staff_message_receipts
for all to authenticated
using (
  admin_id = auth.uid()
  or public.is_founder_user(auth.uid())
  or public.is_super_admin_user(auth.uid())
  or exists (
    select 1 from public.staff_messages m
    where m.id = message_id
      and public.is_staff_conversation_member(m.conversation_id, auth.uid())
  )
)
with check (public.is_staff_user(auth.uid()));

create policy staff_call_sessions_select on public.staff_call_sessions
for select to authenticated
using (
  public.is_founder_user(auth.uid())
  or public.is_super_admin_user(auth.uid())
  or created_by = auth.uid()
  or exists (
    select 1 from public.staff_call_participants p
    where p.call_id = id and p.admin_id = auth.uid()
  )
);

create policy staff_call_sessions_mutate on public.staff_call_sessions
for all to authenticated
using (
  public.is_founder_user(auth.uid())
  or public.is_super_admin_user(auth.uid())
  or created_by = auth.uid()
)
with check (public.is_staff_user(auth.uid()));

create policy staff_call_participants_select on public.staff_call_participants
for select to authenticated
using (
  public.is_founder_user(auth.uid())
  or public.is_super_admin_user(auth.uid())
  or admin_id = auth.uid()
  or exists (
    select 1 from public.staff_call_sessions s
    where s.id = call_id and s.created_by = auth.uid()
  )
);

create policy staff_call_participants_mutate on public.staff_call_participants
for all to authenticated
using (
  public.is_founder_user(auth.uid())
  or public.is_super_admin_user(auth.uid())
  or exists (
    select 1 from public.staff_call_sessions s
    where s.id = call_id and s.created_by = auth.uid()
  )
)
with check (public.is_staff_user(auth.uid()));

-- Storage bucket for staff attachments (private)
insert into storage.buckets (id, name, public)
values ('staff-attachments', 'staff-attachments', false)
on conflict (id) do nothing;

drop policy if exists staff_attachments_select on storage.objects;
drop policy if exists staff_attachments_insert on storage.objects;

create policy staff_attachments_select on storage.objects
for select to authenticated
using (
  bucket_id = 'staff-attachments'
  and public.is_staff_user(auth.uid())
);

create policy staff_attachments_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'staff-attachments'
  and public.is_staff_user(auth.uid())
  and (storage.foldername(name))[1] = auth.uid()::text
);

commit;
