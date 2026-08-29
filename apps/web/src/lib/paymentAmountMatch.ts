import type { PaymentProvider } from "@/lib/paymentTypes";

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function firstNumber(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const n = toFiniteNumber(payload[key]);
    if (n != null) return n;
  }
  return null;
}

function nestedRecord(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function extractProviderAmountCents(
  provider: PaymentProvider | string,
  payload: Record<string, unknown> | null | undefined
): { amountCents: number | null; currency: string | null } {
  const body = payload ?? {};
  const data = nestedRecord(body, "data");
  const invoice = nestedRecord(body, "invoice");
  const currency = String(
    body.currency ?? data.currency ?? invoice.currency ?? ""
  )
    .trim()
    .toUpperCase() || null;

  if (provider === "paydunya") {
    const major = firstNumber(invoice, ["total_amount"]) ?? firstNumber(body, ["total_amount"]);
    if (major == null) return { amountCents: null, currency };
    return { amountCents: Math.round(major * 100), currency };
  }

  const cents =
    firstNumber(body, ["amount_cents", "amount"]) ??
    firstNumber(data, ["amount_cents", "amount"]) ??
    firstNumber(invoice, ["amount_cents", "amount"]);

  if (cents == null) return { amountCents: null, currency };
  return { amountCents: Math.round(cents), currency };
}

export function assertPaidAmountMatches(params: {
  expectedCents: number;
  expectedCurrency: string;
  provider: PaymentProvider | string;
  payload: Record<string, unknown> | null | undefined;
}): { ok: true } | { ok: false; error: string } {
  const expectedCents = Math.round(Number(params.expectedCents ?? 0));
  if (!Number.isFinite(expectedCents) || expectedCents <= 0) {
    return { ok: false, error: "invalid_expected_amount" };
  }

  const extracted = extractProviderAmountCents(params.provider, params.payload);
  if (extracted.amountCents == null) {
    return { ok: false, error: "provider_amount_missing" };
  }
  if (extracted.amountCents !== expectedCents) {
    return { ok: false, error: "amount_mismatch" };
  }

  const expectedCurrency = String(params.expectedCurrency ?? "").trim().toUpperCase();
  if (
    expectedCurrency &&
    extracted.currency &&
    extracted.currency !== expectedCurrency
  ) {
    return { ok: false, error: "currency_mismatch" };
  }

  return { ok: true };
}
