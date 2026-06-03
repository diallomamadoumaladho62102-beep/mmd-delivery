-- S0-E / S0-F: secure delivery_requests driver lifecycle (RPC + status picked_up)

begin;

alter table public.delivery_requests
  add column if not exists pickup_code text;

alter table public.delivery_requests
  add column if not exists dropoff_code text;

alter table public.delivery_requests
  add column if not exists pickup_code_verified_at timestamptz;

alter table public.delivery_requests
  add column if not exists dropoff_code_verified_at timestamptz;

alter table public.delivery_requests
  add column if not exists picked_up_at timestamptz;

alter table public.delivery_requests
  add column if not exists delivered_at timestamptz;

alter table public.delivery_requests
  add column if not exists pickup_photo_url text;

alter table public.delivery_requests
  add column if not exists dropoff_photo_url text;

create or replace function public.ensure_delivery_request_codes(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.delivery_requests
  set
    pickup_code = coalesce(
      nullif(trim(pickup_code), ''),
      lpad((floor(random() * 1000000))::int::text, 6, '0')
    ),
    dropoff_code = coalesce(
      nullif(trim(dropoff_code), ''),
      lpad((floor(random() * 1000000))::int::text, 6, '0')
    ),
    updated_at = now()
  where id = p_request_id;
end;
$$;

-- Drop legacy overloads (return type drift)
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as proc
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'driver_accept_delivery_request',
        'driver_release_delivery_request',
        'confirm_delivery_request_pickup',
        'confirm_delivery_request_delivery'
      )
  loop
    execute format('drop function if exists %s', r.proc);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- driver_accept_delivery_request
-- ---------------------------------------------------------------------------

drop function if exists public.driver_accept_delivery_request(uuid);

create or replace function public.driver_accept_delivery_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  perform public.ensure_delivery_request_codes(p_request_id);

  update public.delivery_requests
  set
    driver_id = v_driver_id,
    status = 'dispatched',
    updated_at = now()
  where id = p_request_id
    and coalesce(payment_status, '') = 'paid'
    and driver_id is null
    and lower(status) in ('pending', 'paid_pending', 'processing_pending');

  if not found then
    return jsonb_build_object('ok', false, 'message', 'request_not_available');
  end if;

  return jsonb_build_object('ok', true, 'delivery_request_id', p_request_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- driver_release_delivery_request (driver cancel before pickup complete)
-- ---------------------------------------------------------------------------

drop function if exists public.driver_release_delivery_request(uuid);

create or replace function public.driver_release_delivery_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  update public.delivery_requests
  set
    driver_id = null,
    status = 'paid_pending',
    updated_at = now()
  where id = p_request_id
    and driver_id = v_driver_id
    and lower(status) = 'dispatched';

  if not found then
    return jsonb_build_object('ok', false, 'message', 'release_not_allowed');
  end if;

  return jsonb_build_object('ok', true, 'delivery_request_id', p_request_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_delivery_request_pickup
-- ---------------------------------------------------------------------------

drop function if exists public.confirm_delivery_request_pickup(uuid, text, text);

create or replace function public.confirm_delivery_request_pickup(
  p_request_id uuid,
  p_pickup_code text default null,
  p_proof_photo_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_row public.delivery_requests%rowtype;
  v_expected_code text;
  v_input_code text;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select *
  into v_row
  from public.delivery_requests
  where id = p_request_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;

  if lower(v_row.status) <> 'dispatched' then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  perform public.ensure_delivery_request_codes(p_request_id);

  select pickup_code
  into v_expected_code
  from public.delivery_requests
  where id = p_request_id;

  v_input_code := nullif(trim(p_pickup_code), '');

  if nullif(trim(v_expected_code), '') is not null then
    if v_input_code is null or v_input_code <> trim(v_expected_code) then
      return jsonb_build_object('ok', false, 'error', 'invalid_pickup_code');
    end if;
  end if;

  update public.delivery_requests
  set
    status = 'picked_up',
    picked_up_at = coalesce(picked_up_at, now()),
    pickup_code_verified_at = coalesce(pickup_code_verified_at, now()),
    pickup_photo_url = coalesce(nullif(trim(p_proof_photo_url), ''), pickup_photo_url),
    updated_at = now()
  where id = p_request_id;

  return jsonb_build_object('ok', true, 'delivery_request_id', p_request_id, 'status', 'picked_up');
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_delivery_request_delivery
-- ---------------------------------------------------------------------------

drop function if exists public.confirm_delivery_request_delivery(uuid, text, text);

create or replace function public.confirm_delivery_request_delivery(
  p_request_id uuid,
  p_dropoff_code text default null,
  p_proof_photo_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_row public.delivery_requests%rowtype;
  v_expected_code text;
  v_input_code text;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select *
  into v_row
  from public.delivery_requests
  where id = p_request_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;

  if lower(v_row.status) <> 'picked_up' then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  v_input_code := nullif(trim(p_dropoff_code), '');
  v_expected_code := nullif(trim(v_row.dropoff_code), '');

  if v_expected_code is not null then
    if v_input_code is null or v_input_code <> v_expected_code then
      return jsonb_build_object('ok', false, 'error', 'invalid_dropoff_code');
    end if;
  end if;

  update public.delivery_requests
  set
    status = 'delivered',
    delivered_at = coalesce(delivered_at, now()),
    dropoff_code_verified_at = coalesce(dropoff_code_verified_at, now()),
    dropoff_photo_url = coalesce(nullif(trim(p_proof_photo_url), ''), dropoff_photo_url),
    updated_at = now()
  where id = p_request_id;

  return jsonb_build_object('ok', true, 'delivery_request_id', p_request_id, 'status', 'delivered');
end;
$$;

revoke all on function public.ensure_delivery_request_codes(uuid) from public;
revoke all on function public.driver_accept_delivery_request(uuid) from public;
revoke all on function public.driver_release_delivery_request(uuid) from public;
revoke all on function public.confirm_delivery_request_pickup(uuid, text, text) from public;
revoke all on function public.confirm_delivery_request_delivery(uuid, text, text) from public;

grant execute on function public.driver_accept_delivery_request(uuid) to authenticated;
grant execute on function public.driver_release_delivery_request(uuid) to authenticated;
grant execute on function public.confirm_delivery_request_pickup(uuid, text, text) to authenticated;
grant execute on function public.confirm_delivery_request_delivery(uuid, text, text) to authenticated;

grant execute on function public.ensure_delivery_request_codes(uuid) to service_role;

commit;
