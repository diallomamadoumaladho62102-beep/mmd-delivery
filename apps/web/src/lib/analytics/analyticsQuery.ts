import type { SupabaseClient } from "@supabase/supabase-js";
import {
  analyticsCacheGet,
  analyticsCacheKey,
  analyticsCacheSet,
} from "@/lib/analytics/analyticsCache";
import type {
  AnalyticsCard,
  AnalyticsFilters,
  AnalyticsModule,
  AnalyticsModulePayload,
} from "@/lib/analytics/analyticsTypes";

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function startIso(day: string | null | undefined): string {
  return `${String(day ?? new Date().toISOString().slice(0, 10))}T00:00:00.000Z`;
}

function endIso(day: string | null | undefined): string {
  return `${String(day ?? new Date().toISOString().slice(0, 10))}T23:59:59.999Z`;
}

async function safeCount(
  supabase: SupabaseClient,
  table: string,
  apply?: (q: any) => any
): Promise<number> {
  try {
    let q = supabase.from(table).select("id", { count: "exact", head: true });
    if (apply) q = apply(q);
    const { count, error } = await q;
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

async function safeSumCents(
  supabase: SupabaseClient,
  table: string,
  column: string,
  apply?: (q: any) => any
): Promise<number> {
  try {
    let q = supabase.from(table).select(column).limit(5000);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error || !data) return 0;
    return (data as unknown as Array<Record<string, unknown>>).reduce(
      (acc, row) => acc + num(row[column]),
      0
    );
  } catch {
    return 0;
  }
}

async function loadCatalog(
  supabase: SupabaseClient,
  module: AnalyticsModule
): Promise<
  Array<{
    key: string;
    module: string;
    label: string;
    metric_key: string;
    format: AnalyticsCard["format"];
    default_visible: boolean;
    sort_order: number;
  }>
> {
  const { data, error } = await supabase
    .from("analytics_card_catalog")
    .select("key,module,label,metric_key,format,default_visible,sort_order")
    .eq("module", module)
    .order("sort_order", { ascending: true });
  if (error || !data) return fallbackCatalog(module);
  return data as Array<{
    key: string;
    module: string;
    label: string;
    metric_key: string;
    format: AnalyticsCard["format"];
    default_visible: boolean;
    sort_order: number;
  }>;
}

function fallbackCatalog(module: AnalyticsModule) {
  const base: Array<{
    key: string;
    module: string;
    label: string;
    metric_key: string;
    format: AnalyticsCard["format"];
    default_visible: boolean;
    sort_order: number;
  }> = [
    {
      key: `${module}_primary`,
      module,
      label: module,
      metric_key: "primary",
      format: "number",
      default_visible: true,
      sort_order: 10,
    },
  ];
  return base;
}

async function loadPrefs(
  supabase: SupabaseClient,
  adminUserId: string | null,
  module: AnalyticsModule
): Promise<{ visible: string[] | null; order: string[] | null }> {
  if (!adminUserId) return { visible: null, order: null };
  const { data } = await supabase
    .from("analytics_dashboard_prefs")
    .select("visible_cards,card_order")
    .eq("admin_user_id", adminUserId)
    .eq("module", module)
    .maybeSingle();
  return {
    visible: (data?.visible_cards as string[] | undefined) ?? null,
    order: (data?.card_order as string[] | undefined) ?? null,
  };
}

async function loadSnapshotMetrics(
  supabase: SupabaseClient,
  module: AnalyticsModule,
  filters: AnalyticsFilters
): Promise<Record<string, number> | null> {
  try {
    let q = supabase
      .from("analytics_daily_metrics")
      .select("metrics,metric_date")
      .eq("module", module)
      .gte("metric_date", filters.from ?? "1970-01-01")
      .lte("metric_date", filters.to ?? "2100-01-01")
      .order("metric_date", { ascending: false })
      .limit(60);
    if (filters.countryCode) {
      q = q.eq("country_code", String(filters.countryCode).toUpperCase());
    }
    const { data, error } = await q;
    if (error || !data?.length) return null;
    const merged: Record<string, number> = {};
    for (const row of data) {
      const metrics = (row.metrics ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(metrics)) {
        merged[k] = (merged[k] ?? 0) + num(v);
      }
    }
    return merged;
  } catch {
    return null;
  }
}

async function liveGlobalMetrics(
  supabase: SupabaseClient,
  filters: AnalyticsFilters
): Promise<Record<string, number>> {
  const from = startIso(filters.from);
  const to = endIso(filters.to);
  const today = new Date().toISOString().slice(0, 10);
  const weekFrom = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const monthFrom = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

  const range = (q: any) => q.gte("created_at", from).lte("created_at", to);

  const [
    foodToday,
    foodWeek,
    foodMonth,
    foodRange,
    foodGmv,
    foodCancel,
    deliveryRange,
    deliveryGmv,
    taxiRange,
    taxiGmv,
    taxiCancel,
    mpRange,
    mpGmv,
    usersTotal,
    usersNew,
    cashback,
    mmdPlus,
    campaigns,
    sellers,
  ] = await Promise.all([
    safeCount(supabase, "orders", (q) =>
      q.gte("created_at", startIso(today)).lte("created_at", endIso(today))
    ),
    safeCount(supabase, "orders", (q) =>
      q.gte("created_at", startIso(weekFrom)).lte("created_at", endIso(today))
    ),
    safeCount(supabase, "orders", (q) =>
      q.gte("created_at", startIso(monthFrom)).lte("created_at", endIso(today))
    ),
    safeCount(supabase, "orders", range),
    safeSumCents(supabase, "orders", "total_cents", range),
    safeCount(supabase, "orders", (q) =>
      range(q).in("status", ["canceled", "cancelled"])
    ),
    safeCount(supabase, "delivery_requests", range),
    safeSumCents(supabase, "delivery_requests", "total_cents", range),
    safeCount(supabase, "taxi_rides", range),
    safeSumCents(supabase, "taxi_rides", "total_cents", range),
    safeCount(supabase, "taxi_rides", (q) => range(q).ilike("status", "%cancel%")),
    safeCount(supabase, "seller_orders", range),
    safeSumCents(supabase, "seller_orders", "total_cents", range),
    safeCount(supabase, "profiles"),
    safeCount(supabase, "profiles", (q) =>
      q.gte("created_at", from).lte("created_at", to)
    ),
    safeSumCents(supabase, "marketing_cashback_ledger", "amount_cents", (q) =>
      q.eq("status", "credited").gte("created_at", from).lte("created_at", to)
    ),
    safeCount(supabase, "mmd_plus_subscriptions", (q) =>
      q.in("status", ["active", "trialing"])
    ),
    safeCount(supabase, "marketing_campaigns", (q) => q.eq("status", "active")),
    safeCount(supabase, "sellers"),
  ]);

  const ordersTotal = foodRange + deliveryRange + taxiRange + mpRange;
  const gmv = foodGmv + deliveryGmv + taxiGmv + mpGmv;
  const canceled = foodCancel + taxiCancel;

  return {
    orders_today: foodToday + deliveryRange, // delivery today approx via range if same day
    orders_week: foodWeek,
    orders_month: foodMonth,
    gmv_cents: gmv,
    revenue_cents: gmv,
    commissions_cents: await safeSumCents(
      supabase,
      "order_commissions",
      "platform_fee_cents",
      range
    ),
    mmd_revenue_cents: await safeSumCents(
      supabase,
      "order_commissions",
      "platform_fee_cents",
      range
    ),
    users_total: usersTotal,
    users_new: usersNew,
    clients_active: foodRange,
    drivers_active: await safeCount(supabase, "profiles", (q) =>
      q.eq("role", "driver")
    ),
    restaurants_active: await safeCount(supabase, "profiles", (q) =>
      q.eq("role", "restaurant")
    ),
    sellers_active: sellers,
    orders_canceled: canceled,
    cancel_rate:
      ordersTotal > 0 ? Math.round((1000 * canceled) / ordersTotal) / 10 : 0,
    avg_delivery_sec: 0,
    avg_taxi_sec: 0,
    avg_basket_cents: ordersTotal > 0 ? Math.round(gmv / ordersTotal) : 0,
    cashback_cents: cashback,
    loyalty_points: 0,
    mmd_plus_active: mmdPlus,
    campaigns_active: campaigns,
  };
}

async function loadCachedTops(
  supabase: SupabaseClient,
  module: string,
  filters: AnalyticsFilters
): Promise<Record<string, Array<Record<string, unknown>>>> {
  try {
    const day = String(filters.to ?? new Date().toISOString().slice(0, 10));
    let q = supabase
      .from("analytics_daily_tops")
      .select("top_key,items")
      .eq("module", module)
      .eq("metric_day", day)
      .limit(20);
    if (filters.countryCode) {
      q = q.eq("country_code", String(filters.countryCode).toUpperCase());
    }
    const { data, error } = await q;
    if (error || !data?.length) return {};
    const out: Record<string, Array<Record<string, unknown>>> = {};
    for (const row of data as Array<{ top_key: string; items: unknown }>) {
      out[row.top_key] = Array.isArray(row.items)
        ? (row.items as Array<Record<string, unknown>>)
        : [];
    }
    return out;
  } catch {
    return {};
  }
}

async function loadCachedSeries(
  supabase: SupabaseClient,
  module: string,
  metricKey: string,
  filters: AnalyticsFilters
): Promise<Array<Record<string, unknown>>> {
  try {
    const from = startIso(filters.from);
    const to = endIso(filters.to);
    let q = supabase
      .from("analytics_time_series")
      .select("bucket_start,value_numeric,granularity,metric_key")
      .eq("module", module)
      .eq("metric_key", metricKey)
      .eq("granularity", "day")
      .gte("bucket_start", from)
      .lte("bucket_start", to)
      .order("bucket_start", { ascending: true })
      .limit(90);
    if (filters.countryCode) {
      q = q.eq("country_code", String(filters.countryCode).toUpperCase());
    }
    const { data, error } = await q;
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>).map((row) => ({
      t: row.bucket_start,
      v: num(row.value_numeric),
      metric: row.metric_key,
    }));
  } catch {
    return [];
  }
}

