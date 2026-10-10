-- Throwaway checks for an atomic segment departure and idempotent progress events.
-- Do not run this against production.

insert into auth.users (id) values
  ('33333333-3333-4333-8333-333333333333')
on conflict (id) do nothing;

insert into public.guinea_xl_axes (
  id, origin_key, destination_key, origin_label, destination_label, route_key,
  directional, front_seat_gnf, other_seat_gnf, active
) values (
  'c5555555-5555-4555-8555-555555555555',
  'conakry', 'labe', 'Conakry', 'Labé', 'atomic-test-conakry-labe',
  true, 100000, 100000, false
) on conflict (id) do nothing;

insert into public.guinea_xl_departures (
  id, axis_id, driver_id, passenger_capacity, status
) values (
  'c6666666-6666-4666-8666-666666666666',
  'c5555555-5555-4555-8555-555555555555',
  '33333333-3333-4333-8333-333333333333',
  4,
  'open'
) on conflict (id) do nothing;

do $$
declare
  v jsonb;
  v_rows integer;
  v_axis integer;
begin
  update public.guinea_xl_segments set active = false where code = '4';
  v := public.open_guinea_xl_segment_departure(
    'c2222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    4,
    now(),
    array(select id from public.guinea_xl_segments where code in ('1', '2', '3', '4', '5') order by sequence)
  );
  update public.guinea_xl_segments set active = true where code = '4';
  if v->>'error' <> 'xl_segment_path_invalid' then
    raise exception 'inactive segment was opened %', v;
  end if;

  v := public.open_guinea_xl_segment_departure(
    'c7777777-7777-4777-8777-777777777777',
    '33333333-3333-4333-8333-333333333333',
    4,
    now(),
    array[
      (select id from public.guinea_xl_segments where code = '1'),
      (select id from public.guinea_xl_segments where code = '8')
    ]
  );
  if v->>'error' <> 'xl_segment_path_invalid' then
    raise exception 'broken path was opened %', v;
  end if;

  v := public.open_guinea_xl_segment_departure(
    'c8888888-8888-4888-8888-888888888888',
    'c9999999-9999-4999-8999-999999999999',
    4,
    now(),
    array(select id from public.guinea_xl_segments where code = '1' order by sequence)
  );
  if v->>'error' <> 'xl_departure_unavailable' then
    raise exception 'unknown driver was accepted %', v;
  end if;

  select count(*) into v_rows from public.guinea_xl_departures where segment_run = true;
  if v_rows <> 0 then
    raise exception 'a rejected segment departure was kept';
  end if;
  select count(*) into v_axis from public.guinea_xl_departures where id = 'c6666666-6666-4666-8666-666666666666' and segment_run = false;
  if v_axis <> 1 then
    raise exception 'axis departure was lost before success';
  end if;

  v := public.open_guinea_xl_segment_departure(
    'c2222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    4,
    now(),
    array(select id from public.guinea_xl_segments where code in ('1', '2', '3', '4', '5') order by sequence)
  );
  if v->>'ok' <> 'true' or v->>'axis_id' is not null or v->'segment_codes' <> '["1","2","3","4","5"]'::jsonb then
    raise exception 'segment departure was not created %', v;
  end if;
  select count(*) into v_rows from public.guinea_xl_seats where departure_id = 'c2222222-2222-4222-8222-222222222222';
  if v_rows <> 4 then
    raise exception 'seats were not created with the departure';
  end if;
  select count(*) into v_rows from public.guinea_xl_departure_segments where departure_id = 'c2222222-2222-4222-8222-222222222222';
  if v_rows <> 5 then
    raise exception 'segment links were not created with the departure';
  end if;

  v := public.open_guinea_xl_segment_departure(
    'c2222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    4,
    now(),
    array(select id from public.guinea_xl_segments where code in ('1', '2', '3', '4', '5') order by sequence)
  );
  if v->>'idempotent' <> 'true' then
    raise exception 'segment departure was not idempotent %', v;
  end if;
  select count(*) into v_rows from public.guinea_xl_departures where id = 'c2222222-2222-4222-8222-222222222222';
  if v_rows <> 1 then
    raise exception 'idempotent open duplicated the departure';
  end if;
end $$;

drop trigger if exists trg_guinea_xl_seed_seats on public.guinea_xl_departures;

do $$
declare
  v jsonb;
  v_rows integer;
