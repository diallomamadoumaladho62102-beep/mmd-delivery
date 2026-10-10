-- Throwaway concurrency check for a persisted segment booking.
-- Run two sessions with different client_id and idem values.
begin;
select public.create_guinea_xl_segment_booking(
  gen_random_uuid(),
  :'idem',
  :'client_id'::uuid,
  'a1111111-1111-4111-8111-111111111111',
  4,
  'conakry',
  'kindia',
  array[]::integer[],
  null
);
select pg_sleep(3);
commit;
