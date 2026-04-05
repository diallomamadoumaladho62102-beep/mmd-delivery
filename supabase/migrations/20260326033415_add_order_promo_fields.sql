-- =========================
-- ORDER PROMO FIELDS (PRODUCTION READY)
-- =========================

begin;

-- 1. Ajouter les colonnes promo (idempotent safe)
alter table public.orders
add column if not exists promo_code_applied text,
add column if not exists promo_type_applied text
  check (promo_type_applied in ('percent','fixed','free_delivery')),
add column if not exists promo_value_applied numeric(10,2),
add column if not exists promo_discount_amount numeric(10,2) default 0,
add column if not exists delivery_discount_amount numeric(10,2) default 0;

-- 2. Contraintes de sécurité
alter table public.orders
add constraint promo_discount_non_negative
check (promo_discount_amount >= 0);

alter table public.orders
add constraint delivery_discount_non_negative
check (delivery_discount_amount >= 0);

-- 3. Index utile pour analytics / debug
create index if not exists orders_promo_code_idx
on public.orders(promo_code_applied);

-- 4. Commentaires (très important en prod)
comment on column public.orders.promo_code_applied
is 'Promo code used at checkout (frozen at order time)';

comment on column public.orders.promo_type_applied
is 'Promo type applied: percent, fixed, free_delivery';

comment on column public.orders.promo_value_applied
is 'Value of promo at time of order (percent or fixed amount)';

comment on column public.orders.promo_discount_amount
is 'Discount applied on subtotal';

comment on column public.orders.delivery_discount_amount
is 'Discount applied on delivery fee';

commit;