export const ANALYTICS_MODULES = [
  "global",
  "food",
  "delivery",
  "taxi",
  "marketplace",
  "loyalty",
  "mmd_plus",
  "marketing",
  "finance",
  "drivers",
  "restaurants",
  "sellers",
  "fraud",
] as const;

export type AnalyticsModule = (typeof ANALYTICS_MODULES)[number];

export type AnalyticsFilters = {
  from?: string | null;
  to?: string | null;
  countryCode?: string | null;
  city?: string | null;
  service?: string | null;
  userId?: string | null;
  partnerUserId?: string | null;
  campaignId?: string | null;
};

export type AnalyticsCard = {
  key: string;
  module: AnalyticsModule | string;
  label: string;
  metric_key: string;
  format: "number" | "currency_cents" | "percent" | "duration_sec" | "string";
  value: number | string | null;
  visible: boolean;
};

export type AnalyticsModulePayload = {
  module: AnalyticsModule;
  filters: AnalyticsFilters;
  cards: AnalyticsCard[];
  metrics: Record<string, number | string | null>;
  series?: Array<Record<string, unknown>>;
  tops?: Record<string, Array<Record<string, unknown>>>;
  source: "live" | "snapshot" | "mixed";
  cached: boolean;
  generated_at: string;
};

export function isAnalyticsModule(value: string): value is AnalyticsModule {
  return (ANALYTICS_MODULES as readonly string[]).includes(value);
}

export function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function parseAnalyticsFilters(
  params: URLSearchParams | Record<string, string | null | undefined>
): AnalyticsFilters {
  const get = (key: string) => {
    if (params instanceof URLSearchParams) return params.get(key);
    return params[key] ?? null;
  };
  const range = defaultDateRange();
  return {
    from: get("from") || range.from,
    to: get("to") || range.to,
    countryCode: get("country") || get("country_code") || null,
    city: get("city") || null,
    service: get("service") || null,
    userId: get("user_id") || null,
    partnerUserId: get("partner_user_id") || null,
    campaignId: get("campaign_id") || null,
  };
}
