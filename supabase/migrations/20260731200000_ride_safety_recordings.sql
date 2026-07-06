-- Ride safety recordings — consent, private storage, retention, regional rules

begin;

-- ---------------------------------------------------------------------------
-- 1) Regional compliance rules (city > country > global)
-- ---------------------------------------------------------------------------

create table if not exists public.ride_safety_recording_rules (
  id uuid primary key default gen_random_uuid(),
  country_code text,
  state_code text,
  city text,
  client_audio_allowed boolean not null default true,
  driver_video_allowed boolean not null default true,
  retention_days integer not null default 14 check (retention_days between 1 and 90),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_code, state_code, city)
);

insert into public.ride_safety_recording_rules (
  country_code, state_code, city, client_audio_allowed, driver_video_allowed, retention_days
) values (
  null, null, null, true, true, 14
) on conflict (country_code, state_code, city) do nothing;

alter table public.ride_safety_recording_rules enable row level security;

drop policy if exists ride_safety_recording_rules_select_authenticated
  on public.ride_safety_recording_rules;
create policy ride_safety_recording_rules_select_authenticated
  on public.ride_safety_recording_rules for select
  to authenticated
  using (is_active = true);

-- ---------------------------------------------------------------------------
-- 2) Recordings + events
-- ---------------------------------------------------------------------------

