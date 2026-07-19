import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveRestaurantCurrency } from "@/lib/resolveRestaurantCurrency";
import {
  computeRestaurantTotalsFromOrders,
  getRestaurantCommissionRate,
} from "@/lib/restaurantTax";
import {
  computeDayKpiSnapshot,
  isCompletedOrderStatus,
  isPaidFoodOrder,
  orderAmount,
  pctChange,
} from "@/lib/restaurantCommandCenterKpi";

type GenericRow = Record<string, unknown>;

const DRIVER_ARRIVED_METERS = 50;
const DRIVER_APPROACHING_METERS = 400;
const DRIVER_APPROACHING_ETA_MINUTES = 5;
const ATTENTION_READY_WAIT_MINUTES = 8;
const ATTENTION_PENDING_MINUTES = 3;
const PREP_TIME_TARGET_MINUTES = 12;

export type CommandCenterDriverCard = {
  orderId: string;
  orderLabel: string;
  driverId: string;
  driverName: string;
  driverPhotoUrl: string | null;
  driverRating: number | null;
  etaMinutes: number | null;
  distanceMeters: number | null;
  arrivedSecondsAgo: number | null;
  pickupLat: number | null;
  pickupLng: number | null;
  dropoffLat: number | null;
  dropoffLng: number | null;
};

export type CommandCenterNewOrderCard = {
  orderId: string;
  orderLabel: string;
  itemCount: number;
  totalAmount: number;
  currency: string;
  receivedSecondsAgo: number;
  acceptExpiresAt: string | null;
};

export type CommandCenterAttentionCard = {
  orderId: string;
  orderLabel: string;
  reasonKey:
    | "restaurant.commandCenter.attention.orderLate"
    | "restaurant.commandCenter.attention.clientWaiting"
    | "restaurant.commandCenter.attention.driverLate"
    | "restaurant.commandCenter.attention.readyNotPickedUp";
  reasonParams: Record<string, string | number>;
  status: string;
};

export type CommandCenterTopProduct = {
  itemId: string | null;
  name: string;
  imageUrl: string | null;
  quantitySold: number;
  revenue: number;
  currency: string;
};

export type CommandCenterMapDriver = {
  driverId: string;
  driverName: string;
  lat: number;
  lng: number;
  status: "arrived" | "approaching" | "en_route";
  orderId: string;
  orderLabel: string;
  etaMinutes: number | null;
};

export type CommandCenterMapCustomer = {
  orderId: string;
  orderLabel: string;
  lat: number;
  lng: number;
};

export type CommandCenterData = {
  generatedAt: string;
  restaurant: {
    userId: string;
    name: string;
    isOpen: boolean;
    lat: number | null;
    lng: number | null;
    currency: string;
  };
  kpis: {
    revenueToday: number;
    revenueYesterday: number;
    revenueChangePct: number | null;
    ordersToday: number;
    ordersYesterday: number;
    ordersChangePct: number | null;
    customersToday: number;
    customersYesterday: number;
    customersChangePct: number | null;
    averageBasket: number | null;
    averageBasketYesterday: number | null;
    averageBasketChangePct: number | null;
    rating: number | null;
    ratingCount: number;
    currency: string;
  };
  liveOperations: {
    driverArrived: CommandCenterDriverCard[];
    driverApproaching: CommandCenterDriverCard[];
    driverEnRoute: CommandCenterDriverCard[];
    newOrders: CommandCenterNewOrderCard[];
    attentionRequired: CommandCenterAttentionCard[];
  };
  map: {
    drivers: CommandCenterMapDriver[];
    customers: CommandCenterMapCustomer[];
  };
  orderStatusBreakdown: Array<{ status: string; count: number; pct: number }>;
  prepTime: {
    averageMinutes: number | null;
    targetMinutes: number;
    percentileBetterThan: number | null;
  };
  topProducts: CommandCenterTopProduct[];
  financial: {
    currency: string;
    grossSalesMonth: number;
    platformCommissionMonth: number;
    netRevenueMonth: number;
    mmdImpactRevenue: number;
    newClientsMonth: number;
    loyalClientsPct: number | null;
    repeatOrdersPct: number | null;
    monthGrowthPct: number | null;
  };
};

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function startOfLocalDayUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function orderLabel(orderId: string): string {
  const compact = String(orderId ?? "").replace(/-/g, "").slice(0, 8).toUpperCase();
  return compact ? `#${compact}` : "#—";
}

