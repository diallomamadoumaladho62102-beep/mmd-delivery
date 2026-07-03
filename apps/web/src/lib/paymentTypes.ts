export const PAYMENT_TRANSACTION_STATUSES = [
  "pending",
  "processing",
  "paid",
  "failed",
  "canceled",
  "expired",
  "manual_review",
] as const;

export type PaymentTransactionStatus = (typeof PAYMENT_TRANSACTION_STATUSES)[number];

export const PAYMENT_ENTITY_TYPES = [
  "order",
  "delivery_request",
  "taxi_ride",
  "seller_order",
] as const;

export type PaymentEntityType = (typeof PAYMENT_ENTITY_TYPES)[number];

export const PAYMENT_PROVIDERS = [
  "stripe",
  "orange_money_gn",
  "paydunya",
  "cinetpay",
] as const;

export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export type PaymentMethodRow = {
  id: string;
  country_code: string;
  provider: PaymentProvider;
  method_code: string;
  display_name: string;
  description: string | null;
  sort_order: number;
  enabled: boolean;
  test_mode: boolean;
};

export type PaymentMethodClientView = {
  method_code: string;
  provider: PaymentProvider;
  display_name: string;
  description: string | null;
  test_mode: boolean;
  available: boolean;
  unavailable_reason: string | null;
  sort_order: number;
};

export type PaymentTransactionRow = {
  id: string;
  order_id: string | null;
  user_id: string;
  entity_type: PaymentEntityType;
  entity_id: string;
  country_code: string;
  provider: string;
  method_code: string;
  amount_cents: number;
  currency: string;
  status: PaymentTransactionStatus;
  external_reference: string | null;
  payment_url: string | null;
  provider_payload: Record<string, unknown>;
  payer_phone: string | null;
  failure_reason: string | null;
  paid_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ResolvedPaymentEntity = {
  entity_type: PaymentEntityType;
  entity_id: string;
  user_id: string;
  country_code: string;
  amount_cents: number;
  currency: string;
  payment_status: string | null;
  order_id: string | null;
};

export type ProviderInitiateInput = {
  transactionId: string;
  amountCents: number;
  currency: string;
  countryCode: string;
  methodCode: string;
  description: string;
  payerPhone?: string | null;
  returnUrl: string;
  notifyUrl: string;
  testMode: boolean;
};

export type ProviderInitiateResult =
  | {
      ok: true;
      externalReference: string;
      paymentUrl: string | null;
      status: PaymentTransactionStatus;
      payload: Record<string, unknown>;
    }
  | { ok: false; error: string; status?: PaymentTransactionStatus };

export type ProviderWebhookResult =
  | {
      ok: true;
      externalReference: string;
      externalEventId: string;
      status: PaymentTransactionStatus;
      payload: Record<string, unknown>;
    }
  | { ok: false; error: string };

export type ProviderStatusResult =
  | {
      ok: true;
      externalReference: string;
      status: PaymentTransactionStatus;
      payload: Record<string, unknown>;
    }
  | { ok: false; error: string };

export function normalizePaymentTransactionStatus(value: unknown): PaymentTransactionStatus {
  const status = String(value ?? "")
    .trim()
    .toLowerCase();
  if ((PAYMENT_TRANSACTION_STATUSES as readonly string[]).includes(status)) {
    return status as PaymentTransactionStatus;
  }
  return "pending";
}

export function isTerminalPaymentStatus(status: PaymentTransactionStatus): boolean {
  return status === "paid" || status === "failed" || status === "canceled" || status === "expired";
}
