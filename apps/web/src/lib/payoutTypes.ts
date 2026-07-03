export const PAYOUT_RECIPIENT_TYPES = [
  "driver",
  "restaurant",
  "seller",
  "partner",
] as const;

export type PayoutRecipientType = (typeof PAYOUT_RECIPIENT_TYPES)[number];

export const PAYOUT_PROVIDERS = [
  "stripe_connect",
  "orange_money_gn",
  "paydunya",
  "cinetpay",
  "bank_transfer",
  "wave",
  "mtn_momo",
  "moov_money",
  "free_money",
] as const;

export type PayoutProvider = (typeof PAYOUT_PROVIDERS)[number];

export const PAYOUT_FREQUENCIES = ["immediate", "daily", "weekly", "manual"] as const;
export type PayoutFrequency = (typeof PAYOUT_FREQUENCIES)[number];

export const PAYOUT_MODES = ["automatic", "manual"] as const;
export type PayoutMode = (typeof PAYOUT_MODES)[number];

export const PAYOUT_TRANSACTION_STATUSES = [
  "pending",
  "approved",
  "processing",
  "paid",
  "failed",
  "canceled",
] as const;

export type PayoutTransactionStatus = (typeof PAYOUT_TRANSACTION_STATUSES)[number];

export const WALLET_ACCOUNT_TYPES = [
  "platform",
  "driver",
  "restaurant",
  "seller",
  "partner",
  "client",
] as const;

export type WalletAccountType = (typeof WALLET_ACCOUNT_TYPES)[number];

export const WALLET_REFERENCE_TYPES = [
  "payment_transaction",
  "payout_transaction",
  "commission",
  "refund",
  "adjustment",
  "order_payout",
] as const;

export type WalletReferenceType = (typeof WALLET_REFERENCE_TYPES)[number];

export const INBOUND_CHARGE_CATEGORIES = [
  "food_order",
  "delivery",
  "taxi",
  "marketplace",
  "late_fee",
  "service_fee",
  "other",
] as const;

export type InboundChargeCategory = (typeof INBOUND_CHARGE_CATEGORIES)[number];

export type PayoutMethodRow = {
  id: string;
  country_code: string;
  recipient_type: PayoutRecipientType;
  provider: PayoutProvider;
  method_code: string;
  display_name: string;
  description: string | null;
  sort_order: number;
  enabled: boolean;
  test_mode: boolean;
  auto_payout_enabled: boolean;
  payout_frequency: PayoutFrequency;
  minimum_payout_cents: number;
  platform_commission_pct: number;
  created_at: string;
  updated_at: string;
};

export type PayoutMethodClientView = {
  method_code: string;
  provider: PayoutProvider;
  display_name: string;
  description: string | null;
  test_mode: boolean;
  auto_payout_enabled: boolean;
  payout_frequency: PayoutFrequency;
  minimum_payout_cents: number;
  available: boolean;
  unavailable_reason: string | null;
  sort_order: number;
};

export type PayoutTransactionRow = {
  id: string;
  country_code: string;
  recipient_type: PayoutRecipientType;
  recipient_user_id: string;
  provider: string;
  method_code: string;
  amount_cents: number;
  currency: string;
  status: PayoutTransactionStatus;
  payout_mode: PayoutMode;
  entity_type: string | null;
  entity_id: string | null;
  order_payout_id: string | null;
  gross_amount_cents: number | null;
  platform_fee_cents: number;
  net_amount_cents: number | null;
  external_reference: string | null;
  destination_account: string | null;
  failure_reason: string | null;
  approved_at: string | null;
  approved_by: string | null;
  paid_at: string | null;
  canceled_at: string | null;
  provider_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type WalletLedgerRow = {
  id: string;
  account_type: WalletAccountType;
  account_user_id: string | null;
  country_code: string;
  currency: string;
  direction: "credit" | "debit";
  amount_cents: number;
  balance_after_cents: number | null;
  reference_type: WalletReferenceType;
  reference_id: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export function mapOrderPayoutTargetToRecipientType(
  target: string
): PayoutRecipientType {
  const value = String(target ?? "").trim().toLowerCase();
  if (value === "restaurant") return "restaurant";
  return "driver";
}

export function entityTypeToChargeCategory(entityType: string): InboundChargeCategory {
  switch (String(entityType ?? "").trim().toLowerCase()) {
    case "order":
      return "food_order";
    case "delivery_request":
      return "delivery";
    case "taxi_ride":
      return "taxi";
    case "seller_order":
      return "marketplace";
    default:
      return "other";
  }
}
