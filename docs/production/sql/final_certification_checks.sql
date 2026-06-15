-- MMD Delivery — Final production certification (READ ONLY)
-- Run in Supabase Dashboard → SQL Editor (Production project)
-- Expected: every row in section "EXPECTED RESULTS" must match before PASS.

-- =============================================================================
-- 1) Migrations trust-boundary (P0)
-- =============================================================================

SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version IN ('20260716120000', '20260717120000')
ORDER BY version;
-- EXPECTED: 2 rows
--   20260716120000 | food_order_trust_boundary
--   20260717120000 | production_hardening_p0_p1

-- =============================================================================
-- 2) RLS enabled on critical tables
-- =============================================================================

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('orders', 'delivery_requests', 'taxi_rides')
ORDER BY c.relname;
-- EXPECTED: 3 rows, rls_enabled = true for each

-- =============================================================================
-- 3) INSERT policies — client direct insert must NOT exist
-- =============================================================================

SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('orders', 'delivery_requests', 'taxi_rides')
  AND cmd = 'INSERT'
ORDER BY tablename, policyname;
-- EXPECTED for trust boundary PASS:
--   orders: NO policy named "orders insert client" / orders_insert_client
--   delivery_requests: NO delivery_requests_insert_client / "delivery_requests insert client"
--   taxi_rides: NO taxi_rides_insert_client
-- (Other INSERT policies for service_role/staff may exist — review names manually.)

-- Explicit forbidden policy names (must return 0 rows):
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (tablename = 'orders' AND policyname IN ('orders insert client', 'orders_insert_client'))
    OR (tablename = 'delivery_requests' AND policyname IN ('delivery_requests insert client', 'delivery_requests_insert_client'))
    OR (tablename = 'taxi_rides' AND policyname = 'taxi_rides_insert_client')
  );
-- EXPECTED: 0 rows

-- =============================================================================
-- 4) Financial UPDATE guards (triggers)
-- =============================================================================

SELECT tgname, tgrelid::regclass AS table_name, tgenabled
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgname IN (
    'trg_guard_orders_client_financial_update',
    'trg_guard_delivery_requests_client_financial_update'
  )
ORDER BY tgname;
-- EXPECTED: 2 rows, tgenabled = 'O' (enabled)

SELECT p.proname AS function_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'guard_orders_client_financial_update',
    'guard_delivery_requests_client_financial_update'
  )
ORDER BY p.proname;
-- EXPECTED: 2 rows

-- Legacy permissive orders UPDATE policy must be gone:
SELECT policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'orders'
  AND policyname IN ('orders update roles', 'orders_update_roles');
-- EXPECTED: 0 rows

-- =============================================================================
-- 5) stripe_webhook_events — idempotence table accessible
-- =============================================================================

SELECT COUNT(*) AS stripe_webhook_events_total
FROM public.stripe_webhook_events;
-- EXPECTED: query succeeds (no permission error)

-- 24h count: production uses received_at (legacy); newer migrations use created_at.
SELECT COUNT(*) AS stripe_webhook_events_24h_received_at
FROM public.stripe_webhook_events
WHERE received_at >= NOW() - INTERVAL '24 hours';
-- EXPECTED: succeeds on current production schema

-- Alternate if received_at is absent:
-- SELECT COUNT(*) FROM public.stripe_webhook_events
-- WHERE created_at >= NOW() - INTERVAL '24 hours';

SELECT stripe_event_id, event_type, created_at
FROM public.stripe_webhook_events
ORDER BY created_at DESC
LIMIT 5;
-- EXPECTED: recent rows after Live traffic; each stripe_event_id unique

-- =============================================================================
-- 6) AI tables (MMD AI foundation)
-- =============================================================================

SELECT COUNT(*) AS ai_runtime_settings_rows
FROM public.ai_runtime_settings;
-- EXPECTED: >= 1

SELECT COUNT(*) AS ai_conversations_total
FROM public.ai_conversations;
-- EXPECTED: query succeeds

SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'platform_countries'
  AND column_name = 'ai_enabled';
-- EXPECTED: 1 row (launch control column present)

-- =============================================================================
-- 7) platform_countries launch control
-- =============================================================================

SELECT COUNT(*) AS platform_countries_count
FROM public.platform_countries;
-- EXPECTED: 11 (matches /api/health)

SELECT country_code, platform_enabled, checkout_enabled, restaurant_enabled,
       delivery_enabled, taxi_enabled, marketplace_enabled, ai_enabled
FROM public.platform_countries
ORDER BY country_code;
-- EXPECTED: review manually — US/GN markets enabled for your launch plan

-- =============================================================================
-- 8) OPTIONAL — client INSERT probe (run as authenticated client, NOT service_role)
-- Use Supabase client SDK or REST with a normal user JWT in a separate script.
-- Expected errors when trust boundary is closed:
--   orders INSERT → permission denied / RLS violation
--   delivery_requests INSERT → permission denied / RLS violation
--   taxi_rides INSERT → permission denied / RLS violation
-- Do NOT run destructive UPDATE tests on production orders.
