import { API_BASE_URL } from "./apiBase";
import { supabase } from "./supabase";

async function getAuthHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const token = data.session?.access_token;
  if (!token) {
    throw new Error("Session expired. Please sign in again.");
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function baseUrl() {
  return String(API_BASE_URL).replace(/\/$/, "");
}

async function taxiGet(path: string) {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "GET",
    headers: await getAuthHeaders(),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(out?.error ?? `Request failed (${res.status})`);
  return out;
}

async function taxiPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(out?.error ?? `Request failed (${res.status})`);
  return out;
}

export function fetchMyTaxiOffers() {
  return taxiGet("/api/taxi/offers/mine");
}

export function fetchActiveTaxiRide() {
  return taxiGet("/api/taxi/rides/active");
}

export function acceptTaxiOffer(offerId: string) {
  return taxiPost("/api/taxi/offers/accept", { taxi_offer_id: offerId });
}

export function rejectTaxiOffer(offerId: string) {
  return taxiPost("/api/taxi/offers/reject", { taxi_offer_id: offerId });
}

export function arriveTaxiPickup(
  rideId: string,
  coords?: { lat: number; lng: number },
) {
  return taxiPost("/api/taxi/rides/arrive", {
    taxi_ride_id: rideId,
    ...(coords
      ? { lat: coords.lat, lng: coords.lng }
      : {}),
  });
}

export function startTaxiRide(rideId: string) {
  return taxiPost("/api/taxi/rides/start", { taxi_ride_id: rideId });
}

export function completeTaxiRide(
  rideId: string,
  coords?: { lat: number; lng: number },
) {
  return taxiPost("/api/taxi/rides/complete", {
    taxi_ride_id: rideId,
    ...(coords
      ? { lat: coords.lat, lng: coords.lng }
      : {}),
  });
}

export function cancelTaxiRideByDriver(rideId: string, reason?: string) {
  return taxiPost("/api/taxi/rides/driver-cancel", {
    taxi_ride_id: rideId,
    reason: reason ?? "driver_cancelled",
  });
}

export function arriveTaxiStop(rideId: string, stopOrder: number) {
  return taxiPost("/api/taxi/rides/stops/arrive", {
    taxi_ride_id: rideId,
    stop_order: stopOrder,
  });
}

export function completeTaxiStop(rideId: string, stopOrder: number) {
  return taxiPost("/api/taxi/rides/stops/complete", {
    taxi_ride_id: rideId,
    stop_order: stopOrder,
  });
}

export type TaxiDriverFeatures = {
  taxi_enabled: boolean;
  vehicle_class: string;
  xl_eligible: boolean;
  premium_eligible: boolean;
};

export async function loadTaxiDriverFeatures(
  userId: string
): Promise<TaxiDriverFeatures | null> {
  const { data, error } = await supabase
    .from("taxi_driver_features")
    .select("taxi_enabled,vehicle_class,xl_eligible,premium_eligible")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.log("[loadTaxiDriverFeatures]", error.message);
    return null;
  }

  return (data as TaxiDriverFeatures | null) ?? null;
}

export function formatDriverPayout(cents: unknown, currency = "USD") {
  const value = Number(cents ?? 0) / 100;
  if (!Number.isFinite(value)) return "$0.00";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}
