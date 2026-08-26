-- IVR metadata, transfer history, and Realtime publication for admin support calls.

begin;

alter table public.admin_voice_calls
  drop constraint if exists admin_voice_calls_status_check;

alter table public.admin_voice_calls
  add constraint admin_voice_calls_status_check
  check (
    status in (
      'incoming',
      'in_ivr',
      'queued',
      'ringing',
      'answered',
      'in_progress',
      'transferred',
      'completed',
      'failed',
      'canceled',
      'missed',
      'expired'
    )
  );

alter table public.admin_voice_calls
  add column if not exists ivr_digit text;

alter table public.admin_voice_calls
  add column if not exists ivr_attempts integer not null default 0;

alter table public.admin_voice_calls
  add column if not exists service text;

alter table public.admin_voice_calls
  drop constraint if exists admin_voice_calls_service_check;

alter table public.admin_voice_calls
  add constraint admin_voice_calls_service_check
  check (
    service is null
    or service in (
      'delivery',
      'package',
      'payment',
      'taxi',
      'restaurant',
      'account',
      'general'
    )
  );

alter table public.admin_voice_calls
  add column if not exists assigned_admin_user_id uuid references public.profiles(id) on delete set null;

alter table public.admin_voice_calls
  add column if not exists transfer_count integer not null default 0;

create table if not exists public.admin_voice_transfer_events (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.admin_voice_calls(id) on delete cascade,
  from_admin_user_id uuid references public.profiles(id) on delete set null,
  to_admin_user_id uuid references public.profiles(id) on delete set null,
  service text,
  created_at timestamptz not null default now()
);

create index if not exists admin_voice_transfer_events_call_idx
  on public.admin_voice_transfer_events (call_id, created_at asc);

create index if not exists admin_voice_calls_service_created_idx
  on public.admin_voice_calls (service, created_at desc);

comment on table public.admin_voice_transfer_events is
  'Admin-to-admin PSTN transfer history for inbound MMD Delivery support calls.';

alter table public.admin_voice_transfer_events enable row level security;

drop policy if exists admin_voice_transfer_events_voice_staff_read
  on public.admin_voice_transfer_events;
create policy admin_voice_transfer_events_voice_staff_read
  on public.admin_voice_transfer_events
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

grant select on public.admin_voice_transfer_events to authenticated;
grant all on public.admin_voice_transfer_events to service_role;

alter table public.admin_voice_calls replica identity full;
alter table public.admin_voice_transfer_events replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.admin_voice_calls;
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter publication supabase_realtime add table public.admin_voice_transfer_events;
exception
  when duplicate_object then null;
end
$$;

commit;
