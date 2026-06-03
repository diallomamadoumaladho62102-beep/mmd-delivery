-- S0-G: driver_order_offers + accept/reject RPCs (idempotent for prod drift)

begin;

create table if not exists public.driver_order_offers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  driver_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending',
  wave integer not null default 1,
  restaurant_name text,
  pickup_address text,
  dropoff_address text,
  driver_price_cents integer,
  distance_miles numeric(8, 2),
  eta_minutes integer,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_order_offers_status_check
    check (status in ('pending', 'accepted', 'rejected', 'expired', 'superseded'))
);

alter table public.driver_order_offers
  add column if not exists wave integer not null default 1;

alter table public.driver_order_offers
  add column if not exists restaurant_name text;

alter table public.driver_order_offers
  add column if not exists pickup_address text;

alter table public.driver_order_offers
  add column if not exists dropoff_address text;

alter table public.driver_order_offers
  add column if not exists driver_price_cents integer;

alter table public.driver_order_offers
  add column if not exists distance_miles numeric(8, 2);

alter table public.driver_order_offers
  add column if not exists eta_minutes integer;

alter table public.driver_order_offers
  add column if not exists expires_at timestamptz;

alter table public.driver_order_offers
  add column if not exists updated_at timestamptz not null default now();

create index if not exists driver_order_offers_driver_status_expires_idx
  on public.driver_order_offers (driver_id, status, expires_at desc);

create index if not exists driver_order_offers_order_status_idx
  on public.driver_order_offers (order_id, status);

create unique index if not exists driver_order_offers_pending_order_driver_uidx
  on public.driver_order_offers (order_id, driver_id)
  where status = 'pending';

alter table public.orders
  add column if not exists ready_at timestamptz;

alter table public.orders
  add column if not exists restaurant_prepared_at timestamptz;

-- ---------------------------------------------------------------------------
-- Drop legacy RPC overloads (return type / signature drift blocks CREATE OR REPLACE)
-- ---------------------------------------------------------------------------

drop function if exists public.driver_accept_order_offer(uuid);
drop function if exists public.driver_reject_order_offer(uuid);
drop function if exists public.driver_reject_order_offer(uuid, text);

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as proc
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('driver_accept_order_offer', 'driver_reject_order_offer')
  loop
    execute format('drop function if exists %s', r.proc);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- driver_accept_order_offer
-- ---------------------------------------------------------------------------

create or replace function public.driver_accept_order_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_offer public.driver_order_offers%rowtype;
  v_order public.orders%rowtype;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  select *
  into v_offer
  from public.driver_order_offers
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
  into v_order
  from public.orders
  where id = v_offer.order_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'order_not_found');
  end if;

  if coalesce(lower(v_order.kind), '') <> 'food' then
    return jsonb_build_object('ok', false, 'message', 'invalid_order_kind');
  end if;

  if coalesce(lower(v_order.payment_status), '') <> 'paid' then
    return jsonb_build_object('ok', false, 'message', 'order_not_paid');
  end if;

  if coalesce(lower(v_order.status), '') <> 'ready' then
    return jsonb_build_object('ok', false, 'message', 'order_not_ready');
  end if;

  if v_order.driver_id is not null and v_order.driver_id <> v_driver_id then
    return jsonb_build_object('ok', false, 'message', 'already_assigned');
  end if;

  update public.orders
  set
    driver_id = v_driver_id,
    status = 'dispatched',
    updated_at = now()
  where id = v_order.id
    and driver_id is null
    and lower(status) = 'ready';

  if not found then
    return jsonb_build_object('ok', false, 'message', 'order_no_longer_available');
  end if;

  update public.driver_order_offers
  set status = 'accepted', updated_at = now()
  where id = v_offer.id;

  update public.driver_order_offers
  set status = 'superseded', updated_at = now()
  where order_id = v_offer.order_id
    and id <> v_offer.id
    and status = 'pending';

  return jsonb_build_object('ok', true, 'order_id', v_order.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- driver_reject_order_offer
-- ---------------------------------------------------------------------------

create or replace function public.driver_reject_order_offer(
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
  v_offer public.driver_order_offers%rowtype;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  select *
  into v_offer
  from public.driver_order_offers
  where id = p_offer_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'offer_not_found');
  end if;

  if v_offer.status <> 'pending' then
    return jsonb_build_object('ok', true, 'message', 'offer_not_available');
  end if;

  update public.driver_order_offers
  set
    status = 'rejected',
    updated_at = now()
  where id = v_offer.id;

  return jsonb_build_object('ok', true, 'reason', coalesce(p_reason, 'driver_rejected'));
end;
$$;

revoke all on function public.driver_accept_order_offer(uuid) from public;
revoke all on function public.driver_reject_order_offer(uuid, text) from public;

grant execute on function public.driver_accept_order_offer(uuid) to authenticated;
grant execute on function public.driver_reject_order_offer(uuid, text) to authenticated;

alter table public.driver_order_offers enable row level security;

drop policy if exists driver_order_offers_select_own on public.driver_order_offers;
create policy driver_order_offers_select_own
  on public.driver_order_offers
  for select
  to authenticated
  using (driver_id = auth.uid());

commit;