async function liveModuleMetrics(
  supabase: SupabaseClient,
  module: AnalyticsModule,
  filters: AnalyticsFilters
): Promise<{
  metrics: Record<string, number>;
  tops: Record<string, Array<Record<string, unknown>>>;
  series: Array<Record<string, unknown>>;
}> {
  const from = startIso(filters.from);
  const to = endIso(filters.to);
  const range = (q: any) => q.gte("created_at", from).lte("created_at", to);
  let tops: Record<string, Array<Record<string, unknown>>> = await loadCachedTops(
    supabase,
    module,
    filters
  );
  let series: Array<Record<string, unknown>> = await loadCachedSeries(
    supabase,
    module,
    "orders",
    filters
  );

  if (module === "global") {
    return {
      metrics: await liveGlobalMetrics(supabase, filters),
      tops,
      series: await loadCachedSeries(supabase, "global", "gmv_cents", filters),
    };
  }

  if (module === "food") {
    const orders = await safeCount(supabase, "orders", range);
    const sales = await safeSumCents(supabase, "orders", "total_cents", range);
    const canceled = await safeCount(supabase, "orders", (q) =>
      range(q).in("status", ["canceled", "cancelled"])
    );
    const refunds = await safeCount(supabase, "orders", (q) =>
      range(q).eq("payment_status", "refunded")
    );
    series = await loadCachedSeries(supabase, "food", "gmv_cents", filters);
    return {
      metrics: {
        orders,
        sales_cents: sales,
        canceled,
        refunds_cents: 0,
        refunds,
        commissions_cents: await safeSumCents(
          supabase,
          "order_commissions",
          "platform_fee_cents",
          range
        ),
        restaurants: await safeCount(supabase, "orders", (q) =>
          range(q).not("restaurant_user_id", "is", null)
        ),
        avg_delivery_sec: 0,
        primary: orders,
      },
      tops,
      series,
    };
  }

  if (module === "delivery") {
    const deliveries = await safeCount(supabase, "delivery_requests", range);
    const revenue = await safeSumCents(
      supabase,
      "delivery_requests",
      "total_cents",
      range
    );
    series = await loadCachedSeries(supabase, "delivery", "gmv_cents", filters);
    return {
      metrics: {
        deliveries,
        revenue_cents: revenue,
        distance_miles: 0,
        canceled: await safeCount(supabase, "delivery_requests", (q) =>
          range(q).ilike("status", "%cancel%")
        ),
        primary: deliveries,
      },
      tops,
      series,
    };
  }

  if (module === "taxi") {
    const rides = await safeCount(supabase, "taxi_rides", range);
    const revenue = await safeSumCents(supabase, "taxi_rides", "total_cents", range);
    const canceled = await safeCount(supabase, "taxi_rides", (q) =>
      range(q).ilike("status", "%cancel%")
    );
    series = await loadCachedSeries(supabase, "taxi", "gmv_cents", filters);
    return {
      metrics: {
        rides,
        revenue_cents: revenue,
        canceled,
        cancel_rate: rides > 0 ? Math.round((1000 * canceled) / rides) / 10 : 0,
        accept_rate: 0,
        distance_miles: 0,
        avg_duration_sec: 0,
        primary: rides,
      },
      tops,
      series,
    };
  }

  if (module === "marketplace" || module === "sellers") {
    const orders = await safeCount(supabase, "seller_orders", range);
    const gmv = await safeSumCents(supabase, "seller_orders", "total_cents", range);
    const sellers = await safeCount(supabase, "sellers");
    return {
      metrics: {
        orders,
        gmv_cents: gmv,
        sales_cents: gmv,
        sellers,
        commissions_cents: 0,
        avg_basket_cents: orders > 0 ? Math.round(gmv / orders) : 0,
        primary: orders,
      },
      tops,
      series,
    };
  }

  if (module === "loyalty") {
    return {
      metrics: {
        points_issued: 0,
        points_redeemed: 0,
        points_expired: 0,
        accounts_active: await safeCount(supabase, "loyalty_accounts"),
        primary: 0,
      },
      tops,
      series,
    };
  }

  if (module === "mmd_plus") {
    const active = await safeCount(supabase, "mmd_plus_subscriptions", (q) =>
      q.eq("status", "active")
    );
    const trials = await safeCount(supabase, "mmd_plus_subscriptions", (q) =>
      q.eq("status", "trialing")
    );
    const canceled = await safeCount(supabase, "mmd_plus_subscriptions", (q) =>
      q.in("status", ["canceled", "cancelled", "expired"])
    );
    const total = active + trials + canceled;

    // Snapshot-based MRR: normalize annual plans to monthly using stored price_cents.
    let mrr = 0;
    let renewals = 0;
    const planBuckets: Record<string, number> = {};
    try {
      const { data: subs } = await supabase
        .from("mmd_plus_subscriptions")
        .select("price_cents,billing_period,status,plan_code,currency")
        .in("status", ["active", "trialing"])
        .limit(5000);
      for (const row of (subs ?? []) as Array<Record<string, unknown>>) {
        const price = num(row.price_cents);
        const period = String(row.billing_period ?? "month").toLowerCase();
        const monthly =
          period === "year" || period === "annual" || period === "yearly"
            ? Math.round(price / 12)
            : price;
        mrr += monthly;
        const plan = String(row.plan_code ?? "unknown");
        planBuckets[plan] = (planBuckets[plan] ?? 0) + monthly;
      }
    } catch {
      mrr = 0;
    }
    const paying = Math.max(active, 1);
    const arpu = Math.round(mrr / paying);
    const topsPlus = {
      ...tops,
      plans_by_mrr: Object.entries(planBuckets)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10),
    };
    const seriesPlus = await loadCachedSeries(supabase, "mmd_plus", "mrr_cents", filters);

    return {
      metrics: {
        active,
        trials,
        renewals,
        cancellations: canceled,
        mrr_cents: mrr,
        arr_cents: mrr * 12,
        churn_rate: total > 0 ? Math.round((1000 * canceled) / total) / 10 : 0,
        arpu_cents: arpu,
        ltv_cents: arpu > 0 ? arpu * 12 : 0,
        primary: active,
      },
      tops: topsPlus,
      series: seriesPlus,
    };
  }

  if (module === "marketing") {
    const campaigns = await safeCount(supabase, "marketing_campaigns");
    const active = await safeCount(supabase, "marketing_campaigns", (q) =>
      q.eq("status", "active")
    );
    const cashback = await safeSumCents(
      supabase,
      "marketing_cashback_ledger",
      "amount_cents",
      (q) => q.eq("status", "credited")
    );
    const spent = await safeSumCents(
      supabase,
      "marketing_campaigns",
      "budget_spent_cents"
    );
    return {
      metrics: {
        campaigns,
        active_campaigns: active,
        budget_spent_cents: spent,
        cashback_cents: cashback,
        roi: 0,
        conversions: await safeCount(supabase, "marketing_applications"),
        primary: campaigns,
      },
      tops,
      series,
    };
  }

  if (module === "finance") {
    const revenue =
      (await safeSumCents(supabase, "orders", "total_cents", range)) +
      (await safeSumCents(supabase, "taxi_rides", "total_cents", range)) +
      (await safeSumCents(supabase, "seller_orders", "total_cents", range));
    return {
      metrics: {
        revenue_cents: revenue,
        commissions_cents: await safeSumCents(
          supabase,
          "order_commissions",
          "platform_fee_cents",
          range
        ),
        payouts_cents: await safeSumCents(
          supabase,
          "payout_transactions",
          "amount_cents",
          range
        ),
        refunds_cents: 0,
        mmd_credit_balance_cents: await safeSumCents(
          supabase,
          "mmd_credit_wallets",
          "balance_cents"
        ),
        cashback_cents: await safeSumCents(
          supabase,
          "marketing_cashback_ledger",
          "amount_cents",
          (q) => q.eq("status", "credited")
        ),
        primary: revenue,
      },
      tops,
      series,
    };
  }

  if (module === "drivers") {
    return {
      metrics: {
        active: await safeCount(supabase, "profiles", (q) => q.eq("role", "driver")),
        earnings_cents: await safeSumCents(supabase, "wallet_ledger", "amount_cents", (q) =>
          q.eq("account_type", "driver").eq("direction", "credit")
        ),
        bonus_cents: await safeSumCents(supabase, "wallet_ledger", "amount_cents", (q) =>
          q.eq("account_type", "driver").eq("reference_type", "adjustment")
        ),
        primary: 0,
      },
      tops,
      series,
    };
  }

  if (module === "restaurants") {
    const sales = await safeSumCents(supabase, "orders", "total_cents", range);
    return {
      metrics: {
        sales_cents: sales,
        commissions_cents: await safeSumCents(
          supabase,
          "order_commissions",
          "platform_fee_cents",
          range
        ),
        primary: sales,
      },
      tops,
      series,
    };
  }

  if (module === "fraud") {
    const fraudSignals = await safeCount(supabase, "marketing_fraud_signals");
    const suspectCashback = await safeCount(
      supabase,
      "marketing_cashback_ledger",
      (q) => q.in("status", ["failed", "pending_recovery", "clawed_back"])
    );
    return {
      metrics: {
        suspect_accounts: fraudSignals,
        suspect_cashback: suspectCashback,
        suspect_coupons: await safeCount(supabase, "marketing_coupons", (q) =>
          q.eq("status", "revoked")
        ),
        primary: fraudSignals,
      },
      tops,
      series,
    };
  }

  return { metrics: { primary: 0 }, tops, series };
}