function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isDriverApproaching(params: {
  distanceMeters: number | null;
  etaMinutes: number | null;
}): boolean {
  const { distanceMeters, etaMinutes } = params;
  if (etaMinutes != null && etaMinutes > 0 && etaMinutes <= DRIVER_APPROACHING_ETA_MINUTES) {
    return true;
  }
  return (
    distanceMeters != null &&
    distanceMeters > DRIVER_ARRIVED_METERS &&
    distanceMeters <= DRIVER_APPROACHING_METERS
  );
}

function isRestaurantOrder(row: GenericRow, restaurantUserId: string): boolean {
  return (
    String(row.restaurant_id ?? "") === restaurantUserId ||
    String(row.restaurant_user_id ?? "") === restaurantUserId
  );
}

function parseItemsJson(value: unknown): Array<{ name?: string; quantity?: number; qty?: number }> {
  if (!Array.isArray(value)) return [];
  return value as Array<{ name?: string; quantity?: number; qty?: number }>;
}

function itemCountFromOrder(row: GenericRow): number {
  const items = parseItemsJson(row.items_json);
  if (!items.length) return 0;
  return items.reduce((sum, item) => sum + asNumber(item.quantity ?? item.qty ?? 1), 0);
}

function secondsAgo(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.now() - new Date(iso).getTime();
  return ms > 0 ? Math.floor(ms / 1000) : 0;
}

function minutesAgo(iso: string | null | undefined): number {
  return Math.floor(secondsAgo(iso) / 60);
}

