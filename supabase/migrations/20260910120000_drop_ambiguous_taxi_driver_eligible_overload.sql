-- Remove legacy 2-arg overload that conflicts with
-- is_taxi_driver_eligible(uuid, text, boolean) when callers pass 2 args.
-- Postgres cannot choose between (uuid,text) and (uuid,text,boolean DEFAULT).
-- Keep only the 3-arg signature (defaults allow 1- and 2-arg calls).

drop function if exists public.is_taxi_driver_eligible(uuid, text);

revoke all on function public.is_taxi_driver_eligible(uuid, text, boolean)
  from public, anon;
grant execute on function public.is_taxi_driver_eligible(uuid, text, boolean)
  to authenticated, service_role;
