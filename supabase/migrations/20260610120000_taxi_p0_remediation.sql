-- Taxi P0 remediation: payable guard + driver_features self-update lockdown

-- ---------------------------------------------------------------------------
-- P0-2: mark_taxi_ride_paid — reject terminal ride statuses
-- ---------------------------------------------------------------------------

create or replace function public.mark_taxi_ride_paid(
  p_ride_id uuid,
  p_session_id text default null,
  p_payment_intent_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_old_status text;
  v_payment_status text;
begin
  select status, payment_status
  into v_old_status, v_payment_status
  from public.taxi_rides
  where id = p_ride_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if lower(coalesce(v_payment_status, '')) = 'paid' then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'taxi_ride_id', p_ride_id,
      'payment_status', 'paid'
    );
  end if;

  if lower(coalesce(v_old_status, '')) in ('canceled', 'completed') then
    return jsonb_build_object('ok', false, 'message', 'taxi_ride_not_payable');
  end if;

  update public.taxi_rides
  set
    payment_status = 'paid',
    paid_at = coalesce(paid_at, v_now),
    status = case
      when status in ('draft', 'quoted', 'pending_payment') then 'paid'
      else status
    end,
    stripe_session_id = coalesce(p_session_id, stripe_session_id),
    stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
    updated_at = v_now
  where id = p_ride_id;

  perform public.log_taxi_event(
    p_ride_id,
    'ride_paid',
    v_old_status,
    'paid',
    null,
    'system',
    'Taxi ride marked as paid',
    jsonb_build_object(
      'stripe_session_id', p_session_id,
      'stripe_payment_intent_id', p_payment_intent_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', p_ride_id,
    'payment_status', 'paid'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- P0-4: taxi_driver_features — staff-only sensitive fields
-- ---------------------------------------------------------------------------

create or replace function public.guard_taxi_driver_features_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_staff_user(auth.uid()) then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    NEW.taxi_enabled := false;
    NEW.xl_eligible := false;
    NEW.premium_eligible := false;
    NEW.passenger_capacity := 4;
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if OLD.taxi_enabled is distinct from NEW.taxi_enabled
       or OLD.xl_eligible is distinct from NEW.xl_eligible
       or OLD.premium_eligible is distinct from NEW.premium_eligible
       or OLD.passenger_capacity is distinct from NEW.passenger_capacity then
      raise exception 'taxi_driver_features_staff_only_fields';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_guard_taxi_driver_features_self_update on public.taxi_driver_features;
create trigger trg_guard_taxi_driver_features_self_update
before insert or update on public.taxi_driver_features
for each row
execute function public.guard_taxi_driver_features_self_update();
