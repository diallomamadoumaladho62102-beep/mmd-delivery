-- Ensure restaurant_profiles.stripe_onboarded exists.
-- Later Connect heals / protect triggers already write this column.
-- Idempotent. Does not create Stripe accounts or change existing flags.

alter table if exists public.restaurant_profiles
  add column if not exists stripe_onboarded boolean not null default false;

comment on column public.restaurant_profiles.stripe_onboarded is
  'True only after Stripe Express is fully ready (details + charges + payouts). Written by service role / Edge / webhooks.';
