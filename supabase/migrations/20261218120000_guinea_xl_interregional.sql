-- Guinea XL interregional axes, seats and baggage.
-- Does not change taxi_rides, USA pricing, or wallet_ledger.
-- Baggage is stored on the booking. It is not posted to wallet_ledger.
-- Axis prices are not seeded. Admin enters them. The baggage grid and the
-- 10% commission below are the initial administrable configuration.

begin;

create table if not exists public.guinea_xl_settings (
  id text primary key,
  country_code text not null default 'GN' check (country_code = 'GN'),
  currency text not null default 'GNF' check (currency = 'GNF'),
  timezone text not null default 'Africa/Conakry',
  platform_share_bps integer not null check (platform_share_bps >= 0 and platform_share_bps <= 10000),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.guinea_xl_settings (id, country_code, currency, timezone, platform_share_bps)
values ('GN', 'GN', 'GNF', 'Africa/Conakry', 1000)
on conflict (id) do nothing;

create table if not exists public.guinea_xl_axes (
  id uuid primary key default gen_random_uuid(),
  country_code text not null default 'GN' check (country_code = 'GN'),
  currency text not null default 'GNF' check (currency = 'GNF'),
  origin_key text not null,
  destination_key text not null,
  origin_label text not null,
  destination_label text not null,
  route_key text not null,
  directional boolean not null default false,
  front_seat_gnf integer not null check (front_seat_gnf >= 0),
  other_seat_gnf integer not null check (other_seat_gnf >= 0),
  active boolean not null default true,
  version integer not null default 1 check (version > 0),
  valid_from timestamptz,
  valid_until timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (origin_key <> destination_key)
);

create unique index if not exists guinea_xl_axes_bidirectional_key
  on public.guinea_xl_axes (route_key)
  where directional = false;

create unique index if not exists guinea_xl_axes_directional_key
  on public.guinea_xl_axes (route_key)
  where directional = true;

create table if not exists public.guinea_xl_axis_versions (
  id uuid primary key default gen_random_uuid(),
  axis_id uuid not null references public.guinea_xl_axes (id),
  version integer not null check (version > 0),
  front_seat_gnf integer not null check (front_seat_gnf >= 0),
  other_seat_gnf integer not null check (other_seat_gnf >= 0),
  active boolean not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (axis_id, version)
);

create table if not exists public.guinea_xl_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  axis_id uuid,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.guinea_xl_baggage_bands (
  id uuid primary key default gen_random_uuid(),
  country_code text not null default 'GN' check (country_code = 'GN'),
  currency text not null default 'GNF' check (currency = 'GNF'),
  min_kg integer not null check (min_kg >= 0),
  max_kg integer not null check (max_kg >= min_kg),
  price_gnf integer not null check (price_gnf >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.guinea_xl_baggage_bands (country_code, currency, min_kg, max_kg, price_gnf, active)
select 'GN', 'GNF', band.min_kg, band.max_kg, band.price_gnf, true
from (
  values
    (1, 5, 0),
    (6, 10, 30000),
    (11, 20, 40000),
    (21, 30, 55000),
    (31, 100, 100000)
) as band(min_kg, max_kg, price_gnf)
where not exists (
  select 1 from public.guinea_xl_baggage_bands existing
  where existing.country_code = 'GN' and existing.min_kg = band.min_kg and existing.max_kg = band.max_kg
);

create table if not exists public.guinea_xl_departures (
  id uuid primary key default gen_random_uuid(),
  axis_id uuid not null references public.guinea_xl_axes (id),
  driver_id uuid not null references auth.users (id),
  passenger_capacity integer not null check (passenger_capacity in (4, 5, 6, 7)),
  scheduled_at timestamptz,
  status text not null default 'open' check (status in ('open', 'closed', 'canceled', 'completed')),
  country_code text not null default 'GN' check (country_code = 'GN'),
  currency text not null default 'GNF' check (currency = 'GNF'),
  created_at timestamptz not null default now()
);

create table if not exists public.guinea_xl_seats (
  id uuid primary key default gen_random_uuid(),
  departure_id uuid not null references public.guinea_xl_departures (id) on delete cascade,
  seat_index integer not null check (seat_index between 1 and 7),
  seat_role text not null check (seat_role in ('front', 'other')),
  booking_id uuid,
  unique (departure_id, seat_index)
);

create table if not exists public.guinea_xl_bookings (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  client_user_id uuid not null references auth.users (id),
  driver_id uuid not null references auth.users (id),
  departure_id uuid not null references public.guinea_xl_departures (id),
  axis_id uuid not null references public.guinea_xl_axes (id),
  seat_indexes integer[] not null,
  status text not null check (status in ('confirmed', 'completed', 'canceled')),
  payment_method text not null default 'cash' check (payment_method = 'cash'),
  payment_status text not null check (payment_status in ('pending_cash', 'cash_collected')),
  country_code text not null default 'GN' check (country_code = 'GN'),
  currency text not null default 'GNF' check (currency = 'GNF'),
  rate_version integer not null,
  front_seat_gnf integer not null check (front_seat_gnf >= 0),
  other_seat_gnf integer not null check (other_seat_gnf >= 0),
  front_seat_count integer not null check (front_seat_count >= 0),
  other_seat_count integer not null check (other_seat_count >= 0),
  transport_gnf integer not null check (transport_gnf >= 0),
  baggage_gnf integer not null check (baggage_gnf >= 0),
  total_gnf integer not null check (total_gnf >= 0),
  platform_share_bps integer not null check (platform_share_bps >= 0 and platform_share_bps <= 10000),
  platform_fee_gnf integer not null check (platform_fee_gnf >= 0),
  driver_amount_gnf integer not null check (driver_amount_gnf >= 0),
  baggage_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (client_user_id, idempotency_key),
  check (platform_fee_gnf + driver_amount_gnf = transport_gnf),
  check (transport_gnf + baggage_gnf = total_gnf)
);

alter table public.guinea_xl_seats
  drop constraint if exists guinea_xl_seats_booking_fk;

alter table public.guinea_xl_seats
  add constraint guinea_xl_seats_booking_fk
  foreign key (booking_id) references public.guinea_xl_bookings (id);

create table if not exists public.guinea_xl_financial_entries (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.guinea_xl_bookings (id),
  entry_kind text not null check (entry_kind in ('driver_transport', 'platform_transport')),
  amount_gnf integer not null check (amount_gnf >= 0),
  currency text not null default 'GNF' check (currency = 'GNF'),
  created_at timestamptz not null default now(),
  unique (booking_id, entry_kind)
);

create or replace function public.guinea_xl_axis_keep_history()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and (
    new.front_seat_gnf is distinct from old.front_seat_gnf
    or new.other_seat_gnf is distinct from old.other_seat_gnf
    or new.active is distinct from old.active
  ) then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guinea_xl_axis_keep_history on public.guinea_xl_axes;
create trigger trg_guinea_xl_axis_keep_history
before update on public.guinea_xl_axes
for each row execute function public.guinea_xl_axis_keep_history();

create or replace function public.guinea_xl_axis_write_version()
returns trigger
language plpgsql
as $$
begin
  insert into public.guinea_xl_axis_versions (
    axis_id, version, front_seat_gnf, other_seat_gnf, active, created_by
  )
  values (
    new.id, new.version, new.front_seat_gnf, new.other_seat_gnf, new.active, new.updated_by
  )
  on conflict (axis_id, version) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_guinea_xl_axis_write_version on public.guinea_xl_axes;
create trigger trg_guinea_xl_axis_write_version
after insert or update on public.guinea_xl_axes
for each row execute function public.guinea_xl_axis_write_version();

create or replace function public.guinea_xl_seed_seats()
returns trigger
language plpgsql
as $$
declare
  seat_no integer;
begin
  for seat_no in 1..new.passenger_capacity loop
    insert into public.guinea_xl_seats (departure_id, seat_index, seat_role)
    values (new.id, seat_no, case when seat_no = 1 then 'front' else 'other' end);
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_guinea_xl_seed_seats on public.guinea_xl_departures;
create trigger trg_guinea_xl_seed_seats
after insert on public.guinea_xl_departures
for each row execute function public.guinea_xl_seed_seats();

create or replace function public.create_guinea_xl_booking(
  p_booking_id uuid,
  p_idempotency_key text,
  p_client_user_id uuid,
  p_departure_id uuid,
  p_seat_indexes integer[],
  p_snapshot jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.guinea_xl_bookings%rowtype;
  v_departure public.guinea_xl_departures%rowtype;
  v_count integer;
begin
  if p_client_user_id is null or p_departure_id is null or coalesce(p_idempotency_key, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'xl_booking_invalid');
  end if;

  if p_seat_indexes is null
     or cardinality(p_seat_indexes) < 1
     or cardinality(p_seat_indexes) <> (select count(distinct seat_no) from unnest(p_seat_indexes) as seat_no) then
    return jsonb_build_object('ok', false, 'error', 'xl_seat_invalid');
  end if;

  select * into v_existing
  from public.guinea_xl_bookings
  where client_user_id = p_client_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'idempotent', true, 'booking_id', v_existing.id);
  end if;

  select * into v_departure
  from public.guinea_xl_departures
  where id = p_departure_id
  for update;
  if not found or v_departure.status <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'xl_departure_unavailable');
  end if;

  if p_snapshot->>'currency' is distinct from 'GNF'
     or p_snapshot->>'country_code' is distinct from 'GN'
     or p_snapshot->>'payment_method' is distinct from 'cash' then
    return jsonb_build_object('ok', false, 'error', 'currency_mismatch');
  end if;

  insert into public.guinea_xl_bookings (
    id, idempotency_key, client_user_id, driver_id, departure_id, axis_id, seat_indexes,
    status, payment_method, payment_status, country_code, currency, rate_version,
    front_seat_gnf, other_seat_gnf, front_seat_count, other_seat_count,
    transport_gnf, baggage_gnf, total_gnf, platform_share_bps, platform_fee_gnf,
    driver_amount_gnf, baggage_snapshot
  ) values (
    p_booking_id,
    p_idempotency_key,
    p_client_user_id,
    v_departure.driver_id,
    v_departure.id,
    v_departure.axis_id,
    p_seat_indexes,
    'confirmed',
    'cash',
    'pending_cash',
    'GN',
    'GNF',
    (p_snapshot->>'rate_version')::integer,
    (p_snapshot->>'front_seat_gnf')::integer,
    (p_snapshot->>'other_seat_gnf')::integer,
    (p_snapshot->>'front_seat_count')::integer,
    (p_snapshot->>'other_seat_count')::integer,
    (p_snapshot->>'transport_gnf')::integer,
    (p_snapshot->>'baggage_gnf')::integer,
    (p_snapshot->>'total_gnf')::integer,
    (p_snapshot->>'platform_share_bps')::integer,
    (p_snapshot->>'platform_fee_gnf')::integer,
    (p_snapshot->>'driver_amount_gnf')::integer,
    coalesce(p_snapshot->'baggage_lines', '[]'::jsonb)
  );

  update public.guinea_xl_seats
  set booking_id = p_booking_id
  where departure_id = p_departure_id
    and seat_index = any(p_seat_indexes)
    and booking_id is null;
  get diagnostics v_count = row_count;

  if v_count <> cardinality(p_seat_indexes) then
    raise exception 'xl_seat_taken';
  end if;

  insert into public.guinea_xl_financial_entries (booking_id, entry_kind, amount_gnf, currency)
  values
    (p_booking_id, 'driver_transport', (p_snapshot->>'driver_amount_gnf')::integer, 'GNF'),
    (p_booking_id, 'platform_transport', (p_snapshot->>'platform_fee_gnf')::integer, 'GNF');

  return jsonb_build_object('ok', true, 'idempotent', false, 'booking_id', p_booking_id);
exception
  when unique_violation then
    select * into v_existing
    from public.guinea_xl_bookings
    where client_user_id = p_client_user_id
      and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('ok', true, 'idempotent', true, 'booking_id', v_existing.id);
    end if;
    return jsonb_build_object('ok', false, 'error', 'xl_booking_invalid');
  when others then
    if sqlerrm = 'xl_seat_taken' then
      return jsonb_build_object('ok', false, 'error', 'xl_seat_taken');
    end if;
    raise;
end;
$$;

revoke all on function public.create_guinea_xl_booking(uuid, text, uuid, uuid, integer[], jsonb) from public, anon, authenticated;
grant execute on function public.create_guinea_xl_booking(uuid, text, uuid, uuid, integer[], jsonb) to service_role;

alter table public.guinea_xl_settings enable row level security;
alter table public.guinea_xl_axes enable row level security;
alter table public.guinea_xl_axis_versions enable row level security;
alter table public.guinea_xl_audit enable row level security;
alter table public.guinea_xl_baggage_bands enable row level security;
alter table public.guinea_xl_departures enable row level security;
alter table public.guinea_xl_seats enable row level security;
alter table public.guinea_xl_bookings enable row level security;
alter table public.guinea_xl_financial_entries enable row level security;

revoke all on public.guinea_xl_settings from anon, authenticated;
revoke all on public.guinea_xl_axis_versions from anon, authenticated;
revoke all on public.guinea_xl_audit from anon, authenticated;
revoke all on public.guinea_xl_financial_entries from anon, authenticated;
revoke insert, update, delete on public.guinea_xl_axes from anon, authenticated;
revoke insert, update, delete on public.guinea_xl_baggage_bands from anon, authenticated;
revoke insert, update, delete on public.guinea_xl_departures from anon, authenticated;
revoke insert, update, delete on public.guinea_xl_seats from anon, authenticated;
revoke insert, update, delete on public.guinea_xl_bookings from anon, authenticated;

grant select on public.guinea_xl_axes to authenticated;
grant select on public.guinea_xl_baggage_bands to authenticated;
grant select on public.guinea_xl_departures to authenticated;
grant select on public.guinea_xl_seats to authenticated;
grant select on public.guinea_xl_bookings to authenticated;

drop policy if exists guinea_xl_axes_read on public.guinea_xl_axes;
create policy guinea_xl_axes_read on public.guinea_xl_axes
for select to authenticated
using (active = true);

drop policy if exists guinea_xl_bands_read on public.guinea_xl_baggage_bands;
create policy guinea_xl_bands_read on public.guinea_xl_baggage_bands
for select to authenticated
using (active = true);

drop policy if exists guinea_xl_departures_read on public.guinea_xl_departures;
create policy guinea_xl_departures_read on public.guinea_xl_departures
for select to authenticated
using (status = 'open' or driver_id = auth.uid());

drop policy if exists guinea_xl_seats_read on public.guinea_xl_seats;
create policy guinea_xl_seats_read on public.guinea_xl_seats
for select to authenticated
using (
  exists (
    select 1 from public.guinea_xl_departures departure
    where departure.id = departure_id
      and (departure.status = 'open' or departure.driver_id = auth.uid())
  )
);

drop policy if exists guinea_xl_bookings_read on public.guinea_xl_bookings;
create policy guinea_xl_bookings_read on public.guinea_xl_bookings
for select to authenticated
using (client_user_id = auth.uid() or driver_id = auth.uid());

commit;
