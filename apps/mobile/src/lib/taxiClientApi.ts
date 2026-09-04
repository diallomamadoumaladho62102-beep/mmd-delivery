import { API_BASE_URL } from "./apiBase";
import {
  AUTH_ACTION_TIMEOUT_MS,
  CLIENT_SCREEN_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  withTimeout,
} from "./bootFailOpen";
import { supabase } from "./supabase";
import { isExpectedTaxiPaymentPendingResponse } from "./taxiPaymentAbandonFlow";
import { logTechnicalError, toUserFacingError } from "./userFacingError";

async function getAuthHeaders() {
  const { data, error } = await withTimeout(
    supabase.auth.getSession(),
    CLIENT_SCREEN_FETCH_TIMEOUT_MS,
    "taxi_client_session",
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
  const res = await fetchWithTimeout(
    `${baseUrl()}${path}`,
    {
      method: "GET",
      headers: await getAuthHeaders(),
    },
    CLIENT_SCREEN_FETCH_TIMEOUT_MS,
    "taxi_client_get",
  );
  const out = await res.json().catch(() => null);
  if (!res.ok) {
    logTechnicalError(`taxi.get${path}`, out, { status: res.status });
    throw new Error(toUserFacingError(out));
  }
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
    "taxi_client_post",
  );
  const out = await res.json().catch(() => null);
  if (!res.ok) {
    const expectedPending =
      path.includes("confirm-taxi-paid") &&
      isExpectedTaxiPaymentPendingResponse(res.status, out);
    if (!expectedPending) {
      logTechnicalError(`taxi.post${path}`, out, { status: res.status });
    } else {
      console.log(`[taxi.post${path}] payment not confirmed yet`, {
        status: res.status,
        payment_status: (out as { payment_status?: string } | null)?.payment_status,
      });
    }
    throw new Error(
      toUserFacingError(
        out,
        expectedPending
          ? "Payment was not completed. Please check your payment method and try again."
          : "Une action temporairement impossible s'est produite. Veuillez réessayer.",
      ),
    );
  }
  return out;
}

export type TaxiVehicleClass =
  | "standard"
  | "comfort"
  | "xl"
  | "wheelchair_accessible"
  | "premium";

export type TaxiTripMode = "one_way" | "round_trip";
export type TaxiReturnMode = "immediate" | "wait" | "scheduled";

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
  preferElectricOrHybrid?: boolean;
  tripMode?: TaxiTripMode;
  returnMode?: TaxiReturnMode;
  returnWaitMinutes?: number;
  returnScheduledAt?: string;
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
    tripMode: input.tripMode,
    returnMode: input.returnMode,
    returnWaitMinutes: input.returnWaitMinutes,
    returnScheduledAt: input.returnScheduledAt,
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
    preferElectricOrHybrid?: boolean;
    clientPreferences?: Record<string, boolean>;
    ambiancePreference?: "quiet" | "music" | "conversation" | "none";
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
    preferElectricOrHybrid: input.preferElectricOrHybrid ?? false,
    clientPreferences: input.clientPreferences ?? {},
    ambiancePreference: input.ambiancePreference ?? "none",
    businessAccountId: input.businessAccountId,
    businessTripType: input.businessTripType ?? "personal",
    tripMode: input.tripMode,
    returnMode: input.returnMode,
    returnWaitMinutes: input.returnWaitMinutes,
    returnScheduledAt: input.returnScheduledAt,
  });
}

export function fetchMyTaxiRides(limit = 50) {
  return taxiGet(`/api/taxi/rides/mine?limit=${limit}`);
}

export function fetchTaxiRide(rideId: string) {
  return taxiGet(`/api/taxi/rides/${rideId}`);
}

export function cancelTaxiRide(
  rideId: string,
  opts?: {
    reason_code?: string;
    reason_detail?: string;
    preview?: boolean;
  },
) {
  return taxiPost("/api/taxi/rides/cancel", {
    taxi_ride_id: rideId,
    reason_code: opts?.reason_code,
    reason_detail: opts?.reason_detail,
    preview: opts?.preview === true,
  });
}

/** Driver-initiated release for reassignment (accepted / driver_arrived). */
export function cancelTaxiRideByDriver(
  rideId: string,
  opts?: { reason_code?: string; reason_detail?: string; reason?: string },
) {
  return taxiPost("/api/taxi/rides/driver-cancel", {
    taxi_ride_id: rideId,
    reason_code: opts?.reason_code ?? opts?.reason ?? "other",
    reason_detail: opts?.reason_detail,
  });
}