begin
  v := public.open_guinea_xl_segment_departure(
    'c3333333-3333-4333-8333-333333333333',
    '33333333-3333-4333-8333-333333333333',
    4,
    now(),
    array(select id from public.guinea_xl_segments where code in ('1', '2', '3', '4', '5') order by sequence)
  );
  if v->>'error' <> 'xl_seats_missing' then
    raise exception 'missing seats were accepted %', v;
  end if;
  select count(*) into v_rows from public.guinea_xl_departures where id = 'c3333333-3333-4333-8333-333333333333';
  if v_rows <> 0 then
    raise exception 'seat failure kept a departure';
  end if;
  select count(*) into v_rows from public.guinea_xl_departure_segments where departure_id = 'c3333333-3333-4333-8333-333333333333';
  if v_rows <> 0 then
    raise exception 'seat failure kept segment links';
  end if;
  select count(*) into v_rows from public.guinea_xl_seats where departure_id = 'c3333333-3333-4333-8333-333333333333';
  if v_rows <> 0 then
    raise exception 'seat failure kept seats';
  end if;
end $$;

create trigger trg_guinea_xl_seed_seats
after insert on public.guinea_xl_departures
for each row execute function public.guinea_xl_seed_seats();

create or replace function public.test_xl_fail_link()
returns trigger
language plpgsql
as $$
begin
  raise exception 'xl_segment_link_failed';
end;
$$;

create trigger test_xl_fail_link
before insert on public.guinea_xl_departure_segments
for each row execute function public.test_xl_fail_link();

do $$
declare
  v jsonb;
  v_rows integer;
begin
  v := public.open_guinea_xl_segment_departure(
    'c4444444-4444-4444-8444-444444444444',
    '33333333-3333-4333-8333-333333333333',
    4,
    now(),
    array(select id from public.guinea_xl_segments where code in ('1', '2', '3', '4', '5') order by sequence)
  );
  if v->>'error' <> 'xl_segment_link_failed' then
    raise exception 'link failure was accepted %', v;
  end if;
  select count(*) into v_rows from public.guinea_xl_departures where id = 'c4444444-4444-4444-8444-444444444444';
  if v_rows <> 0 then
    raise exception 'link failure kept a departure';
  end if;
  select count(*) into v_rows from public.guinea_xl_seats where departure_id = 'c4444444-4444-4444-8444-444444444444';
  if v_rows <> 0 then
    raise exception 'link failure kept seats';
  end if;
end $$;

drop trigger if exists test_xl_fail_link on public.guinea_xl_departure_segments;
drop function if exists public.test_xl_fail_link();

do $$
declare
  v jsonb;
  v_rows integer;
  v_lat double precision;
begin
  v := public.accept_guinea_xl_progress_batch(
    '33333333-3333-4333-8333-333333333333',
    jsonb_build_array(jsonb_build_object(
      'event_id', 'd1111111-1111-4111-8111-111111111111',
      'departure_id', 'c2222222-2222-4222-8222-222222222222',
      'kind', 'gps',
      'lat', 11,
      'lng', -12,
      'captured_at', now()
    ))
  );
  if v->>'ok' <> 'true' then
    raise exception 'progress event was rejected %', v;
  end if;
  v := public.accept_guinea_xl_progress_batch(
    '33333333-3333-4333-8333-333333333333',
    jsonb_build_array(
      jsonb_build_object(
        'event_id', 'd1111111-1111-4111-8111-111111111111',
        'departure_id', 'c2222222-2222-4222-8222-222222222222',
        'kind', 'gps',
        'lat', 99,
        'lng', -12,
        'captured_at', now()
      ),
      jsonb_build_object(
        'event_id', 'd2222222-2222-4222-8222-222222222222',
        'departure_id', 'c2222222-2222-4222-8222-222222222222',
        'kind', 'gps',
        'lat', 8,
        'lng', -12,
        'captured_at', now() - interval '1 hour'
      )
    )
  );
  if v->>'ok' <> 'true' or (v->'events'->0->>'idempotent') <> 'true' then
    raise exception 'progress sync was not idempotent %', v;
  end if;
  select count(*) into v_rows from public.guinea_xl_progress_events where event_id = 'd1111111-1111-4111-8111-111111111111';
  select lat into v_lat from public.guinea_xl_progress_events where event_id = 'd1111111-1111-4111-8111-111111111111';
  if v_rows <> 1 or v_lat <> 11 then
    raise exception 'an older upload replaced the stored fix';
  end if;
  select count(*) into v_rows
  from public.guinea_xl_departures
  where id = 'c6666666-6666-4666-8666-666666666666' and axis_id = 'c5555555-5555-4555-8555-555555555555' and segment_run = false;
  if v_rows <> 1 then
    raise exception 'axis departure was changed';
  end if;
end $$;
