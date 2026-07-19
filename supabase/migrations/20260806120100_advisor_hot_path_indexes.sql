-- Additive indexes for Advisor-related hot paths (FKs / admin filters).
-- Non-concurrent: tables are small / near-empty; safe inside migration txn.
-- Empty-DB safe: skip indexes when relations are absent.

begin;

do $idx$
begin
  if to_regclass('public.taxi_preference_stats') is not null then
    execute $sql$
      create index if not exists taxi_preference_stats_date_geo_idx
        on public.taxi_preference_stats (stat_date, country_code, city)
    $sql$;
  end if;

  if to_regclass('public.driver_reward_history') is not null then
    execute $sql$
      create index if not exists driver_reward_history_driver_created_idx
        on public.driver_reward_history (driver_id, created_at desc)
    $sql$;
  end if;

  if to_regclass('public.taxi_shared_ride_matches') is not null then
    execute $sql$
      create index if not exists taxi_shared_ride_matches_shared_ride_idx
        on public.taxi_shared_ride_matches (shared_ride_id)
    $sql$;
    execute $sql$
      create index if not exists taxi_shared_ride_matches_candidate_ride_idx
        on public.taxi_shared_ride_matches (candidate_taxi_ride_id)
        where candidate_taxi_ride_id is not null
    $sql$;
  end if;

  if to_regclass('public.payment_webhook_events') is not null then
    execute $sql$
      create index if not exists payment_webhook_events_received_idx
        on public.payment_webhook_events (received_at desc)
    $sql$;
  end if;
end;
$idx$;

commit;