export function previewTaxiDestinationChange(
  rideId: string,
  input: {
    dropoffAddress?: string;
    dropoffLat?: number;
    dropoffLng?: number;
    confirm?: boolean;
  },
) {
  return taxiPost("/api/taxi/rides/change-destination", {
    taxi_ride_id: rideId,
    dropoff_address: input.dropoffAddress,
    dropoff_lat: input.dropoffLat,
    dropoff_lng: input.dropoffLng,
    confirm: input.confirm === true,
  });
}

export function previewTaxiAddStop(
  rideId: string,
  input: {
    address?: string;
    lat?: number;
    lng?: number;
    confirm?: boolean;
  },
) {
  return taxiPost("/api/taxi/rides/add-stop", {
    taxi_ride_id: rideId,
    stop_address: input.address,
    stop_lat: input.lat,
    stop_lng: input.lng,
    confirm: input.confirm === true,
  });
}

export async function startTaxiCheckout(taxiRideId: string) {
  return taxiPost("/api/stripe/client/create-taxi-checkout-session", {
    taxi_ride_id: taxiRideId,
  });
}

/** Pay-then-create: Stripe Checkout from quote — no taxi_rides row until paid. */
export function startTaxiCheckoutFromQuote(
  input: TaxiQuoteInput & {
    clientNotes?: string;
    expectedQuoteTotalCents?: number;
    preferredDriverId?: string;
    promoCode?: string;
    stops?: { address?: string; lat?: number; lng?: number }[];
    sharedRide?: boolean;
    premiumDriverOnly?: boolean;
    preferElectricOrHybrid?: boolean;
    clientPreferences?: Record<string, boolean>;
    ambiancePreference?: "quiet" | "music" | "conversation" | "none";
    businessAccountId?: string;
    businessTripType?: "personal" | "business";
  },
) {
  return taxiPost("/api/stripe/client/create-taxi-quote-checkout-session", {
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
    stops: input.stops,
    sharedRide: input.sharedRide ?? false,
    premiumDriverOnly: input.premiumDriverOnly ?? false,
    preferElectricOrHybrid: input.preferElectricOrHybrid ?? false,
    clientPreferences: input.clientPreferences ?? {},
    ambiancePreference: input.ambiancePreference ?? "none",
    businessAccountId: input.businessAccountId,
    businessTripType: input.businessTripType ?? "personal",
    tripMode: input.tripMode,
    returnMode: input.returnMode,
    returnWaitMinutes: input.returnWaitMinutes,
    returnScheduledAt: input.returnScheduledAt,
  });
}

export async function confirmTaxiPaid(taxiRideId: string) {
  return taxiPost("/api/stripe/client/confirm-taxi-paid", {
    taxi_ride_id: taxiRideId,
  });
}

export async function confirmTaxiQuoteCheckoutPaid(
  quoteCheckoutId: string,
  sessionId?: string | null,
) {
  return taxiPost("/api/stripe/client/confirm-taxi-paid", {
    quote_checkout_id: quoteCheckoutId,
    ...(sessionId ? { session_id: sessionId } : {}),
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
  const res = await fetchWithTimeout(
    `${baseUrl()}/api/taxi/favorites/drivers`,
    {
      method: "DELETE",
      headers: await getAuthHeaders(),
      body: JSON.stringify({ driver_user_id: driverUserId }),
    },
    AUTH_ACTION_TIMEOUT_MS,
    "taxi_client_delete_favorite",
  );
  const out = await res.json().catch(() => null);
  if (!res.ok) {
    logTechnicalError("taxi.deleteFavoriteDriver", out, { status: res.status });
    throw new Error(toUserFacingError(out));
  }
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

export async function fetchTaxiRideRating(rideId: string): Promise<{
  ok: boolean;
  rating: {
    id: string;
    rating: number;
    comment: string | null;
    driver_id: string;
    created_at: string;
    updated_at: string;
  } | null;
}> {
  return taxiGet(`/api/taxi/rides/${encodeURIComponent(rideId)}/rating`);
}

export async function submitTaxiRideRating(params: {
  rideId: string;
  rating: number;
  comment?: string | null;
}): Promise<{
  ok: boolean;
  created?: boolean;
  updated?: boolean;
  rating: {
    id: string;
    taxi_ride_id: string;
    driver_id: string;
    rating: number;
    comment: string | null;
  };
}> {
  return taxiPost(`/api/taxi/rides/${encodeURIComponent(params.rideId)}/rating`, {
    rating: params.rating,
    comment: params.comment ?? null,
  });
}
