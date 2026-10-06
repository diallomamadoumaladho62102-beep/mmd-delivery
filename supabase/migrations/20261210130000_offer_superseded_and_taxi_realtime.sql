-- Food and package offer tables were created in production before the
-- migration that allows status 'superseded'. CREATE TABLE IF NOT EXISTS left
-- the narrower check in place, so accepting one of several live offers fails
-- when the accept function closes the others. Taxi already allows the status.
-- Also publish taxi_rides without the boarding code.

begin;

alter table public.driver_order_offers
  drop constraint if exists driver_order_offers_status_check;

alter table public.driver_order_offers
  add constraint driver_order_offers_status_check
  check (status in ('pending', 'accepted', 'rejected', 'expired', 'superseded'));

alter table public.delivery_request_driver_offers
  drop constraint if exists delivery_request_driver_offers_status_check;

alter table public.delivery_request_driver_offers
  add constraint delivery_request_driver_offers_status_check
  check (status in ('pending', 'accepted', 'rejected', 'expired', 'superseded'));

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'taxi_rides'
  ) then
    alter publication supabase_realtime add table public.taxi_rides;
  end if;
end $$;

select public.mmd_sync_trip_column_privileges('taxi_rides');

commit;
