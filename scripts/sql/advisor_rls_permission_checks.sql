-- RLS permission smoke helpers (read-only assertions via service_role SQL).
-- Applied as functions? NO — keep as a test script executed via db query.

-- Expected after 20260806120000_advisor_security_hardening:
-- * taxi_preference_stats.relrowsecurity = true
-- * anon cannot execute driver_accept_ready_order
-- * authenticated can execute driver_accept_ready_order
-- * anon cannot execute award_driver_rewards_on_delivery
-- * policies exist on the 7 previously empty RLS tables

select
  c.relname,
  c.relrowsecurity as rls_enabled,
  (
    select count(*)
    from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname
  ) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'taxi_preference_stats',
    'commission_settings',
    'driver_reward_accounts',
    'driver_reward_history',
    'notification_logs',
    'payment_webhook_events',
    'taxi_business_ride_policies',
    'taxi_shared_ride_matches'
  )
order by c.relname;
