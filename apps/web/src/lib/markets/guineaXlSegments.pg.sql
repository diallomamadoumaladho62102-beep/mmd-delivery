-- Throwaway PostgreSQL checks for the pending XL segment migration.
-- Do not run this against production. It inserts a test axis and a test departure.

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333')
on conflict (id) do nothing;

insert into public.guinea_xl_axes (
  id, origin_key, destination_key, origin_label, destination_label, route_key,
  directional, front_seat_gnf, other_seat_gnf, active
) values (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'conakry', 'labe', 'Conakry', 'Labé', 'pg-test-conakry-labe',
  true, 100000, 100000, false
) on conflict (id) do nothing;

insert into public.guinea_xl_departures (
  id, axis_id, driver_id, passenger_capacity, status
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  '33333333-3333-4333-8333-333333333333',
  4, 'open'
) on conflict (id) do nothing;

insert into public.guinea_xl_seats (departure_id, seat_index, seat_role)
select 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', seat_index, case when seat_index = 1 then 'front' else 'other' end
from generate_series(1, 4) as seat_index
on conflict (departure_id, seat_index) do nothing;

do $$
declare
  v_active integer;
  v_confirmed integer;
  v_priced integer;
begin
  select count(*) into v_active from public.guinea_xl_segments where active = true;
  select count(*) into v_confirmed from public.guinea_xl_segments where confirmed = true;
  select count(*) into v_priced
  from public.guinea_xl_segments
  where distance_km is not null and duration_minutes is not null;
  if v_active <> 8 or v_confirmed <> 0 or v_priced <> 8 then
    raise exception 'local segment activation mismatch';
  end if;
end $$;

insert into public.guinea_xl_bookings (
  id, idempotency_key, client_user_id, driver_id, departure_id, axis_id, seat_indexes,
  status, payment_method, payment_status, rate_version,
  front_seat_gnf, other_seat_gnf, front_seat_count, other_seat_count,
  transport_gnf, baggage_gnf, total_gnf, platform_share_bps, platform_fee_gnf, driver_amount_gnf
) values
  (
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'segment-a',
    '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    array[2], 'confirmed', 'cash', 'pending_cash', 1,
    100000, 100000, 0, 1, 100000, 0, 100000, 1000, 10000, 90000
  ),
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'segment-b',
    '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    array[2], 'confirmed', 'cash', 'pending_cash', 1,
    100000, 100000, 0, 1, 100000, 0, 100000, 1000, 10000, 90000
  );

select public.reserve_guinea_xl_segment_seat(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  2,
  array[(select id from public.guinea_xl_segments where code = '1')],
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
);

select public.reserve_guinea_xl_segment_seat(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  2,
  array[(select id from public.guinea_xl_segments where code = '2')],
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
);

select public.reserve_guinea_xl_segment_seat(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  2,
  array[(select id from public.guinea_xl_segments where code = '1')],
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
);

do $$
begin
  perform public.reserve_guinea_xl_segment_seat(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    2,
    array[(select id from public.guinea_xl_segments where code = '1')],
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  );
  raise exception 'overlap was accepted';
exception
  when others then
    if sqlerrm <> 'xl_seat_taken' then
      raise;
    end if;
end $$;

do $$
declare
  v_result jsonb;
  v_rows integer;
begin
  v_result := public.create_guinea_xl_booking(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'axis-on-segment-seat',
    '11111111-1111-4111-8111-111111111111',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    array[2],
    jsonb_build_object(
      'currency', 'GNF',
      'country_code', 'GN',
      'payment_method', 'cash',
      'rate_version', 1,
      'front_seat_gnf', 100000,
      'other_seat_gnf', 100000,
      'front_seat_count', 0,
      'other_seat_count', 1,
      'transport_gnf', 100000,
      'baggage_gnf', 0,
      'total_gnf', 100000,
      'platform_share_bps', 1000,
      'platform_fee_gnf', 10000,
      'driver_amount_gnf', 90000,
      'baggage_lines', '[]'::jsonb
    )
  );
  if v_result->>'ok' <> 'false' or v_result->>'error' <> 'xl_seat_taken' then
    raise exception 'axis booking crossed a segment hold: %', v_result;
  end if;
  select count(*) into v_rows from public.guinea_xl_bookings where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  if v_rows <> 0 then
    raise exception 'rejected axis booking was kept';
  end if;
