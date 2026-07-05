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

function requireCountryCode(countryCode: string | undefined): string {
  const code = String(countryCode ?? "")
    .trim()
    .toUpperCase();
  if (!code) {
    throw new Error("market_scope_unresolved");
  }
  return code;
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

export type TaxiVehicleClass =
  | "standard"
  | "comfort"
  | "xl"
  | "wheelchair_accessible"
  | "premium";

export type TaxiQuoteInput = {
  pickupAddress?: string;
  dropoffAddress?: string;
  pickupLocationId?: string;
  dropoffLocationId?: string;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  vehicleClass?: TaxiVehicleClass;
  passengerCount?: number;
  countryCode?: string;
  stops?: { address?: string; lat?: number; lng?: number }[];
  sharedRide?: boolean;
  premiumDriverOnly?: boolean;
};

export function quoteTaxiRide(input: TaxiQuoteInput) {
  return taxiPost("/api/taxi/rides/quote", {
    pickupAddress: input.pickupAddress,
    dropoffAddress: input.dropoffAddress,
    pickupLocationId: input.pickupLocationId,
    dropoffLocationId: input.dropoffLocationId,
    pickupLat: input.pickupLat,
    pickupLng: input.pickupLng,
    dropoffLat: input.dropoffLat,
    dropoffLng: input.dropoffLng,
    vehicleClass: input.vehicleClass ?? "standard",
    passengerCount: input.passengerCount ?? 1,
    countryCode: requireCountryCode(input.countryCode),
    stops: input.stops,
    sharedRide: input.sharedRide ?? false,
  });
}

export function createTaxiRide(
  input: TaxiQuoteInput & {
    clientNotes?: string;
    expectedQuoteTotalCents?: number;
    preferredDriverId?: string;
    promoCode?: string;
    rewardId?: string;
    stops?: { address?: string; lat?: number; lng?: number }[];
    sharedRide?: boolean;
    premiumDriverOnly?: boolean;
    businessAccountId?: string;
    businessTripType?: "personal" | "business";
  }
) {
  return taxiPost("/api/taxi/rides/create", {
    pickupAddress: input.pickupAddress,
    dropoffAddress: input.dropoffAddress,
    pickupLocationId: input.pickupLocationId,
    dropoffLocationId: input.dropoffLocationId,
    pickupLat: input.pickupLat,
    pickupLng: input.pickupLng,
    dropoffLat: input.dropoffLat,
    dropoffLng: input.dropoffLng,
    vehicleClass: input.vehicleClass ?? "standard",
    passengerCount: input.passengerCount ?? 1,
    countryCode: requireCountryCode(input.countryCode),
    clientNotes: input.clientNotes ?? "",
    expectedQuoteTotalCents: input.expectedQuoteTotalCents,
    preferredDriverId: input.preferredDriverId,
    promoCode: input.promoCode,
    rewardId: input.rewardId,
    stops: input.stops,
    sharedRide: input.sharedRide ?? false,
    premiumDriverOnly: input.premiumDriverOnly ?? false,
    businessAccountId: input.businessAccountId,
    businessTripType: input.businessTripType ?? "personal",
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

import i18n from "../i18n";
import { formatMoneyFromCents } from "../i18n/formatters";

export function formatTaxiCents(cents: unknown, currency = "USD") {
  return formatMoneyFromCents(Number(cents ?? 0), currency, i18n.language);
}

export function fetchTaxiFavoriteDrivers() {
  return taxiGet("/api/taxi/favorites/drivers");
}

export function addTaxiFavoriteDriver(driverUserId: string) {
  return taxiPost("/api/taxi/favorites/drivers", { driver_user_id: driverUserId });
}

export async function removeTaxiFavoriteDriver(driverUserId: string) {
  const res = await fetch(`${baseUrl()}/api/taxi/favorites/drivers`, {
    method: "DELETE",
    headers: await getAuthHeaders(),
    body: JSON.stringify({ driver_user_id: driverUserId }),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(out?.error ?? `Request failed (${res.status})`);
  return out;
}

export function fetchTaxiLoyaltyBalance() {
  return taxiGet("/api/taxi/loyalty/balance");
}

export function fetchTaxiLoyaltyHistory(limit = 50) {
  return taxiGet(`/api/taxi/loyalty/history?limit=${limit}`);
}

export function validateTaxiPromotion(input: {
  code: string;
  totalCents?: number;
  taxiRideId?: string;
}) {
  return taxiPost("/api/taxi/promotions/validate", {
    code: input.code,
    total_cents: input.totalCents,
    taxi_ride_id: input.taxiRideId,
  });
}

export function applyTaxiPromotion(input: { code: string; taxiRideId: string }) {
  return taxiPost("/api/taxi/promotions/apply", {
    code: input.code,
    taxi_ride_id: input.taxiRideId,
  });
}

export function fetchTaxiLoyaltyRewards() {
  return taxiGet("/api/taxi/loyalty/rewards");
}

export function applyTaxiLoyaltyReward(input: { rewardId: string; taxiRideId: string }) {
  return taxiPost("/api/taxi/loyalty/rewards/apply", {
    reward_id: input.rewardId,
    taxi_ride_id: input.taxiRideId,
  });
}

export function fetchScheduledTaxiRides(limit = 50) {
  return taxiGet(`/api/taxi/scheduled?limit=${limit}`);
}

export function createScheduledTaxiRide(
  input: TaxiQuoteInput & {
    scheduledPickupAt: string;
    preferredDriverId?: string;
    promoCode?: string;
    rewardId?: string;
  }
) {
  return taxiPost("/api/taxi/scheduled", {
    pickupAddress: input.pickupAddress,
    dropoffAddress: input.dropoffAddress,
    pickupLat: input.pickupLat,
    pickupLng: input.pickupLng,
    dropoffLat: input.dropoffLat,
    dropoffLng: input.dropoffLng,
    vehicleClass: input.vehicleClass ?? "standard",
    passengerCount: input.passengerCount ?? 1,
    countryCode: requireCountryCode(input.countryCode),
    stops: input.stops,
    scheduledPickupAt: input.scheduledPickupAt,
    preferredDriverId: input.preferredDriverId,
    promoCode: input.promoCode,
    rewardId: input.rewardId,
  });
}

export function cancelScheduledTaxiRide(scheduledId: string) {
  return taxiPost("/api/taxi/scheduled/cancel", { scheduled_id: scheduledId });
}

export function fetchTaxiBusinessAccounts() {
  return taxiGet("/api/taxi/business/accounts");
}

export type TaxiCountryOption = {
  country_code: string;
  name: string;
  currency_code: string;
  currency_name?: string;
  minor_units?: number;
  sort_order?: number;
};

export type TaxiCurrencyOption = {
  code: string;
  name: string;
  minor_units?: number;
  sort_order?: number;
};

export function fetchTaxiCountries(): Promise<{
  ok: boolean;
  countries: TaxiCountryOption[];
  currencies: TaxiCurrencyOption[];
}> {
  return taxiGet("/api/taxi/countries");
}

export function fetchTaxiSharedRideSegment(sharedRideId: string) {
  return taxiGet(`/api/taxi/shared/${sharedRideId}`);
}
