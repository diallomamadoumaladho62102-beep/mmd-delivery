export function isExpectedTaxiPaymentPendingResponse(
  status: number,
  body: unknown,
): boolean {
  if (status !== 409) return false;
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : null;
  if (!record) return false;
  const error = String(record.error ?? record.message ?? "").toLowerCase();
  const paymentStatus = String(record.payment_status ?? "").toLowerCase();
  return (
    error.includes("payment not confirmed") ||
    paymentStatus === "unpaid" ||
    paymentStatus === "requires_payment_method"
  );
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return String(error.message ?? "");
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return String(record.error ?? record.message ?? record.msg ?? "");
  }
  return "";
}

/**
 * Expected business outcome: card unpaid / Checkout abandoned → confirm-*-paid
 * returns HTTP 409 with payment_status unpaid. Must not pollute Sentry as Error.
 * Real Stripe/server failures (5xx, auth, unknown) must still be captured.
 */
export function isExpectedUnpaidPaymentSentryNoise(
  error: unknown,
  metadata?: Record<string, unknown> | null,
): boolean {
  const statusRaw = metadata?.status;
  const status =
    typeof statusRaw === "number"
      ? statusRaw
      : Number.parseInt(String(statusRaw ?? ""), 10);

  if (Number.isFinite(status) && isExpectedTaxiPaymentPendingResponse(status, error)) {
    return true;
  }

  const text = messageFromUnknown(error).trim();
  if (!text) return false;

  // Exact API business message (and CapturedObjectError wrapping it).
  if (/stripe payment not confirmed yet/i.test(text)) return true;

  // User-facing copy used after expected unpaid 409 in taxiClientApi.
  if (
    /payment was not completed\.?\s*please check your payment method/i.test(text)
  ) {
    return true;
  }

  return false;
}

/**
 * Pure decision helpers for taxi Checkout abandon / recovery.
 * Keep in sync with TaxiQuoteScreen post-WebBrowser behavior.
 *
 * Stripe taxi is pay-then-create: abandoning Checkout leaves no taxi_rides row.
 */

export type TaxiConfirmResult = {
  ok?: boolean;
  already_paid?: boolean;
  payment_status?: string;
  taxi_ride_id?: string;
  error?: string;
};

export function didTaxiConfirmSucceed(result: TaxiConfirmResult | null | undefined): boolean {
  if (!result) return false;
  if (result.ok === true) return true;
  if (result.already_paid === true) return true;
  const status = String(result.payment_status ?? "").toLowerCase();
  return status === "paid";
}

/**
 * After Checkout closes without confirmed payment:
 * - do NOT navigate to live tracking (no ride yet for Stripe pay-then-create)
 * - do NOT invent a ride_id
 */
export function nextActionAfterCheckoutReturn(input: {
  confirmResult: TaxiConfirmResult | null;
  confirmThrew: boolean;
}): "go_tracking" | "stay_on_quote_await_expiry" {
  if (input.confirmThrew) return "stay_on_quote_await_expiry";
  if (!didTaxiConfirmSucceed(input.confirmResult)) {
    return "stay_on_quote_await_expiry";
  }
  // Pay-then-create responses include taxi_ride_id; empty means not ready yet.
  if (
    Object.prototype.hasOwnProperty.call(input.confirmResult ?? {}, "taxi_ride_id") &&
    !String(input.confirmResult?.taxi_ride_id ?? "").trim()
  ) {
    return "stay_on_quote_await_expiry";
  }
  return "go_tracking";
}
