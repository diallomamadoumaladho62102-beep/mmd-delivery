-- =========================
-- Comptes (profil + rôle)
-- =========================
create table if not exists profiles (
  id uuid primary key default auth.uid(),
  role text not null check (role in ('client','vendeur','livreur','admin')),
  full_name text,
  phone text,
  created_at timestamptz default now()
);

-- =========================
-- Vendeurs (restaurants / particuliers)
-- =========================
create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  owner uuid references profiles(id) on delete set null,
  name text not null,
  address text,
  lat double precision,
  lng double precision,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- =========================
-- Plats
-- =========================
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid references vendors(id) on delete cascade,
  name text not null,
  description text,
  price_cents integer not null,
  photo_url text,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- =========================
-- Commandes
-- =========================
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references profiles(id),
  vendor_id uuid references vendors(id),
  courier_id uuid references profiles(id),
  status text default 'pending'
    check (status in ('pending','accepted','preparing','pickup','on_the_way','delivered','canceled')),
  amount_cents integer not null,
  address text,
  lat double precision,
  lng double precision,
  created_at timestamptz default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  item_id uuid references items(id),
  qty integer not null check (qty > 0),
  price_cents integer not null
);

-- =========================
-- Position livreur
-- =========================
create table if not exists courier_locations (
  courier_id uuid references profiles(id) on delete cascade primary key,
  lat double precision,
  lng double precision,
  updated_at timestamptz default now()
);

-- =====================================================
-- DRIVER PROFILES (détails chauffeur – mobile + web)
-- =====================================================
create table if not exists driver_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,

  full_name text,
  phone text,
  emergency_phone text,
  address text,
  city text,
  state text,
  zip_code text,
  date_of_birth date,
  transport_mode text default 'bike',
  vehicle_type text,
  vehicle_brand text,
  vehicle_model text,
  vehicle_year integer,
  vehicle_color text,
  plate_number text,
  license_number text,
  license_expiry date,
  photo_url text,

  is_online boolean not null default false,
  total_deliveries integer not null default 0,
  acceptance_rate numeric,
  cancellation_rate numeric,
  rating numeric,
  rating_count integer not null default 0,
  vehicle_verified boolean not null default false,
  payout_enabled boolean not null default false,
  documents_required boolean not null default true,
  stripe_account_id text,
  stripe_onboarded boolean not null default false,
  stripe_onboarded_at timestamptz,
  driver_score numeric,
  driver_tier integer,
  last_assigned_at timestamptz,
  status text not null default 'pending',
  missing_requirements text,
  onboarding_status text not null default 'draft',
  is_locked boolean not null default false,
  locked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists driver_profiles_user_id_idx
on driver_profiles(user_id);

create index if not exists driver_profiles_status_online_idx
on driver_profiles(status, is_online);

-- =====================================================
-- DRIVER DOCUMENTS
-- =====================================================
create table if not exists driver_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  driver_id uuid references driver_profiles(id) on delete cascade,
  doc_type text not null,
  file_path text not null,
  country text,
  state text,
  doc_number text,
  expires_at text,
  status text not null default 'pending',
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, doc_type)
);

