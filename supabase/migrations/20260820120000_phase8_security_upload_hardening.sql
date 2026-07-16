-- Phase 8 security: tighten storage MIME/size for location attachments
-- and validate ride-safety recording storage paths inside the completion RPC.

begin;

-- ---------------------------------------------------------------------------
-- 1) location-attachments: private + MIME/size limits
-- ---------------------------------------------------------------------------

update storage.buckets
set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'location-attachments';

-- ---------------------------------------------------------------------------
-- 2) driver-identity-selfies: reinforce MIME/size if bucket exists
-- ---------------------------------------------------------------------------

update storage.buckets
set
  public = false,
  file_size_limit = coalesce(file_size_limit, 8388608),
  allowed_mime_types = coalesce(
    nullif(allowed_mime_types, '{}'::text[]),
    array['image/jpeg', 'image/png', 'image/webp']
  )
where id = 'driver-identity-selfies';

-- ---------------------------------------------------------------------------
-- 3) complete_ride_safety_recording_upload: reject path traversal / foreign prefix
-- ---------------------------------------------------------------------------

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
  v_path text := trim(coalesce(p_storage_path, ''));
  v_mime text := lower(trim(coalesce(p_mime_type, '')));
  v_expected_prefix text;
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

  if v_path = ''
     or position('..' in v_path) > 0
     or position(E'\\' in v_path) > 0
     or left(v_path, 1) = '/' then
    return jsonb_build_object('ok', false, 'error', 'invalid_storage_path');
  end if;

  v_expected_prefix := v_recording.taxi_ride_id::text || '/' || v_recording.id::text || '/';
  if left(v_path, length(v_expected_prefix)) <> v_expected_prefix then
    return jsonb_build_object('ok', false, 'error', 'invalid_storage_path_prefix');
  end if;

  if p_file_size_bytes is null or p_file_size_bytes <= 0 or p_file_size_bytes > 104857600 then
    return jsonb_build_object('ok', false, 'error', 'invalid_file_size');
  end if;

  if v_mime not in (
    'audio/m4a',
    'audio/mp4',
    'audio/aac',
    'audio/mpeg',
    'video/mp4',
    'video/quicktime'
  ) then
    return jsonb_build_object('ok', false, 'error', 'mime_not_allowed');
  end if;

  v_expires_at := now() + make_interval(days => coalesce(v_recording.retention_days, 14));

  update public.ride_safety_recordings
  set
    storage_path = v_path,
    file_size_bytes = p_file_size_bytes,
    mime_type = v_mime,
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
    jsonb_build_object('storage_path', v_path, 'expires_at', v_expires_at)
  );

  return jsonb_build_object('ok', true, 'recording', to_jsonb(v_recording));
end;
$$;

revoke all on function public.complete_ride_safety_recording_upload(uuid, text, bigint, text) from public;
grant execute on function public.complete_ride_safety_recording_upload(uuid, text, bigint, text) to authenticated;
grant execute on function public.complete_ride_safety_recording_upload(uuid, text, bigint, text) to service_role;

comment on function public.complete_ride_safety_recording_upload(uuid, text, bigint, text) is
  'Phase 8: complete safety recording upload with path/MIME/size validation. No live money.';

commit;
