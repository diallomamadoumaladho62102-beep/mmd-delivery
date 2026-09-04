import { getApiBaseUrl } from "../../lib/apiBase";
import {
  AUTH_ACTION_TIMEOUT_MS,
  CLIENT_SCREEN_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
  withTimeout,
} from "./bootFailOpen";
import { supabase } from "./supabase";

export type DeliveryRequestPricingPayload = {
  country_code: string;
  currency: string;
  config_key: string;
  subtotal: number;
  tax: number;
  tax_rate_pct: number;
  tax_source: string;
  service_fee: number;
  service_fee_cents: number;
  service_fee_pct: number;
  service_fee_enabled: boolean;
  service_fee_fixed_cents: number;
  delivery_fee: number;
  delivery_fee_raw: number;
  delivery_discount_amount: number;
  promo_code_applied: string | null;
  promo_discount_amount: number;
  discounts: number;
  subtotal_after_discount: number;
  total: number;
  total_cents: number;
  distance_miles: number;
  eta_minutes: number;
  driver_payout_estimate: number;
};

export type CreateDeliveryRequestPayload = {
  request_type: "package" | "ride";
  title?: string;
  description?: string | null;
  pickup_address: string;
  dropoff_address: string;
  pickup_contact_name?: string | null;
  pickup_phone?: string | null;
  dropoff_contact_name?: string | null;
  dropoff_phone?: string | null;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_location_id?: string | null;
  promo_code?: string | null;
  leave_at_door?: boolean;
};

async function getAccessToken(): Promise<string | null> {
  try {
    const { data, error } = await withTimeout(
      supabase.auth.getSession(),
      CLIENT_SCREEN_FETCH_TIMEOUT_MS,
      "delivery_request_session",
    );
    if (error) return null;
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

function appendScopeQuery(
  path: string,
  scope?: { countryCode?: string | null; lat?: number; lng?: number }
) {
  if (!scope) return path;
  const params = new URLSearchParams();
  if (scope.countryCode) params.set("country", scope.countryCode);
  if (scope.lat != null) params.set("lat", String(scope.lat));
  if (scope.lng != null) params.set("lng", String(scope.lng));
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function deliveryRequestFetch(
  path: string,
  body: Record<string, unknown>,
  scope?: { countryCode?: string | null; lat?: number; lng?: number }
) {
  const token = await getAccessToken();
  if (!token) throw new Error("Not authenticated");

  const res = await fetchWithTimeout(
    `${getApiBaseUrl()}${appendScopeQuery(path, scope)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    AUTH_ACTION_TIMEOUT_MS,
    "delivery_request_fetch",
  );

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.ok === false) {
    const message = String(payload.error ?? payload.message ?? "").trim();
    throw new Error(message || `Delivery request failed (${res.status})`);
  }

  return payload;
}

export async function quoteDeliveryRequest(
  input: CreateDeliveryRequestPayload,
  scope?: { countryCode?: string | null; lat?: number; lng?: number }
): Promise<DeliveryRequestPricingPayload> {
  const body = await deliveryRequestFetch("/api/delivery-requests/quote", input, scope);
  return body.quote as DeliveryRequestPricingPayload;
}

export async function createDeliveryRequest(
  input: CreateDeliveryRequestPayload,
  scope?: { countryCode?: string | null; lat?: number; lng?: number }
): Promise<{ deliveryRequestId: string; pricing: DeliveryRequestPricingPayload }> {
  const body = await deliveryRequestFetch("/api/delivery-requests/create", input, scope);
  return {
    deliveryRequestId: String(body.delivery_request_id),
    pricing: body.pricing as DeliveryRequestPricingPayload,
  };
}

/** Pay-then-create: Stripe Checkout from quote — no delivery_requests row until paid. */
export function startDeliveryCheckoutFromQuote(
  payload: CreateDeliveryRequestPayload & { expectedQuoteTotalCents?: number },
  scope?: { countryCode?: string | null; lat?: number; lng?: number }
) {
  return deliveryRequestFetch(
    "/api/stripe/client/create-delivery-quote-checkout-session",
    {
      request_type: payload.request_type,
      title: payload.title,
      description: payload.description,
      pickup_address: payload.pickup_address,
      dropoff_address: payload.dropoff_address,
      pickup_contact_name: payload.pickup_contact_name,
      pickup_phone: payload.pickup_phone,
      dropoff_contact_name: payload.dropoff_contact_name,
      dropoff_phone: payload.dropoff_phone,
      pickup_lat: payload.pickup_lat,
      pickup_lng: payload.pickup_lng,
      dropoff_lat: payload.dropoff_lat,
      dropoff_lng: payload.dropoff_lng,
      dropoff_location_id: payload.dropoff_location_id,
      promo_code: payload.promo_code,
      leave_at_door: payload.leave_at_door,
      expectedQuoteTotalCents: payload.expectedQuoteTotalCents,
    },
    scope
  );
}

export async function confirmDeliveryQuoteCheckoutPaid(
  deliveryCheckoutId: string,
  sessionId?: string | null
) {
  return deliveryRequestFetch("/api/stripe/client/confirm-delivery-request-paid", {
    delivery_checkout_id: deliveryCheckoutId,
    ...(sessionId ? { session_id: sessionId } : {}),
  });
}

export async function syncPaidDeliveryRequestOrder(
  deliveryRequestId: string,
  scope?: { countryCode?: string | null; lat?: number; lng?: number }
): Promise<string> {
  const body = await deliveryRequestFetch(
    "/api/delivery-requests/sync-order",
    { delivery_request_id: deliveryRequestId },
    scope
  );
  return String(body.order_id);
}
