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

export type TaxiVehicleClass = "standard" | "xl" | "premium";

export type TaxiQuoteInput = {
  pickupAddress?: string;
  dropoffAddress?: string;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  vehicleClass?: TaxiVehicleClass;
  passengerCount?: number;
  countryCode?: string;
};

export function quoteTaxiRide(input: TaxiQuoteInput) {
  return taxiPost("/api/taxi/rides/quote", {
    pickupAddress: input.pickupAddress,
    dropoffAddress: input.dropoffAddress,
    pickupLat: input.pickupLat,
    pickupLng: input.pickupLng,
    dropoffLat: input.dropoffLat,
    dropoffLng: input.dropoffLng,
    vehicleClass: input.vehicleClass ?? "standard",
    passengerCount: input.passengerCount ?? 1,
    countryCode: input.countryCode ?? "US",
  });
}

export function createTaxiRide(
  input: TaxiQuoteInput & {
    clientNotes?: string;
    expectedQuoteTotalCents?: number;
  }
) {
  return taxiPost("/api/taxi/rides/create", {
    pickupAddress: input.pickupAddress,
    dropoffAddress: input.dropoffAddress,
    pickupLat: input.pickupLat,
    pickupLng: input.pickupLng,
    dropoffLat: input.dropoffLat,
    dropoffLng: input.dropoffLng,
    vehicleClass: input.vehicleClass ?? "standard",
    passengerCount: input.passengerCount ?? 1,
    countryCode: input.countryCode ?? "US",
    clientNotes: input.clientNotes ?? "",
    expectedQuoteTotalCents: input.expectedQuoteTotalCents,
  });
}

export function fetchMyTaxiRides(limit = 50) {
  return taxiGet(`/api/taxi/rides/mine?limit=${limit}`);
}

export function fetchTaxiRide(rideId: string) {
  return taxiGet(`/api/taxi/rides/${rideId}`);
}

export function cancelTaxiRide(rideId: string) {
  return taxiPost("/api/taxi/rides/cancel", { taxi_ride_id: rideId });
}

export async function startTaxiCheckout(taxiRideId: string) {
  return taxiPost("/api/stripe/client/create-taxi-checkout-session", {
    taxi_ride_id: taxiRideId,
  });
}

export async function confirmTaxiPaid(taxiRideId: string) {
  return taxiPost("/api/stripe/client/confirm-taxi-paid", {
    taxi_ride_id: taxiRideId,
  });
}

export function formatTaxiCents(cents: unknown, currency = "USD") {
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
