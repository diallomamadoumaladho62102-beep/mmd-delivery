-- Marketplace delivery / dispatch shadow (no live dispatch, no driver notifications)

begin;

alter table public.seller_orders
  add column if not exists pickup_location_id uuid
    references public.location_points (id) on delete set null,
  add column if not exists dropoff_location_id uuid
    references public.location_points (id) on delete set null,
  add column if not exists seller_pickup_address text,
  add column if not exists delivery_status_shadow text not null default 'not_started'
    check (
      delivery_status_shadow in (
        'not_started',
        'quoted_shadow',
        'dispatch_simulated',
        'live_not_enabled'
      )
    ),
  add column if not exists delivery_quote_shadow jsonb not null default '{}'::jsonb,
  add column if not exists estimated_distance_miles numeric,
  add column if not exists estimated_minutes numeric,
  add column if not exists driver_earning_shadow_cents integer not null default 0
    check (driver_earning_shadow_cents >= 0),
  add column if not exists platform_margin_shadow_cents integer not null default 0,
  add column if not exists dispatch_shadow jsonb not null default '{}'::jsonb;

create index if not exists seller_orders_delivery_shadow_idx
  on public.seller_orders (delivery_status_shadow, updated_at desc);

commit;
