import type { SupabaseClient } from "@supabase/supabase-js";
import {
  notifyClientDeliveryRequestPaid,
} from "@/lib/clientPushNotifications";
import { completeFoodOrderAfterPayment } from "@/lib/foodOrderPaymentCompletion";
import { ensureOrderCommissionsReady } from "@/lib/refreshOrderCommissions";
import { scheduleDeliveryRequestDispatch, getDispatchSiteOrigin } from "@/lib/scheduleDeliveryRequestDispatch";
import { syncPaidDeliveryRequestOrder } from "@/lib/deliveryRequestService";
import { prepareMarketplaceDeliveryJobAfterPayment } from "@/lib/marketplaceDispatchService";
import { recordInboundPaymentWalletEntries } from "@/lib/inboundWalletBridge";
import type { PaymentEntityType, PaymentTransactionRow } from "@/lib/paymentTypes";
import { runTaxiRideDispatch } from "@/lib/runTaxiRideDispatch";
import { initializeTaxiRidePreferenceDispatch } from "@/lib/taxiPreferenceDispatch";

export async function completePaidEntityFromTransaction(
  supabaseAdmin: SupabaseClient,
  transaction: PaymentTransactionRow
): Promise<{ ok: true } | { ok: false; error: string }> {
  switch (transaction.entity_type as PaymentEntityType) {
    case "order":
      return completeOrderPayment(supabaseAdmin, transaction);
    case "delivery_request":
      return completeDeliveryRequestPayment(supabaseAdmin, transaction);
    case "taxi_ride":
      return completeTaxiRidePayment(supabaseAdmin, transaction);
    case "seller_order":
      return completeSellerOrderPayment(supabaseAdmin, transaction);
    default:
      return { ok: false, error: "unsupported_entity_type" };
  }
}

async function completeOrderPayment(
  supabaseAdmin: SupabaseClient,
  transaction: PaymentTransactionRow
): Promise<{ ok: true } | { ok: false; error: string }> {
  const orderId = transaction.entity_id;
  const { data: order } = await supabaseAdmin
    .from("orders")
    .select("id,kind,client_user_id,created_by,payment_status")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return { ok: false, error: "order_not_found" };

  if (String(order.payment_status ?? "").toLowerCase() !== "paid") {
    const { error } = await supabaseAdmin.rpc("mark_order_paid", {
      p_order_id: orderId,
      p_session_id: null,
      p_payment_intent_id: `local:${transaction.provider}:${transaction.id}`,
    });
    if (error) return { ok: false, error: error.message };
  }

  const commissions = await ensureOrderCommissionsReady(
    supabaseAdmin,
    orderId,
    `local-payment:${transaction.provider}`
  );
  if (commissions.ok === false) {
    return { ok: false, error: commissions.error };
  }

  await completeFoodOrderAfterPayment(supabaseAdmin, {
    orderId,
    clientUserIds: [order.client_user_id, order.created_by, transaction.user_id],
    kind: order.kind,
  });

  return { ok: true };
}

