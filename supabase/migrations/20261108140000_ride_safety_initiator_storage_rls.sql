-- Tighten ride safety recordings to initiator-only (or staff), matching the
-- download API and product privacy copy. Peers must not read storage_path or
-- download/delete another party's recording objects via Storage RLS.

begin;

-- ---------------------------------------------------------------------------
-- Table SELECT: initiator or staff only
-- ---------------------------------------------------------------------------
drop policy if exists ride_safety_recordings_select_participants
  on public.ride_safety_recordings;
drop policy if exists ride_safety_recordings_select_initiator_or_staff
  on public.ride_safety_recordings;
create policy ride_safety_recordings_select_initiator_or_staff
  on public.ride_safety_recordings for select
  to authenticated
  using (
    initiator_user_id = auth.uid()
    or public.is_staff_user(auth.uid())
  );

drop policy if exists ride_safety_recording_events_select_participants
  on public.ride_safety_recording_events;
drop policy if exists ride_safety_recording_events_select_initiator_or_staff
  on public.ride_safety_recording_events;
create policy ride_safety_recording_events_select_initiator_or_staff
  on public.ride_safety_recording_events for select
  to authenticated
  using (
    exists (
      select 1
      from public.ride_safety_recordings r
      where r.id = recording_id
        and (
          r.initiator_user_id = auth.uid()
          or public.is_staff_user(auth.uid())
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Helper: object path is {rideId}/{recordingId}/...
-- ---------------------------------------------------------------------------
create or replace function public.ride_safety_recording_id_from_storage_path(
  p_object_name text
)
returns uuid
language plpgsql
immutable
as $$
declare
  v_part text := nullif(split_part(coalesce(p_object_name, ''), '/', 2), '');
begin
  if v_part is null or v_part !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return v_part::uuid;
end;
$$;

revoke all on function public.ride_safety_recording_id_from_storage_path(text) from public;
grant execute on function public.ride_safety_recording_id_from_storage_path(text) to authenticated, service_role;

create or replace function public.user_owns_ride_safety_storage_object(
  p_object_name text,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.ride_safety_recordings r
    where r.id = public.ride_safety_recording_id_from_storage_path(p_object_name)
      and r.initiator_user_id = p_user_id
      and r.taxi_ride_id = public.taxi_ride_id_from_storage_path(p_object_name)
  );
$$;

revoke all on function public.user_owns_ride_safety_storage_object(text, uuid) from public;
grant execute on function public.user_owns_ride_safety_storage_object(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storage: SELECT / INSERT / DELETE — initiator (or staff for delete/select)
-- ---------------------------------------------------------------------------
drop policy if exists ride_safety_recordings_select_participants on storage.objects;
drop policy if exists ride_safety_recordings_select_initiator on storage.objects;
create policy ride_safety_recordings_select_initiator
  on storage.objects for select to authenticated
  using (
    bucket_id = 'ride-safety-recordings'
    and (
      public.is_staff_user(auth.uid())
      or public.user_owns_ride_safety_storage_object(name, auth.uid())
    )
  );

drop policy if exists ride_safety_recordings_insert_participants on storage.objects;
drop policy if exists ride_safety_recordings_insert_initiator on storage.objects;
create policy ride_safety_recordings_insert_initiator
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'ride-safety-recordings'
    and public.user_owns_ride_safety_storage_object(name, auth.uid())
  );

drop policy if exists ride_safety_recordings_delete_service on storage.objects;
drop policy if exists ride_safety_recordings_delete_initiator_or_staff on storage.objects;
create policy ride_safety_recordings_delete_initiator_or_staff
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'ride-safety-recordings'
    and (
      public.is_staff_user(auth.uid())
      or public.user_owns_ride_safety_storage_object(name, auth.uid())
    )
  );

-- Audit log helper: only initiator, staff, or service_role should write events.
-- Keep grant for service_role; revoke broad authenticated execute and re-grant
-- only through security definer wrappers that already check ownership.
revoke execute on function public.log_ride_safety_recording_event(
  uuid, uuid, text, uuid, text, jsonb
) from authenticated;
grant execute on function public.log_ride_safety_recording_event(
  uuid, uuid, text, uuid, text, jsonb
) to service_role;

commit;
