/**
 * Client-visible taxi price lines. Platform fee is internal (driver/MMD split)
 * and must never appear in the customer Estimate UI or change the customer total.
 */
function cents(value: unknown): number {
  const n = Math.round(Number(value ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export type ClientTaxiPriceBreakdown = {
  subtotalCents: number;
  serviceFeeCents: number;
  taxCents: number;
  totalCents: number;
  formulaGrossCents: number;
};

export function buildClientTaxiPriceBreakdown(input: {
  subtotalCents?: unknown;
  serviceFeeCents?: unknown;
  taxCents?: unknown;
  grossTotalCents?: unknown;
  /** Internal only — ignored for customer total. */
  platformFeeCents?: unknown;
  discountCents?: unknown;
}): ClientTaxiPriceBreakdown {
  const subtotalCents = cents(input.subtotalCents);
  const serviceFeeCents = cents(input.serviceFeeCents);
  const taxCents = cents(input.taxCents);
  const formulaGrossCents = subtotalCents + serviceFeeCents + taxCents;
  const quotedGross = cents(input.grossTotalCents);
  const grossTotalCents = quotedGross > 0 ? quotedGross : formulaGrossCents;
  const discountCents = cents(input.discountCents);
  const totalCents = Math.max(0, grossTotalCents - discountCents);
  void cents(input.platformFeeCents);
  return {
    subtotalCents,
    serviceFeeCents,
    taxCents,
    totalCents,
    formulaGrossCents,
  };
}
