-- Guinea XL segment graph. Do not apply this file with supabase db push.
-- It stays outside supabase/migrations so supabase db push cannot run it.
-- Seed numbers are editable defaults. Admin updates are the commercial source.
-- All eight distances are unconfirmed estimates.
-- They are active for local calculation and confirmed = false.
-- Segments 6, 7 and 8 were checked on 2026-10-10 from road sources, not an official survey.
-- Commercial segment booking stays disabled in the application.
-- This does not change Taxi Standard, the XL commission, or other services.
-- Existing seat locks on guinea_xl_seats stay in place.
-- A future passenger snapshot stores the route total once.
-- That amount is not divided by passengers and not multiplied by seats.
-- Front and other seats stay distinct. No seat supplement is defined here.

begin;

create table if not exists public.guinea_xl_segment_tariff (
  id text primary key check (id = 'GN'),
  country_code text not null default 'GN' check (country_code = 'GN'),
  currency text not null default 'GNF' check (currency = 'GNF'),
  base_gnf integer not null check (base_gnf >= 0),
  per_km_gnf integer not null check (per_km_gnf >= 0),
  per_minute_gnf integer not null check (per_minute_gnf >= 0),
  minimum_gnf integer not null check (minimum_gnf >= 0),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.guinea_xl_segment_tariff (
  id, country_code, currency, base_gnf, per_km_gnf, per_minute_gnf, minimum_gnf
)
values ('GN', 'GN', 'GNF', 1000, 500, 100, 30000)
on conflict (id) do nothing;

create table if not exists public.guinea_xl_segments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  sequence integer not null unique check (sequence > 0),
  origin_label text not null,
  destination_label text not null,
  origin_key text not null,
  destination_key text not null,
  branch text not null check (branch in ('trunk', 'dougountounny', 'mali')),
  distance_km integer,
  duration_minutes integer,
  active boolean not null default false,
  confirmed boolean not null default false,
  estimate_source text not null default '',
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (origin_key <> destination_key),
  check (distance_km is null or distance_km > 0),
  check (duration_minutes is null or duration_minutes >= 0),
  check (active = false or (distance_km is not null and duration_minutes is not null)),
  check (confirmed = false or (distance_km is not null and duration_minutes is not null))
);

insert into public.guinea_xl_segments (
  code, sequence, origin_label, destination_label, origin_key, destination_key,
  branch, distance_km, duration_minutes, active, confirmed, estimate_source
)
values
  ('1', 1, 'Conakry', 'Kindia', 'conakry', 'kindia', 'trunk', 128, 102, true, false,
    'Unconfirmed project estimate. Not an official survey.'),
  ('2', 2, 'Kindia', 'Mamou', 'kindia', 'mamou', 'trunk', 134, 109, true, false,
    'Unconfirmed project estimate. Not an official survey.'),
  ('3', 3, 'Mamou', 'Dalaba', 'mamou', 'dalaba', 'trunk', 54, 75, true, false,
    'Unconfirmed project estimate. Not an official survey.'),
  ('4', 4, 'Dalaba', 'Pita', 'dalaba', 'pita', 'trunk', 54, 42, true, false,
    'Unconfirmed project estimate. Not an official survey.'),
  ('5', 5, 'Pita', 'Labé', 'pita', 'labe', 'trunk', 40, 32, true, false,
    'Unconfirmed project estimate. Not an official survey.'),
  ('6', 6, 'Labé', 'Yembering', 'labe', 'yembering', 'trunk', 70, 120, true, false,
    'Estimate checked 2026-10-10. OSRM 69.7 km. Duration 120 min from road reports. Not confirmed.'),
  ('7', 7, 'Yembering', 'Dougountounny', 'yembering', 'dougountounny', 'dougountounny', 40, 61, true, false,
    'Estimate checked 2026-10-10. OSRM 40.4 km and 61 min. Not confirmed.'),
  ('8', 8, 'Yembering', 'Mali Centre', 'yembering', 'malicentre', 'mali', 40, 180, true, false,
    'Estimate checked 2026-10-10. Project lot 38 km. Current road reports about 40 km and up to 180 min. Not confirmed.')
on conflict (code) do nothing;

create table if not exists public.guinea_xl_departure_segments (
  departure_id uuid not null references public.guinea_xl_departures (id) on delete cascade,
  segment_id uuid not null references public.guinea_xl_segments (id),
  position integer not null check (position > 0),
  primary key (departure_id, segment_id),
  unique (departure_id, position)
);

