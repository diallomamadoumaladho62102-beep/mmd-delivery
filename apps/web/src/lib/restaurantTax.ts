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

export type RestaurantTaxTotals = {
  grossSales: number;
  platformCommission: number;
  restaurantNet: number;
  totalOrders: number;
  year: number;
};

export type RestaurantTaxFile = {
  bucket: string;
  path: string;
  signedUrl: string | null;
} | null;

export type RestaurantTaxSummary = {
  restaurantUserId: string;
  year: number;
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

const RESTAURANT_COMMISSION_RATE = 0.15;
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
    if (Number.isFinite(num) && num > 0) {
      return num;
    }
  }
  return 0;
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

  const allowed = new Set([
    "completed",
    "delivered",
    "paid",
    "fulfilled",
    "closed",
  ]);

  return allowed.has(status);
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

  const safeFallbackAmount = pickFirstFiniteNumber(row, [
    "subtotal",
    "amount_subtotal",
    "total_amount",
    "total",
    "grand_total",
    "amount_total",
  ]);

  return roundMoney(safeFallbackAmount);
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

export function computeRestaurantTotalsFromOrders(
  rows: GenericRow[],
  restaurantUserId: string,
  year: number
): RestaurantTaxTotals {
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

  const platformCommission = roundMoney(
    grossSales * RESTAURANT_COMMISSION_RATE
  );

  const restaurantNet = roundMoney(grossSales - platformCommission);

  return {
    grossSales,
    platformCommission,
    restaurantNet,
    totalOrders: restaurantRows.length,
    year,
  };
}

export function buildRestaurantTaxStoragePath(
  restaurantUserId: string,
  year: number
): string {
  return `restaurant-tax/${restaurantUserId}/${year}/restaurant-tax-summary-${year}.pdf`;
}

export async function getRestaurantTaxSummary(params: {
  supabase: any;
  restaurantUserId: string;
  year: number;
  signedUrl?: string | null;
}): Promise<RestaurantTaxSummary> {
  const { supabase, restaurantUserId, year, signedUrl = null } = params;

  const start = `${year}-01-01T00:00:00.000Z`;
  const end = `${year + 1}-01-01T00:00:00.000Z`;

  const [
    { data: profileRow, error: profileError },
    { data: ordersData, error: ordersError },
  ] = await Promise.all([
    supabase
      .from("restaurant_profiles")
      .select(
        "user_id, restaurant_name, email, tax_id, address, city, postal_code, phone"
      )
      .eq("user_id", restaurantUserId)
      .maybeSingle(),

    // IMPORTANT:
    // on lit toutes les colonnes pour éviter l'erreur
    // "column orders.vendor_id does not exist"
    // si certains noms de colonnes changent selon ton schéma.
    supabase
      .from("orders")
      .select("*")
      .gte("created_at", start)
      .lt("created_at", end),
  ]);

  if (profileError) {
    throw new Error(
      profileError.message || "Failed to load restaurant profile"
    );
  }

  if (ordersError) {
    throw new Error(
      ordersError.message || "Failed to load restaurant orders"
    );
  }

  const profile = buildRestaurantTaxProfile(profileRow);

  const totals = computeRestaurantTotalsFromOrders(
    Array.isArray(ordersData) ? ordersData : [],
    restaurantUserId,
    year
  );

  return {
    restaurantUserId,
    year,
    generatedAt: new Date().toISOString(),
    profile,
    totals,
    file: signedUrl
      ? {
          bucket: RESTAURANT_DOCS_BUCKET,
          path: buildRestaurantTaxStoragePath(restaurantUserId, year),
          signedUrl,
        }
      : null,
  };
}