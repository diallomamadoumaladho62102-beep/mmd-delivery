-- Promote queued next-ride using the driver that owned the ending ride.
-- Admin/client cancel clears driver_id on the same status update; relying only
-- on NEW.driver_id left queued siblings stuck forever.

create or replace function public.promote_queued_taxi_ride_after_current()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next public.taxi_rides%rowtype;
  v_driver_id uuid;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if lower(coalesce(old.status, '')) not in ('in_progress', 'accepted', 'driver_arrived', 'dispatching') then
    return new;
  end if;

  if lower(coalesce(new.status, '')) not in ('completed', 'canceled') then
    return new;
  end if;

  v_driver_id := coalesce(new.driver_id, old.driver_id);
  if v_driver_id is null then
    return new;
  end if;

  select * into v_next
  from public.taxi_rides
  where driver_id = v_driver_id
    and lower(coalesce(status, '')) = 'queued'
    and queued_after_ride_id = new.id
  order by created_at asc
  limit 1
  for update skip locked;

  if not found then
    return new;
  end if;

  update public.taxi_rides
  set
    status = 'accepted',
    accepted_at = coalesce(accepted_at, now()),
    queued_after_ride_id = null,
    updated_at = now()
  where id = v_next.id
    and lower(status) = 'queued';

  perform public.log_taxi_event(
    v_next.id,
    'next_ride_promoted',
    'queued',
    'accepted',
    v_driver_id,
    'system',
    'Queued next ride promoted after current ride ended',
    jsonb_build_object(
      'previous_ride_id', new.id,
      'previous_status', new.status,
      'driver_id_source', case
        when new.driver_id is not null then 'new'
        else 'old'
      end
    )
  );

  return new;
end;
$$;
