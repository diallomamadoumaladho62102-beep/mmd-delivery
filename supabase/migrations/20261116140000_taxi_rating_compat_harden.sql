-- Harden taxi rating integration against the REAL production schema.
-- Already applied earlier: 20261116120000 (additive columns + union VIEW + trigger).
--
-- Production facts this migration respects (verified 2026-08-16):
--   * driver_rating_summary is a VIEW (not a table)
--   * driver_ratings is the live food/legacy ledger:
--       order_id NOT NULL, rater_user_id NOT NULL, ratee_driver_id NOT NULL
--       + additive taxi cols from 20261116120000 (taxi_ride_id, source_*, rater_id)
--   * UNIQUE(order_id) x3 + UNIQUE(order_id, rater_user_id) — NULL order_id OK in PG
--   * No FK from order_id → orders (surrogate taxi UUID as order_id was possible)
--   * driver_reviews = 0 rows; driver_ratings = 6 food rows; taxi_ride_ratings = 0
--   * refresh_driver_rating / VIEW previously ignored live food driver_ratings
--
-- This migration is additive / non-destructive:
--   * preserves all existing driver_ratings rows (no DELETE)
--   * keeps rater_user_id as the legacy required rater column
--   * allows taxi rows via nullable order_id + taxi_ride_id
--   * summary VIEW includes food driver_ratings + driver_reviews + taxi_ride_ratings
--   * no double-count of taxi (exclude taxi_ride_id IS NOT NULL from food branch)

-- ---------------------------------------------------------------------------
-- Preflight: abort if legacy rows cannot satisfy the upcoming coherence check.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad integer;
begin
  select count(*)::int into v_bad
  from public.driver_ratings
  where taxi_ride_id is null
    and order_id is null;

  if v_bad > 0 then
    raise exception
      'taxi_rating_compat_harden preflight failed: % driver_ratings rows have both order_id and taxi_ride_id null',
      v_bad;
  end if;
end $$;

-- 1) Allow taxi rows without inventing a fake order_id.
alter table public.driver_ratings
  alter column order_id drop not null;

-- Ensure additive taxi columns/indexes exist (idempotent if 20261116120000 already ran).
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

-- Clean any accidental surrogate rows from the prior trigger design
-- (order_id incorrectly set equal to taxi_ride_id). Safe no-op if none exist.
update public.driver_ratings
set order_id = null,
    source_type = coalesce(source_type, 'taxi_ride'),
    source_id = coalesce(source_id, taxi_ride_id)
where taxi_ride_id is not null
  and order_id is not null
  and order_id = taxi_ride_id;

-- Coherence AFTER cleanup: food keeps order_id; taxi sets taxi_ride_id.
alter table public.driver_ratings
  drop constraint if exists driver_ratings_source_coherence_chk;

alter table public.driver_ratings
  add constraint driver_ratings_source_coherence_chk
  check (
    (
      taxi_ride_id is not null
      and coalesce(source_type, 'taxi_ride') = 'taxi_ride'
    )
    or (
      taxi_ride_id is null
      and order_id is not null
    )
  );

create unique index if not exists driver_ratings_taxi_ride_uq
  on public.driver_ratings (taxi_ride_id)
  where taxi_ride_id is not null;

create unique index if not exists driver_ratings_source_uq
  on public.driver_ratings (source_type, source_id)
  where source_type is not null and source_id is not null;

create index if not exists driver_ratings_ratee_created_idx
  on public.driver_ratings (ratee_driver_id, created_at desc);

-- 2) Summary VIEW: legacy food ratings + reviews + taxi (no taxi double-count).
create or replace view public.driver_rating_summary
with (security_invoker = true)
as
select
  x.driver_id,
  round(coalesce(avg(x.stars), 0)::numeric, 2) as rating,
  count(*)::integer as rating_count
from (
  -- Food/legacy opportunities reviews (may be empty).
  select dr.driver_id, dr.stars
  from public.driver_reviews dr

  union all

  -- Live food/legacy ledger used by Driver Menu fallback today.
  select d.ratee_driver_id as driver_id, d.rating::integer as stars
  from public.driver_ratings d
  where d.taxi_ride_id is null
    and d.order_id is not null

  union all

  -- Taxi ratings SoT.
  select tr.driver_id, tr.rating as stars
  from public.taxi_ride_ratings tr
) x
group by x.driver_id;

comment on view public.driver_rating_summary is
  'Driver avg/count from driver_reviews + food driver_ratings + taxi_ride_ratings.';

grant select on public.driver_rating_summary to authenticated;
grant select on public.driver_rating_summary to service_role;

-- 3) Keep driver_profiles in sync from the SAME combined sources as the VIEW.
create or replace function public.refresh_driver_rating(p_driver_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avg numeric(10, 4);
  v_cnt integer;
begin
  select
    coalesce(avg(stars)::numeric, 0),
    coalesce(count(*)::int, 0)
  into v_avg, v_cnt
  from (
    select stars
    from public.driver_reviews
    where driver_id = p_driver_id
    union all
    select rating::integer as stars
    from public.driver_ratings
    where ratee_driver_id = p_driver_id
      and taxi_ride_id is null
      and order_id is not null
    union all
    select rating as stars
    from public.taxi_ride_ratings
    where driver_id = p_driver_id
  ) s;

  update public.driver_profiles
  set
    rating = round(v_avg, 2),
    rating_count = v_cnt,
    updated_at = now()
  where user_id = p_driver_id;
end;
$$;

-- 4) Trigger: mirror taxi into driver_ratings WITHOUT touching order_id.
create or replace function public.apply_taxi_ride_rating_to_driver_summary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
      null
    );
  exception
    when unique_violation then
      null;
    when not_null_violation then
      null;
    when foreign_key_violation then
      null;
    when check_violation then
      null;
  end;

  perform public.refresh_driver_rating(new.driver_id);

  update public.taxi_driver_features
  set
    rating_taxi = (
      select coalesce(round(avg(rating)::numeric, 2), 0)
      from public.taxi_ride_ratings
      where driver_id = new.driver_id
    ),
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
  'Mirror taxi rating into driver_ratings (order_id null) and refresh combined driver_profiles rating.';

-- 5) Recompute profiles for drivers that already have food ratings so counts stay correct.
do $$
declare
  r record;
begin
  for r in
    select distinct ratee_driver_id as driver_id
    from public.driver_ratings
    where ratee_driver_id is not null
  loop
    perform public.refresh_driver_rating(r.driver_id);
  end loop;
end $$;
