-- Taxi cancellation reassignment + cancel policy schema + bidirectional ratings.

begin;

-- Policy seeds (mirror businessDefaults.ts)
insert into public.pricing_business_defaults (key, value_numeric, description, category)
values
  ('taxi_client_cancel_before_start_fee_pct', 30, 'Client cancel fee %% after accept before start', 'taxi'),
  ('taxi_driver_cancel_comp_not_at_dest_pct', 50, 'Driver compensation %% when client cancels after start, not at dest', 'taxi'),
  ('taxi_driver_cancel_comp_at_dest_pct', 100, 'Driver compensation %% when client cancels after start at dest', 'taxi'),
  ('taxi_destination_arrival_meters', 150, 'Meters from dropoff to treat driver as arrived at destination', 'taxi'),
  ('taxi_max_stops', 3, 'Maximum taxi stops per ride', 'taxi'),
  ('taxi_min_remaining_miles_for_dest_change', 0.3, 'Min remaining miles to old dropoff to allow destination change', 'taxi')
on conflict (key) do update
set
  value_numeric = excluded.value_numeric,
  description = excluded.description,
  category = excluded.category,
  updated_at = now();

alter table public.taxi_rides
  add column if not exists cancel_reason_code text,
  add column if not exists cancel_reason_detail text,
  add column if not exists cancel_fee_cents integer,
  add column if not exists driver_cancel_compensation_cents integer,
  add column if not exists reassigned_from_driver_id uuid,
  add column if not exists driver_release_count integer not null default 0;

comment on column public.taxi_rides.cancel_fee_cents is
  'Amount kept from client on cancellation (cents).';
comment on column public.taxi_rides.driver_cancel_compensation_cents is
  'Driver compensation cents when client cancels after start.';

-- Destination / stop change audit
create table if not exists public.taxi_ride_route_changes (
  id uuid primary key default gen_random_uuid(),
  taxi_ride_id uuid not null references public.taxi_rides (id) on delete cascade,
  change_type text not null check (change_type in ('destination', 'add_stop', 'remove_stop')),
  requested_by uuid not null references auth.users (id) on delete cascade,
  old_dropoff_address text,
  old_dropoff_lat double precision,
  old_dropoff_lng double precision,
  new_dropoff_address text,
  new_dropoff_lat double precision,
  new_dropoff_lng double precision,
  stop_address text,
  stop_lat double precision,
  stop_lng double precision,
  old_distance_miles numeric,
  new_distance_miles numeric,
  old_total_cents integer,
  new_total_cents integer,
  old_driver_payout_cents integer,
  new_driver_payout_cents integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists taxi_ride_route_changes_ride_idx
  on public.taxi_ride_route_changes (taxi_ride_id, created_at desc);

alter table public.taxi_ride_route_changes enable row level security;

drop policy if exists taxi_ride_route_changes_select_participants on public.taxi_ride_route_changes;
create policy taxi_ride_route_changes_select_participants
  on public.taxi_ride_route_changes
  for select
  to authenticated
  using (
    public.is_staff_user(auth.uid())
    or exists (
      select 1 from public.taxi_rides r
      where r.id = taxi_ride_id
        and (r.client_user_id = auth.uid() or r.driver_id = auth.uid())
    )
  );

grant select on public.taxi_ride_route_changes to authenticated;
grant all on public.taxi_ride_route_changes to service_role;

-- Bidirectional ratings: extend with ratee role + categories
alter table public.taxi_ride_ratings
  add column if not exists ratee_role text,
  add column if not exists client_id uuid references auth.users (id) on delete cascade,
  add column if not exists categories text[] not null default '{}',
  add column if not exists free_text text;

update public.taxi_ride_ratings
set ratee_role = coalesce(ratee_role, 'driver')
where ratee_role is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'taxi_ride_ratings_ratee_role_check'
  ) then
    alter table public.taxi_ride_ratings
      add constraint taxi_ride_ratings_ratee_role_check
      check (ratee_role in ('driver', 'client'));
  end if;
end $$;

-- Unique: one rating per rater+ride+ratee_role
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'taxi_ride_ratings_unique_ride_rater_role'
  ) then
    alter table public.taxi_ride_ratings
      drop constraint if exists taxi_ride_ratings_unique_ride_rater;
    alter table public.taxi_ride_ratings
      add constraint taxi_ride_ratings_unique_ride_rater_role
      unique (taxi_ride_id, rater_id, ratee_role);
  end if;
end $$;

create index if not exists taxi_ride_ratings_client_id_idx
  on public.taxi_ride_ratings (client_id, created_at desc)
  where client_id is not null;

-- Driver release: clear assignment and return ride to dispatch pool (NO cancel, NO refund).
create or replace function public.driver_cancel_taxi_ride(
  p_ride_id uuid,
  p_reason text default 'driver_cancelled'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_ride public.taxi_rides%rowtype;
  v_old_status text;
  v_reason text := left(coalesce(nullif(trim(p_reason), ''), 'driver_cancelled'), 120);
  v_next_status text;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if lower(coalesce(v_ride.status, '')) not in ('accepted', 'driver_arrived') then
    return jsonb_build_object('ok', false, 'message', 'invalid_status');
  end if;

  v_old_status := v_ride.status;
  v_next_status := case
    when lower(coalesce(v_ride.payment_status, '')) = 'paid' then 'dispatching'
    else 'paid'
  end;

  update public.taxi_rides
  set
    status = v_next_status,
    driver_id = null,
    reassigned_from_driver_id = v_driver_id,
    driver_release_count = coalesce(driver_release_count, 0) + 1,
    cancel_reason = v_reason,
    cancel_reason_code = left(v_reason, 64),
    cancelled_by = null,
    cancelled_at = null,
    pickup_verification_code = public.taxi_generate_pickup_verification_code(),
    started_at = null,
    updated_at = now()
  where id = p_ride_id
    and driver_id = v_driver_id
    and status = v_ride.status;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'status_changed');
  end if;

  -- Expire open offers so a fresh dispatch wave can run.
  update public.taxi_offers
  set status = 'expired', updated_at = now()
  where taxi_ride_id = p_ride_id
    and status = 'pending';

  -- Track driver cancellation activity (best-effort; never blocks release).
  begin
    update public.driver_profiles
    set
      cancellation_rate = least(
        1,
        coalesce(cancellation_rate, 0) + 0.01
      ),
      updated_at = now()
    where user_id = v_driver_id;
  exception when others then
    null;
  end;

  perform public.log_taxi_event(
    p_ride_id,
    'driver_release_reassign',
    v_old_status,
    v_next_status,
    v_driver_id,
    'driver',
    'Driver released accepted taxi ride for reassignment',
    jsonb_build_object(
      'reason', v_reason,
      'previous_driver_id', v_driver_id,
      'reassign', true,
      'refund', 'NONE',
      'activity_impact', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', p_ride_id,
    'status', v_next_status,
    'reassign', true,
    'previous_driver_id', v_driver_id,
    'refund', 'NONE'
  );
end;
$$;

revoke all on function public.driver_cancel_taxi_ride(uuid, text) from public;
grant execute on function public.driver_cancel_taxi_ride(uuid, text) to authenticated;

commit;
