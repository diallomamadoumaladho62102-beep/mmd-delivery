-- Driver Safety Audio (independent of client_audio and driver_video).
-- Each party records only on their own device after explicit start + mic permission.

alter table public.ride_safety_recording_rules
  add column if not exists driver_audio_allowed boolean not null default true;

-- Expand recording_type check to include driver_audio.
alter table public.ride_safety_recordings
  drop constraint if exists ride_safety_recordings_recording_type_check;

alter table public.ride_safety_recordings
  add constraint ride_safety_recordings_recording_type_check
  check (recording_type in ('client_audio', 'driver_audio', 'driver_video'));

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

  if p_recording_type not in ('client_audio', 'driver_audio', 'driver_video') then
    return jsonb_build_object('ok', false, 'error', 'invalid_recording_type');
  end if;

  if p_recording_type = 'client_audio' and v_role <> 'client' then
    return jsonb_build_object('ok', false, 'error', 'client_audio_only');
  end if;

  if p_recording_type in ('driver_audio', 'driver_video') and v_role <> 'driver' then
    return jsonb_build_object('ok', false, 'error', 'driver_recording_only');
  end if;

  v_rules := public.resolve_ride_safety_recording_rules(
    v_ride.country_code, null, v_ride.pickup_city
  );

  if p_recording_type = 'client_audio' and coalesce(v_rules.client_audio_allowed, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'client_audio_not_allowed_in_region');
  end if;

  if p_recording_type = 'driver_audio' and coalesce(v_rules.driver_audio_allowed, true) is not true then
    return jsonb_build_object('ok', false, 'error', 'driver_audio_not_allowed_in_region');
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
      'A safety recording is in progress on your device to protect this ride. The other party is notified but does not control your microphone.',
    'notify_other_party', true,
    'other_party_role', case when v_role = 'client' then 'driver' else 'client' end
  );
end;
$$;

grant execute on function public.start_ride_safety_recording(uuid, text) to authenticated;
