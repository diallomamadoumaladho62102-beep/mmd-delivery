-- Phase 7: Marketplace production hardening
-- Live money flags stay OFF (checkout/dispatch/payouts). No Stripe transfers/refunds in this phase.

begin;

-- ---------------------------------------------------------------------------
-- 1) sellers: branding image URLs
-- ---------------------------------------------------------------------------

alter table public.sellers
  add column if not exists logo_url text,
  add column if not exists cover_image_url text;

-- ---------------------------------------------------------------------------
-- 2) seller_products: stock, options, variants, promo
-- ---------------------------------------------------------------------------

alter table public.seller_products
  add column if not exists stock_qty integer,
  add column if not exists options_json jsonb not null default '[]'::jsonb,
  add column if not exists variants_json jsonb not null default '[]'::jsonb,
  add column if not exists promo_price_cents integer;

alter table public.seller_products
  drop constraint if exists seller_products_promo_price_cents_check;

alter table public.seller_products
  add constraint seller_products_promo_price_cents_check
  check (promo_price_cents is null or promo_price_cents >= 0);

alter table public.seller_products
  drop constraint if exists seller_products_stock_qty_check;

alter table public.seller_products
  add constraint seller_products_stock_qty_check
  check (stock_qty is null or stock_qty >= 0);

-- ---------------------------------------------------------------------------
-- 3) seller_orders: cancel/refund metadata + expanded lifecycle statuses
-- ---------------------------------------------------------------------------

alter table public.seller_orders
  add column if not exists refund_status text,
  add column if not exists cancelled_by text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;

alter table public.seller_orders
  drop constraint if exists seller_orders_status_check;

alter table public.seller_orders
  add constraint seller_orders_status_check
  check (
    status in (
      'draft',
      'pending_checkout',
      'pending_payment',
      'paid',
      'payment_failed',
      'cancelled',
      'pending',
      'confirmed',
      'canceled',
      'fulfilled',
      'accepted',
      'refused',
      'preparing',
      'ready',
      'out_for_delivery',
      'delivered'
    )
  );

-- ---------------------------------------------------------------------------
-- 4) marketplace_favorites
-- ---------------------------------------------------------------------------

create table if not exists public.marketplace_favorites (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.seller_products (id) on delete cascade,
  seller_id uuid not null references public.sellers (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint marketplace_favorites_client_product_unique unique (client_user_id, product_id)
);

create index if not exists marketplace_favorites_client_idx
  on public.marketplace_favorites (client_user_id, created_at desc);

create index if not exists marketplace_favorites_seller_idx
  on public.marketplace_favorites (seller_id);

alter table public.marketplace_favorites enable row level security;

drop policy if exists marketplace_favorites_select_own on public.marketplace_favorites;
create policy marketplace_favorites_select_own
on public.marketplace_favorites for select to authenticated
using (client_user_id = auth.uid());

drop policy if exists marketplace_favorites_insert_own on public.marketplace_favorites;
create policy marketplace_favorites_insert_own
on public.marketplace_favorites for insert to authenticated
with check (client_user_id = auth.uid());

drop policy if exists marketplace_favorites_delete_own on public.marketplace_favorites;
create policy marketplace_favorites_delete_own
on public.marketplace_favorites for delete to authenticated
using (client_user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5) marketplace_seller_wallet_entries (logical wallet — no Stripe transfer ids required)
-- ---------------------------------------------------------------------------

create table if not exists public.marketplace_seller_wallet_entries (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id) on delete cascade,
  seller_order_id uuid references public.seller_orders (id) on delete set null,
  entry_type text not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'USD',
  status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists marketplace_seller_wallet_entries_seller_idx
  on public.marketplace_seller_wallet_entries (seller_id, created_at desc);

create index if not exists marketplace_seller_wallet_entries_order_idx
  on public.marketplace_seller_wallet_entries (seller_order_id)
  where seller_order_id is not null;

alter table public.marketplace_seller_wallet_entries enable row level security;

drop policy if exists marketplace_seller_wallet_entries_select on public.marketplace_seller_wallet_entries;
create policy marketplace_seller_wallet_entries_select
on public.marketplace_seller_wallet_entries for select to authenticated
using (
  public.user_owns_seller(seller_id, auth.uid())
  or public.is_staff_user(auth.uid())
);

-- ---------------------------------------------------------------------------
-- Seed comment: Live money flags stay OFF
-- ---------------------------------------------------------------------------

comment on table public.marketplace_seller_wallet_entries is
  'Logical marketplace seller wallet. Phase 7: pending entries only — no Stripe transfers/payouts. Live checkout/dispatch/payout flags stay OFF.';

comment on table public.marketplace_favorites is
  'Client marketplace product favorites. No live money paths.';

commit;
