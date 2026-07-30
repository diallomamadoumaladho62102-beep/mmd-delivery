/**
 * Unified financial timeline event model — single source of truth shape
 * for Client / Driver / Restaurant / Seller / Business / Admin views.
 * Role filters decide which event kinds are visible.
 */

export const FINANCIAL_EVENT_KINDS = [
  "payment_intent",
  "charge",
  "transfer",
  "source_transaction",
  "wallet_entry",
  "commission",
  "tip",
  "refund",
  "reverse_transfer",
  "payout",
  "dispute",
  "clawback",
  "coupon",
  "credit",
  "topup",
  "cashout",
  "promotion",
] as const;

export type FinancialEventKind = (typeof FINANCIAL_EVENT_KINDS)[number];

export type FinancialActorRole =
  | "client"
  | "driver"
  | "restaurant"
  | "seller"
  | "business"
  | "admin";

export type FinancialEntityType =
  | "order"
  | "delivery_request"
  | "taxi_ride"
  | "seller_order"
  | "business_account"
  | "wallet";

export type FinancialTimelineEvent = {
  id: string;
  kind: FinancialEventKind;
  status: string;
  amount_cents: number;
  currency: string;
  direction: "credit" | "debit" | "neutral";
  title_key: string;
  title_fallback: string;
  subtitle?: string | null;
  entity_type: FinancialEntityType;
  entity_id: string;
  occurred_at: string;
  /** Stripe / ledger references (admin & internal roles). */
  references?: {
    payment_intent_id?: string | null;
    charge_id?: string | null;
    transfer_id?: string | null;
    refund_id?: string | null;
    payout_id?: string | null;
    dispute_id?: string | null;
    wallet_entry_id?: string | null;
  };
  metadata?: Record<string, unknown>;
};

/** Which event kinds each role may see (least privilege). */
export const FINANCIAL_EVENT_KINDS_BY_ROLE: Record<
  FinancialActorRole,
  ReadonlySet<FinancialEventKind>
> = {
  client: new Set([
    "payment_intent",
    "charge",
    "coupon",
    "credit",
    "tip",
    "refund",
    "promotion",
  ]),
  driver: new Set([
    "payment_intent",
    "commission",
    "tip",
    "credit",
    "transfer",
    "wallet_entry",
    "payout",
    "refund",
    "dispute",
  ]),
  restaurant: new Set([
    "payment_intent",
    "commission",
    "transfer",
    "wallet_entry",
    "payout",
    "refund",
  ]),
  seller: new Set([
    "payment_intent",
    "commission",
    "transfer",
    "wallet_entry",
    "payout",
    "refund",
  ]),
  business: new Set([
    "payment_intent",
    "wallet_entry",
    "topup",
    "cashout",
    "transfer",
    "refund",
  ]),
  admin: new Set(FINANCIAL_EVENT_KINDS),
};

export function filterFinancialEventsForRole(
  events: FinancialTimelineEvent[],
  role: FinancialActorRole
): FinancialTimelineEvent[] {
  const allowed = FINANCIAL_EVENT_KINDS_BY_ROLE[role];
  return events.filter((e) => allowed.has(e.kind));
}

export function sortFinancialEventsDesc(
  events: FinancialTimelineEvent[]
): FinancialTimelineEvent[] {
  return [...events].sort(
    (a, b) =>
      new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
  );
}
