-- =============================================================================
-- Guinée — activation publique des 4 services (À APPLIQUER UNIQUEMENT APRÈS
-- AUTORISATION EXPLICITE DU PROPRIÉTAIRE DU PRODUIT)
-- =============================================================================
-- Ne pas exécuter automatiquement. Ne pas inclure dans un deploy CI.
-- Touche UNIQUEMENT country_code = 'GN' (et régions GN). US / CA / etc. intacts.
--
-- Prérequis code déjà livrés localement :
--   - Checkout marketplace local cash/OM (route /api/marketplace/checkout/local)
--   - Migration schéma cash : supabase/pending/20261223120000_marketplace_local_cash.sql
--   - Codes Colis via get_authorized_verification_codes (mobile)
--   - Affichage GNF sans ÷100 ; postal GN facultatif
--
-- Après SQL : configurer les secrets env (Orange Money, MARKETPLACE_CHECKOUT_ENABLED)
-- puis approuver les VRAIS professionnels via admin (pas les comptes guinea-*-@example.com
-- tant qu'ils restent des comptes de répétition isolés).
-- =============================================================================

begin;

-- 1) Schéma cash marketplace (idempotent si déjà appliqué)
alter table public.seller_orders
  drop constraint if exists seller_orders_payment_status_check;

alter table public.seller_orders
  add constraint seller_orders_payment_status_check
  check (
    payment_status in (
      'unpaid',
      'pending',
      'pending_cash',
      'cash_collected',
      'paid',
      'failed',
      'cancelled'
    )
  );

-- 1a) Colis + food: payment_method for cash (US rows stay null)
alter table public.delivery_requests
  add column if not exists payment_method text;
alter table public.orders
  add column if not exists payment_method text;

alter table public.delivery_requests
  drop constraint if exists delivery_requests_payment_method_check;
alter table public.delivery_requests
  add constraint delivery_requests_payment_method_check
  check (payment_method is null or payment_method in ('card', 'cash', 'orange_money', 'stripe'));

alter table public.orders
  drop constraint if exists orders_payment_method_check;
alter table public.orders
  add constraint orders_payment_method_check
  check (payment_method is null or payment_method in ('card', 'cash', 'orange_money', 'stripe'));

-- Widen payment_status if a legacy CHECK blocks cash values
alter table public.delivery_requests
  drop constraint if exists delivery_requests_payment_status_check;
alter table public.orders
  drop constraint if exists orders_payment_status_check;

-- 1b) Market column for restaurants (was deferred historically)
alter table public.restaurant_profiles
  add column if not exists country_code text;

update public.restaurant_profiles
set country_code = 'GN'
where country_code is null
  and (
    coalesce(phone, '') like '+224%'
    or coalesce(phone, '') like '224%'
  );

-- 2) Country floor — Taxi, Colis, Marketplace, Restaurant
update public.platform_countries
set
  platform_enabled = true,
  taxi_enabled = true,
  delivery_enabled = true,
  restaurant_enabled = true,
  marketplace_enabled = true,
  seller_enabled = true,
  checkout_enabled = true,
  -- Payouts / live Stripe marketplace : laisser OFF jusqu'à certification OM/cash
  payout_enabled = false,
  marketplace_checkout_live_enabled = false,
  marketplace_dispatch_live_enabled = false,
  marketplace_payouts_live_enabled = false,
  launch_status = 'enabled',
  maintenance_mode = false,
  updated_at = now()
where country_code = 'GN';

-- 3) Zones GN (si PLATFORM_GN_ZONE_GATES / scope régions actif)
update public.platform_regions
set
  platform_enabled = true,
  taxi_enabled = true,
  delivery_enabled = true,
  restaurant_enabled = true,
  marketplace_enabled = true,
  seller_enabled = true,
  checkout_enabled = true,
  payout_enabled = false,
  marketplace_checkout_live_enabled = false,
  marketplace_dispatch_live_enabled = false,
  marketplace_payouts_live_enabled = false,
  launch_status = 'enabled',
  maintenance_mode = false,
  updated_at = now()
where country_code = 'GN';

-- 4) Alignement taxi_countries (legacy)
update public.taxi_countries
set
  checkout_enabled = true,
  payout_enabled = false,
  launch_status = 'enabled'
where country_code = 'GN';

commit;

-- =============================================================================
-- ENV (hors SQL) — ouverture CASH (Orange Money plus tard)
-- =============================================================================
-- GUINEA_MARKET_ENABLED=true
-- MARKETPLACE_CHECKOUT_ENABLED=true
-- ORANGE_MONEY_GN_ENABLED : laisser false / absent jusqu'aux vrais credentials
-- STRIPE_ENABLED_GN : false
-- Ne PAS approuver guinea-client|driver|seller|restaurant@example.com pour le live
-- =============================================================================
