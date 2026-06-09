-- Taxi Premium P0 remediation: Sprint 3 RPC grants for service_role backend.

begin;

grant execute on function public.create_or_join_taxi_shared_ride(uuid) to service_role;
grant execute on function public.apply_taxi_shared_ride_discounts(uuid) to service_role;
grant execute on function public.all_taxi_shared_passengers_paid(uuid) to service_role;
grant execute on function public.mark_taxi_shared_passenger_paid(uuid) to service_role;
grant execute on function public.sync_taxi_shared_ride_driver(uuid, uuid) to service_role;

grant execute on function public.validate_taxi_business_ride(uuid, uuid, integer) to service_role;
grant execute on function public.record_taxi_business_billing_event(uuid, uuid, uuid, integer, text, jsonb) to service_role;
grant execute on function public.is_taxi_business_member(uuid, uuid, text[]) to service_role;

grant execute on function public.refresh_taxi_driver_quality_score(uuid) to service_role;
grant execute on function public.admin_set_taxi_driver_premium(uuid, boolean, uuid) to service_role;

commit;
