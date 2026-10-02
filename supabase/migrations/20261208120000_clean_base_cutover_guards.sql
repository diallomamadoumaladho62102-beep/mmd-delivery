-- Clean-base cutover guards. Does not activate Minimum Pay or Driver Integrity.
-- Archives leftover is_test trips only. Never deletes live Stripe rows.
-- Trip-interval triggers skip test/archived sources so old TEST cannot enter MPR.

alter table public.driver_integrity_settings
  add column if not exists engine_start_at timestamptz;

comment on column public.driver_integrity_settings.engine_start_at is
  'Scan and operational actions apply only to assignments accepted on or after this instant. Null = fail-closed (no scan).';

update public.orders
set
  archived_at = coalesce(archived_at, now()),
  hidden_from_user = true
where coalesce(is_test, false) = true
  and (archived_at is null or hidden_from_user is distinct from true);

update public.delivery_requests
set
  archived_at = coalesce(archived_at, now()),
  hidden_from_user = true
where coalesce(is_test, false) = true
  and (archived_at is null or hidden_from_user is distinct from true);

update public.taxi_rides
set
  archived_at = coalesce(archived_at, now()),
  hidden_from_user = true
where coalesce(is_test, false) = true
  and (archived_at is null or hidden_from_user is distinct from true);

create or replace function public.minimum_pay_sync_order_trip()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_end timestamptz;
  v_reason text;
begin
  if new.driver_accepted_at is null or new.driver_id is null then
    return new;
  end if;
  if coalesce(new.is_test, false) = true or new.archived_at is not null then
    return new;
  end if;
  if new.delivered_at is not null or new.delivered_confirmed_at is not null then
    v_end := coalesce(new.delivered_at, new.delivered_confirmed_at);
    v_reason := 'completed';
  elsif new.cancelled_at is not null or lower(coalesce(new.status, '')) in ('canceled', 'cancelled') then
    v_end := coalesce(new.cancelled_at, now());
    v_reason := 'cancelled';
  end if;
  perform public.minimum_pay_sync_trip_interval(
    'order', new.id, new.driver_id, new.driver_accepted_at, v_end, v_reason
  );
  return new;
end;
$$;

create or replace function public.minimum_pay_sync_dr_trip()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_end timestamptz;
  v_reason text;
begin
  if new.driver_accepted_at is null or new.driver_id is null then
    return new;
  end if;
  if coalesce(new.is_test, false) = true or new.archived_at is not null then
    return new;
  end if;
  if new.delivered_at is not null then
    v_end := new.delivered_at;
    v_reason := 'completed';
  elsif new.cancelled_at is not null or lower(coalesce(new.status, '')) in ('canceled', 'cancelled') then
    v_end := coalesce(new.cancelled_at, now());
    v_reason := 'cancelled';
  end if;
  perform public.minimum_pay_sync_trip_interval(
    'delivery_request', new.id, new.driver_id, new.driver_accepted_at, v_end, v_reason
  );
  return new;
end;
$$;
