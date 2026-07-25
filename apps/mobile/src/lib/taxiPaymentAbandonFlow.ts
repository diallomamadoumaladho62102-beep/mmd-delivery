/**
 * Pure decision helpers for taxi Checkout abandon / recovery.
 * Keep in sync with TaxiQuoteScreen post-WebBrowser behavior.
 */

export type TaxiConfirmResult = {
  ok?: boolean;
  already_paid?: boolean;
  payment_status?: string;
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
 * - do NOT cancel immediately (webhook race)
 * - do NOT navigate to live tracking
 * - unpaid ride remains until expires_at cron cancels it
 */
export function nextActionAfterCheckoutReturn(input: {
  confirmResult: TaxiConfirmResult | null;
  confirmThrew: boolean;
}): "go_tracking" | "stay_on_quote_await_expiry" {
  if (input.confirmThrew) return "stay_on_quote_await_expiry";
  return didTaxiConfirmSucceed(input.confirmResult)
    ? "go_tracking"
    : "stay_on_quote_await_expiry";
}
