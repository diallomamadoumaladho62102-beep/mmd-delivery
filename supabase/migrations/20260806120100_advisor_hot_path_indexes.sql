-- Additive indexes for Advisor-related hot paths (FKs / admin filters).
-- Non-concurrent: tables are small / near-empty; safe inside migration txn.

begin;

create index if not exists taxi_preference_stats_date_geo_idx
  on public.taxi_preference_stats (stat_date, country_code, city);

create index if not exists driver_reward_history_driver_created_idx
  on public.driver_reward_history (driver_id, created_at desc);

create index if not exists taxi_shared_ride_matches_shared_ride_idx
  on public.taxi_shared_ride_matches (shared_ride_id);

create index if not exists taxi_shared_ride_matches_candidate_ride_idx
  on public.taxi_shared_ride_matches (candidate_taxi_ride_id)
  where candidate_taxi_ride_id is not null;

create index if not exists payment_webhook_events_received_idx
  on public.payment_webhook_events (received_at desc);

commit;
