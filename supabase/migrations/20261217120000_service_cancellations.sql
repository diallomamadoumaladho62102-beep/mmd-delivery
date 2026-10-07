-- Immutable cancellation audit. Clients cannot write this table.
-- Acceptance rate is never updated here.

create table if not exists public.service_cancellations (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  service_type text not null,
  actor_user_id uuid not null,
  actor_role text not null,
  reason_code text not null,
  reason_note text,
  created_at timestamptz not null default now(),
  previous_status text,
  resulting_status text,
  wait_minutes integer,
  wait_fee_cents integer,
  payment_status text,
  refund_amount_cents integer,
  acceptance_rate_impact boolean not null default false,
  cancellation_rate_impact boolean not null default false,
  cancellation_source text not null,
  no_show boolean not null default false,
  post_acceptance boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  constraint service_cancellations_note_len check (
    reason_note is null or char_length(reason_note) <= 500
  )
);

create index if not exists service_cancellations_entity_idx
  on public.service_cancellations (entity_type, entity_id, created_at desc);

create index if not exists service_cancellations_filter_idx
  on public.service_cancellations (service_type, actor_role, reason_code, created_at desc);

alter table public.service_cancellations enable row level security;

revoke all on table public.service_cancellations from public, anon, authenticated;
grant select, insert on table public.service_cancellations to service_role;

comment on table public.service_cancellations is
  'Append-only cancellation audit. No update or delete policy. Acceptance rate is not written by this table.';

-- Keep the existing driver-release financial behavior.
-- Do not touch acceptance_rate. The separate cancellation_rate increment stays.
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
    cancel_reason_code = left(split_part(v_reason, ':', 1), 64),
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

  update public.taxi_offers
  set status = 'expired', updated_at = now()
  where taxi_ride_id = p_ride_id
    and status = 'pending';

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
      'acceptance_rate_impact', false
    )
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', p_ride_id,
    'status', v_next_status,
    'reassign', true,
    'previous_driver_id', v_driver_id,
    'refund', 'NONE',
    'acceptance_rate_impact', false
  );
end;
$$;
