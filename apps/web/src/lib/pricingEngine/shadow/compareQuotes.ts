import type {
  ComparableQuote,
  QuoteFieldDiff,
  ShadowCompareReport,
} from "./comparableQuote";

const MONEY_FIELDS: Array<{
  field: keyof ComparableQuote;
  engineName: string;
  ruleHint: string;
}> = [
  {
    field: "customerTotalCents",
    engineName: "Facade/Validation",
    ruleHint: "customer_total",
  },
  { field: "baseCents", engineName: "RateEngine", ruleHint: "base_fare_or_subtotal" },
  { field: "taxCents", engineName: "TaxEngine", ruleHint: "tax_lines" },
  { field: "feeCents", engineName: "FeeEngine", ruleHint: "fee_lines" },
  {
    field: "promotionCents",
    engineName: "PromotionEngine",
    ruleHint: "discount_lines",
  },
  {
    field: "driverEarningsCents",
    engineName: "CommissionEngine",
    ruleHint: "driver_share",
  },
  {
    field: "restaurantEarningsCents",
    engineName: "CommissionEngine",
    ruleHint: "restaurant_share",
  },
  {
    field: "sellerEarningsCents",
    engineName: "CommissionEngine",
    ruleHint: "seller_share",
  },
  {
    field: "platformRevenueCents",
    engineName: "CommissionEngine",
    ruleHint: "platform_share",
  },
];

function moneyDiff(
  field: keyof ComparableQuote,
  legacy: ComparableQuote,
  engine: ComparableQuote,
  meta: { engineName: string; ruleHint: string }
): QuoteFieldDiff | null {
  const lv = legacy[field];
  const ev = engine[field];
  if (typeof lv !== "number" && lv !== null) return null;
  if (typeof ev !== "number" && ev !== null) return null;
  if (lv === null && ev === null) return null;
  if (lv === null || ev === null) {
    return {
      field,
      legacy: lv as number | null,
      engine: ev as number | null,
      engineName: meta.engineName,
      ruleHint: meta.ruleHint,
      proposedFix:
        "Align adapter so both sides expose this field or both skip it",
    };
  }
  const diff = (ev as number) - (lv as number);
  if (diff === 0) return null;
  return {
    field,
    legacy: lv as number,
    engine: ev as number,
    diffCents: diff,
    engineName: meta.engineName,
    ruleHint: meta.ruleHint,
    proposedFix: `Investigate ${meta.engineName} / ${meta.ruleHint} for ${diff}¢ drift`,
  };
}

/**
 * Phase 2: tolerance = 0 cents on all comparable money fields.
 */
export function compareComparableQuotes(input: {
  legacy: ComparableQuote;
  engine: ComparableQuote;
  legacyLatencyMs: number;
  engineLatencyMs: number;
  compareId: string;
}): ShadowCompareReport {
  const { legacy, engine } = input;
  const fieldDiffs: QuoteFieldDiff[] = [];

  if (legacy.currency !== engine.currency) {
    fieldDiffs.push({
      field: "currency",
      legacy: legacy.currency,
      engine: engine.currency,
      engineName: "Facade",
      ruleHint: "currency",
      proposedFix: "Engine must use same ISO currency as legacy quote",
    });
  }

  for (const m of MONEY_FIELDS) {
    const d = moneyDiff(m.field, legacy, engine, m);
    if (d) fieldDiffs.push(d);
  }

  const totalDiff =
    engine.customerTotalCents - legacy.customerTotalCents;

  return {
    equal: fieldDiffs.length === 0,
    service: legacy.service,
    currency: legacy.currency,
    diffCents: totalDiff,
    fieldDiffs,
    legacyLatencyMs: input.legacyLatencyMs,
    engineLatencyMs: input.engineLatencyMs,
    legacy,
    engine,
    at: new Date().toISOString(),
    compareId: input.compareId,
  };
}
