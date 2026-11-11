export const STRIPE_APPLE_PAY_MERCHANT_COUNTRY_CODE = "US";
export const STRIPE_APPLE_PAY_MERCHANT_ID =
  "merchant.com.maladho2025.mmddelivery";

/**
 * True when the client wants a PaymentIntent + client_secret for native UI
 * (Apple Pay / Platform Pay / Stripe PaymentSheet card), not hosted Checkout.
 */
export function isNativeApplePayRequest(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const rec = body as Record<string, unknown>;
  const raw =
    rec.native_wallet ?? rec.nativeWallet ?? rec.payment_ui ?? rec.paymentUi;
  const value = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return (
    value === "apple_pay" ||
    value === "applepay" ||
    value === "platform_pay" ||
    value === "payment_sheet"
  );
}
