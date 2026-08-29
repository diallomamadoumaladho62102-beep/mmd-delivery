-- Twilio Conference fields for real Hold / Resume / Transfer on admin support calls.
-- Masked Customer↔Driver calls stay on <Dial><Number> and are unchanged.

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
      'on_hold',
      'transferred',
      'completed',
      'failed',
      'canceled',
      'declined',
      'missed',
      'expired',
      'busy',
      'no_answer'
    )
  );

alter table public.admin_voice_calls
  add column if not exists conference_name text;

alter table public.admin_voice_calls
  add column if not exists on_hold boolean not null default false;

alter table public.admin_voice_calls
  add column if not exists answered_at timestamptz;

alter table public.admin_voice_calls
  add column if not exists ended_at timestamptz;

create index if not exists admin_voice_calls_conference_name_idx
  on public.admin_voice_calls (conference_name)
  where conference_name is not null;

comment on column public.admin_voice_calls.conference_name is
  'Twilio Conference friendly name (mmd-admin-{id}) for support Hold/Resume/Transfer.';

commit;
