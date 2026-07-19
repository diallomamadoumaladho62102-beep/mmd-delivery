/**
 * Production-compatible SELECT lists for `delivery_requests` payment paths.
 *
 * `public.delivery_requests` has no `country_code` column. Country is inferred
 * from currency + pickup coordinates via `resolveDeliveryRequestPlatformCountry`.
 * Selecting `country_code` hard-fails PostgREST (42703) and blocks Stripe settlement.
 */

export const DELIVERY_REQUEST_PAYMENT_CHECK_SELECT =
  "id, payment_status, total, total_cents, net_charge_cents, currency, stripe_session_id, stripe_payment_intent_id, client_user_id, created_by, pickup_lat, pickup_lng";

export const DELIVERY_REQUEST_CONFIRM_PAID_SELECT =
  "id, created_by, client_user_id, payment_status, stripe_payment_intent_id, stripe_session_id, paid_at, total_cents, total, currency, pickup_lat, pickup_lng";

/** Throws if a SELECT string still requires the non-existent delivery_requests.country_code. */
export function assertDeliveryRequestSelectOmitsCountryCode(select: string): void {
  if (/(^|,)\s*country_code\s*(,|$)/i.test(select)) {
    throw new Error(
      "delivery_requests SELECT must not include country_code (column does not exist on public.delivery_requests)",
    );
  }
}
