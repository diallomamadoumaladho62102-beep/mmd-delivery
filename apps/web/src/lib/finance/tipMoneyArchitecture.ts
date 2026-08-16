/**
 * Founder-approved driver tip money model (Wave 2c).
 *
 * THE SINGLE TIP RULE
 * --------------------
 * 1. A tip is 100% for the driver's Stripe Connect destination account.
 *    The platform takes 0% of any tip — `TIP_MODEL.platformShareBps === 0`.
 * 2. A tip is never "money the platform already holds" the moment a client
 *    sets `orders.tip_cents` (e.g. via `submit_order_review_and_tip`). It only
 *    becomes real, transferable money once its OWN Stripe PaymentIntent has
 *    been created and has succeeded (see createDriverTipPaymentIntent route
 *    + webhook wiring). Until then it MUST NOT inflate any "awaiting SCT"
 *    figure — see `computeDriverAvailableCents` in `@/lib/driverWalletService`,
 *    which intentionally excludes `tip_cents` (taxi fare commissions without
 *    `driver_transfer_id` are included as awaiting transfer; tips are not).
 * 3. Once the tip PaymentIntent succeeds, exactly one Stripe Connect Transfer
 *    (SCT) is created to the driver's Connect account, funded with
 *    `source_transaction = <tip charge id>` (never the food order's charge),
 *    for `amount = tip_cents`. This mirrors the platform→Connect model in
 *    `@/lib/finance/moneyOutArchitecture` (MONEY_OUT_MODEL.platformToConnect).
 * 4. The food order's own driver delivery-share SCT (transfers/run,
 *    target=driver) is computed from `order_commissions.driver_cents` /
 *    `driver_amount`, which are derived from the delivery fee only — tips are
 *    never folded into that transfer. A tip is always its own, separate SCT.
 */
export const TIP_MODEL = {
  /** Platform's cut of any driver tip, in basis points. Always 0. */
  platformShareBps: 0,
  /** Tip must be captured by its own PaymentIntent before it can move. */
  fundingModel: "separate_stripe_payment_intent",
  /** Tip SCT is funded directly from the tip's own charge. */
  transferModel: "stripe_transfer_sct_source_transaction",
  /** Metadata marker every tip PaymentIntent must carry. */
  paymentIntentKind: "driver_tip",
} as const;

export type TipModel = typeof TIP_MODEL;

/** Cents owed to the driver for a given tip amount — always 100%. */
export function driverTipShareCents(tipCents: number): number {
  const cents = Math.max(0, Math.round(Number(tipCents) || 0));
  return cents;
}

/**
 * Build the Stripe Transfer params for a succeeded tip PaymentIntent.
 * Pure/no network so the "100% to driver, funded by its own charge" contract
 * is unit-testable without hitting Stripe.
 */
export function buildDriverTipTransferParams(input: {
  tipCents: number;
  tipChargeId: string;
  destinationAccountId: string;
  currency: string;
  orderId: string;
}): {
  amount: number;
  currency: string;
  destination: string;
  source_transaction: string;
  metadata: Record<string, string>;
} {
  const tipChargeId = String(input.tipChargeId ?? "").trim();
  const destination = String(input.destinationAccountId ?? "").trim();
  if (!tipChargeId) throw new Error("tip_charge_id_required");
  if (!destination) throw new Error("destination_account_id_required");

  const amount = driverTipShareCents(input.tipCents);
  if (amount <= 0) throw new Error("tip_cents_must_be_positive");

  return {
    amount,
    currency: String(input.currency ?? "usd").toLowerCase(),
    destination,
    source_transaction: tipChargeId,
    metadata: {
      role: "driver_tip",
      order_id: input.orderId,
      source_charge: tipChargeId,
    },
  };
}

/** Idempotency key for the tip's own SCT — one transfer per order tip. */
export function buildDriverTipTransferIdempotencyKey(orderId: string): string {
  return `tip_transfer:${orderId}`;
}
