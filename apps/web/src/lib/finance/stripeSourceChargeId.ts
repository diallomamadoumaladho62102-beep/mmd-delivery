/**
 * Stripe Charge ids usable as Transfer `source_transaction`.
 * Card: `ch_…`. Link / some wallets: `py_…` (still a Charge object id).
 *
 * Do NOT accept PaymentIntent (`pi_`), Checkout Session (`cs_`), or Refund (`re_`)
 * ids — those are not valid `source_transaction` values.
 */
export function isStripeSourceChargeId(id: unknown): boolean {
  const s = String(id ?? "").trim();
  return /^(ch_|py_)[A-Za-z0-9]+$/.test(s);
}
