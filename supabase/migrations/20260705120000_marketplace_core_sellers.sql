-- Marketplace Core — sellers, products, orders (no checkout / payouts)

begin;

-- ---------------------------------------------------------------------------
-- 1) sellers
-- ---------------------------------------------------------------------------

create table if not exists public.sellers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  business_name text not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  city text not null,
  address text not null,
  phone text not null,
  region_code text,
  mmd_zone_id uuid references public.mmd_zones (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'suspended')),
  review_notes text,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sellers_user_id_unique unique (user_id)
);

create index if not exists sellers_status_idx
  on public.sellers (status, country_code);

create index if not exists sellers_country_idx
  on public.sellers (country_code, region_code);

drop trigger if exists trg_sellers_updated_at on public.sellers;
create trigger trg_sellers_updated_at
before update on public.sellers
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) seller_products
-- ---------------------------------------------------------------------------

create table if not exists public.seller_products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id) on delete cascade,
  title text not null,
  description text not null default '',
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'USD',
  category text not null default 'general',
  image_paths text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists seller_products_seller_active_idx
  on public.seller_products (seller_id, active, created_at desc);

drop trigger if exists trg_seller_products_updated_at on public.seller_products;
create trigger trg_seller_products_updated_at
before update on public.seller_products
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) seller_orders (read-only placeholder — no checkout yet)
-- ---------------------------------------------------------------------------

create table if not exists public.seller_orders (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id) on delete cascade,
  client_user_id uuid references public.profiles (id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'confirmed', 'canceled', 'fulfilled')),
  currency text not null default 'USD',
  total_cents integer not null default 0 check (total_cents >= 0),
  country_code text,
  region_code text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists seller_orders_seller_idx
  on public.seller_orders (seller_id, created_at desc);

drop trigger if exists trg_seller_orders_updated_at on public.seller_orders;
create trigger trg_seller_orders_updated_at
before update on public.seller_orders
for each row execute function public.taxi_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4) seller_order_items
-- ---------------------------------------------------------------------------

create table if not exists public.seller_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.seller_orders (id) on delete cascade,
  product_id uuid references public.seller_products (id) on delete set null,
  title text not null,
  price_cents integer not null check (price_cents >= 0),
  quantity integer not null default 1 check (quantity > 0),
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);

create index if not exists seller_order_items_order_idx
  on public.seller_order_items (order_id);

-- ---------------------------------------------------------------------------
-- 5) Helpers
-- ---------------------------------------------------------------------------

create or replace function public.user_owns_seller(p_seller_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sellers s
    where s.id = p_seller_id
      and s.user_id = p_user_id
  );
$$;

create or replace function public.user_seller_id(p_user_id uuid default auth.uid())
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
  from public.sellers s
  where s.user_id = p_user_id
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 6) RLS
-- ---------------------------------------------------------------------------

alter table public.sellers enable row level security;
alter table public.seller_products enable row level security;
alter table public.seller_orders enable row level security;
alter table public.seller_order_items enable row level security;

drop policy if exists sellers_select_own on public.sellers;
create policy sellers_select_own
on public.sellers for select to authenticated
using (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists sellers_insert_own on public.sellers;
create policy sellers_insert_own
on public.sellers for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists sellers_update_own on public.sellers;
create policy sellers_update_own
on public.sellers for update to authenticated
using (user_id = auth.uid() or public.is_staff_user(auth.uid()))
with check (user_id = auth.uid() or public.is_staff_user(auth.uid()));

drop policy if exists seller_products_select on public.seller_products;
create policy seller_products_select
on public.seller_products for select to authenticated
using (
  public.user_owns_seller(seller_id, auth.uid())
  or public.is_staff_user(auth.uid())
);

drop policy if exists seller_products_write on public.seller_products;
create policy seller_products_write
on public.seller_products for all to authenticated
using (
  public.user_owns_seller(seller_id, auth.uid())
  or public.is_staff_user(auth.uid())
)
with check (
  public.user_owns_seller(seller_id, auth.uid())
  or public.is_staff_user(auth.uid())
);

drop policy if exists seller_orders_select on public.seller_orders;
create policy seller_orders_select
on public.seller_orders for select to authenticated
using (
  public.user_owns_seller(seller_id, auth.uid())
  or public.is_staff_user(auth.uid())
);

drop policy if exists seller_order_items_select on public.seller_order_items;
create policy seller_order_items_select
on public.seller_order_items for select to authenticated
using (
  exists (
    select 1
    from public.seller_orders o
    where o.id = seller_order_items.order_id
      and (
        public.user_owns_seller(o.seller_id, auth.uid())
        or public.is_staff_user(auth.uid())
      )
  )
);

revoke all on function public.user_owns_seller(uuid, uuid) from public;
revoke all on function public.user_seller_id(uuid) from public;
grant execute on function public.user_owns_seller(uuid, uuid) to authenticated, service_role;
grant execute on function public.user_seller_id(uuid) to authenticated, service_role;

commit;
