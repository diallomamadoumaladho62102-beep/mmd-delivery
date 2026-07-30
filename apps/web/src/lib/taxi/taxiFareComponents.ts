/**
 * Extensible Taxi fare component catalog.
 * New fee keys can be added here without rewriting receipts/APIs —
 * unknown keys still render via label_key when present with non-zero amount.
 */

export const TAXI_FARE_COMPONENT_KEYS = [
  "base",
  "distance",
  "time",
  "minimum_fare",
  "surge",
  "tolls",
  "parking",
  "wait",
  "booking_fee",
  "airport_fee",
  "regulatory_fee",
  "service_fee",
  "cleaning_fee",
  "promo",
  "coupon",
  "wallet_credit",
  "loyalty",
  "shared",
  "mmd_plus",
  "tip",
  "tax",
  "refund",
  "adjustment",
  "total",
] as const;

export type TaxiFareComponentKey = (typeof TAXI_FARE_COMPONENT_KEYS)[number] | (string & {});

export type TaxiFareLineKind = "charge" | "discount" | "info" | "total";

export type TaxiFareComponentLine = {
  key: TaxiFareComponentKey;
  label_key: string;
  amount_cents: number;
  kind: TaxiFareLineKind;
  meta?: Record<string, unknown>;
};

export type TaxiFareRatesSnapshot = {
  base_fare: number;
  per_mile: number;
  per_minute: number;
  min_fare: number;
  booking_fee: number;
  class_multiplier: number;
  surge_multiplier: number;
  airport_fee: number;
  cleaning_fee: number;
};

export type TaxiFareComponentsDoc = {
  version: 1;
  currency: string;
  lines: TaxiFareComponentLine[];
  rates_snapshot?: TaxiFareRatesSnapshot;
};

export const TAXI_FARE_LABEL_KEYS: Record<string, string> = {
  base: "taxi.receipt.fare.base",
  distance: "taxi.receipt.fare.distance",
  time: "taxi.receipt.fare.time",
  minimum_fare: "taxi.receipt.fare.minimum",
  surge: "taxi.receipt.fare.surge",
  tolls: "taxi.receipt.fare.tolls",
  parking: "taxi.receipt.fare.parking",
  wait: "taxi.receipt.fare.wait",
  booking_fee: "taxi.receipt.fare.bookingFee",
  airport_fee: "taxi.receipt.fare.airport",
  regulatory_fee: "taxi.receipt.fare.regulatoryFee",
  service_fee: "taxi.receipt.fare.regulatory",
  cleaning_fee: "taxi.receipt.fare.cleaning",
  promo: "taxi.receipt.fare.promo",
  coupon: "taxi.receipt.fare.coupon",
  wallet_credit: "taxi.receipt.fare.walletCredit",
  loyalty: "taxi.receipt.fare.loyalty",
  shared: "taxi.receipt.fare.shared",
  mmd_plus: "taxi.receipt.fare.mmdPlus",
  tip: "taxi.receipt.fare.tip",
  tax: "taxi.receipt.fare.tax",
  refund: "taxi.receipt.fare.refund",
  adjustment: "taxi.receipt.fare.adjustment",
  total: "taxi.receipt.fare.total",
};

