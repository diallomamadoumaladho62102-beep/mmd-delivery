-- XL segment departures and driver progress events.
-- Do not apply this file with supabase db push.
-- It stays outside supabase/migrations so supabase db push cannot run it.
-- It does not change a fare, a commission, Taxi Standard, or segment confirmation.

begin;

create table if not exists public.guinea_xl_progress_events (
  event_id uuid primary key,
  departure_id uuid not null references public.guinea_xl_departures (id) on delete cascade,
  driver_id uuid not null references auth.users (id),
  kind text not null check (kind in (
    'gps',
    'stop_reached',
    'passenger_picked_up',
    'passenger_dropped_off',
    'progress_reconciled'
  )),
  stop_index integer check (stop_index is null or stop_index >= 0),
  lat double precision,
  lng double precision,
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists guinea_xl_progress_events_departure_idx
  on public.guinea_xl_progress_events (departure_id, received_at);

revoke all on public.guinea_xl_progress_events from public, anon, authenticated;
grant select, insert on public.guinea_xl_progress_events to service_role;
alter table public.guinea_xl_progress_events enable row level security;

create or replace function public.open_guinea_xl_segment_departure(
  p_departure_id uuid,
  p_driver_id uuid,
  p_capacity integer,
  p_scheduled_at timestamptz,
  p_segment_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_existing public.guinea_xl_departures%rowtype;
  v_previous text;
  v_segment record;
  v_codes text[] := array[]::text[];
  v_seats integer;
  v_links integer;
begin
  if p_departure_id is null or p_driver_id is null or p_capacity is null
     or p_capacity not in (4, 5, 6, 7)
     or p_segment_ids is null or cardinality(p_segment_ids) < 1
     or cardinality(p_segment_ids) <> (select count(distinct id) from unnest(p_segment_ids) as id)
  then
    return jsonb_build_object('ok', false, 'error', 'xl_booking_invalid');
  end if;

  select * into v_existing from public.guinea_xl_departures where id = p_departure_id;
  if found then
    if v_existing.driver_id = p_driver_id and v_existing.segment_run is true and v_existing.axis_id is null then
      return jsonb_build_object('ok', true, 'idempotent', true, 'departure_id', p_departure_id, 'axis_id', null);
    end if;
    return jsonb_build_object('ok', false, 'error', 'xl_departure_unavailable');
  end if;

  select count(*) into v_count
  from unnest(p_segment_ids) with ordinality as requested(id, position)
  join public.guinea_xl_segments segment on segment.id = requested.id
  where segment.active = true;
  if v_count <> cardinality(p_segment_ids) then
    return jsonb_build_object('ok', false, 'error', 'xl_segment_path_invalid');
  end if;

  v_previous := null;
  for v_segment in
    select segment.origin_label, segment.destination_label, segment.code
    from unnest(p_segment_ids) with ordinality as requested(id, position)
    join public.guinea_xl_segments segment on segment.id = requested.id
    order by requested.position
  loop
    if v_previous is not null and v_segment.origin_label is distinct from v_previous then
      return jsonb_build_object('ok', false, 'error', 'xl_segment_path_invalid');
    end if;
    v_previous := v_segment.destination_label;
    v_codes := v_codes || v_segment.code;
  end loop;

  insert into public.guinea_xl_departures (
    id, axis_id, segment_run, driver_id, passenger_capacity, scheduled_at, status, country_code, currency
  ) values (
    p_departure_id, null, true, p_driver_id, p_capacity, p_scheduled_at, 'open', 'GN', 'GNF'
  );

  insert into public.guinea_xl_departure_segments (departure_id, segment_id, position)
  select p_departure_id, requested.id, requested.position::integer
  from unnest(p_segment_ids) with ordinality as requested(id, position);

  select count(*) into v_links
  from public.guinea_xl_departure_segments
  where departure_id = p_departure_id;
  if v_links <> cardinality(p_segment_ids) then
    raise exception 'xl_segment_link_failed';
  end if;

  select count(*) into v_seats
  from public.guinea_xl_seats
  where departure_id = p_departure_id;
  if v_seats <> p_capacity then
    raise exception 'xl_seats_missing';
  end if;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'departure_id', p_departure_id,
    'axis_id', null,
    'segment_run', true,
    'segment_codes', to_jsonb(v_codes)
  );
exception
  when foreign_key_violation then
    return jsonb_build_object('ok', false, 'error', 'xl_departure_unavailable');
  when others then
    if sqlerrm in ('xl_segment_link_failed', 'xl_seats_missing', 'xl_departure_unavailable') then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end if;
    raise;
end;
$$;

revoke all on function public.open_guinea_xl_segment_departure(uuid, uuid, integer, timestamptz, uuid[]) from public, anon, authenticated;
grant execute on function public.open_guinea_xl_segment_departure(uuid, uuid, integer, timestamptz, uuid[]) to service_role;

create or replace function public.accept_guinea_xl_progress_batch(
  p_driver_id uuid,
  p_events jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event jsonb;
  v_id uuid;
  v_departure uuid;
  v_kind text;
  v_captured timestamptz;
  v_idempotent boolean;
  v_row public.guinea_xl_progress_events%rowtype;
  v_prev record;
  v_rows jsonb := '[]'::jsonb;
  v_owned boolean;
  v_stop integer;
  v_index integer;
  v_lat double precision;
  v_lng double precision;
  v_reason text;
  v_links integer;
begin
  if p_driver_id is null or jsonb_typeof(p_events) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'xl_booking_invalid');
  end if;

  for v_event in select value from jsonb_array_elements(p_events)
  loop
    begin
      v_id := (v_event->>'event_id')::uuid;
      v_departure := (v_event->>'departure_id')::uuid;
      v_kind := v_event->>'kind';
      v_captured := (v_event->>'captured_at')::timestamptz;
      v_idempotent := false;
      if v_id is null or v_departure is null or v_captured is null or v_kind is null then
        raise exception 'xl_booking_invalid';
      end if;
      -- The authenticated driver is p_driver_id. A driver id in the event is ignored.
      -- A client receipt time is ignored. received_at is written only on insert.
      select * into v_row
      from public.guinea_xl_progress_events
      where event_id = v_id;
      if found then
        if v_row.driver_id is distinct from p_driver_id then
          raise exception 'xl_departure_unavailable';
        end if;
        v_idempotent := true;
      else
        v_owned := false;
        select true into v_owned
        from public.guinea_xl_departures
        where id = v_departure and driver_id = p_driver_id and segment_run is true;
        if v_owned is not true then
          raise exception 'xl_departure_unavailable';
        end if;
        if v_captured > clock_timestamp() + interval '2 minutes'
          or v_captured < clock_timestamp() - interval '6 hours' then
          raise exception 'xl_progress_clock';
        end if;
        v_stop := nullif(v_event->>'stop_index', '')::integer;
        v_lat := nullif(v_event->>'lat', '')::double precision;
        v_lng := nullif(v_event->>'lng', '')::double precision;
        v_reason := nullif(btrim(coalesce(v_event->>'reason', '')), '');
        if v_kind = 'gps' then
          if v_lat is null or v_lng is null or v_lat < -90 or v_lat > 90
            or v_lng < -180 or v_lng > 180 or (v_lat = 0 and v_lng = 0) then
            raise exception 'xl_progress_invalid';
          end if;
        elsif v_kind in ('stop_reached', 'passenger_picked_up', 'passenger_dropped_off', 'progress_reconciled') then
          if v_kind = 'progress_reconciled' and v_reason is null then
            raise exception 'xl_progress_inconsistent';
          end if;
          if v_stop is null or v_stop < 0 then
            raise exception 'xl_progress_inconsistent';
          end if;
          select count(*) into v_links
          from public.guinea_xl_departure_segments
          where departure_id = v_departure;
          if v_stop > v_links then
            raise exception 'xl_progress_inconsistent';
          end if;
          v_index := null;
          for v_prev in
            select kind, stop_index
            from public.guinea_xl_progress_events
            where departure_id = v_departure and driver_id = p_driver_id and kind <> 'gps'
            order by received_at asc, captured_at asc
          loop
            if v_prev.kind in ('passenger_picked_up', 'passenger_dropped_off') then
              if v_index is null or v_prev.stop_index is distinct from v_index then
                raise exception 'xl_progress_inconsistent';
              end if;
            elsif v_index is null then
              if v_prev.stop_index is distinct from 0 then
                raise exception 'xl_progress_inconsistent';
              end if;
              v_index := 0;
            elsif v_prev.stop_index = v_index then
              null;
            elsif v_prev.stop_index = v_index + 1 then
              v_index := v_prev.stop_index;
            else
              raise exception 'xl_progress_inconsistent';
            end if;
          end loop;
          if v_kind in ('passenger_picked_up', 'passenger_dropped_off') then
            if v_index is null or v_stop is distinct from v_index then
              raise exception 'xl_progress_inconsistent';
            end if;
            if exists (
              select 1 from public.guinea_xl_progress_events
              where departure_id = v_departure and driver_id = p_driver_id
                and kind = v_kind and stop_index = v_stop
            ) then
              raise exception 'xl_progress_duplicate';
            end if;
          elsif v_index is null then
            if v_stop <> 0 then
              raise exception 'xl_progress_inconsistent';
            end if;
          elsif v_stop <> v_index + 1 then
            raise exception 'xl_progress_inconsistent';
          end if;
        else
          raise exception 'xl_progress_invalid';
        end if;
        insert into public.guinea_xl_progress_events (
          event_id, departure_id, driver_id, kind, stop_index, lat, lng, captured_at, received_at, reason
        ) values (
          v_id,
          v_departure,
          p_driver_id,
          v_kind,
          v_stop,
          v_lat,
          v_lng,
          v_captured,
          clock_timestamp(),
          v_reason
        );
        select * into v_row
        from public.guinea_xl_progress_events
        where event_id = v_id and driver_id = p_driver_id;
        if not found then
          raise exception 'xl_departure_unavailable';
        end if;
      end if;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'event_id', v_row.event_id,
        'received_at', v_row.received_at,
        'captured_at', v_row.captured_at,
        'kind', v_row.kind,
        'stop_index', v_row.stop_index,
        'lat', v_row.lat,
        'lng', v_row.lng,
        'reason', v_row.reason,
        'idempotent', v_idempotent
      ));
    exception
      when others then
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
          'event_id', v_event->>'event_id',
          'error', sqlerrm
        ));
    end;
  end loop;

  return jsonb_build_object('ok', true, 'events', v_rows);
end;
$$;

revoke all on function public.accept_guinea_xl_progress_batch(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.accept_guinea_xl_progress_batch(uuid, jsonb) to service_role;

commit;
