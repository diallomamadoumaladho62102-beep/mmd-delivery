/**
 * Display helpers for Admin Food Orders list (UI-only).
 * No money/payment/Stripe mutation — formatting and client-side filter/sort only.
 */

export type AdminFoodOrderParty = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
};

export type AdminFoodOrderRestaurant = {
  id: string | null;
  name: string | null;
  logo_url: string | null;
};

export type AdminFoodOrderListItem = {
  id: string;
  status: string | null;
  kind: string | null;
  payment_status: string | null;
  subtotal: number | null;
  total: number | null;
  total_cents: number | null;
  currency: string | null;
  restaurant_name: string | null;
  restaurant_id: string | null;
  restaurant_user_id: string | null;
  client_id: string | null;
  client_user_id: string | null;
  user_id: string | null;
  driver_id: string | null;
  created_at: string;
  paid_at: string | null;
  delivered_confirmed_at: string | null;
  items_json: unknown;
  distance_miles: number | null;
  eta_minutes: number | null;
  delivery_fee: number | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  promo_code_applied: string | null;
  item_count: number;
  client: AdminFoodOrderParty | null;
  driver: AdminFoodOrderParty | null;
  restaurant: AdminFoodOrderRestaurant | null;
};

export type FoodOrderSortKey =
  | "date"
  | "amount"
  | "client"
  | "restaurant"
  | "status";

export type FoodOrderSortDir = "asc" | "desc";

export type FoodOrderListFilters = {
  q: string;
  status: string;
  payment: string;
  restaurantId: string;
  clientId: string;
  driverId: string;
  kind: string;
  dateFrom: string;
  dateTo: string;
  minAmount: string;
  maxAmount: string;
  sort: FoodOrderSortKey;
  dir: FoodOrderSortDir;
};

export const DEFAULT_FOOD_ORDER_FILTERS: FoodOrderListFilters = {
  q: "",
  status: "",
  payment: "",
  restaurantId: "",
  clientId: "",
  driverId: "",
  kind: "",
  dateFrom: "",
  dateTo: "",
  minAmount: "",
  maxAmount: "",
  sort: "date",
  dir: "desc",
};

export const FOOD_ORDER_STATUS_STEPS = [
  "pending",
  "accepted",
  "prepared",
  "ready",
  "dispatched",
  "delivered",
] as const;

export function normalizeSearchText(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function countOrderItems(itemsJson: unknown): number {
  if (!Array.isArray(itemsJson)) return 0;
  return itemsJson.reduce((sum, row) => {
    if (!row || typeof row !== "object") return sum + 1;
    const qty = Number((row as { quantity?: unknown }).quantity);
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 1);
  }, 0);
}

export function orderAmountNumber(order: Pick<AdminFoodOrderListItem, "total_cents" | "total" | "subtotal">): number {
  if (order.total_cents != null && Number.isFinite(order.total_cents)) {
    return order.total_cents / 100;
  }
  const total = Number(order.total);
  if (Number.isFinite(total)) return total;
  const sub = Number(order.subtotal);
  return Number.isFinite(sub) ? sub : 0;
}

export function formatOrderMoney(
  order: Pick<AdminFoodOrderListItem, "total_cents" | "total" | "subtotal" | "currency">
): string {
  const currency = order.currency || "USD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(orderAmountNumber(order));
}

export function formatOrderDateParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "—", time: "—" };
  return {
    date: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(d),
    time: new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(d),
  };
}

