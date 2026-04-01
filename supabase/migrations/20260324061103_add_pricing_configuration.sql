begin;

create table if not exists public.pricing_config (
  id uuid primary key default gen_random_uuid(),
  config_key text not null unique,
  label text not null,

  order_type text not null check (order_type in ('food', 'errand')),

  active boolean not null default true,

  client_pct numeric(6,2) not null default 0,
  driver_pct numeric(6,2) not null default 0,
  restaurant_pct numeric(6,2) not null default 0,
  platform_pct numeric(6,2) not null default 0,

  delivery_fee_base numeric(12,2) not null default 0,
  delivery_fee_per_mile numeric(12,2) not null default 0,
  delivery_fee_per_minute numeric(12,2) not null default 0,
  minimum_order_amount numeric(12,2) not null default 0,

  promo_enabled boolean not null default false,
  promo_type text check (promo_type in ('percent', 'fixed', 'free_delivery')),
  promo_value numeric(12,2),
  promo_code text,
  promo_starts_at timestamptz,
  promo_ends_at timestamptz,

  currency text not null default 'USD',
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint pricing_config_pct_total_check
    check (
      client_pct >= 0 and
      driver_pct >= 0 and
      restaurant_pct >= 0 and
      platform_pct >= 0
    )
);

create or replace function public.set_pricing_config_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_pricing_config_updated_at on public.pricing_config;
create trigger trg_pricing_config_updated_at
before update on public.pricing_config
for each row
execute function public.set_pricing_config_updated_at();

insert into public.pricing_config (
  config_key,
  label,
  order_type,
  active,
  client_pct,
  driver_pct,
  restaurant_pct,
  platform_pct,
  delivery_fee_base,
  delivery_fee_per_mile,
  delivery_fee_per_minute,
  minimum_order_amount,
  promo_enabled,
  currency,
  notes
)
values
(
  'food_default',
  'Food default pricing',
  'food',
  true,
  0,
  80,
  85,
  15,
  0,
  0,
  0,
  0,
  false,
  'USD',
  'Repas: 15% plateforme sur subtotal, 85% restaurant; livraison gérée séparément côté logique.'
),
(
  'errand_default',
  'Errand default pricing',
  'errand',
  true,
  0,
  80,
  0,
  20,
  0,
  0,
  0,
  0,
  false,
  'USD',
  'Errand: 20% plateforme, 80% driver.'
)
on conflict (config_key) do nothing;

commit;