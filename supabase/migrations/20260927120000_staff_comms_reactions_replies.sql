-- Staff comms finalization: replies + reactions
-- Safe to re-run (IF NOT EXISTS).

alter table public.staff_messages
  add column if not exists reply_to_message_id uuid
    references public.staff_messages (id) on delete set null;

create index if not exists staff_messages_reply_to_idx
  on public.staff_messages (reply_to_message_id)
  where reply_to_message_id is not null;

create table if not exists public.staff_message_reactions (
  message_id uuid not null references public.staff_messages (id) on delete cascade,
  admin_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, admin_id, emoji)
);

create index if not exists staff_message_reactions_message_idx
  on public.staff_message_reactions (message_id);

alter table public.staff_message_reactions enable row level security;

revoke all on table public.staff_message_reactions from anon, public;
grant select, insert, delete on table public.staff_message_reactions to authenticated;
grant all on table public.staff_message_reactions to service_role;

drop policy if exists staff_message_reactions_select on public.staff_message_reactions;
drop policy if exists staff_message_reactions_insert on public.staff_message_reactions;
drop policy if exists staff_message_reactions_delete on public.staff_message_reactions;

create policy staff_message_reactions_select on public.staff_message_reactions
  for select to authenticated
  using (
    public.is_founder_user(auth.uid())
    or public.is_super_admin_user(auth.uid())
    or exists (
      select 1
      from public.staff_messages m
      where m.id = message_id
        and public.is_staff_conversation_member(m.conversation_id, auth.uid())
    )
  );

create policy staff_message_reactions_insert on public.staff_message_reactions
  for insert to authenticated
  with check (
    admin_id = auth.uid()
    and (
      public.is_founder_user(auth.uid())
      or public.is_super_admin_user(auth.uid())
      or exists (
        select 1
        from public.staff_messages m
        where m.id = message_id
          and public.is_staff_conversation_member(m.conversation_id, auth.uid())
      )
    )
  );

create policy staff_message_reactions_delete on public.staff_message_reactions
  for delete to authenticated
  using (
    admin_id = auth.uid()
    or public.is_founder_user(auth.uid())
    or public.is_super_admin_user(auth.uid())
  );