create table if not exists public.guinea_xl_seat_segments (
  id uuid primary key default gen_random_uuid(),
  departure_id uuid not null references public.guinea_xl_departures (id) on delete cascade,
  segment_id uuid not null references public.guinea_xl_segments (id),
  seat_index integer not null check (seat_index between 1 and 7),
  booking_id uuid references public.guinea_xl_bookings (id),
  unique (departure_id, seat_index, segment_id),
  foreign key (departure_id, seat_index)
    references public.guinea_xl_seats (departure_id, seat_index)
);

create table if not exists public.guinea_xl_booking_segments (
  booking_id uuid not null references public.guinea_xl_bookings (id),
  segment_id uuid not null references public.guinea_xl_segments (id),
  position integer not null check (position > 0),
  distance_km integer not null check (distance_km > 0),
  duration_minutes integer not null check (duration_minutes >= 0),
  raw_gnf integer not null check (raw_gnf >= 0),
  final_gnf integer not null check (final_gnf >= 0),
  primary key (booking_id, segment_id),
  unique (booking_id, position)
);

alter table public.guinea_xl_bookings
  add column if not exists fare_source text,
  add column if not exists segment_tariff_version integer,
  add column if not exists segment_snapshot jsonb;

alter table public.guinea_xl_bookings
  drop constraint if exists guinea_xl_bookings_fare_source_check;

alter table public.guinea_xl_bookings
  add constraint guinea_xl_bookings_fare_source_check
  check (fare_source is null or fare_source in ('xl_axis', 'xl_segment'));

create or replace function public.guinea_xl_booking_segments_frozen()
returns trigger
language plpgsql
as $$
begin
  raise exception 'xl_segment_snapshot_frozen';
end;
$$;

drop trigger if exists trg_guinea_xl_booking_segments_frozen on public.guinea_xl_booking_segments;
create trigger trg_guinea_xl_booking_segments_frozen
before update or delete on public.guinea_xl_booking_segments
for each row execute function public.guinea_xl_booking_segments_frozen();

create or replace function public.guinea_xl_booking_amounts_frozen()
returns trigger
language plpgsql
as $$
begin
  if new.transport_gnf is distinct from old.transport_gnf
     or new.baggage_gnf is distinct from old.baggage_gnf
     or new.total_gnf is distinct from old.total_gnf
     or new.platform_fee_gnf is distinct from old.platform_fee_gnf
     or new.driver_amount_gnf is distinct from old.driver_amount_gnf
     or new.platform_share_bps is distinct from old.platform_share_bps
     or new.front_seat_gnf is distinct from old.front_seat_gnf
     or new.other_seat_gnf is distinct from old.other_seat_gnf
     or new.front_seat_count is distinct from old.front_seat_count
     or new.other_seat_count is distinct from old.other_seat_count
     or (old.fare_source is not null and new.fare_source is distinct from old.fare_source)
     or (old.segment_tariff_version is not null and new.segment_tariff_version is distinct from old.segment_tariff_version)
     or (old.segment_snapshot is not null and new.segment_snapshot is distinct from old.segment_snapshot)
  then
    raise exception 'xl_financial_snapshot_frozen';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guinea_xl_booking_amounts_frozen on public.guinea_xl_bookings;
create trigger trg_guinea_xl_booking_amounts_frozen
before update on public.guinea_xl_bookings
for each row execute function public.guinea_xl_booking_amounts_frozen();

revoke all on function public.guinea_xl_booking_segments_frozen() from public, anon, authenticated;
revoke all on function public.guinea_xl_booking_amounts_frozen() from public, anon, authenticated;

create or replace function public.guinea_xl_seat_axis_respects_segments()
returns trigger
language plpgsql
as $$
begin
  if new.booking_id is not null and new.booking_id is distinct from old.booking_id then
    if exists (
      select 1
      from public.guinea_xl_seat_segments held
      where held.departure_id = new.departure_id
        and held.seat_index = new.seat_index
        and held.booking_id is distinct from new.booking_id
    ) then
      raise exception 'xl_seat_taken';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guinea_xl_seat_axis_respects_segments on public.guinea_xl_seats;
create trigger trg_guinea_xl_seat_axis_respects_segments
before update on public.guinea_xl_seats
for each row execute function public.guinea_xl_seat_axis_respects_segments();

