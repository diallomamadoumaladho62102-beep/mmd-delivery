-- Guard: only client→driver taxi ratings feed driver summary / mirrors.
-- Driver→client ratings stay in taxi_ride_ratings for admin moderation.

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

  select d.ratee_driver_id as driver_id, d.rating::integer as stars
  from public.driver_ratings d
  where d.taxi_ride_id is null
    and d.order_id is not null

  union all

  select tr.driver_id, tr.rating as stars
  from public.taxi_ride_ratings tr
  where coalesce(tr.ratee_role, 'driver') = 'driver'
) x
group by x.driver_id;

comment on view public.driver_rating_summary is
  'Driver avg/count from driver_reviews + food driver_ratings + client→driver taxi ratings.';

grant select on public.driver_rating_summary to authenticated;
grant select on public.driver_rating_summary to service_role;

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
      and coalesce(ratee_role, 'driver') = 'driver'
  ) s;

  update public.driver_profiles
  set
    rating = round(v_avg, 2),
    rating_count = v_cnt,
    updated_at = now()
  where user_id = p_driver_id;
end;
$$;

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

  -- Driver→client ratings must not pollute driver score / mirror ledger.
  if coalesce(new.ratee_role, 'driver') <> 'driver' then
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
        and coalesce(ratee_role, 'driver') = 'driver'
    ),
    updated_at = now()
  where user_id = new.driver_id;

  return new;
end;
$$;

comment on function public.apply_taxi_ride_rating_to_driver_summary() is
  'Mirror client→driver taxi ratings into driver_ratings and refresh combined driver rating.';
