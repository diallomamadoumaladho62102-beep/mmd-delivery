-- Wire taxi_ride_ratings into driver_rating_summary (VIEW over reviews)
-- and extend driver_ratings for taxi history. Production already has:
--   driver_rating_summary VIEW = avg(stars) FROM driver_reviews
--   driver_ratings TABLE = order_id, rater_user_id, ratee_driver_id, ...

-- 1) Extend driver_ratings for taxi sources (additive).
alter table public.driver_ratings
  add column if not exists taxi_ride_id uuid references public.taxi_rides (id) on delete set null;

alter table public.driver_ratings
  add column if not exists source_type text;

alter table public.driver_ratings
  add column if not exists source_id uuid;

alter table public.driver_ratings
  add column if not exists rater_id uuid references auth.users (id) on delete set null;

update public.driver_ratings
set rater_id = rater_user_id
where rater_id is null
  and rater_user_id is not null;

create unique index if not exists driver_ratings_taxi_ride_uq
  on public.driver_ratings (taxi_ride_id)
  where taxi_ride_id is not null;

create unique index if not exists driver_ratings_source_uq
  on public.driver_ratings (source_type, source_id)
  where source_type is not null and source_id is not null;

create index if not exists driver_ratings_ratee_created_idx
  on public.driver_ratings (ratee_driver_id, created_at desc);

-- 2) Replace summary VIEW so Taxi ratings feed the same Driver UI path.
create or replace view public.driver_rating_summary
with (security_invoker = true)
as
select
  x.driver_id,
  round(coalesce(avg(x.stars), 0)::numeric, 2) as rating,
  count(*)::integer as rating_count
from (
  select dr.driver_id, dr.stars
  from public.driver_reviews dr
  union all
  select tr.driver_id, tr.rating as stars
  from public.taxi_ride_ratings tr
) x
group by x.driver_id;

comment on view public.driver_rating_summary is
  'Driver avg/count from food driver_reviews + taxi_ride_ratings (Driver Menu SoT).';

grant select on public.driver_rating_summary to authenticated;
grant select on public.driver_rating_summary to service_role;

-- 3) Trigger: mirror taxi rating into driver_ratings + sync profile fields.
create or replace function public.apply_taxi_ride_rating_to_driver_summary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avg numeric := 0;
  v_count integer := 0;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  begin
    insert into public.driver_ratings (
      ratee_driver_id,
      rater_user_id,
      rater_id,
      rating,
      comment,
      source_type,
      source_id,
      taxi_ride_id,
      order_id
    )
    values (
      new.driver_id,
      new.rater_id,
      new.rater_id,
      new.rating,
      new.comment,
      'taxi_ride',
      new.taxi_ride_id,
      new.taxi_ride_id,
      -- Legacy NOT NULL order_id: use taxi_ride_id as surrogate when no food order.
      new.taxi_ride_id
    );
  exception
    when unique_violation then
      null;
    when not_null_violation then
      null;
    when foreign_key_violation then
      null;
  end;

  select coalesce(rating, 0), coalesce(rating_count, 0)
    into v_avg, v_count
  from public.driver_rating_summary
  where driver_id = new.driver_id;

  update public.driver_profiles
  set
    rating = v_avg,
    rating_count = v_count,
    updated_at = now()
  where user_id = new.driver_id;

  update public.taxi_driver_features
  set
    rating_taxi = v_avg,
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
  'On taxi rating insert: mirror driver_ratings when possible; sync profiles from driver_rating_summary VIEW.';
