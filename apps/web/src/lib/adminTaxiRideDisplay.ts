/**
 * Display helpers for Admin Taxi Operations Center (UI-only).
 * No fare/dispatch/payment/Stripe mutation — formatting and client-side filter/sort only.
 */

import {
  normalizeSearchText,
  partyDisplayName,
  paymentStatusBadge,
  shortOrderId,
  summarizeAddress,
  type AdminFoodOrderParty,
  type StatusBadgeTone,
} from "@/lib/adminFoodOrderDisplay";

export type { AdminFoodOrderParty, StatusBadgeTone };
export {
  normalizeSearchText,
  partyDisplayName,
  paymentStatusBadge,
  summarizeAddress,
};

export type AdminTaxiRideVehicle = {
  id: string | null;
  photo_url: string | null;
  vehicle_type: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  plate: string | null;
};

export type AdminTaxiRideListItem = {
  id: string;
  status: string | null;
  vehicle_class: string | null;
  payment_status: string | null;
  refund_status: string | null;
  total_cents: number | null;
  currency: string | null;
  client_user_id: string | null;
  driver_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_city: string | null;
  distance_miles: number | null;
  duration_minutes: number | null;
  next_ride_eta_minutes: number | null;
  created_at: string;
  completed_at: string | null;
  accepted_at: string | null;
  driver_arrived_at: string | null;
  started_at: string | null;
  updated_at: string | null;
  driver_is_online: boolean | null;
  client: AdminFoodOrderParty | null;
  driver: AdminFoodOrderParty | null;
  vehicle: AdminTaxiRideVehicle | null;
};

export type TaxiRideUiBucket =
  | "payment_failed"
  | "refund_pending"
  | "searching"
  | "assigned"
  | "arriving"
  | "on_board"
  | "completed"
  | "canceled"
  | "other";

export type TaxiRideListFilters = {
  q: string;
  status: string;
  payment: string;
  vehicle: string;
  city: string;
  online: string;
  dateFrom: string;
  clientId: string;
  driverId: string;
};

export const DEFAULT_TAXI_RIDE_FILTERS: TaxiRideListFilters = {
  q: "",
  status: "",
  payment: "",
  vehicle: "",
  city: "",
  online: "",
  dateFrom: "",
  clientId: "",
  driverId: "",
};

export const TAXI_RIDE_STATUS_STEPS = [
  "created",
  "searching",
  "accepted",
  "en_route",
  "picked_up",
  "destination",
  "completed",
] as const;

export function shortRideId(id: string): string {
  return shortOrderId(id);
}

export function formatRideMoney(
  cents: number | null | undefined,
  currency = "USD"
): string {
  if (cents == null || !Number.isFinite(Number(cents))) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
  }).format(Number(cents) / 100);
}

export function formatRideDateParts(iso: string | null | undefined): {
  date: string;
  time: string;
} {
  const d = new Date(String(iso ?? ""));
  if (Number.isNaN(d.getTime())) return { date: "—", time: "—" };
  return {
    date: new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(d),
    time: new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(d),
  };
}

