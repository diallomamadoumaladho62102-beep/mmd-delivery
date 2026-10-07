-- Mark when the pickup wait fee has been added to the quoted trip total.
-- Does not change the wait rate. Prevents a retry from adding the same fee twice.

begin;

alter table public.taxi_rides
  add column if not exists wait_fee_applied_to_total boolean not null default false;

comment on column public.taxi_rides.wait_fee_applied_to_total is
  'True after the server has added the finalized pickup wait fee to total_cents once.';

commit;
