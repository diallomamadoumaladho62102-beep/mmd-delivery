-- Admin PSTN voice sessions for inbound support calls and admin-to-admin transfer.
-- Separate from call_sessions (masked order/trip calls require order + user FKs).

begin;

create table if not exists public.admin_voice_calls (
  id uuid primary key default gen_random_uuid(),
  parent_call_sid text not null unique,
  child_call_sid text,
  from_phone text,
  current_admin_user_id uuid references public.profiles(id) on delete set null,
  current_admin_phone text not null,
  transferred_from_user_id uuid references public.profiles(id) on delete set null,
  transferred_to_user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'ringing'
    check (
      status in (
        'ringing',
        'in_progress',
        'transferred',
        'completed',
        'failed',
        'canceled',
        'missed'
      )
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admin_voice_calls_status_created_idx
  on public.admin_voice_calls (status, created_at desc);

create index if not exists admin_voice_calls_current_admin_idx
  on public.admin_voice_calls (current_admin_user_id);

comment on table public.admin_voice_calls is
  'Inbound MMD Delivery PSTN support calls and admin-to-admin Twilio Voice transfers.';

alter table public.admin_voice_calls enable row level security;

drop policy if exists admin_voice_calls_voice_staff_read on public.admin_voice_calls;
create policy admin_voice_calls_voice_staff_read
  on public.admin_voice_calls
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and (
          coalesce(p.is_founder, false) = true
          or lower(trim(coalesce(p.role::text, ''))) in (
            'founder',
            'super_admin',
            'admin',
            'operations_admin',
            'ops',
            'support_admin',
            'support'
          )
        )
    )
  );

grant select on public.admin_voice_calls to authenticated;
grant all on public.admin_voice_calls to service_role;

commit;
