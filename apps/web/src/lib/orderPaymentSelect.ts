/**
 * Production-compatible SELECT lists for food `orders` payment paths.
 *
 * `public.orders` has never had a `country_code` column. Country for food is
 * inferred from currency + pickup/dropoff coordinates via
 * `resolveOrderPlatformCountry`. Selecting `country_code` hard-fails PostgREST
 * (42703) and blocks Stripe settlement.
 */

export const ORDER_PAYMENT_CHECK_SELECT =
  "id, payment_status, total, grand_total, total_cents, net_charge_cents, currency, stripe_session_id, stripe_payment_intent_id, client_user_id, created_by, user_id, kind, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng";

export const ORDER_POST_PAID_SELECT =
  "id,kind,client_user_id,created_by,total_cents,total,grand_total,currency,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng";

export const ORDER_CONFIRM_PAID_SELECT =
  "id, stripe_session_id, stripe_payment_intent_id, payment_status, client_user_id, created_by, kind, total_cents, total, grand_total, currency, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng";

export const ORDER_FINANCE_SNAPSHOT_SELECT =
  "id,total,total_cents,tax,tax_cents,taxes_cents,service_fee_cents,delivery_fee_cents,delivery_pay,discounts,promo_discount_amount,currency,restaurant_user_id,client_user_id,items_subtotal,subtotal_cents,mmd_credit_applied_cents,commission_cents,platform_fee_cents,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng";

/** Throws if a SELECT string still requires the non-existent orders.country_code. */
export function assertOrdersSelectOmitsCountryCode(select: string): void {
  if (/(^|,)\s*country_code\s*(,|$)/i.test(select)) {
    throw new Error(
      "orders SELECT must not include country_code (column does not exist on public.orders)"
    );
  }
}
