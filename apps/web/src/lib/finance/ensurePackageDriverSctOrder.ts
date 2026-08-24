/**
 * Package Delivery SCT bridge: every delivered+paid delivery_request must have a
 * linked `orders` row with Stripe source + driver payout before transfers/run.
 *
 * Historical orphans (delivered, paid, null driver_paid_out, no linked order)
 * stay forever in Wallet awaiting_transfer_cents until this runs.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshOrderCommissions } from "@/lib/refreshOrderCommissions";

export type EnsurePackageDriverSctOrderResult =
  | {
      ok: true;
      orderId: string;
      created: boolean;
      updated: boolean;
      fundable: true;
    }
  | {
      ok: false;
      error: string;
      fundable?: false;
      deliveryRequestId?: string;
    };

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Ensure a package delivery_request has a linked order ready for driver SCT.
 * Copies Stripe PI / session, driver_id, driver_delivery_payout, delivered status.
 */
export async function ensurePackageDriverSctOrder(
  supabaseAdmin: SupabaseClient,
  deliveryRequestId: string,
): Promise<EnsurePackageDriverSctOrderResult> {
  const id = String(deliveryRequestId ?? "").trim();
  if (!id) {
    return { ok: false, error: "missing_delivery_request_id" };
  }

  const { data: delivery, error } = await supabaseAdmin
    .from("delivery_requests")
    .select(
      "id, created_by, client_user_id, payment_status, paid_at, status, driver_id, driver_delivery_payout, driver_paid_out, stripe_payment_intent_id, stripe_session_id, pickup_address, dropoff_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, distance_miles, delivery_fee, total, currency, delivered_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) return { ok: false, error: error.message, deliveryRequestId: id };
  if (!delivery) {
    return { ok: false, error: "delivery_request_not_found", deliveryRequestId: id };
  }

  if (String(delivery.payment_status ?? "").toLowerCase() !== "paid") {
    return { ok: false, error: "payment_not_confirmed", deliveryRequestId: id };
  }

  const stripePi = String(delivery.stripe_payment_intent_id ?? "").trim();
  const stripeSession = String(delivery.stripe_session_id ?? "").trim();
  if (!stripePi && !stripeSession) {
    return {
      ok: false,
      error: "unfunded_no_stripe_source",
      fundable: false,
      deliveryRequestId: id,
    };
  }

  // Package order rows inherit paid only from a delivery_request already settled
  // with a Stripe reference (webhook / confirm-delivery-request-paid SoT).
  if (!delivery.paid_at) {
    return {
      ok: false,
      error: "payment_not_settled",
      fundable: false,
      deliveryRequestId: id,
    };
  }

  const clientId = String(
    delivery.client_user_id ?? delivery.created_by ?? "",
  ).trim();
  if (!clientId) {
    return { ok: false, error: "missing_client", deliveryRequestId: id };
  }

  const driverId = String(delivery.driver_id ?? "").trim() || null;
  const driverPayout = toNumber(delivery.driver_delivery_payout);
  const delivered =
    String(delivery.status ?? "").toLowerCase() === "delivered";
  const nowIso = new Date().toISOString();

  const { data: existingOrder } = await supabaseAdmin
    .from("orders")
    .select(
      "id, driver_id, driver_delivery_payout, driver_transfer_id, stripe_payment_intent_id, stripe_session_id, status, payment_status",
    )
    .eq("external_ref_id", id)
    .eq("external_ref_type", "delivery_request")
    .maybeSingle();

  if (existingOrder?.id) {
    const orderId = String(existingOrder.id);
    if (existingOrder.driver_transfer_id) {
      // Already SCT'd — mirror paid flag on delivery_request if needed.
      if (delivery.driver_paid_out !== true) {
        await supabaseAdmin
          .from("delivery_requests")
          .update({
            driver_paid_out: true,
            driver_paid_out_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", id)
          .eq("driver_paid_out", false);
      }
      return { ok: true, orderId, created: false, updated: false, fundable: true };
    }

    const patch: Record<string, unknown> = { updated_at: nowIso };
    if (driverId && !existingOrder.driver_id) patch.driver_id = driverId;
    if (
      driverPayout > 0 &&
      toNumber(existingOrder.driver_delivery_payout) <= 0
    ) {
      patch.driver_delivery_payout = driverPayout;
    }
    if (stripePi && !existingOrder.stripe_payment_intent_id) {
      patch.stripe_payment_intent_id = stripePi;
    }
    if (stripeSession && !existingOrder.stripe_session_id) {
      patch.stripe_session_id = stripeSession;
    }
    if (delivered && String(existingOrder.status ?? "").toLowerCase() !== "delivered") {
      patch.status = "delivered";
      patch.delivered_confirmed_at =
        delivery.delivered_at ?? nowIso;
    }
    if (String(existingOrder.payment_status ?? "").toLowerCase() !== "paid") {
      patch.payment_status = "paid";
      patch.paid_at = delivery.paid_at;
      if (stripePi) patch.stripe_payment_intent_id = stripePi;
      if (stripeSession) patch.stripe_session_id = stripeSession;
    }

    let updated = false;
    if (Object.keys(patch).length > 1) {
      const { error: updErr } = await supabaseAdmin
        .from("orders")
        .update(patch)
        .eq("id", orderId);
      if (updErr) {
        return { ok: false, error: updErr.message, deliveryRequestId: id };
      }
      updated = true;
    }

    await refreshOrderCommissions(supabaseAdmin, orderId).catch(() => null);

    // Package SoT: delivery_request.driver_delivery_payout wins over commission
    // recompute (refresh can drift legacy package fee formulas).
    if (driverPayout > 0) {
      await supabaseAdmin
        .from("orders")
        .update({
          driver_delivery_payout: driverPayout,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId)
        .is("driver_transfer_id", null);

      const driverCents = Math.round(driverPayout * 100);
      await supabaseAdmin
        .from("order_commissions")
        .update({
          driver_cents: driverCents,
          driver_amount: driverPayout,
        })
        .eq("order_id", orderId);
    }

    return { ok: true, orderId, created: false, updated, fundable: true };
  }

  const { data: orderData, error: orderError } = await supabaseAdmin
    .from("orders")
    .insert({
      // Match syncPaidDeliveryRequestOrder shape so SCT / commissions RPCs accept the row.
      kind: "pickup_dropoff",
      status: delivered ? "delivered" : "pending",
      payment_status: "paid",
      paid_at: delivery.paid_at ?? nowIso,
      delivered_confirmed_at: delivered
        ? (delivery.delivered_at ?? nowIso)
        : null,
      driver_id: driverId,
      driver_delivery_payout: driverPayout > 0 ? driverPayout : null,
      stripe_payment_intent_id: stripePi || null,
      stripe_session_id: stripeSession || null,
      created_by: delivery.created_by ?? clientId,
      client_id: clientId,
      user_id: clientId,
      client_user_id: clientId,
      pickup_address: delivery.pickup_address,
      dropoff_address: delivery.dropoff_address,
      pickup_lat: delivery.pickup_lat,
      pickup_lng: delivery.pickup_lng,
      dropoff_lat: delivery.dropoff_lat,
      dropoff_lng: delivery.dropoff_lng,
      distance_miles: delivery.distance_miles,
      delivery_fee: delivery.delivery_fee,
      total: delivery.total,
      currency: delivery.currency,
      external_ref_id: delivery.id,
      external_ref_type: "delivery_request",
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id")
    .single();

  if (orderError || !orderData?.id) {
    return {
      ok: false,
      error: orderError?.message ?? "order_create_failed",
      deliveryRequestId: id,
    };
  }

  const orderId = String(orderData.id);

  await supabaseAdmin.from("order_members").upsert(
    [{ order_id: orderId, user_id: clientId, role: "client" }],
    { onConflict: "order_id,user_id", ignoreDuplicates: false },
  );

  await refreshOrderCommissions(supabaseAdmin, orderId).catch(() => null);

  if (driverPayout > 0) {
    await supabaseAdmin
      .from("orders")
      .update({
        driver_delivery_payout: driverPayout,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .is("driver_transfer_id", null);

    const driverCents = Math.round(driverPayout * 100);
    await supabaseAdmin
      .from("order_commissions")
      .update({
        driver_cents: driverCents,
        driver_amount: driverPayout,
      })
      .eq("order_id", orderId);
  }

  return { ok: true, orderId, created: true, updated: false, fundable: true };
}

/**
 * Backfill: find delivered+paid package orphans for a driver (or globally) and
 * ensure linked SCT orders exist. Does not itself call Stripe — caller runs
 * transfers/run or process-payouts afterward.
 */
export async function ensureOrphanPackageDriverSctOrders(
  supabaseAdmin: SupabaseClient,
  params?: { driverUserId?: string; limit?: number },
): Promise<{
  attempted: number;
  ensured: number;
  unfunded: number;
  orderIds: string[];
  errors: string[];
}> {
  const limit = Math.min(Math.max(params?.limit ?? 25, 1), 100);
  const errors: string[] = [];
  const orderIds: string[] = [];
  let ensured = 0;
  let unfunded = 0;

  let query = supabaseAdmin
    .from("delivery_requests")
    .select("id, driver_id, driver_paid_out, driver_payout_id, payment_status, status")
    .eq("status", "delivered")
    .eq("payment_status", "paid")
    .or("driver_paid_out.is.null,driver_paid_out.eq.false")
    .is("driver_payout_id", null)
    .order("delivered_at", { ascending: true, nullsFirst: false })
    .limit(limit);

  if (params?.driverUserId) {
    query = query.eq("driver_id", params.driverUserId);
  }

  const { data: rows, error } = await query;
  if (error) {
    return {
      attempted: 0,
      ensured: 0,
      unfunded: 0,
      orderIds: [],
      errors: [error.message],
    };
  }

  for (const row of rows ?? []) {
    const drId = String(row.id ?? "").trim();
    if (!drId) continue;

    // Skip if a linked order already has a transfer (wallet should exclude via SoT).
    const { data: linked } = await supabaseAdmin
      .from("orders")
      .select("id, driver_transfer_id")
      .eq("external_ref_id", drId)
      .eq("external_ref_type", "delivery_request")
      .maybeSingle();

    if (linked?.driver_transfer_id) {
      await supabaseAdmin
        .from("delivery_requests")
        .update({
          driver_paid_out: true,
          driver_paid_out_at: new Date().toISOString(),
        })
        .eq("id", drId)
        .or("driver_paid_out.is.null,driver_paid_out.eq.false");
      continue;
    }

    const out = await ensurePackageDriverSctOrder(supabaseAdmin, drId);
    if (out.ok === true) {
      ensured += 1;
      orderIds.push(out.orderId);
    } else if (out.ok === false && out.error === "unfunded_no_stripe_source") {
      unfunded += 1;
      errors.push(`${drId}:unfunded_no_stripe_source`);
    } else if (out.ok === false) {
      errors.push(`${drId}:${out.error}`);
    }
  }

  return {
    attempted: (rows ?? []).length,
    ensured,
    unfunded,
    orderIds,
    errors,
  };
}
