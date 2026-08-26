-- A2P 10DLC SMS consent audit + outbound logs. Voice tables are untouched.

begin;

create table if not exists public.sms_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  phone_e164 text not null,
  sms_consent boolean not null default false,
  consent_type text not null default 'transactional',
  consent_source text not null,
  consent_timestamp timestamptz,
  privacy_version text,
  terms_version text,
  ip_address inet,
  user_agent text,
  revoked_at timestamptz,
  opt_out_timestamp timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sms_consents_type_check
    check (consent_type in ('transactional')),
  constraint sms_consents_source_check
    check (
      consent_source in (
        'public_cta',
        'web_signup',
        'mobile_signup',
        'web_profile',
        'mobile_profile',
        'inbound_start',
        'inbound_stop'
      )
    )
);

alter table public.sms_consents
  drop constraint if exists sms_consents_phone_type_key;
alter table public.sms_consents
  add constraint sms_consents_phone_type_key unique (phone_e164, consent_type);

create index if not exists sms_consents_user_idx
  on public.sms_consents (user_id)
  where user_id is not null;

create table if not exists public.sms_opt_outs (
  phone_e164 text primary key,
  opted_out_at timestamptz not null default now(),
  source text not null,
  keyword text
);

create table if not exists public.sms_message_logs (
  id uuid primary key default gen_random_uuid(),
  message_type text not null,
  user_id uuid,
  phone_e164_hash text,
  phone_last4 text,
  twilio_message_sid text,
  status text not null default 'queued',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  opt_in_status boolean,
  idempotency_key text
);

create unique index if not exists sms_message_logs_idempotency_uidx
  on public.sms_message_logs (idempotency_key)
  where idempotency_key is not null;

create index if not exists sms_message_logs_sid_idx
  on public.sms_message_logs (twilio_message_sid)
  where twilio_message_sid is not null;

create index if not exists sms_message_logs_created_idx
  on public.sms_message_logs (created_at desc);

comment on table public.sms_consents is
  'Explicit MMD Delivery transactional SMS consent. Providing a phone number is not consent.';
comment on table public.sms_opt_outs is
  'Phone-level SMS opt-out from STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT.';
comment on table public.sms_message_logs is
  'Outbound SMS audit. Stores last4 + hash only — never OTP codes or secrets.';

alter table public.sms_consents enable row level security;
alter table public.sms_opt_outs enable row level security;
alter table public.sms_message_logs enable row level security;

drop policy if exists sms_consents_select_own on public.sms_consents;
create policy sms_consents_select_own
  on public.sms_consents
  for select
  to authenticated
  using (user_id = auth.uid());

revoke all on public.sms_consents from anon;
revoke all on public.sms_opt_outs from anon, authenticated;
revoke all on public.sms_message_logs from anon, authenticated;
grant select on public.sms_consents to authenticated;

insert into public.site_menu_items (menu_id, label, href, sort_order)
select m.id, 'SMS Program', '/legal/sms', 25
from public.site_menus m
where m.locale = 'en'
  and m.key = 'footer'
  and not exists (
    select 1
    from public.site_menu_items i
    where i.menu_id = m.id
      and i.href = '/legal/sms'
  );

commit;
