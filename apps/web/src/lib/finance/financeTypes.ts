export const FINANCE_MODULES = [
  "overview",
  "treasury",
  "revenue",
  "expenses",
  "commissions",
  "payments",
  "refunds",
  "payouts",
  "partners",
  "clients",
  "mmd_credit",
  "cashback",
  "subscriptions",
  "taxes",
  "reconciliation",
  "settlements",
  "disputes",
  "adjustments",
  "ledger",
  "periods",
  "reports",
  "audit",
] as const;

export type FinanceModule = (typeof FINANCE_MODULES)[number];

export type FinanceEnqueueInput = {
  sourceType: string;
  sourceId: string;
  eventType: string;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  occurredAt?: string | null;
  vertical?: string | null;
  countryCode?: string | null;
  currency?: string | null;
  correlationId?: string | null;
};

export function financeIdempotencyKey(
  parts: Array<string | null | undefined>
): string {
  return ["finance", ...parts.map((p) => String(p ?? "").trim()).filter(Boolean)].join(
    ":"
  );
}
