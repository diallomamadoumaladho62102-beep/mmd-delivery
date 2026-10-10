-- Throwaway concurrency check. Run this file in two sessions at the same time.
-- One session keeps the lock. The other must fail with xl_seat_taken.
begin;
select public.reserve_guinea_xl_segment_seat(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  1,
  array[(select id from public.guinea_xl_segments where code = '3')],
  :'booking_id'::uuid
);
select pg_sleep(3);
commit;