create table if not exists public.ride_safety_recordings (
  id uuid primary key default gen_random_uuid(),
  taxi_ride_id uuid not null references public.taxi_rides (id) on delete cascade,
  initiator_user_id uuid not null references auth.users (id) on delete cascade,
  initiator_role text not null check (initiator_role in ('client', 'driver')),
  recording_type text not null check (recording_type in ('client_audio', 'driver_video')),
  status text not null default 'recording'
    check (status in (
      'recording', 'uploaded', 'available', 'expired', 'deleted', 'locked_for_review'
    )),
  storage_bucket text not null default 'ride-safety-recordings',
  storage_path text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  mime_type text,
  retention_days integer not null default 14 check (retention_days between 1 and 90),
  started_at timestamptz not null default now(),
  stopped_at timestamptz,
  uploaded_at timestamptz,
  expires_at timestamptz,
  locked_for_review boolean not null default false,
  locked_reason text,
  lock_incident_id uuid,
  country_code text,
  pickup_city text,
  warning_3d_sent_at timestamptz,
  warning_24h_sent_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ride_safety_recordings_ride_idx
  on public.ride_safety_recordings (taxi_ride_id, created_at desc);

create index if not exists ride_safety_recordings_expires_idx
  on public.ride_safety_recordings (expires_at)
  where status in ('uploaded', 'available') and locked_for_review is not true;

create table if not exists public.ride_safety_recording_events (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.ride_safety_recordings (id) on delete cascade,
  taxi_ride_id uuid not null references public.taxi_rides (id) on delete cascade,
  event_type text not null check (event_type in (
    'started', 'stopped', 'uploaded', 'participant_notified', 'download',
    'view', 'expiry_warning_3d', 'expiry_warning_24h', 'expired', 'deleted',
    'locked_for_review', 'unlocked'
  )),
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_role text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ride_safety_recording_events_recording_idx
  on public.ride_safety_recording_events (recording_id, created_at desc);

alter table public.ride_safety_recordings enable row level security;
alter table public.ride_safety_recording_events enable row level security;

drop policy if exists ride_safety_recordings_select_participants
  on public.ride_safety_recordings;
create policy ride_safety_recordings_select_participants
  on public.ride_safety_recordings for select
  to authenticated
  using (
    public.user_can_access_taxi_ride_storage(taxi_ride_id, auth.uid())
  );

drop policy if exists ride_safety_recording_events_select_participants
  on public.ride_safety_recording_events;
create policy ride_safety_recording_events_select_participants
  on public.ride_safety_recording_events for select
  to authenticated
  using (
    public.user_can_access_taxi_ride_storage(taxi_ride_id, auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 3) Resolve regional rules
-- ---------------------------------------------------------------------------

create or replace function public.resolve_ride_safety_recording_rules(
  p_country_code text default null,
  p_state_code text default null,
  p_city text default null
)
returns public.ride_safety_recording_rules
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rules public.ride_safety_recording_rules%rowtype;
  v_city text := public.normalize_taxi_city_name(p_city);
begin
  if v_city is not null then
    select * into v_rules
    from public.ride_safety_recording_rules r
    where r.is_active = true
      and lower(coalesce(r.country_code, '')) = lower(coalesce(p_country_code, ''))
      and lower(coalesce(r.state_code, '')) = lower(coalesce(p_state_code, ''))
      and public.normalize_taxi_city_name(r.city) = v_city
    limit 1;
    if found then return v_rules; end if;
  end if;

  select * into v_rules
  from public.ride_safety_recording_rules r
  where r.is_active = true
    and lower(coalesce(r.country_code, '')) = lower(coalesce(p_country_code, ''))
    and coalesce(r.state_code, '') = ''
    and coalesce(r.city, '') = ''
  limit 1;
  if found then return v_rules; end if;

  if p_state_code is not null and length(trim(p_state_code)) > 0 then
    select * into v_rules
    from public.ride_safety_recording_rules r
    where r.is_active = true
      and lower(coalesce(r.country_code, '')) = lower(coalesce(p_country_code, ''))
      and lower(coalesce(r.state_code, '')) = lower(trim(p_state_code))
      and coalesce(r.city, '') = ''
    limit 1;
    if found then return v_rules; end if;
  end if;

  select * into v_rules
  from public.ride_safety_recording_rules r
  where r.is_active = true
    and r.country_code is null
    and r.state_code is null
    and r.city is null
  limit 1;

  return v_rules;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Logging helper
-- ---------------------------------------------------------------------------

create or replace function public.log_ride_safety_recording_event(
  p_recording_id uuid,
  p_taxi_ride_id uuid,
  p_event_type text,
  p_actor_user_id uuid default null,
  p_actor_role text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ride_safety_recording_events (
    recording_id, taxi_ride_id, event_type, actor_user_id, actor_role, metadata
  ) values (
    p_recording_id, p_taxi_ride_id, p_event_type, p_actor_user_id, p_actor_role, coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Start / stop / upload / lock RPCs
-- ---------------------------------------------------------------------------

create or replace function public.start_ride_safety_recording(
  p_ride_id uuid,
  p_recording_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride public.taxi_rides%rowtype;
  v_rules public.ride_safety_recording_rules%rowtype;
  v_user_id uuid := auth.uid();
  v_role text;
  v_recording public.ride_safety_recordings%rowtype;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  select * into v_ride from public.taxi_rides where id = p_ride_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'ride_not_found');
  end if;

  if lower(coalesce(v_ride.status, '')) not in (
    'accepted', 'driver_arrived', 'in_progress'
  ) then
    return jsonb_build_object('ok', false, 'error', 'ride_not_active');
  end if;

  if v_ride.client_user_id = v_user_id then
    v_role := 'client';
  elsif v_ride.driver_id = v_user_id then
    v_role := 'driver';
  else
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_recording_type = 'client_audio' and v_role <> 'client' then
    return jsonb_build_object('ok', false, 'error', 'client_audio_only');
  end if;

  if p_recording_type = 'driver_video' and v_role <> 'driver' then
    return jsonb_build_object('ok', false, 'error', 'driver_video_only');
  end if;

  v_rules := public.resolve_ride_safety_recording_rules(
    v_ride.country_code, null, v_ride.pickup_city
  );

  if p_recording_type = 'client_audio' and coalesce(v_rules.client_audio_allowed, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'client_audio_not_allowed_in_region');
  end if;

  if p_recording_type = 'driver_video' and coalesce(v_rules.driver_video_allowed, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'driver_video_not_allowed_in_region');
  end if;

  if exists (
    select 1 from public.ride_safety_recordings r
    where r.taxi_ride_id = p_ride_id
      and r.initiator_user_id = v_user_id
      and r.recording_type = p_recording_type
      and r.status = 'recording'
  ) then
    return jsonb_build_object('ok', false, 'error', 'recording_already_active');
  end if;

  insert into public.ride_safety_recordings (
    taxi_ride_id,
    initiator_user_id,
    initiator_role,
    recording_type,
    status,
    retention_days,
    country_code,
    pickup_city
  ) values (
    p_ride_id,
    v_user_id,
    v_role,
    p_recording_type,
    'recording',
    coalesce(v_rules.retention_days, 14),
    v_ride.country_code,
    v_ride.pickup_city
  )
  returning * into v_recording;

  perform public.log_ride_safety_recording_event(
    v_recording.id, p_ride_id, 'started', v_user_id, v_role,
    jsonb_build_object('recording_type', p_recording_type)
  );

  return jsonb_build_object(
    'ok', true,
    'recording', to_jsonb(v_recording),
    'consent_message',
      'Un enregistrement de sécurité est en cours pour protéger les deux parties.',
    'notify_other_party', true,
    'other_party_role', case when v_role = 'client' then 'driver' else 'client' end
  );
end;
$$;

create or replace function public.stop_ride_safety_recording(p_recording_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recording public.ride_safety_recordings%rowtype;
  v_user_id uuid := auth.uid();
begin
  select * into v_recording from public.ride_safety_recordings where id = p_recording_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'recording_not_found');
  end if;

  if v_recording.initiator_user_id <> v_user_id
     and not public.is_staff_user(v_user_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_recording.status <> 'recording' then
    return jsonb_build_object('ok', false, 'error', 'not_recording');
  end if;

  update public.ride_safety_recordings
  set status = 'uploaded', stopped_at = now(), updated_at = now()
  where id = p_recording_id
  returning * into v_recording;

  perform public.log_ride_safety_recording_event(
    v_recording.id, v_recording.taxi_ride_id, 'stopped', v_user_id,
    v_recording.initiator_role, '{}'::jsonb
  );

  return jsonb_build_object('ok', true, 'recording', to_jsonb(v_recording));
end;
$$;

create or replace function public.complete_ride_safety_recording_upload(
  p_recording_id uuid,
  p_storage_path text,
  p_file_size_bytes bigint,
  p_mime_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recording public.ride_safety_recordings%rowtype;
  v_user_id uuid := auth.uid();
  v_expires_at timestamptz;
begin
  select * into v_recording from public.ride_safety_recordings where id = p_recording_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'recording_not_found');
  end if;

  if v_recording.initiator_user_id <> v_user_id then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_recording.status not in ('recording', 'uploaded') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  v_expires_at := now() + make_interval(days => coalesce(v_recording.retention_days, 14));

  update public.ride_safety_recordings
  set
    storage_path = p_storage_path,
    file_size_bytes = p_file_size_bytes,
    mime_type = p_mime_type,
    status = 'available',
    uploaded_at = now(),
    expires_at = v_expires_at,
    stopped_at = coalesce(stopped_at, now()),
    updated_at = now()
  where id = p_recording_id
  returning * into v_recording;

  perform public.log_ride_safety_recording_event(
    v_recording.id, v_recording.taxi_ride_id, 'uploaded', v_user_id,
    v_recording.initiator_role,
    jsonb_build_object('storage_path', p_storage_path, 'expires_at', v_expires_at)
  );

  return jsonb_build_object('ok', true, 'recording', to_jsonb(v_recording));
end;
$$;

create or replace function public.lock_ride_safety_recording_for_review(
  p_recording_id uuid,
  p_reason text default null,
  p_incident_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recording public.ride_safety_recordings%rowtype;
  v_user_id uuid := auth.uid();
begin
  if not public.is_staff_user(v_user_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.ride_safety_recordings
  set
    status = 'locked_for_review',
    locked_for_review = true,
    locked_reason = nullif(trim(p_reason), ''),
    lock_incident_id = p_incident_id,
    updated_at = now()
  where id = p_recording_id
  returning * into v_recording;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'recording_not_found');
  end if;

  perform public.log_ride_safety_recording_event(
    v_recording.id, v_recording.taxi_ride_id, 'locked_for_review', v_user_id, 'staff',
    jsonb_build_object('reason', p_reason, 'incident_id', p_incident_id)
  );

  return jsonb_build_object('ok', true, 'recording', to_jsonb(v_recording));
end;
$$;

create or replace function public.audit_ride_safety_recording_access(
  p_recording_id uuid,
  p_event_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recording public.ride_safety_recordings%rowtype;
  v_user_id uuid := auth.uid();
  v_role text := 'unknown';
begin
  select * into v_recording from public.ride_safety_recordings where id = p_recording_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'recording_not_found');
  end if;

  if not public.user_can_access_taxi_ride_storage(v_recording.taxi_ride_id, v_user_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_recording.status not in ('available', 'locked_for_review') then
    return jsonb_build_object('ok', false, 'error', 'not_available');
  end if;

  select case
    when tr.client_user_id = v_user_id then 'client'
    when tr.driver_id = v_user_id then 'driver'
    when public.is_staff_user(v_user_id) then 'staff'
    else 'unknown'
  end into v_role
  from public.taxi_rides tr where tr.id = v_recording.taxi_ride_id;

  perform public.log_ride_safety_recording_event(
    v_recording.id, v_recording.taxi_ride_id, p_event_type, v_user_id, v_role,
    jsonb_build_object('storage_path', v_recording.storage_path)
  );

  return jsonb_build_object('ok', true, 'recording_id', p_recording_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Retention purge (cron)
-- ---------------------------------------------------------------------------

create or replace function public.purge_expired_ride_safety_recordings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.ride_safety_recordings%rowtype;
  v_expired integer := 0;
  v_deleted integer := 0;
  v_warn3 integer := 0;
  v_warn24 integer := 0;
begin
  for v_row in
    select * from public.ride_safety_recordings
    where status in ('available', 'uploaded')
      and locked_for_review is not true
      and expires_at is not null
      and expires_at <= now() + interval '3 days'
      and expires_at > now()
      and warning_3d_sent_at is null
  loop
    update public.ride_safety_recordings
    set warning_3d_sent_at = now(), updated_at = now()
    where id = v_row.id;
    perform public.log_ride_safety_recording_event(
      v_row.id, v_row.taxi_ride_id, 'expiry_warning_3d', null, 'system', '{}'::jsonb
    );
    v_warn3 := v_warn3 + 1;
  end loop;

  for v_row in
    select * from public.ride_safety_recordings
    where status in ('available', 'uploaded')
      and locked_for_review is not true
      and expires_at is not null
      and expires_at <= now() + interval '24 hours'
      and expires_at > now()
      and warning_24h_sent_at is null
  loop
    update public.ride_safety_recordings
    set warning_24h_sent_at = now(), updated_at = now()
    where id = v_row.id;
    perform public.log_ride_safety_recording_event(
      v_row.id, v_row.taxi_ride_id, 'expiry_warning_24h', null, 'system', '{}'::jsonb
    );
    v_warn24 := v_warn24 + 1;
  end loop;

  for v_row in
    select * from public.ride_safety_recordings
    where status in ('available', 'uploaded')
      and locked_for_review is not true
      and expires_at is not null
      and expires_at <= now()
  loop
    update public.ride_safety_recordings
    set status = 'expired', updated_at = now()
    where id = v_row.id;
    perform public.log_ride_safety_recording_event(
      v_row.id, v_row.taxi_ride_id, 'expired', null, 'system', '{}'::jsonb
    );
    v_expired := v_expired + 1;
  end loop;

  update public.ride_safety_recordings
  set status = 'deleted', deleted_at = now(), updated_at = now()
  where status = 'expired'
    and locked_for_review is not true
    and deleted_at is null
    and expires_at <= now() - interval '1 hour';

  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'ok', true,
    'warnings_3d', v_warn3,
    'warnings_24h', v_warn24,
    'expired', v_expired,
    'marked_deleted', v_deleted
  );
end;
$$;

grant execute on function public.resolve_ride_safety_recording_rules(text, text, text) to authenticated;
grant execute on function public.start_ride_safety_recording(uuid, text) to authenticated;
grant execute on function public.stop_ride_safety_recording(uuid) to authenticated;
grant execute on function public.complete_ride_safety_recording_upload(uuid, text, bigint, text) to authenticated;
grant execute on function public.audit_ride_safety_recording_access(uuid, text) to authenticated;
grant execute on function public.lock_ride_safety_recording_for_review(uuid, text, uuid) to authenticated;
grant execute on function public.log_ride_safety_recording_event(uuid, uuid, text, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.purge_expired_ride_safety_recordings() to service_role;

-- ---------------------------------------------------------------------------
-- 7) Private storage bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ride-safety-recordings',
  'ride-safety-recordings',
  false,
  104857600,
  array['audio/m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'video/mp4', 'video/quicktime']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists ride_safety_recordings_select_participants on storage.objects;
create policy ride_safety_recordings_select_participants
  on storage.objects for select to authenticated
  using (
    bucket_id = 'ride-safety-recordings'
    and public.user_can_access_taxi_ride_storage(
      public.taxi_ride_id_from_storage_path(name), auth.uid()
    )
  );

drop policy if exists ride_safety_recordings_insert_participants on storage.objects;
create policy ride_safety_recordings_insert_participants
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ride-safety-recordings'
    and public.user_can_access_taxi_ride_storage(
      public.taxi_ride_id_from_storage_path(name), auth.uid()
    )
  );

drop policy if exists ride_safety_recordings_delete_service on storage.objects;
create policy ride_safety_recordings_delete_service
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'ride-safety-recordings'
    and (
      public.is_staff_user(auth.uid())
      or public.user_can_access_taxi_ride_storage(
        public.taxi_ride_id_from_storage_path(name), auth.uid()
      )
    )
  );

commit;