end $$;

do $$
declare
  v_result jsonb;
begin
  v_result := public.create_guinea_xl_booking(
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'axis-free-seat',
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    array[3],
    jsonb_build_object(
      'currency', 'GNF',
      'country_code', 'GN',
      'payment_method', 'cash',
      'rate_version', 1,
      'front_seat_gnf', 100000,
      'other_seat_gnf', 100000,
      'front_seat_count', 0,
      'other_seat_count', 1,
      'transport_gnf', 100000,
      'baggage_gnf', 0,
      'total_gnf', 100000,
      'platform_share_bps', 1000,
      'platform_fee_gnf', 10000,
      'driver_amount_gnf', 90000,
      'baggage_lines', '[]'::jsonb
    )
  );
  if v_result->>'ok' <> 'true' or v_result->>'idempotent' <> 'false' then
    raise exception 'free seat was not booked: %', v_result;
  end if;
  v_result := public.create_guinea_xl_booking(
    '99999999-9999-4999-8999-999999999999',
    'axis-free-seat',
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    array[3],
    jsonb_build_object(
      'currency', 'GNF',
      'country_code', 'GN',
      'payment_method', 'cash',
      'rate_version', 1,
      'front_seat_gnf', 100000,
      'other_seat_gnf', 100000,
      'front_seat_count', 0,
      'other_seat_count', 1,
      'transport_gnf', 100000,
      'baggage_gnf', 0,
      'total_gnf', 100000,
      'platform_share_bps', 1000,
      'platform_fee_gnf', 10000,
      'driver_amount_gnf', 90000,
      'baggage_lines', '[]'::jsonb
    )
  );
  if v_result->>'idempotent' <> 'true' then
    raise exception 'booking was not idempotent: %', v_result;
  end if;
end $$;

do $$
begin
  perform public.reserve_guinea_xl_segment_seat(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    3,
    array[(select id from public.guinea_xl_segments where code = '5')],
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  );
  raise exception 'segment booking crossed an axis seat';
exception
  when others then
    if sqlerrm <> 'xl_seat_taken' then
      raise;
    end if;
end $$;

do $$
begin
  update public.guinea_xl_bookings
  set transport_gnf = 100001
  where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  raise exception 'snapshot was writable';
exception
  when others then
    if sqlerrm <> 'xl_financial_snapshot_frozen' then
      raise;
    end if;
end $$;

begin;
select public.reserve_guinea_xl_segment_seat(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  1,
  array[(select id from public.guinea_xl_segments where code = '4')],
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
);
rollback;

do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows
  from public.guinea_xl_seat_segments
  where seat_index = 1;
  if v_rows <> 0 then
    raise exception 'rollback kept a segment hold';
  end if;
  select count(*) into v_rows
  from public.guinea_xl_seat_segments
  where departure_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and seat_index = 2;
  if v_rows <> 2 then
    raise exception 'successive holds were not kept';
  end if;
end $$;

insert into public.guinea_xl_bookings (
  id, idempotency_key, client_user_id, driver_id, departure_id, axis_id, seat_indexes,
  status, payment_method, payment_status, rate_version,
  front_seat_gnf, other_seat_gnf, front_seat_count, other_seat_count,
  transport_gnf, baggage_gnf, total_gnf, platform_share_bps, platform_fee_gnf, driver_amount_gnf
) values
  (
    '12121212-1212-4121-8121-121212121212', 'race-a',
    '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    array[4], 'confirmed', 'cash', 'pending_cash', 1,
    100000, 100000, 0, 1, 100000, 0, 100000, 1000, 10000, 90000
  ),
  (
    '13131313-1313-4131-8131-131313131313', 'race-b',
    '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    array[4], 'confirmed', 'cash', 'pending_cash', 1,
    100000, 100000, 0, 1, 100000, 0, 100000, 1000, 10000, 90000
  );

