-- Throwaway end-to-end checks for segment departure creation and progress acceptance.
-- Do not run this against production.

insert into auth.users (id) values
  ('33333333-3333-4333-8333-333333333333'),
  ('11111111-1111-4111-8111-111111111111')
on conflict (id) do nothing;

do $$
declare
  v jsonb;
  v_rows integer;
  v_lat double precision;
  v_driver uuid;
  v_received timestamptz;
  v_service boolean;
  v_anon boolean;
begin
  select has_function_privilege('service_role', 'public.open_guinea_xl_segment_departure(uuid, uuid, integer, timestamptz, uuid[])', 'execute')
    into v_service;
  select has_function_privilege('anon', 'public.open_guinea_xl_segment_departure(uuid, uuid, integer, timestamptz, uuid[])', 'execute')
    into v_anon;
  if v_service is not true or v_anon is true then
    raise exception 'segment departure execute grants are wrong';
  end if;
  select has_function_privilege('service_role', 'public.accept_guinea_xl_progress_batch(uuid, jsonb)', 'execute')
    into v_service;
  select has_function_privilege('anon', 'public.accept_guinea_xl_progress_batch(uuid, jsonb)', 'execute')
    into v_anon;
  if v_service is not true or v_anon is true then
    raise exception 'progress execute grants are wrong';
  end if;

  v := public.open_guinea_xl_segment_departure(
    'e2222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    4,
    now(),
    array(select id from public.guinea_xl_segments where code in ('1', '2', '3', '4', '5') order by sequence)
  );
  if v->>'ok' <> 'true' or v->>'axis_id' is not null then
    raise exception 'segment departure was not created %', v;
  end if;
  select count(*) into v_rows from public.guinea_xl_departure_segments where departure_id = 'e2222222-2222-4222-8222-222222222222';
  if v_rows <> 5 then
    raise exception 'segment links were not attached';
  end if;
  select count(*) into v_rows from public.guinea_xl_seats where departure_id = 'e2222222-2222-4222-8222-222222222222';
  if v_rows <> 4 then
    raise exception 'seats were not created';
  end if;

  v := public.open_guinea_xl_segment_departure(
    'e4444444-4444-4444-8444-444444444444',
    '11111111-1111-4111-8111-111111111111',
    4,
    now(),
    array(select id from public.guinea_xl_segments where code in ('1', '8') order by sequence)
  );
  if v->>'error' <> 'xl_segment_path_invalid' then
    raise exception 'invalid path was kept %', v;
  end if;
  select count(*) into v_rows from public.guinea_xl_departures where id = 'e4444444-4444-4444-8444-444444444444';
  if v_rows <> 0 then
    raise exception 'invalid path left a departure';
  end if;

  v := public.accept_guinea_xl_progress_batch(
    '33333333-3333-4333-8333-333333333333',
    jsonb_build_array(
      jsonb_build_object(
        'event_id', 'e1111111-1111-4111-8111-111111111111',
        'departure_id', 'e2222222-2222-4222-8222-222222222222',
        'driver_id', '11111111-1111-4111-8111-111111111111',
        'kind', 'stop_reached',
        'stop_index', 0,
        'captured_at', now(),
        'received_at', now() - interval '2 days'
      ),
      jsonb_build_object(
        'event_id', 'e5555555-5555-4555-8555-555555555555',
        'departure_id', 'e2222222-2222-4222-8222-222222222222',
        'kind', 'stop_reached',
        'stop_index', 2,
        'captured_at', now()
      ),
      jsonb_build_object(
        'event_id', 'e3333333-3333-4333-8333-333333333333',
        'departure_id', 'e3333333-3333-4333-8333-333333333333',
        'kind', 'gps',
        'lat', 10,
        'lng', -13,
        'captured_at', now()
      )
    )
  );
  if v->'events'->0->>'error' is not null
    or v->'events'->1->>'error' <> 'xl_progress_inconsistent'
    or v->'events'->2->>'error' <> 'xl_departure_unavailable' then
    raise exception 'stop order or departure ownership was not checked %', v;
  end if;
  select driver_id, received_at into v_driver, v_received
  from public.guinea_xl_progress_events
  where event_id = 'e1111111-1111-4111-8111-111111111111';
  if v_driver <> '33333333-3333-4333-8333-333333333333' or v_received < now() - interval '5 minutes' then
    raise exception 'session identity or receipt time was replaced';
  end if;
  select count(*) into v_rows from public.guinea_xl_progress_events where event_id = 'e5555555-5555-4555-8555-555555555555';
  if v_rows <> 0 then
    raise exception 'an inconsistent stop was stored';
  end if;

  v := public.accept_guinea_xl_progress_batch(
    '11111111-1111-4111-8111-111111111111',
    jsonb_build_array(jsonb_build_object(
      'event_id', 'e6666666-6666-4666-8666-666666666666',
      'departure_id', 'e2222222-2222-4222-8222-222222222222',
      'driver_id', '33333333-3333-4333-8333-333333333333',
      'kind', 'gps',
      'lat', 10,
      'lng', -13,
      'captured_at', now()
    ))
  );
  if v->'events'->0->>'error' <> 'xl_departure_unavailable' then
    raise exception 'another driver was accepted %', v;
  end if;

  v := public.accept_guinea_xl_progress_batch(
    '33333333-3333-4333-8333-333333333333',
    jsonb_build_array(
      jsonb_build_object(
        'event_id', 'e7777777-7777-4777-8777-777777777777',
        'departure_id', 'e2222222-2222-4222-8222-222222222222',
        'kind', 'gps',
        'lat', 10.05,
        'lng', -12.86,
        'captured_at', now()
      ),
      jsonb_build_object(
        'event_id', 'e7777777-7777-4777-8777-777777777777',
        'departure_id', 'e2222222-2222-4222-8222-222222222222',
        'kind', 'gps',
        'lat', 99,
        'lng', -12.86,
        'captured_at', now()
      ),
      jsonb_build_object(
        'event_id', 'e8888888-8888-4888-8888-888888888888',
        'departure_id', 'e2222222-2222-4222-8222-222222222222',
        'kind', 'stop_reached',
        'stop_index', 1,
        'captured_at', now()
      ),
      jsonb_build_object(
        'event_id', 'e9999999-9999-4999-8999-999999999999',
        'departure_id', 'e2222222-2222-4222-8222-222222222222',
        'kind', 'passenger_dropped_off',
        'stop_index', 1,
        'captured_at', now()
      )
    )
  );
  if v->'events'->1->>'idempotent' <> 'true' or v->'events'->3->>'error' is not null then
    raise exception 'sync did not keep the first fix or the dropoff %', v;
  end if;
  select lat into v_lat from public.guinea_xl_progress_events where event_id = 'e7777777-7777-4777-8777-777777777777';
  if v_lat <> 10.05 then
    raise exception 'a repeated upload replaced the stored fix';
  end if;
end $$;