export async function getRestaurantCommandCenter(params: {
  supabase: SupabaseClient;
  restaurantUserId: string;
}): Promise<CommandCenterData> {
  const { supabase, restaurantUserId } = params;
  const now = new Date();
  const todayStart = startOfLocalDayUtc(now);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const prevMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const prevMonthEnd = new Date(monthStart);

  const [
    profileRes,
    todayOrdersRes,
    yesterdayOrdersRes,
    monthOrdersRes,
    prevMonthOrdersRes,
    activeOrdersRes,
    driverLocationsRes,
    ratingsRes,
    allTimeClientsRes,
  ] = await Promise.all([
    supabase
      .from("restaurant_profiles")
      .select(
        "restaurant_name,is_accepting_orders,location_lat,location_lng,lat,lng"
      )
      .eq("user_id", restaurantUserId)
      .maybeSingle(),
    supabase
      .from("orders")
      .select(
        "id,status,kind,payment_status,total,subtotal,tax,currency,created_at,client_id,client_user_id,items_json,ready_at,restaurant_prepared_at,paid_at,restaurant_accept_expires_at,driver_id,eta_minutes,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng"
      )
      .eq("kind", "food")
      .eq("restaurant_id", restaurantUserId)
      .eq("payment_status", "paid")
      .gte("created_at", todayStart.toISOString()),
    supabase
      .from("orders")
      .select(
        "id,status,kind,payment_status,total,subtotal,tax,currency,created_at,client_id,client_user_id"
      )
      .eq("kind", "food")
      .eq("restaurant_id", restaurantUserId)
      .eq("payment_status", "paid")
      .gte("created_at", yesterdayStart.toISOString())
      .lt("created_at", todayStart.toISOString()),
    supabase
      .from("orders")
      .select(
        "id,status,payment_status,total,subtotal,tax,currency,created_at,client_id,client_user_id,restaurant_prepared_at,paid_at,ready_at,items_json,restaurant_net_amount"
      )
      .eq("kind", "food")
      .eq("restaurant_id", restaurantUserId)
      .gte("created_at", monthStart.toISOString()),
    supabase
      .from("orders")
      .select("id,status,payment_status,total,subtotal,tax,currency,created_at,client_id,client_user_id")
      .eq("kind", "food")
      .eq("restaurant_id", restaurantUserId)
      .gte("created_at", prevMonthStart.toISOString())
      .lt("created_at", prevMonthEnd.toISOString()),
    supabase
      .from("orders")
      .select(
        "id,status,kind,payment_status,total,subtotal,tax,currency,created_at,client_id,client_user_id,items_json,ready_at,restaurant_prepared_at,paid_at,restaurant_accept_expires_at,driver_id,eta_minutes,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng"
      )
      .eq("kind", "food")
      .eq("restaurant_id", restaurantUserId)
      .in("status", ["pending", "accepted", "prepared", "ready", "dispatched"])
      .eq("payment_status", "paid")
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("driver_locations")
      .select("driver_id,lat,lng,updated_at")
      .gte("updated_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .limit(50),
    supabase
      .from("orders")
      .select("id")
      .eq("kind", "food")
      .eq("restaurant_id", restaurantUserId)
      .in("status", ["delivered", "completed"])
      .limit(500),
    supabase
      .from("orders")
      .select("client_id,client_user_id,created_at")
      .eq("kind", "food")
      .eq("restaurant_id", restaurantUserId)
      .eq("payment_status", "paid")
      .in("status", ["delivered", "completed"]),
  ]);

  if (profileRes.error) {
    throw new Error(profileRes.error.message || "Failed to load restaurant profile");
  }

  const profile = (profileRes.data ?? {}) as GenericRow;
  const restaurantLat =
    asNumber(profile.location_lat) || asNumber(profile.lat) || null;
  const restaurantLng =
    asNumber(profile.location_lng) || asNumber(profile.lng) || null;

  const todayRows = ((todayOrdersRes.data ?? []) as GenericRow[]).filter((row) =>
    isRestaurantOrder(row, restaurantUserId)
  );
  const yesterdayRows = ((yesterdayOrdersRes.data ?? []) as GenericRow[]).filter((row) =>
    isRestaurantOrder(row, restaurantUserId)
  );
  const monthRows = ((monthOrdersRes.data ?? []) as GenericRow[]).filter((row) =>
    isRestaurantOrder(row, restaurantUserId)
  );
  const prevMonthRows = ((prevMonthOrdersRes.data ?? []) as GenericRow[]).filter((row) =>
    isRestaurantOrder(row, restaurantUserId)
  );
  const activeRows = ((activeOrdersRes.data ?? []) as GenericRow[]).filter((row) =>
    isRestaurantOrder(row, restaurantUserId)
  );

  const currency = resolveRestaurantCurrency({
    profile,
    orderRows: [
      ...todayRows,
      ...yesterdayRows,
      ...monthRows,
      ...prevMonthRows,
      ...activeRows,
    ],
  });

  const dayKpis = computeDayKpiSnapshot({
    todayRows,
    yesterdayRows,
  });

  let ratingValues: number[] = [];
  const deliveredOrderIds = ((ratingsRes.data ?? []) as GenericRow[])
    .map((row) => String(row.id ?? "").trim())
    .filter(Boolean);

  if (deliveredOrderIds.length > 0) {
    const { data: ratingRows, error: ratingError } = await supabase
      .from("order_ratings")
      .select("rating, order_id")
      .in("order_id", deliveredOrderIds.slice(0, 200));

    if (!ratingError) {
      ratingValues = ((ratingRows ?? []) as GenericRow[])
        .map((row) => asNumber(row.rating))
        .filter((value) => value > 0);
    }
  }

  const rating =
    ratingValues.length > 0
      ? Math.round((ratingValues.reduce((a, b) => a + b, 0) / ratingValues.length) * 10) / 10
      : null;

  const driverLocations = ((driverLocationsRes.data ?? []) as GenericRow[]).filter(
    (row) => Number.isFinite(asNumber(row.lat)) && Number.isFinite(asNumber(row.lng))
  );

  const driverIds = Array.from(
    new Set(
      activeRows
        .map((row) => String(row.driver_id ?? "").trim())
        .filter(Boolean)
    )
  );

  const driverProfilesRes =
    driverIds.length > 0
      ? await supabase
          .from("driver_profiles")
          .select("user_id,full_name,photo_url,rating")
          .in("user_id", driverIds)
      : { data: [], error: null };

  const driverProfileMap = new Map<string, GenericRow>();
  for (const row of (driverProfilesRes.data ?? []) as GenericRow[]) {
    driverProfileMap.set(String(row.user_id ?? ""), row);
  }

  const driverLocationMap = new Map<string, GenericRow>();
  for (const row of driverLocations) {
    driverLocationMap.set(String(row.driver_id ?? ""), row);
  }

  const buildDriverCard = (row: GenericRow): CommandCenterDriverCard | null => {
    const driverId = String(row.driver_id ?? "").trim();
    if (!driverId) return null;

    const profileRow = driverProfileMap.get(driverId);
    const location = driverLocationMap.get(driverId);
    const pickupLat = asNumber(row.pickup_lat);
    const pickupLng = asNumber(row.pickup_lng);
    const hasPickupCoordinate =
      Number.isFinite(pickupLat) &&
      Number.isFinite(pickupLng) &&
      pickupLat !== 0 &&
      pickupLng !== 0;

    let distanceM: number | null = null;
    const rawEta = asNumber(row.eta_minutes);
    const etaMinutes = rawEta > 0 ? rawEta : null;
    let arrivedSecondsAgo: number | null = null;

    if (
      location &&
      hasPickupCoordinate &&
      Number.isFinite(asNumber(location.lat)) &&
      Number.isFinite(asNumber(location.lng))
    ) {
      distanceM = distanceMeters(
        asNumber(location.lat),
        asNumber(location.lng),
        pickupLat,
        pickupLng
      );
      if (distanceM <= DRIVER_ARRIVED_METERS) {
        arrivedSecondsAgo = secondsAgo(String(location.updated_at ?? ""));
      }
    }

    return {
      orderId: String(row.id ?? ""),
      orderLabel: orderLabel(String(row.id ?? "")),
      driverId,
      driverName:
        String(profileRow?.full_name ?? "").trim() ||
        String(profileRow?.user_id ?? driverId).slice(0, 8),
      driverPhotoUrl: String(profileRow?.photo_url ?? "").trim() || null,
      driverRating: asNumber(profileRow?.rating) || null,
      etaMinutes,
      distanceMeters: distanceM,
      arrivedSecondsAgo,
      pickupLat: hasPickupCoordinate ? pickupLat : null,
      pickupLng: hasPickupCoordinate ? pickupLng : null,
      dropoffLat: asNumber(row.dropoff_lat) || null,
      dropoffLng: asNumber(row.dropoff_lng) || null,
    };
  };

  const driverArrived: CommandCenterDriverCard[] = [];
  const driverApproaching: CommandCenterDriverCard[] = [];
  const driverEnRoute: CommandCenterDriverCard[] = [];
  const mapDrivers: CommandCenterMapDriver[] = [];

  for (const row of activeRows) {
    const status = String(row.status ?? "").toLowerCase();
    if (!row.driver_id || !["ready", "dispatched"].includes(status)) continue;

    const card = buildDriverCard(row);
    if (!card) continue;

    if (card.distanceMeters != null && card.distanceMeters <= DRIVER_ARRIVED_METERS) {
      driverArrived.push(card);
      mapDrivers.push({
        driverId: card.driverId,
        driverName: card.driverName,
        lat: asNumber(driverLocationMap.get(card.driverId)?.lat),
        lng: asNumber(driverLocationMap.get(card.driverId)?.lng),
        status: "arrived",
        orderId: card.orderId,
        orderLabel: card.orderLabel,
        etaMinutes: card.etaMinutes,
      });
    } else if (isDriverApproaching({
      distanceMeters: card.distanceMeters,
      etaMinutes: card.etaMinutes,
    })) {
      driverApproaching.push(card);
      mapDrivers.push({
        driverId: card.driverId,
        driverName: card.driverName,
        lat: asNumber(driverLocationMap.get(card.driverId)?.lat),
        lng: asNumber(driverLocationMap.get(card.driverId)?.lng),
        status: "approaching",
        orderId: card.orderId,
        orderLabel: card.orderLabel,
        etaMinutes: card.etaMinutes,
      });
    } else {
      driverEnRoute.push(card);
      mapDrivers.push({
        driverId: card.driverId,
        driverName: card.driverName,
        lat: asNumber(driverLocationMap.get(card.driverId)?.lat),
        lng: asNumber(driverLocationMap.get(card.driverId)?.lng),
        status: "en_route",
        orderId: card.orderId,
        orderLabel: card.orderLabel,
        etaMinutes: card.etaMinutes,
      });
    }
  }

  const newOrders: CommandCenterNewOrderCard[] = activeRows
    .filter((row) => String(row.status ?? "").toLowerCase() === "pending")
    .map((row) => ({
      orderId: String(row.id ?? ""),
      orderLabel: orderLabel(String(row.id ?? "")),
      itemCount: itemCountFromOrder(row),
      totalAmount: orderAmount(row),
      currency: String(row.currency ?? currency).toUpperCase(),
      receivedSecondsAgo: secondsAgo(String(row.created_at ?? "")),
      acceptExpiresAt: String(row.restaurant_accept_expires_at ?? "") || null,
    }));

  const attentionRequired: CommandCenterAttentionCard[] = [];

  for (const row of activeRows) {
    const status = String(row.status ?? "").toLowerCase();
    const orderId = String(row.id ?? "");
    const label = orderLabel(orderId);

    if (status === "pending" && minutesAgo(String(row.created_at ?? "")) >= ATTENTION_PENDING_MINUTES) {
      attentionRequired.push({
        orderId,
        orderLabel: label,
        reasonKey: "restaurant.commandCenter.attention.orderLate",
        reasonParams: { minutes: minutesAgo(String(row.created_at ?? "")) },
        status,
      });
      continue;
    }

    if (
      status === "ready" &&
      minutesAgo(String(row.ready_at ?? row.created_at ?? "")) >= ATTENTION_READY_WAIT_MINUTES
    ) {
      attentionRequired.push({
        orderId,
        orderLabel: label,
        reasonKey: row.driver_id
          ? "restaurant.commandCenter.attention.readyNotPickedUp"
          : "restaurant.commandCenter.attention.clientWaiting",
        reasonParams: {
          minutes: minutesAgo(String(row.ready_at ?? row.created_at ?? "")),
        },
        status,
      });
      continue;
    }

    if (
      status === "dispatched" &&
      row.driver_id &&
      minutesAgo(String(row.ready_at ?? row.created_at ?? "")) >= ATTENTION_READY_WAIT_MINUTES
    ) {
      const card = buildDriverCard(row);
      if (card?.distanceMeters != null && card.distanceMeters > DRIVER_ARRIVED_METERS) {
        attentionRequired.push({
          orderId,
          orderLabel: label,
          reasonKey: "restaurant.commandCenter.attention.driverLate",
          reasonParams: {
            minutes: minutesAgo(String(row.ready_at ?? row.created_at ?? "")),
          },
          status,
        });
      }
    }
  }

  const mapCustomers: CommandCenterMapCustomer[] = activeRows
    .filter((row) => {
      const lat = asNumber(row.dropoff_lat);
      const lng = asNumber(row.dropoff_lng);
      return lat && lng;
    })
    .slice(0, 12)
    .map((row) => ({
      orderId: String(row.id ?? ""),
      orderLabel: orderLabel(String(row.id ?? "")),
      lat: asNumber(row.dropoff_lat),
      lng: asNumber(row.dropoff_lng),
    }));

  const todayPaidRows = todayRows.filter(isPaidFoodOrder);
  const statusCounts = new Map<string, number>();
  for (const row of todayPaidRows) {
    const status = String(row.status ?? "unknown").toLowerCase();
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }
  const totalTodayForBreakdown = Math.max(todayPaidRows.length, 1);
  const orderStatusBreakdown = Array.from(statusCounts.entries()).map(([status, count]) => ({
    status,
    count,
    pct: Math.round((count / totalTodayForBreakdown) * 1000) / 10,
  }));

  const prepDurations = todayPaidRows
    .filter((row) => isCompletedOrderStatus(row.status))
    .map((row) => {
      const accepted = String(
        row.accepted_at ?? row.restaurant_prepared_at ?? row.paid_at ?? "",
      );
      const ready = String(row.ready_at ?? "");
      if (!accepted || !ready) return null;
      const ms = new Date(ready).getTime() - new Date(accepted).getTime();
      return ms > 0 ? ms / 60000 : null;
    })
    .filter((value): value is number => value != null && Number.isFinite(value));

  const prepAverageMinutes =
    prepDurations.length > 0
      ? Math.round(
          (prepDurations.reduce((a, b) => a + b, 0) / prepDurations.length) * 10
        ) / 10
      : null;

  const productMap = new Map<
    string,
    { name: string; quantity: number; revenue: number; imageUrl: string | null; itemId: string | null }
  >();

  for (const row of monthRows) {
    const status = String(row.status ?? "").toLowerCase();
    if (!["delivered", "completed"].includes(status)) continue;
    const items = parseItemsJson(row.items_json);
    for (const item of items) {
      const name = String(item.name ?? "").trim() || "item";
      const qty = asNumber(item.quantity ?? item.qty ?? 1);
      const key = name.toLowerCase();
      const existing = productMap.get(key) ?? {
        name,
        quantity: 0,
        revenue: 0,
        imageUrl: null,
        itemId: null,
      };
      existing.quantity += qty;
      existing.revenue += orderAmount(row) * (qty / Math.max(itemCountFromOrder(row), 1));
      productMap.set(key, existing);
    }
  }

  const topProducts: CommandCenterTopProduct[] = Array.from(productMap.values())
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 5)
    .map((item) => ({
      itemId: item.itemId,
      name: item.name,
      imageUrl: item.imageUrl,
      quantitySold: item.quantity,
      revenue: Math.round(item.revenue * 100) / 100,
      currency,
    }));

  const commissionRate = await getRestaurantCommissionRate(supabase);
  const monthTotals = computeRestaurantTotalsFromOrders({
    rows: monthRows.filter((row) => String(row.payment_status ?? "") === "paid"),
    restaurantUserId,
    year: now.getUTCFullYear(),
    range: "yearly",
    commissionRate,
  });
  const prevMonthTotals = computeRestaurantTotalsFromOrders({
    rows: prevMonthRows.filter((row) => String(row.payment_status ?? "") === "paid"),
    restaurantUserId,
    year: prevMonthStart.getUTCFullYear(),
    range: "yearly",
    commissionRate,
  });

  const clientFirstOrder = new Map<string, string>();
  for (const row of (allTimeClientsRes.data ?? []) as GenericRow[]) {
    const clientId = String(row.client_id ?? row.client_user_id ?? "").trim();
    if (!clientId) continue;
    const created = String(row.created_at ?? "");
    const existing = clientFirstOrder.get(clientId);
    if (!existing || created < existing) {
      clientFirstOrder.set(clientId, created);
    }
  }

  const monthClientCounts = new Map<string, number>();
  for (const row of monthRows) {
    const clientId = String(row.client_id ?? row.client_user_id ?? "").trim();
    if (!clientId) continue;
    monthClientCounts.set(clientId, (monthClientCounts.get(clientId) ?? 0) + 1);
  }

  let newClientsMonth = 0;
  let loyalClients = 0;
  let repeatOrders = 0;
  for (const [clientId, count] of monthClientCounts.entries()) {
    const first = clientFirstOrder.get(clientId) ?? "";
    if (first >= monthStart.toISOString()) newClientsMonth += 1;
    if (count >= 2) {
      loyalClients += 1;
      repeatOrders += count - 1;
    }
  }

  const totalMonthOrders = monthRows.filter((row) =>
    ["delivered", "completed"].includes(String(row.status ?? "").toLowerCase())
  ).length;
  const loyalClientsPct =
    monthClientCounts.size > 0
      ? Math.round((loyalClients / monthClientCounts.size) * 1000) / 10
      : null;
  const repeatOrdersPct =
    totalMonthOrders > 0
      ? Math.round((repeatOrders / totalMonthOrders) * 1000) / 10
      : null;

  const mmdImpactRevenue = Math.max(
    0,
    Math.round((monthTotals.restaurantNet - prevMonthTotals.restaurantNet) * 100) / 100
  );

  return {
    generatedAt: now.toISOString(),
    restaurant: {
      userId: restaurantUserId,
      name: String(profile.restaurant_name ?? "").trim() || "Restaurant",
      isOpen: profile.is_accepting_orders === true,
      lat: restaurantLat,
      lng: restaurantLng,
      currency,
    },
    kpis: {
      revenueToday: dayKpis.revenueToday,
      revenueYesterday: dayKpis.revenueYesterday,
      revenueChangePct: dayKpis.revenueChangePct,
      ordersToday: dayKpis.ordersToday,
      ordersYesterday: dayKpis.ordersYesterday,
      ordersChangePct: dayKpis.ordersChangePct,
      customersToday: dayKpis.customersToday,
      customersYesterday: dayKpis.customersYesterday,
      customersChangePct: dayKpis.customersChangePct,
      averageBasket: dayKpis.averageBasket,
      averageBasketYesterday: dayKpis.averageBasketYesterday,
      averageBasketChangePct: dayKpis.averageBasketChangePct,
      rating,
      ratingCount: ratingValues.length,
      currency,
    },
    liveOperations: {
      driverArrived,
      driverApproaching,
      driverEnRoute,
      newOrders,
      attentionRequired,
    },
    map: {
      drivers: mapDrivers.filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lng)),
      customers: mapCustomers,
    },
    orderStatusBreakdown,
    prepTime: {
      averageMinutes: prepAverageMinutes,
      targetMinutes: PREP_TIME_TARGET_MINUTES,
      percentileBetterThan: null,
    },
    topProducts,
    financial: {
      currency,
      grossSalesMonth: monthTotals.grossSales,
      platformCommissionMonth: monthTotals.platformCommission,
      netRevenueMonth: monthTotals.restaurantNet,
      mmdImpactRevenue,
      newClientsMonth,
      loyalClientsPct,
      repeatOrdersPct,
      monthGrowthPct: pctChange(monthTotals.grossSales, prevMonthTotals.grossSales),
    },
  };
}
