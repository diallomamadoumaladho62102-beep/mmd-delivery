-- Delivery request dispatch offers + accept/reject RPCs (mirrors driver_order_offers)

begin;

create table if not exists public.delivery_request_driver_offers (
  id uuid primary key default gen_random_uuid(),
  delivery_request_id uuid not null references public.delivery_requests (id) on delete cascade,
  driver_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending',
  wave integer not null default 1,
  pickup_address text,
  dropoff_address text,
  driver_price_cents integer,
  distance_miles numeric(8, 2),
  eta_minutes integer,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_request_driver_offers_status_check
    check (status in ('pending', 'accepted', 'rejected', 'expired', 'superseded'))
);

create index if not exists delivery_request_driver_offers_driver_status_expires_idx
  on public.delivery_request_driver_offers (driver_id, status, expires_at desc);

create index if not exists delivery_request_driver_offers_request_status_idx
  on public.delivery_request_driver_offers (delivery_request_id, status);

create unique index if not exists delivery_request_driver_offers_pending_request_driver_uidx
  on public.delivery_request_driver_offers (delivery_request_id, driver_id)
  where status = 'pending';

-- Drop legacy overloads
drop function if exists public.driver_accept_delivery_request_offer(uuid);
drop function if exists public.driver_reject_delivery_request_offer(uuid);
drop function if exists public.driver_reject_delivery_request_offer(uuid, text);

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
        'driver_accept_delivery_request_offer',
        'driver_reject_delivery_request_offer'
      )
  loop
    execute format('drop function if exists %s', r.proc);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- driver_accept_delivery_request_offer
-- ---------------------------------------------------------------------------

create or replace function public.driver_accept_delivery_request_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_offer public.delivery_request_driver_offers%rowtype;
  v_request public.delivery_requests%rowtype;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  select *
  into v_offer
  from public.delivery_request_driver_offers
  where id = p_offer_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'offer_not_found');
  end if;

  if v_offer.status <> 'pending' or v_offer.expires_at <= now() then
    return jsonb_build_object('ok', false, 'message', 'offer_not_available');
  end if;

  select *
  into v_request
  from public.delivery_requests
  where id = v_offer.delivery_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'request_not_found');
  end if;

  if coalesce(lower(v_request.payment_status), '') <> 'paid' then
    return jsonb_build_object('ok', false, 'message', 'request_not_paid');
  end if;

  if v_request.driver_id is not null and v_request.driver_id <> v_driver_id then
    return jsonb_build_object('ok', false, 'message', 'already_assigned');
  end if;

  if lower(coalesce(v_request.status, '')) not in (
    'pending',
    'paid_pending',
    'processing_pending'
  ) then
    return jsonb_build_object('ok', false, 'message', 'request_not_available');
  end if;

  perform public.ensure_delivery_request_codes(v_request.id);

  update public.delivery_requests
  set
    driver_id = v_driver_id,
    status = 'dispatched',
    updated_at = now()
  where id = v_request.id
    and driver_id is null
    and coalesce(payment_status, '') = 'paid'
    and lower(status) in ('pending', 'paid_pending', 'processing_pending');

  if not found then
    return jsonb_build_object('ok', false, 'message', 'request_no_longer_available');
  end if;

  update public.delivery_request_driver_offers
  set status = 'accepted', updated_at = now()
  where id = v_offer.id;

  update public.delivery_request_driver_offers
  set status = 'superseded', updated_at = now()
  where delivery_request_id = v_offer.delivery_request_id
    and id <> v_offer.id
    and status = 'pending';

  return jsonb_build_object(
    'ok',
    true,
    'delivery_request_id',
    v_request.id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- driver_reject_delivery_request_offer
-- ---------------------------------------------------------------------------

create or replace function public.driver_reject_delivery_request_offer(
  p_offer_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_offer public.delivery_request_driver_offers%rowtype;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  select *
  into v_offer
  from public.delivery_request_driver_offers
  where id = p_offer_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'offer_not_found');
  end if;

  if v_offer.status <> 'pending' then
    return jsonb_build_object('ok', true, 'message', 'offer_not_available');
  end if;

  update public.delivery_request_driver_offers
  set
    status = 'rejected',
    updated_at = now()
  where id = v_offer.id;

  return jsonb_build_object('ok', true, 'reason', coalesce(p_reason, 'driver_rejected'));
end;
$$;

revoke all on function public.driver_accept_delivery_request_offer(uuid) from public;
revoke all on function public.driver_reject_delivery_request_offer(uuid, text) from public;

grant execute on function public.driver_accept_delivery_request_offer(uuid) to authenticated;
grant execute on function public.driver_reject_delivery_request_offer(uuid, text) to authenticated;

alter table public.delivery_request_driver_offers enable row level security;

drop policy if exists delivery_request_driver_offers_select_own
  on public.delivery_request_driver_offers;

create policy delivery_request_driver_offers_select_own
  on public.delivery_request_driver_offers
  for select
  to authenticated
  using (driver_id = auth.uid());

commit;