revoke all on function public.guinea_xl_seat_axis_respects_segments() from public, anon, authenticated;

create or replace function public.reserve_guinea_xl_segment_seat(
  p_departure_id uuid,
  p_seat_index integer,
  p_segment_ids uuid[],
  p_booking_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_departure public.guinea_xl_departures%rowtype;
  v_seat public.guinea_xl_seats%rowtype;
  v_held integer;
begin
  if p_departure_id is null or p_booking_id is null or p_seat_index is null
     or p_segment_ids is null or cardinality(p_segment_ids) < 1
     or cardinality(p_segment_ids) <> (select count(distinct segment_id) from unnest(p_segment_ids) as segment_id)
  then
    raise exception 'xl_booking_invalid';
  end if;

  select * into v_departure
  from public.guinea_xl_departures
  where id = p_departure_id
  for update;
  if not found or v_departure.status <> 'open' then
    raise exception 'xl_departure_unavailable';
  end if;

  select * into v_seat
  from public.guinea_xl_seats
  where departure_id = p_departure_id and seat_index = p_seat_index
  for update;
  if not found then
    raise exception 'xl_seat_invalid';
  end if;
  if v_seat.booking_id is not null and v_seat.booking_id is distinct from p_booking_id then
    raise exception 'xl_seat_taken';
  end if;

  select count(*) into v_held
  from public.guinea_xl_seat_segments held
  where held.departure_id = p_departure_id
    and held.seat_index = p_seat_index
    and held.segment_id = any (p_segment_ids)
    and held.booking_id = p_booking_id;
  if v_held = cardinality(p_segment_ids) then
    return;
  end if;

  if exists (
    select 1
    from public.guinea_xl_seat_segments held
    where held.departure_id = p_departure_id
      and held.seat_index = p_seat_index
      and held.segment_id = any (p_segment_ids)
      and held.booking_id is distinct from p_booking_id
  ) then
    raise exception 'xl_seat_taken';
  end if;

  insert into public.guinea_xl_seat_segments (departure_id, segment_id, seat_index, booking_id)
  select p_departure_id, segment_id, p_seat_index, p_booking_id
  from unnest(p_segment_ids) as segment_id
  where not exists (
    select 1
    from public.guinea_xl_seat_segments held
    where held.departure_id = p_departure_id
      and held.seat_index = p_seat_index
      and held.segment_id = segment_id
      and held.booking_id = p_booking_id
  );
end;
$$;

revoke all on function public.reserve_guinea_xl_segment_seat(uuid, integer, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.reserve_guinea_xl_segment_seat(uuid, integer, uuid[], uuid) to service_role;

alter table public.guinea_xl_departures
  add column if not exists segment_run boolean not null default false;

alter table public.guinea_xl_departures
  alter column axis_id drop not null;

alter table public.guinea_xl_departures
  drop constraint if exists guinea_xl_departures_axis_or_segment;

alter table public.guinea_xl_departures
  add constraint guinea_xl_departures_axis_or_segment
  check (
    (segment_run = false and axis_id is not null)
    or (segment_run = true and axis_id is null)
  );

alter table public.guinea_xl_bookings
  alter column axis_id drop not null;

alter table public.guinea_xl_bookings
  drop constraint if exists guinea_xl_bookings_axis_for_axis_fare;

alter table public.guinea_xl_bookings
  add constraint guinea_xl_bookings_axis_for_axis_fare
  check (fare_source = 'xl_segment' or axis_id is not null);

create or replace function public.quote_guinea_xl_segments(
  p_origin_key text,
  p_destination_key text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tariff public.guinea_xl_segment_tariff%rowtype;
  v_ids uuid[];
  v_codes text[];
  v_paths integer;
  v_segment public.guinea_xl_segments%rowtype;
  v_segment_id uuid;
  v_raw integer;
  v_final integer;
  v_raw_total integer := 0;
  v_total integer := 0;
  v_definitive boolean := true;
  v_lines jsonb := '[]'::jsonb;
begin
  if p_origin_key is null or p_destination_key is null or p_origin_key = p_destination_key then
    return jsonb_build_object('ok', false, 'error', 'xl_segment_path_invalid');
  end if;
  select * into v_tariff from public.guinea_xl_segment_tariff where id = 'GN';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'xl_segment_not_priced');
  end if;

  with recursive walk as (
    select
      s.id,
      s.destination_key as node,
      array[s.id] as ids,
      array[s.code] as codes,
      1 as depth
    from public.guinea_xl_segments s
    where s.origin_key = p_origin_key
    union all
    select
      s.id,
      s.destination_key,
      w.ids || s.id,
      w.codes || s.code,
      w.depth + 1
    from walk w
    join public.guinea_xl_segments s on s.origin_key = w.node
    where w.node <> p_destination_key
      and w.depth < 8
      and not s.id = any (w.ids)
  )
  select
    (select count(*)::integer from walk w where w.node = p_destination_key),
    walk.ids,
    walk.codes
  into v_paths, v_ids, v_codes
  from walk
  where walk.node = p_destination_key
  limit 1;
  if v_paths is distinct from 1 then
    return jsonb_build_object('ok', false, 'error', 'xl_segment_path_invalid');
  end if;

  foreach v_segment_id in array v_ids loop
    select * into v_segment from public.guinea_xl_segments where id = v_segment_id;
    if v_segment.distance_km is null or v_segment.duration_minutes is null then
      return jsonb_build_object('ok', false, 'error', 'xl_segment_not_priced');
    end if;
    if v_segment.active is not true then
      return jsonb_build_object('ok', false, 'error', 'xl_segment_inactive');
    end if;
    if v_segment.confirmed is not true then
      v_definitive := false;
    end if;
    v_raw := v_tariff.base_gnf + v_segment.distance_km * v_tariff.per_km_gnf + v_segment.duration_minutes * v_tariff.per_minute_gnf;
    v_final := greatest(v_tariff.minimum_gnf, v_raw);
    v_raw_total := v_raw_total + v_raw;
    v_total := v_total + v_final;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'code', v_segment.code,
      'raw_gnf', v_raw,
      'final_gnf', v_final
    ));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'definitive', v_definitive,
    'commercial_booking', false,
    'total_gnf', v_total,
    'raw_total_gnf', v_raw_total,
    'segment_codes', to_jsonb(v_codes),
    'segments', v_lines
  );
