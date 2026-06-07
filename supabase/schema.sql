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
