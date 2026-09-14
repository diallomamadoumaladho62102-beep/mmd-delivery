/**
 * Pure Apple Pay checkout helpers for Stripe React Native 0.50.3.
 * Display amounts are derived from the server PaymentIntent — never used to charge.
 */
export const STRIPE_APPLE_PAY_MERCHANT_ID =
  "merchant.com.maladho2025.mmddelivery";

export const STRIPE_APPLE_PAY_MERCHANT_COUNTRY_CODE = "US";

const ZERO_DECIMAL_CURRENCIES = new Set(["GNF", "XOF"]);

export type ApplePayConfirmOutcome = "succeeded" | "canceled" | "failed";

export type ServerPaymentIntentPayload = {
  alreadyPaid: boolean;
  clientSecret: string | null;
  paymentIntentId: string | null;
  stripeAmount: number | null;
  currencyCode: string;
  merchantCountryCode: string;
};

export function shouldShowApplePayButton(params: {
  platform: string;
  isPlatformPaySupported: boolean;
}): boolean {
  return params.platform === "ios" && params.isPlatformPaySupported === true;
}

export function isZeroDecimalApplePayCurrency(currency: unknown): boolean {
  return ZERO_DECIMAL_CURRENCIES.has(String(currency ?? "").trim().toUpperCase());
}

/** Format Stripe smallest-unit amount for Apple Pay cartItems (major units as string). */
export function formatApplePayCartAmount(
  currency: string,
  stripeSmallestUnit: number,
): string {
  const amount = Math.round(Number(stripeSmallestUnit));
  if (!Number.isFinite(amount) || amount < 0) return "0.00";
  if (isZeroDecimalApplePayCurrency(currency)) return String(amount);
  return (amount / 100).toFixed(2);
}

export function buildApplePayCartItems(params: {
  label?: string;
  currency: string;
  stripeAmount: number;
}): Array<{
  paymentType: "Immediate";
  label: string;
  amount: string;
}> {
  return [
    {
      paymentType: "Immediate",
      label: String(params.label ?? "MMD Delivery").trim() || "MMD Delivery",
      amount: formatApplePayCartAmount(params.currency, params.stripeAmount),
    },
  ];
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function asPositiveInt(value: unknown): number | null {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function parseServerPaymentIntentPayload(
  data: unknown,
): ServerPaymentIntentPayload {
  const d = (data ?? {}) as Record<string, unknown>;
  const alreadyPaid =
    d.alreadyPaid === true ||
    d.already_paid === true ||
    String(d.error ?? "").toLowerCase().includes("already paid");

  const clientSecret =
    asNonEmptyString(d.clientSecret) ??
    asNonEmptyString(d.client_secret) ??
    asNonEmptyString(d.payment_intent_client_secret);

  const paymentIntentId =
    asNonEmptyString(d.paymentIntentId) ??
    asNonEmptyString(d.payment_intent_id);

  const stripeAmount =
    asPositiveInt(d.stripe_amount) ??
    asPositiveInt(d.stripeAmount) ??
    asPositiveInt(d.amount);

  const currencyCode = (
    asNonEmptyString(d.currency) ??
    asNonEmptyString(d.currencyCode) ??
    asNonEmptyString(d.currency_code) ??
    "usd"
  ).toLowerCase();

  const merchantCountryCode = (
    asNonEmptyString(d.merchantCountryCode) ??
    asNonEmptyString(d.merchant_country_code) ??
    STRIPE_APPLE_PAY_MERCHANT_COUNTRY_CODE
  ).toUpperCase();

  return {
    alreadyPaid,
    clientSecret,
    paymentIntentId,
    stripeAmount,
    currencyCode,
    merchantCountryCode,
  };
}

export function mapApplePayConfirmOutcome(params: {
  errorCode?: string | null;
  errorMessage?: string | null;
  paymentIntentStatus?: string | null;
}): ApplePayConfirmOutcome {
  const code = String(params.errorCode ?? "").toLowerCase();
  const message = String(params.errorMessage ?? "").toLowerCase();
  if (
    code === "canceled" ||
    code === "cancelled" ||
    message.includes("canceled") ||
    message.includes("cancelled")
  ) {
    return "canceled";
  }
  if (params.errorCode || params.errorMessage) {
    return "failed";
  }
  const status = String(params.paymentIntentStatus ?? "").toLowerCase();
  if (status === "succeeded" || status === "processing" || status === "requirescapture") {
    return "succeeded";
  }
  return "failed";
}

export function isPaidLikeConfirmResult(result: {
  ok?: boolean;
  already?: boolean;
  already_paid?: boolean;
  stripe_paid?: boolean;
  payment_status?: string;
  db_status?: string;
} | null): boolean {
  if (!result) return false;
  if (
    result.ok === true ||
    result.already === true ||
    result.already_paid === true ||
    result.stripe_paid === true
  ) {
    return true;
  }
  const status = String(result.payment_status ?? result.db_status ?? "").toLowerCase();
  return status === "paid";
}
