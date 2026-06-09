import {
  normalizeTaxiCurrencyCode,
  TAXI_COUNTRY_CURRENCY_MAP,
} from "@/lib/taxiCountries";

/** Static MVP fallback rates (USD base) when DB RPC unavailable. */
const STATIC_FX_TO_USD: Record<string, number> = {
  USD: 1,
  EUR: 1.08695652,
  GBP: 1.26582278,
  CAD: 0.73529412,
  GNF: 0.00011628,
  XOF: 0.00166667,
  SLE: 0.04444444,
  MRU: 0.02531646,
};

const STATIC_FX_FROM_USD: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  CAD: 1.36,
  GNF: 8600,
  XOF: 600,
  SLE: 22.5,
  MRU: 39.5,
};

export type TaxiExchangeRateResult = {
  ok: boolean;
  from_currency: string;
  to_currency: string;
  rate: number;
  source?: string;
  message?: string;
};

export async function getTaxiExchangeRate(
  supabaseAdmin: {
    rpc: (
      fn: string,
      args: Record<string, unknown>
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  },
  fromCurrency: unknown,
  toCurrency: unknown
): Promise<TaxiExchangeRateResult> {
  const from = normalizeTaxiCurrencyCode(fromCurrency, "USD");
  const to = normalizeTaxiCurrencyCode(toCurrency, "USD");

  if (from === to) {
    return {
      ok: true,
      from_currency: from,
      to_currency: to,
      rate: 1,
      source: "identity",
    };
  }

  const { data, error } = await supabaseAdmin.rpc("get_taxi_exchange_rate", {
    p_from_currency: from,
    p_to_currency: to,
  });

  if (!error && data && typeof data === "object") {
    const row = data as Record<string, unknown>;
    if (row.ok === true && row.rate != null) {
      return {
        ok: true,
        from_currency: String(row.from_currency ?? from),
        to_currency: String(row.to_currency ?? to),
        rate: Number(row.rate),
        source: String(row.source ?? "db"),
      };
    }
  }

  const fromUsd = STATIC_FX_TO_USD[from];
  const toUsd = STATIC_FX_TO_USD[to];
  if (fromUsd && toUsd) {
    return {
      ok: true,
      from_currency: from,
      to_currency: to,
      rate: fromUsd / toUsd,
      source: "static_fallback",
    };
  }

  if (from === "USD" && STATIC_FX_FROM_USD[to]) {
    return {
      ok: true,
      from_currency: from,
      to_currency: to,
      rate: STATIC_FX_FROM_USD[to],
      source: "static_fallback",
    };
  }

  return {
    ok: false,
    from_currency: from,
    to_currency: to,
    rate: 0,
    message: error?.message ?? "exchange_rate_not_found",
  };
}

/** Convert amount in minor units (cents) between currencies for display/analytics only. */
export async function convertTaxiCurrency(
  supabaseAdmin: Parameters<typeof getTaxiExchangeRate>[0],
  amountMinorUnits: number,
  fromCurrency: unknown,
  toCurrency: unknown
): Promise<{ amount: number; rate: TaxiExchangeRateResult }> {
  const rate = await getTaxiExchangeRate(supabaseAdmin, fromCurrency, toCurrency);
  if (!rate.ok) {
    return { amount: amountMinorUnits, rate };
  }
  return {
    amount: Math.round(amountMinorUnits * rate.rate),
    rate,
  };
}

export function formatTaxiCurrency(
  amountMinorUnits: unknown,
  currency: unknown,
  locale?: string
): string {
  const code = normalizeTaxiCurrencyCode(currency, "USD");
  const value = Number(amountMinorUnits ?? 0) / 100;
  if (!Number.isFinite(value)) return `${code} 0`;

  const lang = locale?.split("-")[0] ?? "en";
  try {
    return new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", {
      style: "currency",
      currency: code,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${code}`;
  }
}

export function getTaxiCurrencyForCountry(countryCode: string): string {
  return (
    TAXI_COUNTRY_CURRENCY_MAP[String(countryCode ?? "").toUpperCase()] ?? "USD"
  );
}
