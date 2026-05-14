export type RestaurantTaxProfile = {
  restaurantName: string | null;
  email: string | null;
  taxId: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  phone: string | null;
  isComplete: boolean;
  missingFields: string[];
};

export type RestaurantTaxRange = "weekly" | "monthly" | "yearly";

export type RestaurantTaxTotals = {
  grossSales: number;
  platformCommission: number;
  restaurantNet: number;
  totalOrders: number;
  year: number;
  range: RestaurantTaxRange;
  commissionRate: number;
  month?: number | null;
  week?: number | null;
};

export type RestaurantTaxFile = {
  bucket: string;
  path: string;
  signedUrl: string | null;
} | null;

export type RestaurantTaxSummary = {
  restaurantUserId: string;
  year: number;
  range: RestaurantTaxRange;
  month?: number | null;
  week?: number | null;
  generatedAt: string;
  profile: RestaurantTaxProfile;
  totals: RestaurantTaxTotals;
  file: RestaurantTaxFile;
};

type RestaurantProfileRow = {
  user_id?: string;
  restaurant_name?: string | null;
  email?: string | null;
  tax_id?: string | null;
  address?: string | null;
  city?: string | null;
  postal_code?: string | null;
  phone?: string | null;
};

type GenericRow = Record<string, unknown>;

const RESTAURANT_DOCS_BUCKET = "restaurant-docs";

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    const n = Number(normalized);
    if (Number.isFinite(n)) return n;
  }

  return 0;
}

function pickFirstFiniteNumber(row: GenericRow, keys: readonly string[]): number {
  for (const key of keys) {
    const value = row[key];
    const num = asNumber(value);
    if (Number.isFinite(num) && num > 0) return num;
  }

  return 0;
}

async function getRestaurantCommissionRate(supabase: any): Promise<number> {
  const { data, error } = await supabase
    .from("pricing_config")
    .select("restaurant_pct")
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.log("pricing_config restaurant_pct error:", error);
  }

  const raw = Number(data?.restaurant_pct);

  if (Number.isFinite(raw) && raw > 0) {
    return raw > 1 ? raw / 100 : raw;
  }

  return 0.15;
}

function isRestaurantOrderForUser(
  row: GenericRow,
  restaurantUserId: string
): boolean {
  const possibleRestaurantKeys = [
    "restaurant_id",
    "restaurant_user_id",
    "vendor_id",
    "merchant_id",
    "seller_id",
  ] as const;

  return possibleRestaurantKeys.some((key) => {
    const value = row[key];
    return typeof value === "string" && value === restaurantUserId;
  });
}

function isIncludedOrderStatus(row: GenericRow): boolean {
  const raw = row.status;
  const status = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (!status) return true;

  return new Set(["completed", "delivered", "paid", "fulfilled", "closed"]).has(
    status
  );
}

function getRestaurantGrossAmountFromOrder(row: GenericRow): number {
  const restaurantSpecificAmount = pickFirstFiniteNumber(row, [
    "restaurant_amount",
    "restaurant_total",
    "restaurant_subtotal",
    "merchant_amount",
    "merchant_total",
    "vendor_amount",
    "vendor_total",
    "seller_amount",
    "seller_total",
    "food_total",
    "items_total",
    "menu_total",
  ]);

  if (restaurantSpecificAmount > 0) {
    return roundMoney(restaurantSpecificAmount);
  }

  return roundMoney(
    pickFirstFiniteNumber(row, [
      "subtotal",
      "amount_subtotal",
      "total_amount",
      "total",
      "grand_total",
      "amount_total",
    ])
  );
}

function getDateRange(params: {
  year: number;
  range: RestaurantTaxRange;
  month?: number | null;
  week?: number | null;
}) {
  const { year, range, month, week } = params;

  if (range === "monthly") {
    const safeMonth = Math.min(Math.max(month ?? 1, 1), 12);
    const start = new Date(Date.UTC(year, safeMonth - 1, 1));
    const end = new Date(Date.UTC(year, safeMonth, 1));

    return {
      start: start.toISOString(),
      end: end.toISOString(),
    };
  }

  if (range === "weekly") {
    const safeWeek = Math.min(Math.max(week ?? 1, 1), 53);
    const start = new Date(Date.UTC(year, 0, 1));

    start.setUTCDate(start.getUTCDate() + (safeWeek - 1) * 7);

    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 7);

    return {
      start: start.toISOString(),
      end: end.toISOString(),
    };
  }

  return {
    start: `${year}-01-01T00:00:00.000Z`,
    end: `${year + 1}-01-01T00:00:00.000Z`,
  };
}

