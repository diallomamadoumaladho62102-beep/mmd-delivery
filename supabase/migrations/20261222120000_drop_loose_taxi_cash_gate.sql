-- Remove the two-argument cash gate.
-- It returned true for any pending_cash ride and ignored country and currency.
-- Accept and validate call the four-argument function. No SQL caller remains.
-- Does not change fares, commissions, ride rows, or the 150 m dropoff rule.

begin;

drop function if exists public.taxi_ride_payment_allows_dispatch(text, text);

revoke all on function public.taxi_ride_payment_allows_dispatch(text, text, text, text) from public, anon;

grant execute on function public.taxi_ride_payment_allows_dispatch(text, text, text, text) to authenticated, service_role;

commit;