do $$
begin
  insert into public.guinea_xl_bookings (
    id, idempotency_key, client_user_id, driver_id, departure_id, axis_id, seat_indexes,
    status, payment_method, payment_status, rate_version,
    front_seat_gnf, other_seat_gnf, front_seat_count, other_seat_count,
    transport_gnf, baggage_gnf, total_gnf, platform_share_bps, platform_fee_gnf, driver_amount_gnf
  ) values (
    'abababab-abab-4aba-8aba-abababababab', 'bad-payment',
    '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    array[1], 'confirmed', 'cash', 'pending_cash', 1,
    100000, 100000, 1, 0, 100000, 0, 100000, 1000, 1, 90000
  );
  raise exception 'inconsistent payment was stored';
exception
  when check_violation then
    null;
end $$;

do $$
declare
  v jsonb;
begin
  v := public.quote_guinea_xl_segments('conakry', 'kindia');
  if (v->>'total_gnf')::integer <> 75200 or (v->>'definitive')::boolean <> false then
    raise exception 'kindia quote %', v;
  end if;
  v := public.quote_guinea_xl_segments('conakry', 'mamou');
  if (v->>'total_gnf')::integer <> 154100 then raise exception 'mamou quote %', v; end if;
  v := public.quote_guinea_xl_segments('conakry', 'pita');
  if (v->>'total_gnf')::integer <> 221800 then raise exception 'pita quote %', v; end if;
  v := public.quote_guinea_xl_segments('conakry', 'labe');
  if (v->>'total_gnf')::integer <> 251800 then raise exception 'labe quote %', v; end if;
  v := public.quote_guinea_xl_segments('mamou', 'labe');
  if (v->>'total_gnf')::integer <> 97700 then raise exception 'mamou labe quote %', v; end if;
  v := public.quote_guinea_xl_segments('conakry', 'yembering');
  if (v->>'total_gnf')::integer <> 299800 then raise exception 'yembering quote %', v; end if;
  v := public.quote_guinea_xl_segments('conakry', 'dougountounny');
  if (v->>'total_gnf')::integer <> 329800 then raise exception 'dougountounny quote %', v; end if;
  v := public.quote_guinea_xl_segments('conakry', 'malicentre');
  if (v->>'total_gnf')::integer <> 338800 or (v->'segment_codes')::jsonb ? '7' then
    raise exception 'mali quote %', v;
  end if;
  v := public.quote_guinea_xl_segments('kindia', 'conakry');
  if v->>'error' <> 'xl_segment_path_invalid' then raise exception 'reverse quote %', v; end if;
  v := public.quote_guinea_xl_segments('dougountounny', 'malicentre');
  if v->>'error' <> 'xl_segment_path_invalid' then raise exception 'branch quote %', v; end if;
end $$;

update public.guinea_xl_segments set confirmed = true where code in ('1', '2');

insert into public.guinea_xl_departures (
  id, axis_id, driver_id, passenger_capacity, status, segment_run
) values (
  'a1111111-1111-4111-8111-111111111111',
  null,
  '33333333-3333-4333-8333-333333333333',
  4,
  'open',
  true
);

insert into public.guinea_xl_departure_segments (departure_id, segment_id, position)
select 'a1111111-1111-4111-8111-111111111111', id, sequence::integer
from public.guinea_xl_segments
where code in ('1', '2', '3', '4', '5', '6', '7');

do $$
declare
  v jsonb;
  v_rows integer;
