-- Heal inconsistent Stripe Connect flags when no connected account exists.
--
-- Observed on Fouta Halal (and platform-wide restaurants):
--   stripe_account_id IS NULL
--   but stripe_charges_enabled / stripe_payouts_enabled / stripe_details_submitted = true
--
-- Root cause of "Restaurant payout account missing": no Express account was ever
-- created/linked (onboarding via create_connect_account not completed).
-- Transfers correctly refuse SCT without stripe_account_id.
-- Misleading readiness flags can confuse admin/ops UIs that don't check account id first.
--
-- Does NOT create Stripe accounts. Idempotent flag heal only.

update public.restaurant_profiles
set
  stripe_charges_enabled = false,
  stripe_payouts_enabled = false,
  stripe_details_submitted = false,
  stripe_onboarded = false,
  stripe_onboarded_at = null,
  stripe_onboarding_status = coalesce(nullif(trim(stripe_onboarding_status), ''), 'pending'),
  updated_at = now()
where coalesce(nullif(trim(stripe_account_id), ''), '') = ''
  and (
    coalesce(stripe_charges_enabled, false) = true
    or coalesce(stripe_payouts_enabled, false) = true
    or coalesce(stripe_details_submitted, false) = true
    or coalesce(stripe_onboarded, false) = true
    or stripe_onboarded_at is not null
  );

update public.sellers
set
  stripe_charges_enabled = false,
  stripe_payouts_enabled = false,
  stripe_details_submitted = false,
  stripe_onboarded_at = null,
  stripe_onboarding_status = coalesce(nullif(trim(stripe_onboarding_status), ''), 'pending'),
  updated_at = now()
where coalesce(nullif(trim(stripe_account_id), ''), '') = ''
  and (
    coalesce(stripe_charges_enabled, false) = true
    or coalesce(stripe_payouts_enabled, false) = true
    or coalesce(stripe_details_submitted, false) = true
    or stripe_onboarded_at is not null
  );
