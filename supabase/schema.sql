-- Comptes (profil + rôle)
create table if not exists profiles (
  id uuid primary key default auth.uid(),
  role text not null check (role in ('client','vendeur','livreur','admin')),
  full_name text,
  phone text,
  created_at timestamptz default now()
);

-- Vendeurs (restaurants / particuliers)
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

-- Plats
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

-- Commandes
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references profiles(id),
  vendor_id uuid references vendors(id),
  courier_id uuid references profiles(id),
  status text default 'pending' check (status in ('pending','accepted','preparing','pickup','on_the_way','delivered','canceled')),
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
  qty integer not null check (qty>0),
  price_cents integer not null
);

-- Position livreur
create table if not exists courier_locations (
  courier_id uuid references profiles(id) on delete cascade primary key,
  lat double precision,
  lng double precision,
  updated_at timestamptz default now()
);