export function initialsFromName(name: string | null | undefined, fallback = "?"): string {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function shortOrderId(id: string): string {
  return String(id ?? "").slice(0, 8);
}

export function summarizeAddress(address: string | null | undefined, max = 48): string | null {
  const raw = String(address ?? "").trim();
  if (!raw) return null;
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 1)}…`;
}

export type StatusBadgeTone = "green" | "yellow" | "blue" | "orange" | "red" | "slate";

export function orderStatusBadge(status: string | null | undefined): {
  label: string;
  tone: StatusBadgeTone;
} {
  const s = String(status ?? "").toLowerCase();
  switch (s) {
    case "delivered":
      return { label: "Delivered", tone: "green" };
    case "prepared":
    case "accepted":
      return { label: s === "accepted" ? "Accepted" : "Preparing", tone: "yellow" };
    case "ready":
      return { label: "Ready", tone: "blue" };
    case "dispatched":
    case "assigned":
      return { label: "On the way", tone: "orange" };
    case "canceled":
    case "cancelled":
      return { label: "Cancelled", tone: "red" };
    case "pending":
      return { label: "Pending", tone: "slate" };
    case "scheduled":
      return { label: "Scheduled", tone: "slate" };
    default:
      return { label: s || "Unknown", tone: "slate" };
  }
}

export function paymentStatusBadge(status: string | null | undefined): {
  label: string;
  tone: StatusBadgeTone;
} {
  const s = String(status ?? "").toLowerCase();
  switch (s) {
    case "paid":
    case "succeeded":
    case "complete":
    case "completed":
      return { label: "Paid", tone: "green" };
    case "pending":
    case "processing":
    case "requires_payment":
      return { label: "Pending", tone: "orange" };
    case "failed":
    case "canceled":
    case "cancelled":
      return { label: "Failed", tone: "red" };
    case "refunded":
    case "partially_refunded":
      return { label: "Refunded", tone: "slate" };
    default:
      return { label: s || "—", tone: "slate" };
  }
}

export function statusStepperIndex(status: string | null | undefined): number {
  const s = String(status ?? "").toLowerCase();
  if (s === "canceled" || s === "cancelled") return -1;
  const idx = FOOD_ORDER_STATUS_STEPS.indexOf(s as (typeof FOOD_ORDER_STATUS_STEPS)[number]);
  return idx;
}

function matchesQuery(order: AdminFoodOrderListItem, qRaw: string): boolean {
  const q = normalizeSearchText(qRaw);
  if (!q) return true;
  const haystack = [
    order.id,
    shortOrderId(order.id),
    order.restaurant_name,
    order.restaurant?.name,
    order.client?.full_name,
    order.client?.email,
    order.client?.phone,
    order.driver?.full_name,
    order.driver?.email,
    order.driver?.phone,
    order.dropoff_address,
    order.pickup_address,
    order.promo_code_applied,
  ]
    .map((v) => normalizeSearchText(String(v ?? "")))
    .join(" ");
  return haystack.includes(q);
}

export function filterFoodOrders(
  items: AdminFoodOrderListItem[],
  filters: FoodOrderListFilters
): AdminFoodOrderListItem[] {
  const minAmount = filters.minAmount.trim() === "" ? null : Number(filters.minAmount);
  const maxAmount = filters.maxAmount.trim() === "" ? null : Number(filters.maxAmount);
  const fromMs = filters.dateFrom ? Date.parse(`${filters.dateFrom}T00:00:00`) : NaN;
  const toMs = filters.dateTo ? Date.parse(`${filters.dateTo}T23:59:59.999`) : NaN;

  return items.filter((order) => {
    if (!matchesQuery(order, filters.q)) return false;
    if (filters.status && String(order.status ?? "").toLowerCase() !== filters.status.toLowerCase()) {
      return false;
    }
    if (
      filters.payment &&
      String(order.payment_status ?? "").toLowerCase() !== filters.payment.toLowerCase()
    ) {
      return false;
    }
    if (filters.kind && String(order.kind ?? "").toLowerCase() !== filters.kind.toLowerCase()) {
      return false;
    }
    if (filters.restaurantId) {
      const rid = order.restaurant?.id || order.restaurant_id || order.restaurant_user_id || "";
      if (rid !== filters.restaurantId) return false;
    }
    if (filters.clientId) {
      const cid = order.client?.id || order.client_id || order.client_user_id || order.user_id || "";
      if (cid !== filters.clientId) return false;
    }
    if (filters.driverId) {
      const did = order.driver?.id || order.driver_id || "";
      if (did !== filters.driverId) return false;
    }
    const created = Date.parse(order.created_at);
    if (Number.isFinite(fromMs) && Number.isFinite(created) && created < fromMs) return false;
    if (Number.isFinite(toMs) && Number.isFinite(created) && created > toMs) return false;

    const amount = orderAmountNumber(order);
    if (minAmount != null && Number.isFinite(minAmount) && amount < minAmount) return false;
    if (maxAmount != null && Number.isFinite(maxAmount) && amount > maxAmount) return false;
    return true;
  });
}

export function sortFoodOrders(
  items: AdminFoodOrderListItem[],
  sort: FoodOrderSortKey,
  dir: FoodOrderSortDir
): AdminFoodOrderListItem[] {
  const mul = dir === "asc" ? 1 : -1;
  const copy = [...items];
  copy.sort((a, b) => {
    let cmp = 0;
    switch (sort) {
      case "amount":
        cmp = orderAmountNumber(a) - orderAmountNumber(b);
        break;
      case "client":
        cmp = normalizeSearchText(a.client?.full_name ?? "").localeCompare(
          normalizeSearchText(b.client?.full_name ?? "")
        );
        break;
      case "restaurant":
        cmp = normalizeSearchText(a.restaurant?.name ?? a.restaurant_name ?? "").localeCompare(
          normalizeSearchText(b.restaurant?.name ?? b.restaurant_name ?? "")
        );
        break;
      case "status":
        cmp = normalizeSearchText(a.status ?? "").localeCompare(normalizeSearchText(b.status ?? ""));
        break;
      case "date":
      default:
        cmp = Date.parse(a.created_at) - Date.parse(b.created_at);
        break;
    }
    if (cmp === 0) cmp = a.id.localeCompare(b.id);
    return cmp * mul;
  });
  return copy;
}

export function parseFiltersFromSearchParams(
  params: URLSearchParams | { get(name: string): string | null }
): FoodOrderListFilters {
  const sortRaw = String(params.get("sort") ?? "date");
  const sort: FoodOrderSortKey = (
    ["date", "amount", "client", "restaurant", "status"] as const
  ).includes(sortRaw as FoodOrderSortKey)
    ? (sortRaw as FoodOrderSortKey)
    : "date";
  const dirRaw = String(params.get("dir") ?? "desc");
  const dir: FoodOrderSortDir = dirRaw === "asc" ? "asc" : "desc";

  return {
    q: String(params.get("q") ?? ""),
    status: String(params.get("status") ?? ""),
    payment: String(params.get("payment") ?? ""),
    restaurantId: String(params.get("restaurant") ?? ""),
    clientId: String(params.get("client") ?? ""),
    driverId: String(params.get("driver") ?? ""),
    kind: String(params.get("kind") ?? ""),
    dateFrom: String(params.get("from") ?? ""),
    dateTo: String(params.get("to") ?? ""),
    minAmount: String(params.get("min") ?? ""),
    maxAmount: String(params.get("max") ?? ""),
    sort,
    dir,
  };
}

export function filtersToSearchParams(filters: FoodOrderListFilters): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string, skipDefault = "") => {
    const v = value.trim();
    if (v && v !== skipDefault) params.set(key, v);
  };
  set("q", filters.q);
  set("status", filters.status);
  set("payment", filters.payment);
  set("restaurant", filters.restaurantId);
  set("client", filters.clientId);
  set("driver", filters.driverId);
  set("kind", filters.kind);
  set("from", filters.dateFrom);
  set("to", filters.dateTo);
  set("min", filters.minAmount);
  set("max", filters.maxAmount);
  if (filters.sort !== "date") params.set("sort", filters.sort);
  if (filters.dir !== "desc") params.set("dir", filters.dir);
  return params;
}
