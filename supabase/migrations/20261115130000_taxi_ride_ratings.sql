-- Taxi ride ratings (client → driver), unique per ride+rater.

begin;

create table if not exists public.taxi_ride_ratings (
  id uuid primary key default gen_random_uuid(),
  taxi_ride_id uuid not null references public.taxi_rides (id) on delete cascade,
  rater_id uuid not null references auth.users (id) on delete cascade,
  driver_id uuid not null references auth.users (id) on delete cascade,
  rating integer not null check (rating >= 1 and rating <= 5),
  comment text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint taxi_ride_ratings_unique_ride_rater unique (taxi_ride_id, rater_id)
);

create index if not exists taxi_ride_ratings_driver_id_idx
  on public.taxi_ride_ratings (driver_id, created_at desc);

create index if not exists taxi_ride_ratings_ride_id_idx
  on public.taxi_ride_ratings (taxi_ride_id);

alter table public.taxi_ride_ratings enable row level security;

drop policy if exists taxi_ride_ratings_select_participants on public.taxi_ride_ratings;
create policy taxi_ride_ratings_select_participants
  on public.taxi_ride_ratings
  for select
  to authenticated
  using (
    rater_id = auth.uid()
    or driver_id = auth.uid()
    or public.is_staff_user(auth.uid())
  );

drop policy if exists taxi_ride_ratings_insert_own on public.taxi_ride_ratings;
create policy taxi_ride_ratings_insert_own
  on public.taxi_ride_ratings
  for insert
  to authenticated
  with check (rater_id = auth.uid());

drop policy if exists taxi_ride_ratings_update_own on public.taxi_ride_ratings;
create policy taxi_ride_ratings_update_own
  on public.taxi_ride_ratings
  for update
  to authenticated
  using (rater_id = auth.uid())
  with check (rater_id = auth.uid());

grant select, insert, update on public.taxi_ride_ratings to authenticated;
grant all on public.taxi_ride_ratings to service_role;

commit;