async function completeDeliveryRequestPayment(
  supabaseAdmin: SupabaseClient,
  transaction: PaymentTransactionRow
): Promise<{ ok: true } | { ok: false; error: string }> {
  const deliveryRequestId = transaction.entity_id;
  const nowIso = new Date().toISOString();

  const { data: delivery } = await supabaseAdmin
    .from("delivery_requests")
    .select("id,payment_status,client_user_id,created_by")
    .eq("id", deliveryRequestId)
    .maybeSingle();

  if (!delivery) return { ok: false, error: "delivery_request_not_found" };

  if (String(delivery.payment_status ?? "").toLowerCase() !== "paid") {
    const { error } = await supabaseAdmin
      .from("delivery_requests")
      .update({
        payment_status: "paid",
        paid_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", deliveryRequestId);
    if (error) return { ok: false, error: error.message };
  }

  const syncResult = await syncPaidDeliveryRequestOrder(
    supabaseAdmin,
    deliveryRequestId,
    transaction.user_id
  );
  if (syncResult.ok === false) {
    return { ok: false, error: syncResult.error };
  }

  const commissions = await ensureOrderCommissionsReady(
    supabaseAdmin,
    syncResult.orderId,
    `local-payment:${transaction.provider}:delivery_request`
  );
  if (commissions.ok === false) {
    return { ok: false, error: commissions.error };
  }

  const origin = getDispatchSiteOrigin();
  if (origin) {
    scheduleDeliveryRequestDispatch({ origin, deliveryRequestId });
  }
  await notifyClientDeliveryRequestPaid({
    supabaseAdmin,
    userIds: [delivery.client_user_id, delivery.created_by, transaction.user_id],
    deliveryRequestId,
  });

  return { ok: true };
}

async function completeTaxiRidePayment(
  supabaseAdmin: SupabaseClient,
  transaction: PaymentTransactionRow
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rideId = transaction.entity_id;

  const { error } = await supabaseAdmin.rpc("mark_taxi_ride_paid", {
    p_ride_id: rideId,
    p_session_id: null,
    p_payment_intent_id: `local:${transaction.provider}:${transaction.id}`,
  });
  if (error) return { ok: false, error: error.message };

  const { data: ride } = await supabaseAdmin
    .from("taxi_rides")
    .select("id,payment_status,is_scheduled,status,country_code,pickup_city")
    .eq("id", rideId)
    .maybeSingle();

  if (ride && String(ride.payment_status ?? "").toLowerCase() === "paid") {
    await initializeTaxiRidePreferenceDispatch(
      supabaseAdmin,
      rideId,
      ride.country_code ? String(ride.country_code) : null,
      ride.pickup_city ? String(ride.pickup_city) : null,
    );
    await runTaxiRideDispatch({ supabase: supabaseAdmin, taxiRideId: rideId });
  }

  return { ok: true };
}

async function completeSellerOrderPayment(
  supabaseAdmin: SupabaseClient,
  transaction: PaymentTransactionRow
): Promise<{ ok: true } | { ok: false; error: string }> {
  const orderId = transaction.entity_id;
  const nowIso = new Date().toISOString();

  const { data: order } = await supabaseAdmin
    .from("seller_orders")
    .select("id,payment_status,status")
    .eq("id", orderId)
    .maybeSingle();

  if (!order) return { ok: false, error: "seller_order_not_found" };

  if (order.payment_status !== "paid" && order.status !== "paid") {
    const { error } = await supabaseAdmin
      .from("seller_orders")
      .update({
        payment_status: "paid",
        status: "paid",
        paid_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", orderId);
    if (error) return { ok: false, error: error.message };
  }

  await prepareMarketplaceDeliveryJobAfterPayment(supabaseAdmin, {
    sellerOrderId: orderId,
    source: `local-payment:${transaction.provider}`,
  });
  return { ok: true };
}

export async function applyTransactionStatusUpdate(
  supabaseAdmin: SupabaseClient,
  transaction: PaymentTransactionRow,
  status: PaymentTransactionRow["status"],
  patch?: {
    failure_reason?: string | null;
    provider_payload?: Record<string, unknown>;
  }
): Promise<PaymentTransactionRow> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("payment_transactions")
    .update({
      status,
      failure_reason: patch?.failure_reason ?? null,
      provider_payload: patch?.provider_payload ?? transaction.provider_payload,
      paid_at: status === "paid" ? nowIso : transaction.paid_at,
      updated_at: nowIso,
    })
    .eq("id", transaction.id)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "payment_transaction_update_failed");
  }

  const updated = data as PaymentTransactionRow;
  if (status === "paid") {
    await completePaidEntityFromTransaction(supabaseAdmin, updated);
    // Fail-closed: paid local-money settlement must write wallet ledger (same as Stripe).
    try {
      await recordInboundPaymentWalletEntries(supabaseAdmin, updated);
    } catch (walletErr) {
      console.error("[paymentEntityCompletion] inbound wallet bridge failed", walletErr);
      throw new Error(
        walletErr instanceof Error
          ? `wallet_ledger_bridge_failed: ${walletErr.message}`
          : "wallet_ledger_bridge_failed"
      );
    }
  }
  return updated;
}
