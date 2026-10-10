import { API_BASE_URL } from "./apiBase";
import { supabase } from "./supabase";

async function headers() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Session expired. Please sign in again.");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function post(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${String(API_BASE_URL).replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? "request_failed");
  }
  return payload;
}

const XL_ERROR_KEYS: Record<string, string> = {
  xl_route_not_configured: "taxiXl.routeNotConfigured",
  xl_seat_taken: "taxiXl.seatTaken",
  cash_forbidden: "taxiXl.cashForbidden",
  ride_canceled: "taxiXl.rideCanceled",
  ride_not_completed: "taxiXl.rideNotCompleted",
  xl_vehicle_capacity_unsupported: "taxiXl.capacityRejected",
  xl_segment_commercial_disabled: "taxiXl.segmentClosed",
  xl_market_unavailable: "taxiXl.marketUnavailable",
  xl_segment_schema_not_ready: "taxiXl.segmentClosed",
  xl_segment_unconfirmed: "taxiXl.segmentHint",
  xl_segment_not_priced: "taxiXl.routeNotConfigured",
  xl_client_total_rejected: "taxiXl.requestFailed",
  xl_dispatch_not_configured: "taxiXl.dispatchUnavailable",
  xl_dispatch_no_driver: "taxiXl.dispatchUnavailable",
  xl_dispatch_pickup_required: "taxiXl.dispatchUnavailable",
  xl_pickup_time_required: "taxiXl.dispatchUnavailable",
  xl_driver_location_unavailable: "taxiXl.dispatchUnavailable",
  xl_driver_too_far: "taxiXl.dispatchUnavailable",
  xl_driver_wrong_direction: "taxiXl.dispatchUnavailable",
  xl_detour_exceeded: "taxiXl.dispatchUnavailable",
  xl_pickup_delay: "taxiXl.dispatchUnavailable",
  xl_pickup_passed: "taxiXl.dispatchUnavailable",
  xl_progress_unverified: "taxiXl.dispatchUnavailable",
  xl_progress_inconsistent: "taxiXl.dispatchUnavailable",
  xl_dispatch_no_verified_driver: "taxiXl.dispatchUnavailable",
  xl_driver_unavailable: "taxiXl.dispatchUnavailable",
  xl_departure_completed: "taxiXl.dispatchUnavailable",
  xl_departure_canceled: "taxiXl.dispatchUnavailable",
};

const XL_STATUS_KEYS: Record<string, string> = {
  open: "taxiXl.statusOpen",
  closed: "taxiXl.statusClosed",
  completed: "taxiXl.statusCompleted",
  canceled: "taxiXl.statusCanceled",
  cancelled: "taxiXl.statusCanceled",
  confirmed: "taxiXl.statusConfirmed",
};

export function xlStatusLabel(status: unknown, translate: (key: string) => string): string {
  const key = XL_STATUS_KEYS[String(status ?? "").trim().toLowerCase()];
  return key ? translate(key) : translate("taxiXl.requestFailed");
}

export function xlErrorMessage(error: unknown, translate: (key: string) => string): string {
  const code = error instanceof Error ? error.message : "";
  const key = XL_ERROR_KEYS[code];
  return key ? translate(key) : translate("taxiXl.requestFailed");
}

export async function fetchGuineaXlDepartures(scope?: "driver") {
  const query = scope === "driver" ? "?scope=driver" : "";
  const response = await fetch(`${String(API_BASE_URL).replace(/\/$/, "")}/api/taxi/xl/departures${query}`, {
    headers: await headers(),
  });
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false) throw new Error(payload.error ?? "request_failed");
  return payload as {
    departures: Array<Record<string, unknown>>;
    axes: Array<Record<string, unknown>>;
  };
}

export async function fetchMyGuineaXlBookings() {
  const response = await fetch(`${String(API_BASE_URL).replace(/\/$/, "")}/api/taxi/xl/bookings`, {
    headers: await headers(),
  });
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false) throw new Error(payload.error ?? "request_failed");
  return payload as { bookings: Array<Record<string, unknown>> };
}

export function quoteGuineaXl(body: Record<string, unknown>) {
  return post("/api/taxi/xl/quote", body);
}

export function bookGuineaXl(body: Record<string, unknown>) {
  return post("/api/taxi/xl/bookings", body);
}

export function openGuineaXlDeparture(body: Record<string, unknown>) {
  return post("/api/taxi/xl/departures", body);
}

export function completeGuineaXlDeparture(departureId: string) {
  return post("/api/taxi/xl/departures", { action: "complete", departureId });
}

export function syncGuineaXlProgress(events: Array<Record<string, unknown>>) {
  return post("/api/taxi/xl/departures", { action: "progress", events });
}

export function collectGuineaXlCash(bookingId: string) {
  return post("/api/taxi/xl/cash-collected", { bookingId });
}
