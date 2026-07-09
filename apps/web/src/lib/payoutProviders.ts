import type { PayoutProvider } from "@/lib/payoutTypes";

export type PayoutProviderExecutionMode = "automatic" | "manual_only";

export type PayoutProviderCapabilities = {
  provider: PayoutProvider;
  execution_mode: PayoutProviderExecutionMode;
  merchant_keys_required: boolean;
  env_enable_flag: string | null;
  configured: boolean;
  auto_execution_allowed: boolean;
  unavailable_reason: string | null;
};

export type PayoutDispatchInput = {
  payoutTransactionId: string;
  provider: PayoutProvider;
  countryCode: string;
  amountCents: number;
  currency: string;
  destinationAccount?: string | null;
  autoPayoutEnabled: boolean;
  testMode: boolean;
};

export type PayoutDispatchResult =
  | { ok: true; mode: "automatic"; external_reference?: string | null }
  | { ok: true; mode: "manual"; message: string }
  | { ok: false; error: string; message?: string };

function env(name: string): string {
  return String(process.env[name] ?? "").trim();
}

function envEnabled(name: string): boolean {
  return env(name).toLowerCase() === "true";
}

function providerUsesInboundSecrets(provider: PayoutProvider): PayoutProvider {
  if (provider === "wave" || provider === "free_money") return "paydunya";
  if (provider === "mtn_momo" || provider === "moov_money") return "cinetpay";
  return provider;
}

function providerSecretsConfigured(provider: PayoutProvider): boolean {
  const mapped = providerUsesInboundSecrets(provider);

  if (provider === "stripe_connect") {
    return Boolean(env("STRIPE_SECRET_KEY"));
  }
  if (provider === "bank_transfer") {
    return true;
  }
  if (mapped === "orange_money_gn") {
    return Boolean(env("ORANGE_MONEY_GN_ACCESS_TOKEN") && env("ORANGE_MONEY_GN_MERCHANT_KEY"));
  }
  if (mapped === "paydunya") {
    return Boolean(env("PAYDUNYA_MASTER_KEY") && env("PAYDUNYA_PRIVATE_KEY"));
  }
  if (mapped === "cinetpay") {
    return Boolean(env("CINETPAY_API_KEY") && env("CINETPAY_SITE_ID"));
  }
  return false;
}

function providerEnableFlag(provider: PayoutProvider): string | null {
  switch (providerUsesInboundSecrets(provider)) {
    case "orange_money_gn":
      return "ORANGE_MONEY_GN_PAYOUT_ENABLED";
    case "paydunya":
      return "PAYDUNYA_PAYOUT_ENABLED";
    case "cinetpay":
      return "CINETPAY_PAYOUT_ENABLED";
    case "stripe_connect":
      return null;
    case "bank_transfer":
      return "BANK_TRANSFER_PAYOUT_ENABLED";
    default:
      return null;
  }
}

export function describePayoutProviderCapabilities(
  provider: PayoutProvider
): PayoutProviderCapabilities {
  const configured = providerSecretsConfigured(provider);
  const enableFlag = providerEnableFlag(provider);
  const executionMode: PayoutProviderExecutionMode =
    provider === "stripe_connect" ? "automatic" : "manual_only";

  const autoExecutionAllowed =
    provider === "stripe_connect"
      ? configured
      : configured && (enableFlag ? envEnabled(enableFlag) : false);

  let unavailableReason: string | null = null;
  if (!configured) {
    unavailableReason = "merchant_keys_missing";
  } else if (provider !== "stripe_connect" && enableFlag && !envEnabled(enableFlag)) {
    unavailableReason = "manual_activation_required";
  }

  return {
    provider,
    execution_mode: executionMode,
    merchant_keys_required: provider !== "bank_transfer",
    env_enable_flag: enableFlag,
    configured,
    auto_execution_allowed: autoExecutionAllowed,
    unavailable_reason: unavailableReason,
  };
}

export async function dispatchPayoutToProvider(
  input: PayoutDispatchInput
): Promise<PayoutDispatchResult> {
  const capabilities = describePayoutProviderCapabilities(input.provider);

  const isProd =
    process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  if (isProd && input.testMode === true) {
    return {
      ok: false,
      error: "payout_method_test_mode_blocked",
      message:
        "Payout method is still in test_mode. Flip test_mode=false in admin before production disbursement.",
    };
  }

  if (input.provider === "stripe_connect") {
    if (!capabilities.configured) {
      return { ok: false, error: "stripe_not_configured" };
    }
    return {
      ok: true,
      mode: "automatic",
      external_reference: null,
    };
  }

  if (input.provider === "bank_transfer") {
    return {
      ok: true,
      mode: "manual",
      message: "Bank transfer payout queued for manual processing.",
    };
  }

  if (!capabilities.configured) {
    return {
      ok: false,
      error: "provider_not_configured",
      message: `${input.provider} payout keys are not configured on the server.`,
    };
  }

  if (!input.autoPayoutEnabled || !capabilities.auto_execution_allowed) {
    return {
      ok: true,
      mode: "manual",
      message:
        "Mobile money payout recorded as pending. Automatic disbursement stays disabled until merchant payout keys are enabled.",
    };
  }

  return {
    ok: false,
    error: "automatic_mobile_payout_not_implemented",
    message:
      "Automatic mobile money payout execution is not enabled yet. Approve and process manually from admin.",
  };
}

export function getPayoutProviderRegistry(): PayoutProviderCapabilities[] {
  const providers: PayoutProvider[] = [
    "stripe_connect",
    "orange_money_gn",
    "paydunya",
    "cinetpay",
    "bank_transfer",
    "wave",
    "mtn_momo",
    "moov_money",
    "free_money",
  ];
  return providers.map(describePayoutProviderCapabilities);
}
