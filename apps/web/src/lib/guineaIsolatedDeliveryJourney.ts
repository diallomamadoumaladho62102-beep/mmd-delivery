import type { SupabaseClient } from "@supabase/supabase-js";
import { isGuineaIsolatedTestUserId } from "@/lib/guineaTestIsolation";
import {
  GUINEA_ISOLATED_TEST_DRIVER_USER_ID,
} from "@/lib/guineaIsolatedTaxiJourney";
import { quoteDeliveryRequestServerSide } from "@/lib/deliveryRequestService";

export function isolatedGuineaDeliveryCreateFields(clientUserId: string) {
  if (!isGuineaIsolatedTestUserId(clientUserId)) {
    throw new Error("guinea_isolated_actor_required");
  }
  return {
    driver_id: GUINEA_ISOLATED_TEST_DRIVER_USER_ID,
    status: "accepted",
    is_test: true,
    hidden_from_user: true,
  };
}

export function isGuineaIsolatedDelivery(row: {
  is_test?: boolean | null;
  client_user_id?: string | null;
  created_by?: string | null;
  driver_id?: string | null;
}): boolean {
  if (row.is_test !== true) return false;
  const parties = [row.client_user_id, row.created_by, row.driver_id];
  return (
    parties.every((id) => !id || isGuineaIsolatedTestUserId(id)) &&
    parties.some((id) => isGuineaIsolatedTestUserId(id))
  );
}

export async function createIsolatedGuineaDeliveryRequest(params: {
  admin: SupabaseClient;
  clientId: string;
  pickupAddress: string;
  dropoffAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  title?: string;
  description?: string | null;
}): Promise<{
  deliveryRequestId: string;
  pricing: Awaited<ReturnType<typeof quoteDeliveryRequestServerSide>>;
  pickupCode: string;
  dropoffCode: string;
}> {
  if (!isGuineaIsolatedTestUserId(params.clientId)) {
    throw new Error("guinea_isolated_actor_required");
  }

  const pricing = await quoteDeliveryRequestServerSide({
    supabaseAdmin: params.admin,
    pickupAddress: params.pickupAddress,
    dropoffAddress: params.dropoffAddress,
    pickupLat: params.pickupLat,
    pickupLng: params.pickupLng,
    dropoffLat: params.dropoffLat,
    dropoffLng: params.dropoffLng,
    countryCode: "GN",
  });

  const isolated = isolatedGuineaDeliveryCreateFields(params.clientId);
  const pickupCode = Math.random().toString(36).slice(2, 8).toUpperCase();
  const dropoffCode = Math.floor(100000 + Math.random() * 900000).toString();
  const chargedTotalCents = Math.round(Number(pricing.totalCents ?? 0));

  const baseRow = {
    created_by: params.clientId,
    client_user_id: params.clientId,
    status: isolated.status,
    payment_status: "pending_cash",
    payment_method: "cash",
    kind: "delivery",
    request_type: "package",
    title: params.title?.trim() || "Package delivery",
    errand_description: params.description?.trim() || null,
    pickup_address: params.pickupAddress.trim(),
    dropoff_address: params.dropoffAddress.trim(),
    pickup_lat: params.pickupLat,
    pickup_lng: params.pickupLng,
    dropoff_lat: params.dropoffLat,
    dropoff_lng: params.dropoffLng,
    pickup_code: pickupCode,
    dropoff_code: dropoffCode,
    distance_miles: pricing.distanceMiles,
    eta_minutes: pricing.etaMinutes,
    subtotal: pricing.subtotal,
    delivery_fee: pricing.deliveryFee,
    tax: pricing.tax,
    total: pricing.total,
    total_cents: chargedTotalCents,
    currency: pricing.currency,
    driver_id: isolated.driver_id,
    is_test: true,
    hidden_from_user: true,
  };

  let { data, error } = await params.admin
    .from("delivery_requests")
    .insert(baseRow)
    .select("id")
    .single();

  // Schema before migration B: retry without payment_method (still pending_cash if allowed).
  if (error && /payment_method/i.test(error.message)) {
    const { payment_method: _omit, ...withoutMethod } = baseRow;
    ({ data, error } = await params.admin
      .from("delivery_requests")
      .insert(withoutMethod)
      .select("id")
      .single());
  }

  if (error) {
    if (/is_test|hidden_from_user|column/i.test(error.message)) {
      throw new Error("guinea_isolated_schema_not_ready");
    }
    throw new Error(error.message);
  }

  return {
    deliveryRequestId: String(data.id),
    pricing,
    pickupCode,
    dropoffCode,
  };
}

export async function transitionIsolatedDeliveryRequest(params: {
  admin: SupabaseClient;
  actorUserId: string;
  deliveryRequestId: string;
  action: "pickup" | "deliver" | "complete" | "cancel";
}): Promise<{ id: string; status: string; previousStatus: string }> {
  if (!isGuineaIsolatedTestUserId(params.actorUserId)) {
    throw new Error("guinea_isolated_actor_required");
  }

  const { data: row, error } = await params.admin
    .from("delivery_requests")
    .select(
      "id,status,payment_status,payment_method,client_user_id,created_by,driver_id,is_test,hidden_from_user",
    )
    .eq("id", params.deliveryRequestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("delivery_request_not_found");
  if (!isGuineaIsolatedDelivery(row)) throw new Error("guinea_isolated_delivery_required");

  const previousStatus = String(row.status ?? "").toLowerCase();
  const paymentStatus = String((row as { payment_status?: string }).payment_status ?? "").toLowerCase();
  const isDriver = params.actorUserId === row.driver_id;
  const isClient =
    params.actorUserId === row.client_user_id ||
    params.actorUserId === row.created_by;
  const nowIso = new Date().toISOString();
  let nextStatus = previousStatus;
  const patch: Record<string, unknown> = { updated_at: nowIso };

  if (params.action === "cancel") {
    if (!isClient && !isDriver) throw new Error("forbidden");
    nextStatus = "cancelled";
    patch.status = nextStatus;
  } else if (params.action === "pickup") {
    if (!isDriver) throw new Error("driver_actor_required");
    if (!["accepted", "assigned", "pending"].includes(previousStatus)) {
      throw new Error("invalid_status");
    }
    nextStatus = "picked_up";
    patch.status = nextStatus;
  } else if (params.action === "deliver") {
    if (!isDriver) throw new Error("driver_actor_required");
    if (previousStatus !== "picked_up") throw new Error("invalid_status");
    nextStatus = "delivered";
    patch.status = nextStatus;
    // Isolated rehearsal: driver confirms physical cash at dropoff (never at accept).
    if (paymentStatus === "pending_cash") {
      patch.payment_status = "cash_collected";
    }
  } else if (params.action === "complete") {
    if (!isClient && !isDriver) throw new Error("forbidden");
    if (previousStatus !== "delivered") throw new Error("invalid_status");
    nextStatus = "completed";
    patch.status = nextStatus;
  } else {
    throw new Error("unsupported_action");
  }

  const { data, error: updateError } = await params.admin
    .from("delivery_requests")
    .update(patch)
    .eq("id", row.id)
    .eq("status", previousStatus)
    .select("id,status")
    .maybeSingle();
  if (updateError) throw new Error(updateError.message);
  if (!data) throw new Error("status_race");
  return {
    id: String(data.id),
    status: String(data.status),
    previousStatus,
  };
}
