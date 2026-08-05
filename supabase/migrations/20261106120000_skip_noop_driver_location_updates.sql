-- Cut Disk I/O / WAL from high-frequency GPS upserts that do not move.
-- driver_locations upserts dominate exec time (~33% / 187k calls in pg_stat_statements).
-- Skip BEFORE UPDATE when coordinates are unchanged within ~1 m and a heartbeat
-- was written less than 60s ago.

begin;

create or replace function public.skip_noop_driver_location_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  eps constant double precision := 0.00001; -- ~1.1 m at equator
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if
    old.lat is not null
    and old.lng is not null
    and new.lat is not null
    and new.lng is not null
    and abs(new.lat - old.lat) < eps
    and abs(new.lng - old.lng) < eps
  then
    if
      old.updated_at is not null
      and new.updated_at is not null
      and new.updated_at < old.updated_at + interval '60 seconds'
    then
      return null; -- skip write entirely
    end if;

    -- Heartbeat-only: keep previous coordinates, allow updated_at refresh.
    new.lat := old.lat;
    new.lng := old.lng;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_skip_noop_driver_location_update on public.driver_locations;
create trigger trg_skip_noop_driver_location_update
  before update on public.driver_locations
  for each row
  execute function public.skip_noop_driver_location_update();

commit;
