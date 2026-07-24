-- Driver vehicle primary photo (client tracking identification).
-- Stores an avatars-bucket object path: drivers/{user_id}/vehicles/{vehicle_id}/primary.jpg
-- Snapshot on taxi accept is filled via BEFORE trigger so accept RPCs need not be rewritten.

alter table public.driver_vehicles
  add column if not exists photo_url text;

comment on column public.driver_vehicles.photo_url is
  'Primary vehicle photo object path in public avatars bucket (drivers/{user_id}/vehicles/{vehicle_id}/primary.jpg). Nullable for legacy vehicles.';

-- When a ride is assigned a vehicle, freeze the current vehicle photo into the snapshot.
create or replace function public.taxi_rides_freeze_vehicle_photo_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_photo text;
begin
  if new.assigned_vehicle_id is null then
    return new;
  end if;

  -- Freeze only at assignment / reassignment (or first time driver is attached).
  if tg_op = 'INSERT'
     or new.assigned_vehicle_id is distinct from old.assigned_vehicle_id
     or (old.driver_id is null and new.driver_id is not null)
  then
    select nullif(trim(dv.photo_url), '')
      into v_photo
    from public.driver_vehicles dv
    where dv.id = new.assigned_vehicle_id
      and dv.deleted_at is null;

    new.vehicle_photo_url_snapshot := v_photo;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_taxi_rides_freeze_vehicle_photo on public.taxi_rides;
create trigger trg_taxi_rides_freeze_vehicle_photo
before insert or update of assigned_vehicle_id, driver_id
on public.taxi_rides
for each row
execute function public.taxi_rides_freeze_vehicle_photo_snapshot();

-- Backfill snapshots for active assigned rides that already have a vehicle photo.
update public.taxi_rides t
set vehicle_photo_url_snapshot = nullif(trim(dv.photo_url), '')
from public.driver_vehicles dv
where t.assigned_vehicle_id = dv.id
  and dv.deleted_at is null
  and nullif(trim(dv.photo_url), '') is not null
  and t.vehicle_photo_url_snapshot is null
  and t.driver_id is not null
  and lower(coalesce(t.status, '')) in (
    'accepted', 'queued', 'driver_arrived', 'in_progress', 'completed'
  );
