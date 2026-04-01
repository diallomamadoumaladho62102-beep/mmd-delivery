alter table if exists public.restaurant_profiles
  add column if not exists stripe_account_id text,
  add column if not exists stripe_onboarding_status text,
  add column if not exists stripe_charges_enabled boolean,
  add column if not exists stripe_payouts_enabled boolean,
  add column if not exists stripe_details_submitted boolean,
  add column if not exists stripe_onboarded_at timestamptz;
