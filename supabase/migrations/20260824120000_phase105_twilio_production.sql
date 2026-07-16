-- Phase 10.5 Twilio production: call session timing + failure metadata

begin;

alter table public.call_sessions
  add column if not exists answered_at timestamptz;

alter table public.call_sessions
  add column if not exists duration_seconds integer;

alter table public.call_sessions
  add column if not exists failure_code text;

alter table public.call_sessions
  add column if not exists final_status text;

alter table public.call_events
  add column if not exists failure_code text;

alter table public.call_sessions
  drop constraint if exists call_sessions_status_check;

alter table public.call_sessions
  add constraint call_sessions_status_check
  check (
    status in (
      'active',
      'ringing',
      'connected',
      'completed',
      'expired',
      'failed',
      'missed',
      'declined',
      'canceled'
    )
  );

commit;
