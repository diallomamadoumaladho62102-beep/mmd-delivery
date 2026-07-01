import type { SupabaseClient } from "@supabase/supabase-js";
import {
  notifyDeliveryRequestDispatchedTransactional,
  notifyOrderDispatchedTransactional,
  notifyTaxiRideDispatchedTransactional,
} from "./transactionalOutbound";

function logTransactionalFailure(
  context: string,
  entityId: string,
  err: unknown,
) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[transactional] ${context} failed`, {
    entity_id: entityId,
    message,
  });
}

export async function fireFoodOrderDispatchedTransactional(params: {
  supabaseAdmin: SupabaseClient;
  orderId: string;
}): Promise<void> {
  try {
    const { data } = await params.supabaseAdmin
      .from("orders")
      .select("client_user_id, client_id, created_by")
      .eq("id", params.orderId)
      .maybeSingle();

    const clientUserId =
      data?.client_user_id ?? data?.client_id ?? data?.created_by ?? null;

    await notifyOrderDispatchedTransactional({
      supabaseAdmin: params.supabaseAdmin,
      clientUserId,
      orderId: params.orderId,
    });
  } catch (err) {
    logTransactionalFailure("food dispatch", params.orderId, err);
  }
}

export async function fireDeliveryRequestDispatchedTransactional(params: {
  supabaseAdmin: SupabaseClient;
  deliveryRequestId: string;
}): Promise<void> {
  try {
    const { data } = await params.supabaseAdmin
      .from("delivery_requests")
      .select("client_user_id, created_by")
      .eq("id", params.deliveryRequestId)
      .maybeSingle();

    const clientUserId = data?.client_user_id ?? data?.created_by ?? null;

    await notifyDeliveryRequestDispatchedTransactional({
      supabaseAdmin: params.supabaseAdmin,
      clientUserId,
      deliveryRequestId: params.deliveryRequestId,
    });
  } catch (err) {
    logTransactionalFailure("delivery dispatch", params.deliveryRequestId, err);
  }
}

export async function fireTaxiRideDispatchedTransactional(params: {
  supabaseAdmin: SupabaseClient;
  taxiRideId: string;
}): Promise<void> {
  try {
    const { data } = await params.supabaseAdmin
      .from("taxi_rides")
      .select("client_user_id")
      .eq("id", params.taxiRideId)
      .maybeSingle();

    await notifyTaxiRideDispatchedTransactional({
      supabaseAdmin: params.supabaseAdmin,
      clientUserId: data?.client_user_id ?? null,
      taxiRideId: params.taxiRideId,
    });
  } catch (err) {
    logTransactionalFailure("taxi dispatch", params.taxiRideId, err);
  }
}
