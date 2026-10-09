import { API_BASE_URL } from "./apiBase";
import {
  AUTH_ACTION_TIMEOUT_MS,
  CLIENT_SCREEN_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  withTimeout,
} from "./bootFailOpen";
import { supabase } from "./supabase";

async function getAuthHeaders() {
  const { data, error } = await withTimeout(
    supabase.auth.getSession(),
    CLIENT_SCREEN_FETCH_TIMEOUT_MS,
    "taxi_driver_session",
  );
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
  const res = await fetchWithTimeout(
    `${baseUrl()}${path}`,
    {
      method: "GET",
      headers: await getAuthHeaders(),
    },
    CLIENT_SCREEN_FETCH_TIMEOUT_MS,
    "taxi_driver_get",
  );
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(out?.error ?? `Request failed (${res.status})`);
  return out;
}

async function taxiPost(path: string, body: Record<string, unknown>) {
  const res = await fetchWithTimeout(
    `${baseUrl()}${path}`,
    {
      method: "POST",
      headers: await getAuthHeaders(),
      body: JSON.stringify(body),
    },
    AUTH_ACTION_TIMEOUT_MS,
    "taxi_driver_post",
  );
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

export function startTaxiRide(rideId: string, pickupCode: string) {
  return taxiPost("/api/taxi/rides/start", {
    taxi_ride_id: rideId,
    pickup_code: String(pickupCode ?? "")
      .replace(/\D/g, "")
      .slice(0, 4),
  });
}

export function confirmTaxiCashCollected(rideId: string) {
  return taxiPost("/api/taxi/rides/cash-collected", { taxi_ride_id: rideId });
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

export function continueTaxiWait(rideId: string) {
  return taxiPost("/api/taxi/rides/wait-continue", {
    taxi_ride_id: rideId,
  });
}

export function cancelTaxiRideByDriver(
  rideId: string,
  opts?: { reason_code?: string; reason_detail?: string; reason?: string },
) {
  return taxiPost("/api/taxi/rides/driver-cancel", {
    taxi_ride_id: rideId,
    reason_code: opts?.reason_code ?? opts?.reason ?? "",
    reason_detail: opts?.reason_detail,
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
  const code = String(currency || "USD").trim().toUpperCase();
  const minor = Number(cents ?? 0);
  if (!Number.isFinite(minor)) return code === "GNF" ? "0 GNF" : "$0.00";
  const value = code === "GNF" ? minor : minor / 100;
  try {
    if (code === "GNF") {
      const formatted = new Intl.NumberFormat("fr-FR", {
        maximumFractionDigits: 0,
      }).format(Math.round(value));
      return `${formatted} GNF`;
    }
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
    }).format(value);
  } catch {
    return code === "GNF" ? `${Math.round(value)} GNF` : `$${value.toFixed(2)}`;
  }
}