end;
$$;

create or replace function public.create_guinea_xl_segment_booking(
  p_booking_id uuid,
  p_idempotency_key text,
  p_client_user_id uuid,
  p_departure_id uuid,
  p_seat_index integer,
  p_origin_key text,
  p_destination_key text,
  p_baggage_kg integer[],
  p_claimed_total_gnf integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.guinea_xl_bookings%rowtype;
  v_departure public.guinea_xl_departures%rowtype;
  v_tariff public.guinea_xl_segment_tariff%rowtype;
  v_bps integer;
  v_ids uuid[];
  v_codes text[];
  v_paths integer;
  v_segment public.guinea_xl_segments%rowtype;
  v_segment_id uuid;
  v_position integer := 0;
  v_raw integer;
  v_final integer;
  v_transport integer := 0;
  v_kg integer;
  v_band_count integer;
  v_band_price integer;
  v_included integer := 0;
  v_baggage integer := 0;
  v_fee integer;
  v_driver integer;
  v_total integer;
  v_lines jsonb := '[]'::jsonb;
  v_front_count integer;
  v_other_count integer;
begin
  if p_client_user_id is null or p_departure_id is null or p_booking_id is null
     or coalesce(p_idempotency_key, '') = '' or char_length(p_idempotency_key) > 80
     or p_seat_index is null or p_seat_index < 1 or p_seat_index > 7
     or p_origin_key is null or p_destination_key is null or p_origin_key = p_destination_key
  then
    return jsonb_build_object('ok', false, 'error', 'xl_booking_invalid');
  end if;

  select * into v_existing
  from public.guinea_xl_bookings
  where client_user_id = p_client_user_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'booking_id', v_existing.id,
      'total_gnf', v_existing.total_gnf,
      'transport_gnf', v_existing.transport_gnf,
      'baggage_gnf', v_existing.baggage_gnf,
      'platform_fee_gnf', v_existing.platform_fee_gnf,
      'driver_amount_gnf', v_existing.driver_amount_gnf
    );
  end if;

  select * into v_departure
  from public.guinea_xl_departures
  where id = p_departure_id
  for update;
  if not found or v_departure.status <> 'open' or v_departure.segment_run is not true then
    return jsonb_build_object('ok', false, 'error', 'xl_departure_unavailable');
  end if;

  select * into v_tariff from public.guinea_xl_segment_tariff where id = 'GN';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'xl_segment_not_priced');
  end if;
  select platform_share_bps into v_bps from public.guinea_xl_settings where id = 'GN';
  if not found or v_bps is null then
    return jsonb_build_object('ok', false, 'error', 'xl_commission_not_configured');
  end if;

  with recursive walk as (
    select
      s.id,
      s.destination_key as node,
      array[s.id] as ids,
      array[s.code] as codes,
      1 as depth
    from public.guinea_xl_segments s
    join public.guinea_xl_departure_segments d
      on d.segment_id = s.id and d.departure_id = p_departure_id
    where s.origin_key = p_origin_key
    union all
    select
      s.id,
      s.destination_key,
      w.ids || s.id,
      w.codes || s.code,
      w.depth + 1
    from walk w
    join public.guinea_xl_segments s on s.origin_key = w.node
    join public.guinea_xl_departure_segments d
      on d.segment_id = s.id and d.departure_id = p_departure_id
    where w.node <> p_destination_key
      and w.depth < 8
      and not s.id = any (w.ids)
  )
  select
    (select count(*)::integer from walk w where w.node = p_destination_key),
    walk.ids,
    walk.codes
  into v_paths, v_ids, v_codes
  from walk
  where walk.node = p_destination_key
  limit 1;
  if v_paths is distinct from 1 then
    return jsonb_build_object('ok', false, 'error', 'xl_segment_path_invalid');
  end if;

  foreach v_segment_id in array v_ids loop
    select * into v_segment from public.guinea_xl_segments where id = v_segment_id;
    if v_segment.distance_km is null or v_segment.duration_minutes is null or v_segment.active is not true then
      return jsonb_build_object('ok', false, 'error', 'xl_segment_not_priced');
    end if;
    if v_segment.confirmed is not true then
      return jsonb_build_object('ok', false, 'error', 'xl_segment_unconfirmed');
    end if;
    v_position := v_position + 1;
    v_raw := v_tariff.base_gnf + v_segment.distance_km * v_tariff.per_km_gnf + v_segment.duration_minutes * v_tariff.per_minute_gnf;
    v_final := greatest(v_tariff.minimum_gnf, v_raw);
    v_transport := v_transport + v_final;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'code', v_segment.code,
      'position', v_position,
      'distance_km', v_segment.distance_km,
      'duration_minutes', v_segment.duration_minutes,
      'raw_gnf', v_raw,
      'final_gnf', v_final
    ));
  end loop;

  if p_baggage_kg is not null then
    foreach v_kg in array p_baggage_kg loop
      if v_kg is null or v_kg <= 0 then
        return jsonb_build_object('ok', false, 'error', 'xl_baggage_invalid');
      end if;
      select count(*), min(price_gnf) into v_band_count, v_band_price
      from public.guinea_xl_baggage_bands
      where active = true and v_kg between min_kg and max_kg;
      if v_band_count <> 1 then
        return jsonb_build_object('ok', false, 'error', 'xl_baggage_not_accepted');
      end if;
      if v_band_price = 0 then
        v_included := v_included + 1;
        if v_included > 1 then
          return jsonb_build_object('ok', false, 'error', 'xl_backpack_limit');
        end if;
      end if;
      v_baggage := v_baggage + v_band_price;
    end loop;
  end if;

  v_fee := ((v_transport * v_bps) + 5000) / 10000;
  v_driver := v_transport - v_fee;
  v_total := v_transport + v_baggage;
  if p_claimed_total_gnf is not null and p_claimed_total_gnf is distinct from v_total then
    return jsonb_build_object('ok', false, 'error', 'xl_client_total_rejected');
  end if;

  if p_seat_index = 1 then
    v_front_count := 1;
    v_other_count := 0;
  else
    v_front_count := 0;
    v_other_count := 1;
  end if;

  insert into public.guinea_xl_bookings (
    id, idempotency_key, client_user_id, driver_id, departure_id, axis_id, seat_indexes,
    status, payment_method, payment_status, country_code, currency, rate_version,
    front_seat_gnf, other_seat_gnf, front_seat_count, other_seat_count,
    transport_gnf, baggage_gnf, total_gnf, platform_share_bps, platform_fee_gnf,
    driver_amount_gnf, baggage_snapshot, fare_source, segment_tariff_version, segment_snapshot
  ) values (
    p_booking_id, p_idempotency_key, p_client_user_id, v_departure.driver_id, p_departure_id, null,
    array[p_seat_index], 'confirmed', 'cash', 'pending_cash', 'GN', 'GNF', v_tariff.version,
    v_transport, v_transport, v_front_count, v_other_count,
    v_transport, v_baggage, v_total, v_bps, v_fee, v_driver,
    coalesce((
      select jsonb_agg(jsonb_build_object('weightKg', kg, 'priceGnf', band.price_gnf))
      from unnest(coalesce(p_baggage_kg, array[]::integer[])) as kg
      join public.guinea_xl_baggage_bands band
        on band.active = true and kg between band.min_kg and band.max_kg
    ), '[]'::jsonb),
    'xl_segment', v_tariff.version,
    jsonb_build_object(
      'segments', v_lines,
      'transport_gnf', v_transport,
      'baggage_gnf', v_baggage,
      'platform_share_bps', v_bps,
      'platform_fee_gnf', v_fee,
      'driver_amount_gnf', v_driver,
      'commercial_booking', true
    )
  );

  v_position := 0;
  foreach v_segment_id in array v_ids loop
    v_position := v_position + 1;
    select * into v_segment from public.guinea_xl_segments where id = v_segment_id;
    v_raw := v_tariff.base_gnf + v_segment.distance_km * v_tariff.per_km_gnf + v_segment.duration_minutes * v_tariff.per_minute_gnf;
    v_final := greatest(v_tariff.minimum_gnf, v_raw);
    insert into public.guinea_xl_booking_segments (
      booking_id, segment_id, position, distance_km, duration_minutes, raw_gnf, final_gnf
    ) values (
      p_booking_id, v_segment_id, v_position, v_segment.distance_km, v_segment.duration_minutes, v_raw, v_final
    );
  end loop;

  perform public.reserve_guinea_xl_segment_seat(p_departure_id, p_seat_index, v_ids, p_booking_id);

  insert into public.guinea_xl_financial_entries (booking_id, entry_kind, amount_gnf, currency)
  values
    (p_booking_id, 'driver_transport', v_driver, 'GNF'),
    (p_booking_id, 'platform_transport', v_fee, 'GNF');

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'booking_id', p_booking_id,
    'total_gnf', v_total,
    'transport_gnf', v_transport,
    'baggage_gnf', v_baggage,
    'platform_fee_gnf', v_fee,
    'driver_amount_gnf', v_driver,
    'segment_codes', to_jsonb(v_codes)
  );
