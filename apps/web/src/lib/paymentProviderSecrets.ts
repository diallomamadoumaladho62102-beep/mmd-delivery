import type { PaymentProvider } from "@/lib/paymentTypes";

export type ProviderSecretStatus = {
  configured: boolean;
  missing: string[];
};

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function hasAll(keys: string[]): ProviderSecretStatus {
  const missing = keys.filter((key) => !env(key));
  return { configured: missing.length === 0, missing };
}

export function getProviderSecretStatus(provider: PaymentProvider): ProviderSecretStatus {
  switch (provider) {
    case "stripe":
      return hasAll(["STRIPE_SECRET_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"]);
    case "orange_money_gn":
      return hasAll([
        "ORANGE_MONEY_GN_MERCHANT_KEY",
        "ORANGE_MONEY_GN_CLIENT_ID",
        "ORANGE_MONEY_GN_CLIENT_SECRET",
        "ORANGE_MONEY_GN_ACCESS_TOKEN",
        "ORANGE_MONEY_GN_WEBHOOK_SECRET",
      ]);
    case "paydunya":
      return hasAll(["PAYDUNYA_MASTER_KEY", "PAYDUNYA_PRIVATE_KEY", "PAYDUNYA_TOKEN"]);
    case "cinetpay":
      return hasAll(["CINETPAY_API_KEY", "CINETPAY_SITE_ID", "CINETPAY_WEBHOOK_SECRET"]);
    default:
      return { configured: false, missing: ["unknown_provider"] };
  }
}

export function isStripeExplicitlyEnabledForGuinea(): boolean {
  const flag = String(process.env.STRIPE_ENABLED_GN ?? "")
    .trim()
    .toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

export function paymentsPublicBaseUrl(): string {
  const raw =
    String(process.env.PROD_BASE_URL ?? "").trim() ||
    String(process.env.NEXT_PUBLIC_APP_URL ?? "").trim() ||
    "https://www.mmddelivery.com";
  return raw.replace(/\/$/, "");
}

export function providerWebhookUrl(provider: PaymentProvider): string {
  return `${paymentsPublicBaseUrl()}/api/payments/webhook/${provider}`;
}

export function providerReturnUrl(transactionId: string): string {
  return `${paymentsPublicBaseUrl()}/payments/return?payment_id=${encodeURIComponent(transactionId)}`;
}