begin
  v := public.create_guinea_xl_segment_booking(
    'a2222222-2222-4222-8222-222222222222',
    'seg-a',
    '11111111-1111-4111-8111-111111111111',
    'a1111111-1111-4111-8111-111111111111',
    2,
    'conakry',
    'kindia',
    array[8],
    null
  );
  if v->>'ok' <> 'true'
     or (v->>'transport_gnf')::integer <> 75200
     or (v->>'baggage_gnf')::integer <> 30000
     or (v->>'platform_fee_gnf')::integer <> 7520
     or (v->>'driver_amount_gnf')::integer <> 67680
     or (v->>'total_gnf')::integer <> 105200
  then
    raise exception 'segment booking amounts %', v;
  end if;
  if (v->>'platform_fee_gnf')::integer <> ((v->>'transport_gnf')::integer * 1000 + 5000) / 10000 then
    raise exception 'commission used baggage';
  end if;

  v := public.create_guinea_xl_segment_booking(
    'a3333333-3333-4333-8333-333333333333',
    'seg-b',
    '22222222-2222-4222-8222-222222222222',
    'a1111111-1111-4111-8111-111111111111',
    2,
    'kindia',
    'mamou',
    array[]::integer[],
    null
  );
  if v->>'ok' <> 'true' or (v->>'transport_gnf')::integer <> 78900 then
    raise exception 'successive segment booking %', v;
  end if;

  v := public.create_guinea_xl_segment_booking(
    'a4444444-4444-4444-8444-444444444444',
    'seg-overlap',
    '33333333-3333-4333-8333-333333333333',
    'a1111111-1111-4111-8111-111111111111',
    2,
    'conakry',
    'mamou',
    array[]::integer[],
    null
  );
  if v->>'error' <> 'xl_seat_taken' then
    raise exception 'overlap was accepted %', v;
  end if;
  select count(*) into v_rows from public.guinea_xl_bookings where id = 'a4444444-4444-4444-8444-444444444444';
  if v_rows <> 0 then
    raise exception 'failed overlap booking was kept';
  end if;

  v := public.create_guinea_xl_segment_booking(
    'a6666666-6666-4666-8666-666666666666',
    'seg-a',
    '11111111-1111-4111-8111-111111111111',
    'a1111111-1111-4111-8111-111111111111',
    2,
    'conakry',
    'kindia',
    array[8],
    null
  );
  if v->>'idempotent' <> 'true' or v->>'booking_id' <> 'a2222222-2222-4222-8222-222222222222' then
    raise exception 'segment booking was not idempotent %', v;
  end if;

  v := public.create_guinea_xl_segment_booking(
    'a7777777-7777-4777-8777-777777777777',
    'seg-unconfirmed',
    '22222222-2222-4222-8222-222222222222',
    'a1111111-1111-4111-8111-111111111111',
    1,
    'labe',
    'yembering',
    array[]::integer[],
    null
  );
  if v->>'error' <> 'xl_segment_unconfirmed' then
    raise exception 'unconfirmed segment was sold %', v;
  end if;

  v := public.create_guinea_xl_segment_booking(
    'a8888888-8888-4888-8888-888888888888',
    'seg-claimed',
    '22222222-2222-4222-8222-222222222222',
    'a1111111-1111-4111-8111-111111111111',
    1,
    'conakry',
    'kindia',
    array[]::integer[],
    1
  );
  if v->>'error' <> 'xl_client_total_rejected' then
    raise exception 'client total was accepted %', v;
  end if;

  v := public.create_guinea_xl_segment_booking(
    'a9999999-9999-4999-8999-999999999999',
    'seg-front',
    '33333333-3333-4333-8333-333333333333',
    'a1111111-1111-4111-8111-111111111111',
    1,
    'conakry',
    'kindia',
    array[]::integer[],
    null
  );
  if (v->>'transport_gnf')::integer <> 75200 then
    raise exception 'front seat changed the price %', v;
  end if;

  update public.guinea_xl_bookings
  set payment_status = 'cash_collected'
  where id = 'a2222222-2222-4222-8222-222222222222' and payment_status = 'pending_cash';
  if not found then
    raise exception 'payment status did not move';
  end if;
end $$;

begin;
select public.create_guinea_xl_segment_booking(
  'a5555555-5555-4555-8555-555555555555',
  'seg-rollback',
  '11111111-1111-4111-8111-111111111111',
  'a1111111-1111-4111-8111-111111111111',
  4,
  'conakry',
  'kindia',
  array[]::integer[],
  null
);
rollback;

do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows from public.guinea_xl_bookings where id = 'a5555555-5555-4555-8555-555555555555';
  if v_rows <> 0 then
    raise exception 'rollback kept a segment booking';
  end if;
  update public.guinea_xl_bookings
  set transport_gnf = 1
  where id = 'a2222222-2222-4222-8222-222222222222';
  raise exception 'segment snapshot was writable';
exception
  when others then
    if sqlerrm <> 'xl_financial_snapshot_frozen' then
      raise;
    end if;
end $$;