exception
  when others then
    if sqlerrm in (
      'xl_seat_taken',
      'xl_segment_unconfirmed',
      'xl_segment_not_priced',
      'xl_departure_unavailable',
      'xl_booking_invalid'
    ) then
      return jsonb_build_object('ok', false, 'error', sqlerrm);
    end if;
    raise;
end;
$$;

revoke all on function public.quote_guinea_xl_segments(text, text) from public, anon, authenticated;
revoke all on function public.create_guinea_xl_segment_booking(uuid, text, uuid, uuid, integer, text, text, integer[], integer) from public, anon, authenticated;
grant execute on function public.quote_guinea_xl_segments(text, text) to service_role;
grant execute on function public.create_guinea_xl_segment_booking(uuid, text, uuid, uuid, integer, text, text, integer[], integer) to service_role;

alter table public.guinea_xl_segment_tariff enable row level security;
alter table public.guinea_xl_segments enable row level security;
alter table public.guinea_xl_departure_segments enable row level security;
alter table public.guinea_xl_seat_segments enable row level security;
alter table public.guinea_xl_booking_segments enable row level security;

revoke all on public.guinea_xl_segment_tariff from anon, authenticated;
revoke all on public.guinea_xl_segments from anon, authenticated;
revoke all on public.guinea_xl_departure_segments from anon, authenticated;
revoke all on public.guinea_xl_seat_segments from anon, authenticated;
revoke all on public.guinea_xl_booking_segments from anon, authenticated;

grant all on public.guinea_xl_segment_tariff to service_role;
grant all on public.guinea_xl_segments to service_role;
grant all on public.guinea_xl_departure_segments to service_role;
grant all on public.guinea_xl_seat_segments to service_role;
grant all on public.guinea_xl_booking_segments to service_role;

commit;