export function buildRestaurantTaxProfile(
  row: RestaurantProfileRow | null | undefined
): RestaurantTaxProfile {
  const restaurantName = asString(row?.restaurant_name);
  const email = asString(row?.email);
  const taxId = asString(row?.tax_id);
  const address = asString(row?.address);
  const city = asString(row?.city);
  const postalCode = asString(row?.postal_code);
  const phone = asString(row?.phone);

  const missingFields: string[] = [];

  if (!restaurantName) missingFields.push("restaurant_name");
  if (!email) missingFields.push("email");
  if (!taxId) missingFields.push("tax_id");
  if (!address) missingFields.push("address");
  if (!city) missingFields.push("city");
  if (!postalCode) missingFields.push("postal_code");

  return {
    restaurantName,
    email,
    taxId,
    address,
    city,
    postalCode,
    phone,
    isComplete: missingFields.length === 0,
    missingFields,
  };
}

export function computeRestaurantTotalsFromOrders(params: {
  rows: GenericRow[];
  restaurantUserId: string;
  year: number;
  range: RestaurantTaxRange;
  commissionRate: number;
  month?: number | null;
  week?: number | null;
}): RestaurantTaxTotals {
  const {
    rows,
    restaurantUserId,
    year,
    range,
    commissionRate,
    month,
    week,
  } = params;

  const restaurantRows = rows.filter(
    (row) =>
      isRestaurantOrderForUser(row, restaurantUserId) &&
      isIncludedOrderStatus(row)
  );

  let grossSales = 0;

  for (const row of restaurantRows) {
    grossSales += getRestaurantGrossAmountFromOrder(row);
  }

  grossSales = roundMoney(grossSales);

  const platformCommission = roundMoney(grossSales * commissionRate);
  const restaurantNet = roundMoney(grossSales - platformCommission);

  return {
    grossSales,
    platformCommission,
    restaurantNet,
    totalOrders: restaurantRows.length,
    year,
    range,
    commissionRate,
    month,
    week,
  };
}

export function buildRestaurantTaxStoragePath(params: {
  restaurantUserId: string;
  year: number;
  range?: RestaurantTaxRange;
  month?: number | null;
  week?: number | null;
}): string {
  const { restaurantUserId, year, range = "yearly", month, week } = params;

  if (range === "monthly") {
    return `restaurant-tax/${restaurantUserId}/${year}/monthly/month-${month}.pdf`;
  }

  if (range === "weekly") {
    return `restaurant-tax/${restaurantUserId}/${year}/weekly/week-${week}.pdf`;
  }

  return `restaurant-tax/${restaurantUserId}/${year}/restaurant-tax-summary-${year}.pdf`;
}

export async function getRestaurantTaxSummary(params: {
  supabase: any;
  restaurantUserId: string;
  year: number;
  range?: RestaurantTaxRange;
  month?: number | null;
  week?: number | null;
  signedUrl?: string | null;
}): Promise<RestaurantTaxSummary> {
  const {
    supabase,
    restaurantUserId,
    year,
    range = "yearly",
    month = null,
    week = null,
    signedUrl = null,
  } = params;

  const dates = getDateRange({ year, range, month, week });

  const [
    { data: profileRow, error: profileError },
    { data: ordersData, error: ordersError },
    commissionRate,
  ] = await Promise.all([
    supabase
      .from("restaurant_profiles")
      .select(
        "user_id, restaurant_name, email, tax_id, address, city, postal_code, phone"
      )
      .eq("user_id", restaurantUserId)
      .maybeSingle(),

    supabase
      .from("orders")
      .select("*")
      .gte("created_at", dates.start)
      .lt("created_at", dates.end),

    getRestaurantCommissionRate(supabase),
  ]);

  if (profileError) {
    throw new Error(
      profileError.message || "Failed to load restaurant profile"
    );
  }

  if (ordersError) {
    throw new Error(ordersError.message || "Failed to load restaurant orders");
  }

  const profile = buildRestaurantTaxProfile(profileRow);

  const totals = computeRestaurantTotalsFromOrders({
    rows: Array.isArray(ordersData) ? ordersData : [],
    restaurantUserId,
    year,
    range,
    month,
    week,
    commissionRate,
  });

  return {
    restaurantUserId,
    year,
    range,
    month,
    week,
    generatedAt: new Date().toISOString(),
    profile,
    totals,
    file: signedUrl
      ? {
          bucket: RESTAURANT_DOCS_BUCKET,
          path: buildRestaurantTaxStoragePath({
            restaurantUserId,
            year,
            range,
            month,
            week,
          }),
          signedUrl,
        }
      : null,
  };
}