-- =====================================================
-- DRIVER LOCATIONS (GPS temps réel)
-- =====================================================
create table if not exists driver_locations (
  driver_id uuid primary key references auth.users(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  updated_at timestamptz not null default now()
);

-- =========================
-- Auto update updated_at
-- =========================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_driver_profiles_updated_at on driver_profiles;
create trigger trg_driver_profiles_updated_at
before update on driver_profiles
for each row execute function set_updated_at();

-- =========================
-- RLS (sécurité)
-- =========================
alter table driver_profiles enable row level security;

drop policy if exists driver_profiles_select_own on driver_profiles;
create policy driver_profiles_select_own
on driver_profiles
for select
using (auth.uid() = user_id);

drop policy if exists driver_profiles_insert_own on driver_profiles;
create policy driver_profiles_insert_own
on driver_profiles
for insert
with check (auth.uid() = user_id);

drop policy if exists driver_profiles_update_if_not_locked on driver_profiles;
create policy driver_profiles_update_if_not_locked
on driver_profiles
for update
using (auth.uid() = user_id and coalesce(is_locked, false) = false)
with check (auth.uid() = user_id and coalesce(is_locked, false) = false);

-- =====================================================
-- TAXI MODULE (isolated domain — no orders / delivery_requests)
-- Migration: 20260609120000_taxi_sprint1_infrastructure.sql
-- =====================================================

create table if not exists taxi_pricing (
  id uuid primary key default gen_random_uuid(),
  config_key text not null unique,
  vehicle_class text not null check (vehicle_class in ('standard', 'xl', 'premium')),
  country_code text not null default 'US',
  currency text not null default 'USD',
  active boolean not null default true,
  base_fare numeric(12, 2) not null default 0,
  per_mile numeric(12, 2) not null default 0,
  per_minute numeric(12, 2) not null default 0,
  min_fare numeric(12, 2) not null default 0,
  booking_fee numeric(12, 2) not null default 0,
  driver_share_pct numeric(6, 2) not null default 75,
  platform_share_pct numeric(6, 2) not null default 25,
  class_multiplier numeric(8, 4) not null default 1,
  max_passengers integer not null default 4,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists taxi_driver_features (
  user_id uuid primary key references auth.users (id) on delete cascade,
  taxi_enabled boolean not null default false,
  vehicle_class text not null default 'standard'
    check (vehicle_class in ('standard', 'xl', 'premium')),
  vehicle_make text,
  vehicle_model text,
  vehicle_year integer,
  vehicle_plate text,
  vehicle_color text,
  passenger_capacity integer not null default 4,
  xl_eligible boolean not null default false,
  premium_eligible boolean not null default false,
  stripe_connect_account_id text,
  rating_taxi numeric(4, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists taxi_rides (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references auth.users (id) on delete restrict,
  driver_id uuid references auth.users (id) on delete set null,
  vehicle_class text not null default 'standard',
  status text not null default 'draft',
  pickup_address text not null,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  dropoff_address text not null,
  dropoff_lat double precision not null,
  dropoff_lng double precision not null,
  distance_miles numeric(10, 3),
  duration_minutes numeric(10, 2),
  country_code text not null default 'US',
  currency text not null default 'USD',
  pricing_snapshot_id uuid references taxi_pricing (id) on delete set null,
  subtotal_cents integer not null default 0,
  platform_fee_cents integer not null default 0,
  driver_payout_cents integer not null default 0,
  total_cents integer not null default 0,
  payment_status text not null default 'unpaid',
  paid_at timestamptz,
  stripe_session_id text,
  stripe_payment_intent_id text,
  refund_status text,
  stripe_refund_id text,
  stripe_refunded_at timestamptz,
  accepted_at timestamptz,
  driver_arrived_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text,
  cancel_reason text,
  client_notes text,
  passenger_count integer not null default 1,
  dispatch_wave integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists taxi_offers (
  id uuid primary key default gen_random_uuid(),
  taxi_ride_id uuid not null references taxi_rides (id) on delete cascade,
  driver_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending',
  wave integer not null default 1,
  distance_miles numeric(10, 3),
  vehicle_class_match boolean not null default true,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists taxi_events (
  id uuid primary key default gen_random_uuid(),
  taxi_ride_id uuid not null references taxi_rides (id) on delete cascade,
  event_type text not null,
  old_status text,
  new_status text,
  actor_id uuid references auth.users (id) on delete set null,
  triggered_role text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists taxi_messages (
  id uuid primary key default gen_random_uuid(),
  taxi_ride_id uuid not null references taxi_rides (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  sender_role text,
  target_role text,
  text text,
  image_path text,
  created_at timestamptz not null default now()
);

create table if not exists taxi_commissions (
  id uuid primary key default gen_random_uuid(),
  taxi_ride_id uuid not null unique references taxi_rides (id) on delete cascade,
  currency text not null default 'USD',
  total_cents integer not null default 0,
  platform_cents integer not null default 0,
  driver_cents integer not null default 0,
  driver_transfer_id text,
  driver_paid_out boolean not null default false,
  driver_paid_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Key RPCs (full definitions in migration 20260609120000):
-- taxi_ride_participant_ids, is_taxi_account_active, is_taxi_driver_eligible,
-- quote_taxi_ride, mark_taxi_ride_paid, refresh_taxi_commissions,
-- driver_accept/reject_taxi_offer, driver_arrive/start/complete_taxi_ride,
-- log_taxi_event
-- Storage bucket: taxi-images (path: {ride_id}/{filename})
