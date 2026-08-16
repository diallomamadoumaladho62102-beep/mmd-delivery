-- Wire taxi_ride_ratings into driver_rating_summary (+ driver_ratings log).
-- Incremental avg/count on INSERT only (anti-double via UNIQUE + trigger).

create table if not exists public.driver_rating_summary (
  driver_id uuid primary key references auth.users (id) on delete cascade,
  rating numeric(4, 2) not null default 0
    check (rating >= 0 and rating <= 5),
  rating_count integer not null default 0
    check (rating_count >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.driver_ratings (
  id uuid primary key default gen_random_uuid(),
  ratee_driver_id uuid not null references auth.users (id) on delete cascade,
  rater_id uuid references auth.users (id) on delete set null,
  rating integer not null check (rating between 1 and 5),
  comment text,
  source_type text not null default 'taxi_ride',
  source_id uuid,
  taxi_ride_id uuid references public.taxi_rides (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists driver_ratings_taxi_ride_uq
  on public.driver_ratings (taxi_ride_id)
  where taxi_ride_id is not null;

create unique index if not exists driver_ratings_source_uq
  on public.driver_ratings (source_type, source_id)
  where source_id is not null;

create index if not exists driver_ratings_ratee_created_idx
  on public.driver_ratings (ratee_driver_id, created_at desc);

alter table public.driver_rating_summary enable row level security;
alter table public.driver_ratings enable row level security;

drop policy if exists driver_rating_summary_select_own on public.driver_rating_summary;
create policy driver_rating_summary_select_own
  on public.driver_rating_summary
  for select
  to authenticated
  using (driver_id = auth.uid());

drop policy if exists driver_ratings_select_own on public.driver_ratings;
create policy driver_ratings_select_own
  on public.driver_ratings
  for select
  to authenticated
  using (ratee_driver_id = auth.uid() or rater_id = auth.uid());

grant select on public.driver_rating_summary to authenticated;
grant select on public.driver_ratings to authenticated;
grant select, insert, update, delete on public.driver_rating_summary to service_role;
grant select, insert, update, delete on public.driver_ratings to service_role;

create or replace function public.apply_taxi_ride_rating_to_driver_summary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_count integer := 0;
  v_old_rating numeric := 0;
  v_new_count integer;
  v_new_rating numeric;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  select coalesce(rating_count, 0), coalesce(rating, 0)
    into v_old_count, v_old_rating
  from public.driver_rating_summary
  where driver_id = new.driver_id
  for update;

  if not found then
    v_old_count := 0;
    v_old_rating := 0;
  end if;

  v_new_count := v_old_count + 1;
  v_new_rating := round(
    ((v_old_rating * v_old_count) + new.rating)::numeric / v_new_count,
    2
  );

  insert into public.driver_rating_summary as s (driver_id, rating, rating_count, updated_at)
  values (new.driver_id, v_new_rating, v_new_count, now())
  on conflict (driver_id) do update
    set rating = excluded.rating,
        rating_count = excluded.rating_count,
        updated_at = now();

  begin
    insert into public.driver_ratings (
      ratee_driver_id,
      rater_id,
      rating,
      comment,
      source_type,
      source_id,
      taxi_ride_id
    )
    values (
      new.driver_id,
      new.rater_id,
      new.rating,
      new.comment,
      'taxi_ride',
      new.taxi_ride_id,
      new.taxi_ride_id
    );
  exception
    when unique_violation then
      null;
  end;

  -- Keep driver_profiles in sync for dispatch/eligibility readers.
  update public.driver_profiles
  set
    rating = v_new_rating,
    rating_count = v_new_count,
    updated_at = now()
  where user_id = new.driver_id;

  update public.taxi_driver_features
  set
    rating_taxi = v_new_rating,
    updated_at = now()
  where user_id = new.driver_id;

  return new;
end;
$$;

drop trigger if exists trg_taxi_ride_ratings_driver_summary
  on public.taxi_ride_ratings;
create trigger trg_taxi_ride_ratings_driver_summary
after insert on public.taxi_ride_ratings
for each row
execute function public.apply_taxi_ride_rating_to_driver_summary();

comment on function public.apply_taxi_ride_rating_to_driver_summary() is
  'On taxi rating insert: bump driver_rating_summary avg/count, mirror driver_ratings, sync profiles.';
