-- Baseline core identity tables required for empty-DB resets.
--
-- Context (Phase 10.1): this migration file existed but was empty, while later
-- migrations (e.g. 20260602130000_driver_map_reports_v1_1) create SQL-language
-- helpers that resolve public.profiles / public.driver_profiles at CREATE time.
-- Without these tables, `supabase db reset` fails on a blank database.
--
-- Idempotent: create table / column / index IF NOT EXISTS only.
-- Safe for environments that already have a richer schema.

begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'client',
  full_name text,
  phone text,
  account_status text not null default 'active',
  is_founder boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists role text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists account_status text;
alter table public.profiles add column if not exists is_founder boolean;
alter table public.profiles add column if not exists created_at timestamptz;
alter table public.profiles add column if not exists updated_at timestamptz;

update public.profiles set account_status = 'active' where account_status is null;
update public.profiles set is_founder = false where is_founder is null;
update public.profiles set created_at = now() where created_at is null;
update public.profiles set updated_at = now() where updated_at is null;

create table if not exists public.driver_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
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
  on public.driver_profiles (user_id);

create index if not exists driver_profiles_status_online_idx
  on public.driver_profiles (status, is_online);

-- Minimal restaurant profile stub so early alter-if-exists migrations can attach columns.
create table if not exists public.restaurant_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  name text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.restaurant_profiles add column if not exists status text;
alter table public.restaurant_profiles add column if not exists user_id uuid;
alter table public.restaurant_profiles add column if not exists name text;

-- delivery_requests was never created in historical migrations (only ALTER/RPC).
create table if not exists public.delivery_requests (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  driver_id uuid references auth.users (id) on delete set null,
  status text not null default 'pending',
  payment_status text not null default 'unpaid',
  kind text not null default 'delivery',
  request_type text not null default 'package',
  title text,
  errand_description text,
  pickup_address text not null default '',
  dropoff_address text not null default '',
  pickup_contact_name text,
  pickup_phone text,
  dropoff_contact_name text,
  dropoff_phone text,
  pickup_lat double precision not null default 0,
  pickup_lng double precision not null default 0,
  dropoff_lat double precision not null default 0,
  dropoff_lng double precision not null default 0,
  distance_miles numeric(10, 3),
  eta_minutes integer,
  subtotal numeric(12, 2) not null default 0,
  delivery_fee numeric(12, 2) not null default 0,
  tax numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  subtotal_cents integer not null default 0,
  delivery_fee_cents integer not null default 0,
  tax_cents integer not null default 0,
  total_cents integer not null default 0,
  currency text not null default 'USD',
  country_code text,
  discounts numeric(12, 2) default 0,
  driver_pay numeric(12, 2),
  commission_cents integer default 0,
  paid_at timestamptz,
  expires_at timestamptz,
  stripe_session_id text,
  stripe_payment_intent_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists delivery_requests_client_user_id_idx
  on public.delivery_requests (client_user_id, created_at desc);

create table if not exists public.restaurant_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid,
  restaurant_user_id uuid references auth.users (id) on delete set null,
  name text,
  price_cents integer,
  is_active boolean not null default true,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.referral_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  owner_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

commit;