export async function getAnalyticsModulePayload(
  supabase: SupabaseClient,
  params: {
    module: AnalyticsModule;
    filters: AnalyticsFilters;
    adminUserId?: string | null;
    skipCache?: boolean;
  }
): Promise<AnalyticsModulePayload> {
  const cacheKey = analyticsCacheKey(params.module, params.filters as Record<string, unknown>);
  if (!params.skipCache) {
    const cached = analyticsCacheGet<AnalyticsModulePayload>(cacheKey);
    if (cached) return { ...cached, cached: true };
  }

  const [catalog, prefs, snapshot] = await Promise.all([
    loadCatalog(supabase, params.module),
    loadPrefs(supabase, params.adminUserId ?? null, params.module),
    loadSnapshotMetrics(supabase, params.module, params.filters),
  ]);

  const live = await liveModuleMetrics(supabase, params.module, params.filters);
  const metrics = {
    ...(snapshot ?? {}),
    ...live.metrics,
  };

  let cards: AnalyticsCard[] = catalog.map((card) => ({
    key: card.key,
    module: card.module,
    label: card.label,
    metric_key: card.metric_key,
    format: card.format,
    value: metrics[card.metric_key] ?? null,
    visible: prefs.visible
      ? prefs.visible.includes(card.key)
      : card.default_visible !== false,
  }));

  if (prefs.order?.length) {
    const orderMap = new Map(prefs.order.map((k, i) => [k, i]));
    cards = [...cards].sort(
      (a, b) => (orderMap.get(a.key) ?? 999) - (orderMap.get(b.key) ?? 999)
    );
  }

  const payload: AnalyticsModulePayload = {
    module: params.module,
    filters: params.filters,
    cards,
    metrics,
    series: live.series,
    tops: live.tops,
    source: snapshot ? "mixed" : "live",
    cached: false,
    generated_at: new Date().toISOString(),
  };

  analyticsCacheSet(cacheKey, payload, 30_000);
  return payload;
}

export async function listAnalyticsExportRows(
  supabase: SupabaseClient,
  module: AnalyticsModule,
  filters: AnalyticsFilters
): Promise<Array<Record<string, unknown>>> {
  const payload = await getAnalyticsModulePayload(supabase, {
    module,
    filters,
    skipCache: true,
  });
  return payload.cards
    .filter((c) => c.visible)
    .map((c) => ({
      module: c.module,
      card: c.key,
      label: c.label,
      metric: c.metric_key,
      value: c.value,
      format: c.format,
      from: filters.from,
      to: filters.to,
      country: filters.countryCode,
      city: filters.city,
      generated_at: payload.generated_at,
    }));
}