export function normalizeTaxiRideStatus(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/** Map DB status → ops display bucket. */
export function taxiRideUiBucket(row: Pick<
  AdminTaxiRideListItem,
  "status" | "payment_status" | "refund_status"
>): TaxiRideUiBucket {
  const status = normalizeTaxiRideStatus(row.status);
  const payment = normalizeTaxiRideStatus(row.payment_status);
  const refund = normalizeTaxiRideStatus(row.refund_status);

  // Intervention first (even if also searching / in progress).
  if (payment === "failed") return "payment_failed";
  if (refund === "pending" || refund === "processing" || refund === "failed") {
    return "refund_pending";
  }
  if (status === "canceled" || status === "cancelled") return "canceled";
  if (status === "completed") return "completed";
  if (status === "in_progress") return "on_board";
  if (status === "driver_arrived") return "arriving";
  if (status === "accepted") return "assigned";
  if (
    status === "dispatching" ||
    status === "paid" ||
    status === "pending_payment" ||
    status === "quoted" ||
    status === "draft" ||
    status === "scheduled" ||
    status === "queued"
  ) {
    return "searching";
  }
  return "other";
}

/**
 * Lower score = more urgent.
 * payment failed → refund pending → searching/dispatch → assigned → arriving → on board → completed → canceled
 */
export function getTaxiRideOpsPriorityScore(row: Pick<
  AdminTaxiRideListItem,
  "status" | "payment_status" | "refund_status"
>): number {
  switch (taxiRideUiBucket(row)) {
    case "payment_failed":
      return 0;
    case "refund_pending":
      return 1;
    case "searching":
      return 2;
    case "assigned":
      return 3;
    case "arriving":
      return 4;
    case "on_board":
      return 5;
    case "completed":
      return 6;
    case "canceled":
      return 7;
    default:
      return 8;
  }
}

export function sortTaxiRidesOps(items: AdminTaxiRideListItem[]): AdminTaxiRideListItem[] {
  return [...items].sort((a, b) => {
    const pa = getTaxiRideOpsPriorityScore(a);
    const pb = getTaxiRideOpsPriorityScore(b);
    if (pa !== pb) return pa - pb;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  });
}

export type TaxiBadgeTone = StatusBadgeTone | "purple";

export function rideStatusBadge(status: string | null | undefined): {
  label: string;
  tone: TaxiBadgeTone;
} {
  const s = normalizeTaxiRideStatus(status);
  switch (s) {
    case "completed":
      return { label: "Completed", tone: "green" };
    case "accepted":
      return { label: "Driver Assigned", tone: "yellow" };
    case "driver_arrived":
      return { label: "Driver Arriving", tone: "blue" };
    case "in_progress":
      return { label: "Passenger On Board", tone: "purple" };
    case "dispatching":
    case "paid":
    case "pending_payment":
    case "quoted":
    case "draft":
    case "scheduled":
    case "queued":
      return { label: "Searching Driver", tone: "orange" };
    case "canceled":
    case "cancelled":
      return { label: "Cancelled", tone: "red" };
    default:
      return { label: s || "Unknown", tone: "slate" };
  }
}

export function driverOnlineBadge(isOnline: boolean | null | undefined): {
  label: string;
  tone: TaxiBadgeTone;
} | null {
  if (isOnline == null) return null;
  return isOnline
    ? { label: "Online", tone: "green" }
    : { label: "Offline", tone: "slate" };
}

export function isTaxiRideActive(
  row: Pick<AdminTaxiRideListItem, "status" | "payment_status" | "refund_status">
): boolean {
  const status = normalizeTaxiRideStatus(row.status);
  if (status === "completed" || status === "canceled" || status === "cancelled") {
    return false;
  }
  const bucket = taxiRideUiBucket(row);
  return (
    bucket === "payment_failed" ||
    bucket === "refund_pending" ||
    bucket === "searching" ||
    bucket === "assigned" ||
    bucket === "arriving" ||
    bucket === "on_board" ||
    bucket === "other"
  );
}

export type TaxiRideActionKey =
  | "view"
  | "timeline"
  | "driver"
  | "customer"
  | "receipt"
  | "live_map";

export type TaxiRideUiAction = {
  key: TaxiRideActionKey;
  label: string;
  href: string;
};

export function rideStatusActions(row: Pick<
  AdminTaxiRideListItem,
  "id" | "status" | "client_user_id" | "driver_id" | "client" | "driver"
>): TaxiRideUiAction[] {
  const status = normalizeTaxiRideStatus(row.status);
  const clientId = row.client?.id || row.client_user_id || "";
  const driverId = row.driver?.id || row.driver_id || "";
  const detail = `/admin/taxi-rides/${row.id}`;
  const timeline = `${detail}#timeline`;

  const customer = clientId
    ? {
        key: "customer" as const,
        label: "Customer Profile",
        href: `/admin/clients?q=${encodeURIComponent(clientId)}`,
      }
    : null;
  const driver = driverId
    ? {
        key: "driver" as const,
        label: "Driver Profile",
        href: `/admin/drivers?q=${encodeURIComponent(driverId)}`,
      }
    : null;

  if (status === "completed") {
    return [
      { key: "receipt", label: "Receipt", href: `/taxi/receipt/${row.id}` },
      { key: "timeline", label: "Timeline", href: timeline },
      ...(driver ? [driver] : []),
      ...(customer ? [customer] : []),
    ];
  }

  if (status === "canceled" || status === "cancelled") {
    return [
      { key: "timeline", label: "Timeline", href: timeline },
      ...(driver ? [driver] : []),
      ...(customer ? [customer] : []),
    ];
  }

  return [
    { key: "view", label: "View Details", href: detail },
    { key: "timeline", label: "Timeline", href: timeline },
    ...(driver ? [driver] : []),
    ...(customer ? [customer] : []),
    { key: "live_map", label: "Live Map", href: "/admin/live-map" },
  ];
}

/**
 * Stepper index for read-only lifecycle.
 * -1 = cancelled branch.
 */
export function taxiRideStepperIndex(row: Pick<
  AdminTaxiRideListItem,
  "status" | "accepted_at" | "driver_arrived_at" | "started_at" | "completed_at"
>): number {
  const status = normalizeTaxiRideStatus(row.status);
  if (status === "canceled" || status === "cancelled") return -1;
  if (status === "completed" || row.completed_at) return 6;
  if (status === "in_progress" || row.started_at) return 4;
  if (status === "driver_arrived" || row.driver_arrived_at) return 3;
  if (status === "accepted" || row.accepted_at) return 2;
  if (
    status === "dispatching" ||
    status === "paid" ||
    status === "pending_payment" ||
    status === "quoted" ||
    status === "scheduled" ||
    status === "queued"
  ) {
    return 1;
  }
  return 0;
}

export function lastRideUpdateAt(row: Pick<
  AdminTaxiRideListItem,
  | "updated_at"
  | "completed_at"
  | "started_at"
  | "driver_arrived_at"
  | "accepted_at"
  | "created_at"
>): string | null {
  const candidates = [
    row.updated_at,
    row.completed_at,
    row.started_at,
    row.driver_arrived_at,
    row.accepted_at,
    row.created_at,
  ];
  for (const c of candidates) {
    if (c && Number.isFinite(Date.parse(c))) return c;
  }
  return null;
}

function isSameLocalDay(iso: string | null | undefined, now = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Display-only sum of persisted total_cents for completed rides today. */
export function revenueTodayCents(
  items: AdminTaxiRideListItem[],
  now = new Date()
): number {
  let sum = 0;
  for (const row of items) {
    if (normalizeTaxiRideStatus(row.status) !== "completed") continue;
    if (!isSameLocalDay(row.completed_at ?? row.created_at, now)) continue;
    if (row.total_cents != null && Number.isFinite(row.total_cents)) {
      sum += Number(row.total_cents);
    }
  }
  return sum;
}

export function computeTaxiRideKpis(items: AdminTaxiRideListItem[]) {
  const count = (pred: (r: AdminTaxiRideListItem) => boolean) =>
    items.filter(pred).length;
  return {
    total: items.length,
    active: count((r) => isTaxiRideActive(r)),
    searching: count((r) => taxiRideUiBucket(r) === "searching"),
    onBoard: count((r) => taxiRideUiBucket(r) === "on_board"),
    completed: count((r) => normalizeTaxiRideStatus(r.status) === "completed"),
    canceled: count((r) => {
      const s = normalizeTaxiRideStatus(r.status);
      return s === "canceled" || s === "cancelled";
    }),
    revenueTodayCents: revenueTodayCents(items),
  };
}

export function filterTaxiRides(
  items: AdminTaxiRideListItem[],
  filters: TaxiRideListFilters
): AdminTaxiRideListItem[] {
  const q = normalizeSearchText(filters.q);
  const fromMs = filters.dateFrom ? Date.parse(`${filters.dateFrom}T00:00:00`) : NaN;

  return items.filter((row) => {
    if (filters.status) {
      const want = filters.status.toLowerCase();
      // UI filter groups: searching maps to several DB statuses
      if (want === "searching") {
        if (taxiRideUiBucket(row) !== "searching") return false;
      } else if (normalizeTaxiRideStatus(row.status) !== want) {
        return false;
      }
    }
    if (
      filters.payment &&
      normalizeTaxiRideStatus(row.payment_status) !== filters.payment.toLowerCase()
    ) {
      return false;
    }
    if (
      filters.vehicle &&
      String(row.vehicle_class ?? "").toLowerCase() !== filters.vehicle.toLowerCase()
    ) {
      return false;
    }
    if (
      filters.city &&
      normalizeSearchText(row.pickup_city ?? "") !== normalizeSearchText(filters.city)
    ) {
      return false;
    }
    if (filters.online === "online" && row.driver_is_online !== true) return false;
    if (filters.online === "offline" && row.driver_is_online !== false) return false;
    if (filters.clientId) {
      const cid = row.client?.id || row.client_user_id || "";
      if (cid !== filters.clientId) return false;
    }
    if (filters.driverId) {
      const did = row.driver?.id || row.driver_id || "";
      if (did !== filters.driverId) return false;
    }
    if (Number.isFinite(fromMs)) {
      const created = Date.parse(row.created_at);
      if (Number.isFinite(created) && created < fromMs) return false;
    }
    if (!q) return true;
    const hay = [
      row.id,
      shortRideId(row.id),
      row.client?.full_name,
      row.client?.email,
      row.client?.phone,
      row.driver?.full_name,
      row.driver?.email,
      row.driver?.phone,
      row.vehicle?.plate,
      row.pickup_address,
      row.dropoff_address,
      row.pickup_city,
      row.vehicle_class,
      row.status,
    ]
      .map((v) => normalizeSearchText(String(v ?? "")))
      .join(" ");
    return hay.includes(q);
  });
}

export function parseTaxiRideFiltersFromSearchParams(
  params: URLSearchParams | { get(name: string): string | null }
): TaxiRideListFilters {
  return {
    q: String(params.get("q") ?? ""),
    status: String(params.get("status") ?? ""),
    payment: String(params.get("payment") ?? ""),
    vehicle: String(params.get("vehicle") ?? ""),
    city: String(params.get("city") ?? ""),
    online: String(params.get("online") ?? ""),
    dateFrom: String(params.get("from") ?? ""),
    clientId: String(params.get("client") ?? ""),
    driverId: String(params.get("driver") ?? ""),
  };
}

export function taxiRideFiltersToSearchParams(
  filters: TaxiRideListFilters
): URLSearchParams {
  const params = new URLSearchParams();
  const set = (k: string, v: string) => {
    const t = v.trim();
    if (t) params.set(k, t);
  };
  set("q", filters.q);
  set("status", filters.status);
  set("payment", filters.payment);
  set("vehicle", filters.vehicle);
  set("city", filters.city);
  set("online", filters.online);
  set("from", filters.dateFrom);
  set("client", filters.clientId);
  set("driver", filters.driverId);
  return params;
}
