-- Throwaway check for one segment departure and two compatible bookings.
-- Do not run this against production. It confirms segments only in this database.

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333')
on conflict (id) do nothing;

update public.guinea_xl_segments
set confirmed = true
where code in ('1', '2', '3', '4', '5');

insert into public.guinea_xl_departures (
  id, axis_id, segment_run, driver_id, passenger_capacity, status, scheduled_at
) values (
  'b2222222-2222-4222-8222-222222222222',
  null,
  true,
  '33333333-3333-4333-8333-333333333333',
  4,
  'open',
  now()
) on conflict (id) do nothing;

insert into public.guinea_xl_departure_segments (departure_id, segment_id, position)
select 'b2222222-2222-4222-8222-222222222222', id, sequence
from public.guinea_xl_segments
where code in ('1', '2', '3', '4', '5')
on conflict do nothing;

do $$
declare
  v jsonb;
  v_rows integer;
  v_fee integer;
  v_driver integer;
begin
  v := public.create_guinea_xl_segment_booking(
    'b3333333-3333-4333-8333-333333333333',
    'dispatch-dalaba-pita',
    '11111111-1111-4111-8111-111111111111',
    'b2222222-2222-4222-8222-222222222222',
    1,
    'dalaba',
    'pita',
    array[8],
    null
  );
  if v->>'ok' <> 'true' or (v->>'transport_gnf')::integer <> 32200 or (v->>'baggage_gnf')::integer <> 30000 then
    raise exception 'dalaba pita booking %', v;
  end if;
  v_fee := (v->>'platform_fee_gnf')::integer;
  v_driver := (v->>'driver_amount_gnf')::integer;
  if v_fee <> 3220 or v_driver <> 28980 or (v->>'total_gnf')::integer <> 62200 then
    raise exception 'dalaba pita money %', v;
  end if;

  v := public.create_guinea_xl_segment_booking(
    'b4444444-4444-4444-8444-444444444444',
    'dispatch-dalaba-pita',
    '11111111-1111-4111-8111-111111111111',
    'b2222222-2222-4222-8222-222222222222',
    1,
    'dalaba',
    'pita',
    array[8],
    null
  );
  if v->>'idempotent' <> 'true' or (v->>'total_gnf')::integer <> 62200 then
    raise exception 'dispatch booking was not idempotent %', v;
  end if;

  v := public.create_guinea_xl_segment_booking(
    'b5555555-5555-4555-8555-555555555555',
    'dispatch-conakry-mamou',
    '22222222-2222-4222-8222-222222222222',
    'b2222222-2222-4222-8222-222222222222',
    1,
    'conakry',
    'mamou',
    array[]::integer[],
    null
  );
  if v->>'ok' <> 'true' or (v->>'transport_gnf')::integer <> 154100 or (v->>'baggage_gnf')::integer <> 0 then
    raise exception 'successive booking %', v;
  end if;
  if (v->>'platform_fee_gnf')::integer <> 15410 or (v->>'driver_amount_gnf')::integer <> 138690 then
    raise exception 'successive commission %', v;
  end if;

  v := public.create_guinea_xl_segment_booking(
    'b6666666-6666-4666-8666-666666666666',
    'dispatch-overlap',
    '11111111-1111-4111-8111-111111111111',
    'b2222222-2222-4222-8222-222222222222',
    1,
    'mamou',
    'pita',
    array[]::integer[],
    null
  );
  if v->>'ok' <> 'false' or v->>'error' <> 'xl_seat_taken' then
    raise exception 'overlap was accepted %', v;
  end if;
  select count(*) into v_rows from public.guinea_xl_bookings where id = 'b6666666-6666-4666-8666-666666666666';
  if v_rows <> 0 then
    raise exception 'failed overlap booking was kept';
  end if;
end $$;