function moneyToCents(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function cents(value: unknown): number {
  const n = Math.round(Number(value ?? 0));
  return Number.isFinite(n) ? n : 0;
}

function nullableCents(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return n;
}

/** Only non-zero finite amounts are displayable. */
export function isApplicableFareLine(
  line: Pick<TaxiFareComponentLine, "amount_cents"> | null | undefined
): boolean {
  if (!line) return false;
  const amount = Number(line.amount_cents);
  return Number.isFinite(amount) && amount !== 0;
}

export function filterApplicableFareLines(
  lines: TaxiFareComponentLine[] | null | undefined
): TaxiFareComponentLine[] {
  return (lines ?? []).filter(isApplicableFareLine);
}

export function parseFareComponentsDoc(
  raw: unknown
): TaxiFareComponentsDoc | null {
  if (!raw || typeof raw !== "object") return null;
  const doc = raw as Record<string, unknown>;
  if (Number(doc.version) !== 1) return null;
  if (!Array.isArray(doc.lines)) return null;
  return {
    version: 1,
    currency: String(doc.currency ?? "USD").toUpperCase(),
    lines: doc.lines as TaxiFareComponentLine[],
    rates_snapshot: doc.rates_snapshot as TaxiFareRatesSnapshot | undefined,
  };
}

function pushCharge(
  lines: TaxiFareComponentLine[],
  key: string,
  amountCents: unknown,
  meta?: Record<string, unknown>
) {
  const amount = cents(amountCents);
  if (amount === 0) return;
  lines.push({
    key,
    label_key: TAXI_FARE_LABEL_KEYS[key] ?? `taxi.receipt.fare.${key}`,
    amount_cents: amount,
    kind: amount < 0 ? "discount" : "charge",
    ...(meta ? { meta } : {}),
  });
}

function pushDiscount(
  lines: TaxiFareComponentLine[],
  key: string,
  amountCents: unknown,
  meta?: Record<string, unknown>
) {
  const amount = Math.abs(cents(amountCents));
  if (amount === 0) return;
  lines.push({
    key,
    label_key: TAXI_FARE_LABEL_KEYS[key] ?? `taxi.receipt.fare.${key}`,
    amount_cents: -amount,
    kind: "discount",
    ...(meta ? { meta } : {}),
  });
}

export type BuildTaxiFareComponentsInput = {
  currency: string;
  distanceMiles?: number | null;
  durationMinutes?: number | null;
  pricing?: Record<string, unknown> | null;
  /** Ride / quote scalar fields */
  ride?: Record<string, unknown> | null;
};

/**
 * Build a frozen fare_components document from pricing rates + ride scalars.
 * Omits zero/null lines. Safe for legacy rides (no invented amounts).
 */
export function buildTaxiFareComponentsDoc(
  input: BuildTaxiFareComponentsInput
): TaxiFareComponentsDoc {
  const ride = input.ride ?? {};
  const pricing = input.pricing ?? null;
  const distanceMiles = Number(
    input.distanceMiles ?? ride.distance_miles ?? 0
  );
  const durationMinutes = Number(
    input.durationMinutes ?? ride.duration_minutes ?? 0
  );
  const lines: TaxiFareComponentLine[] = [];

  let ratesSnapshot: TaxiFareRatesSnapshot | undefined;

  if (pricing) {
    const baseFare = Number(pricing.base_fare ?? 0);
    const perMile = Number(pricing.per_mile ?? 0);
    const perMinute = Number(pricing.per_minute ?? 0);
    const minFare = Number(pricing.min_fare ?? 0);
    const bookingFee = Number(pricing.booking_fee ?? 0);
    const classMultiplier = Number(pricing.class_multiplier ?? 1) || 1;
    const surgeMultiplier = Number(pricing.surge_multiplier ?? 1) || 1;
    const airportFee = Number(pricing.airport_fee ?? 0);
    const cleaningFee = Number(pricing.cleaning_fee ?? 0);

    ratesSnapshot = {
      base_fare: baseFare,
      per_mile: perMile,
      per_minute: perMinute,
      min_fare: minFare,
      booking_fee: bookingFee,
      class_multiplier: classMultiplier,
      surge_multiplier: surgeMultiplier,
      airport_fee: airportFee,
      cleaning_fee: cleaningFee,
    };

    const baseCents = moneyToCents(baseFare);
    const distanceCents =
      Number.isFinite(perMile) && perMile > 0 && distanceMiles > 0
        ? Math.round(perMile * distanceMiles * 100)
        : 0;
    const timeCents =
      Number.isFinite(perMinute) && perMinute > 0 && durationMinutes > 0
        ? Math.round(perMinute * durationMinutes * 100)
        : 0;

    // Prefer explicit frozen cents on the ride when present; else reconstruct.
    const surgeFromRide = nullableCents(ride.surge_cents);
    const airportFromRide = nullableCents(ride.airport_fee_cents);
    const cleaningFromRide = nullableCents(ride.cleaning_fee_cents);

    pushCharge(lines, "base", baseCents, { major_units: baseFare });
    pushCharge(lines, "distance", distanceCents, {
      miles: distanceMiles,
      per_mile: perMile,
    });
    pushCharge(lines, "time", timeCents, {
      minutes: durationMinutes,
      per_minute: perMinute,
    });

    const preMultiplier = baseCents + distanceCents + timeCents;
    const afterClass = Math.round(preMultiplier * classMultiplier);
    const classDelta = afterClass - preMultiplier;
    if (classDelta !== 0) {
      // Represent class uplift as part of minimum/adjustment path only when needed;
      // fold into minimum_fare adjustment below for receipt clarity.
    }

    const afterMin = Math.max(afterClass, moneyToCents(minFare));
    const minDelta = afterMin - afterClass;
    pushCharge(lines, "minimum_fare", minDelta, {
      min_fare: minFare,
      class_multiplier: classMultiplier,
    });

    // Surge: prefer explicit ride cents; else derive from multiplier on fare basis.
    if (surgeFromRide != null) {
      pushCharge(lines, "surge", surgeFromRide, { source: "ride" });
    } else if (surgeMultiplier > 1 && afterMin > 0) {
      const surged = Math.round(afterMin * surgeMultiplier);
      pushCharge(lines, "surge", surged - afterMin, {
        surge_multiplier: surgeMultiplier,
      });
    }

    pushCharge(lines, "booking_fee", moneyToCents(bookingFee));

    if (airportFromRide != null) {
      pushCharge(lines, "airport_fee", airportFromRide);
    } else {
      pushCharge(lines, "airport_fee", moneyToCents(airportFee));
    }

    if (cleaningFromRide != null) {
      pushCharge(lines, "cleaning_fee", cleaningFromRide);
    } else {
      pushCharge(lines, "cleaning_fee", moneyToCents(cleaningFee));
    }
  }

  // Ride-level optional fees (explicit scalars — never invent)
  pushCharge(lines, "tolls", nullableCents(ride.tolls_cents) ?? 0);
  pushCharge(lines, "parking", nullableCents(ride.parking_cents) ?? 0);
  pushCharge(lines, "wait", ride.wait_fee_amount_cents);
  pushCharge(lines, "regulatory_fee", nullableCents(ride.regulatory_fee_cents) ?? 0);
  pushCharge(lines, "service_fee", ride.service_fee_cents);
  pushCharge(lines, "tax", ride.tax_cents);

  // Discounts (combine promo + marketing into one promo line when both present)
  const promoTotal =
    Math.abs(cents(ride.discount_cents)) +
    Math.abs(cents(ride.marketing_discount_cents));
  pushDiscount(lines, "promo", promoTotal);
  pushDiscount(lines, "coupon", ride.coupon_discount_cents);
  pushDiscount(lines, "loyalty", ride.loyalty_discount_cents);
  pushDiscount(lines, "shared", ride.shared_discount_cents);
  pushDiscount(lines, "wallet_credit", ride.mmd_credit_applied_cents);
  pushDiscount(lines, "mmd_plus", ride.mmd_plus_discount_cents);

  const adjustment = nullableCents(ride.adjustment_cents);
  if (adjustment != null && adjustment !== 0) {
    lines.push({
      key: "adjustment",
      label_key: TAXI_FARE_LABEL_KEYS.adjustment,
      amount_cents: adjustment,
      kind: adjustment < 0 ? "discount" : "charge",
    });
  }

  pushCharge(lines, "tip", ride.tip_cents);

  const refundStatus = String(ride.refund_status ?? "").toLowerCase();
  if (refundStatus === "refunded" || refundStatus === "partially_refunded") {
    pushDiscount(lines, "refund", ride.total_cents, { status: refundStatus });
  }

  return {
    version: 1,
    currency: String(input.currency ?? ride.currency ?? "USD").toUpperCase(),
    lines: filterApplicableFareLines(lines),
    ...(ratesSnapshot ? { rates_snapshot: ratesSnapshot } : {}),
  };
}

/**
 * Resolve display lines: prefer stored fare_components (frozen rates),
 * then overlay live tip/wait/refund/discount scalars so post-create updates appear.
 */
export function resolveTaxiFareLinesForDisplay(params: {
  ride: Record<string, unknown>;
  pricing?: Record<string, unknown> | null;
}): TaxiFareComponentLine[] {
  const stored = parseFareComponentsDoc(params.ride.fare_components);
  const ride = params.ride;

  if (stored?.lines?.length) {
    let doc = stored;
    doc = upsertFareComponentLine(
      doc,
      {
        key: "wait",
        label_key: TAXI_FARE_LABEL_KEYS.wait,
        amount_cents: cents(ride.wait_fee_amount_cents),
        kind: "charge",
      },
      stored.currency
    );
    doc = upsertFareComponentLine(
      doc,
      {
        key: "tip",
        label_key: TAXI_FARE_LABEL_KEYS.tip,
        amount_cents: cents(ride.tip_cents),
        kind: "charge",
      },
      stored.currency
    );
    doc = upsertFareComponentLine(
      doc,
      {
        key: "wallet_credit",
        label_key: TAXI_FARE_LABEL_KEYS.wallet_credit,
        amount_cents: -Math.abs(cents(ride.mmd_credit_applied_cents)),
        kind: "discount",
      },
      stored.currency
    );
    const promoTotal =
      Math.abs(cents(ride.discount_cents)) +
      Math.abs(cents(ride.marketing_discount_cents));
    doc = upsertFareComponentLine(
      doc,
      {
        key: "promo",
        label_key: TAXI_FARE_LABEL_KEYS.promo,
        amount_cents: -promoTotal,
        kind: "discount",
      },
      stored.currency
    );
    doc = upsertFareComponentLine(
      doc,
      {
        key: "loyalty",
        label_key: TAXI_FARE_LABEL_KEYS.loyalty,
        amount_cents: -Math.abs(cents(ride.loyalty_discount_cents)),
        kind: "discount",
      },
      stored.currency
    );
    doc = upsertFareComponentLine(
      doc,
      {
        key: "shared",
        label_key: TAXI_FARE_LABEL_KEYS.shared,
        amount_cents: -Math.abs(cents(ride.shared_discount_cents)),
        kind: "discount",
      },
      stored.currency
    );
    doc = upsertFareComponentLine(
      doc,
      {
        key: "mmd_plus",
        label_key: TAXI_FARE_LABEL_KEYS.mmd_plus,
        amount_cents: -Math.abs(cents(ride.mmd_plus_discount_cents)),
        kind: "discount",
      },
      stored.currency
    );

    // Optional market fees from ride scalars
    for (const [key, field] of [
      ["surge", "surge_cents"],
      ["tolls", "tolls_cents"],
      ["parking", "parking_cents"],
      ["airport_fee", "airport_fee_cents"],
      ["cleaning_fee", "cleaning_fee_cents"],
      ["regulatory_fee", "regulatory_fee_cents"],
    ] as const) {
      const value = nullableCents(ride[field]);
      if (value != null) {
        doc = upsertFareComponentLine(
          doc,
          {
            key,
            label_key: TAXI_FARE_LABEL_KEYS[key] ?? `taxi.receipt.fare.${key}`,
            amount_cents: value,
            kind: "charge",
          },
          stored.currency
        );
      }
    }

    const adjustment = nullableCents(ride.adjustment_cents);
    if (adjustment != null) {
      doc = upsertFareComponentLine(
        doc,
        {
          key: "adjustment",
          label_key: TAXI_FARE_LABEL_KEYS.adjustment,
          amount_cents: adjustment,
          kind: adjustment < 0 ? "discount" : "charge",
        },
        stored.currency
      );
    }

    const refundStatus = String(ride.refund_status ?? "").toLowerCase();
    if (refundStatus === "refunded" || refundStatus === "partially_refunded") {
      doc = upsertFareComponentLine(
        doc,
        {
          key: "refund",
          label_key: TAXI_FARE_LABEL_KEYS.refund,
          amount_cents: -Math.abs(cents(ride.total_cents)),
          kind: "discount",
          meta: { status: refundStatus },
        },
        stored.currency
      );
    }

    return filterApplicableFareLines(doc.lines);
  }

  return buildTaxiFareComponentsDoc({
    currency: String(params.ride.currency ?? "USD"),
    pricing: params.pricing ?? null,
    ride: params.ride,
  }).lines;
}

/**
 * Upsert a single component into an existing doc (e.g. tip / wait after create).
 */
export function upsertFareComponentLine(
  doc: TaxiFareComponentsDoc | null,
  line: TaxiFareComponentLine,
  currency = "USD"
): TaxiFareComponentsDoc {
  const base: TaxiFareComponentsDoc = doc ?? {
    version: 1,
    currency,
    lines: [],
  };
  const without = base.lines.filter((l) => l.key !== line.key);
  const nextLines = isApplicableFareLine(line)
    ? [...without, line]
    : without;
  return {
    ...base,
    lines: filterApplicableFareLines(nextLines),
  };
}
