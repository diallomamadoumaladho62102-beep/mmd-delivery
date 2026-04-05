import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanAccessPayouts,
} from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PayoutTarget = "restaurant" | "driver";

type OrderRow = {
  id: string;
  created_at: string;
  status: string;
  payment_status: string;
  restaurant_name: string | null;
  currency: string | null;
  total: number | null;
  total_cents: number | null;
  paid_at: string | null;
  picked_up_at: string | null;
  delivered_confirmed_at: string | null;

  restaurant_paid_out: boolean;
  restaurant_paid_out_at: string | null;
  restaurant_transfer_id: string | null;
  restaurant_payout_id: string | null;

  driver_paid_out: boolean;
  driver_paid_out_at: string | null;
  driver_transfer_id: string | null;
  driver_payout_id: string | null;

  stripe_payment_intent_id: string | null;
  stripe_session_id: string | null;

  user_id: string | null;
  client_id: string | null;
  client_user_id: string | null;
  driver_id: string | null;
  restaurant_id: string;
  restaurant_user_id: string | null;

  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;

  subtotal: number | null;
  tax: number | null;
  total_amount_alias?: number | null;
  delivery_fee: number | null;
  delivery_fee_cents: number | null;
  taxes_cents: number | null;
  tip: number | null;
  tip_cents: number | null;

  restaurant_net_amount: number | null;
  restaurant_commission_amount: number | null;
  restaurant_commission_rate: number | null;
  driver_delivery_payout: number | null;
  platform_delivery_fee: number | null;

  distance_miles: number | null;
  eta_minutes: number | null;
  distance_miles_est: number | null;
  eta_minutes_est: number | null;

  kind: string | null;
  order_type: string | null;
  type: string | null;
  title: string | null;
};

type OrderPayoutRow = {
  id: string;
  order_id: string;
  target: PayoutTarget | string;
  status: string;
  currency: string | null;
  amount_cents: number | null;
  destination_account_id: string | null;
  source_charge_id: string | null;
  stripe_transfer_id: string | null;
  idempotency_key: string | null;
  locked_at: string | null;
  locked_by: string | null;
  failure_code: string | null;
  failure_message: string | null;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  succeeded_at: string | null;
  failed_at: string | null;
};

type DashboardStatus =
  | "completed"
  | "partial"
  | "failed"
  | "unpaid"
  | "paid_no_payout"
  | "data_mismatch";

type TimelineTone = "default" | "success" | "danger";

type TimelineItem = {
  key: string;
  label: string;
  at: string;
  tone: TimelineTone;
};

function normalizeOrderId(value: string): string {
  return value.trim();
}

function isPayoutTarget(value: string): value is PayoutTarget {
  return value === "restaurant" || value === "driver";
}

function getTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function deriveDashboardStatus(
  order: Pick<
    OrderRow,
    | "payment_status"
    | "restaurant_paid_out"
    | "restaurant_transfer_id"
    | "driver_paid_out"
    | "driver_transfer_id"
  >,
  restaurant?: OrderPayoutRow,
  driver?: OrderPayoutRow
): DashboardStatus {
  const restaurantFailed = restaurant?.status === "failed";
  const driverFailed = driver?.status === "failed";

  const restaurantSucceeded =
    restaurant?.status === "succeeded" ||
    (order.restaurant_paid_out === true && !!order.restaurant_transfer_id);

  const driverSucceeded =
    driver?.status === "succeeded" ||
    (order.driver_paid_out === true && !!order.driver_transfer_id);

  const hasMismatch =
    (order.restaurant_paid_out === true && !order.restaurant_transfer_id) ||
    (order.driver_paid_out === true && !order.driver_transfer_id);

  if (hasMismatch) return "data_mismatch";
  if (restaurantFailed || driverFailed) return "failed";
  if (order.payment_status !== "paid") return "unpaid";
  if (restaurantSucceeded && driverSucceeded) return "completed";
  if (restaurantSucceeded || driverSucceeded) return "partial";
  return "paid_no_payout";
}

function buildTimeline(
  order: OrderRow,
  restaurantPayout: OrderPayoutRow | undefined,
  driverPayout: OrderPayoutRow | undefined
): TimelineItem[] {
  const timeline: Array<{
    key: string;
    label: string;
    at: string | null | undefined;
    tone: TimelineTone;
  }> = [
    {
      key: "order_created",
      label: "Order created",
      at: order.created_at,
      tone: "default",
    },
    {
      key: "order_paid",
      label: "Order paid",
      at: order.paid_at,
      tone: "success",
    },
    {
      key: "picked_up",
      label: "Picked up",
      at: order.picked_up_at,
      tone: "default",
    },
    {
      key: "delivered",
      label: "Delivered confirmed",
      at: order.delivered_confirmed_at,
      tone: "success",
    },
    {
      key: "restaurant_payout",
      label: "Restaurant payout succeeded",
      at: restaurantPayout?.succeeded_at ?? order.restaurant_paid_out_at,
      tone: "success",
    },
    {
      key: "driver_payout",
      label: "Driver payout succeeded",
      at: driverPayout?.succeeded_at ?? order.driver_paid_out_at,
      tone: "success",
    },
    {
      key: "restaurant_failed",
      label: "Restaurant payout failed",
      at: restaurantPayout?.failed_at,
      tone: "danger",
    },
    {
      key: "driver_failed",
      label: "Driver payout failed",
      at: driverPayout?.failed_at,
      tone: "danger",
    },
  ];

  return timeline
    .filter((item): item is TimelineItem => Boolean(item.at))
    .sort((a, b) => getTimestamp(a.at) - getTimestamp(b.at));
}

async function loadOrder(
  supabase: ReturnType<typeof buildSupabaseAdminClient>,
  orderId: string
): Promise<OrderRow | null> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      `
        id,
        created_at,
        status,
        payment_status,
        restaurant_name,
        currency,
        total,
        total_cents,
        paid_at,
        picked_up_at,
        delivered_confirmed_at,
        restaurant_paid_out,
        restaurant_paid_out_at,
        restaurant_transfer_id,
        restaurant_payout_id,
        driver_paid_out,
        driver_paid_out_at,
        driver_transfer_id,
        driver_payout_id,
        stripe_payment_intent_id,
        stripe_session_id,
        user_id,
        client_id,
        client_user_id,
        driver_id,
        restaurant_id,
        restaurant_user_id,
        pickup_address,
        dropoff_address,
        pickup_lat,
        pickup_lng,
        dropoff_lat,
        dropoff_lng,
        subtotal,
        tax,
        delivery_fee,
        delivery_fee_cents,
        taxes_cents,
        tip,
        tip_cents,
        restaurant_net_amount,
        restaurant_commission_amount,
        restaurant_commission_rate,
        driver_delivery_payout,
        platform_delivery_fee,
        distance_miles,
        eta_minutes,
        distance_miles_est,
        eta_minutes_est,
        kind,
        order_type,
        type,
        title
      `
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load order: ${error.message}`);
  }

  return (data as OrderRow | null) ?? null;
}

async function loadOrderPayouts(
  supabase: ReturnType<typeof buildSupabaseAdminClient>,
  orderId: string
): Promise<OrderPayoutRow[]> {
  const { data, error } = await supabase
    .from("order_payouts")
    .select(
      `
        id,
        order_id,
        target,
        status,
        currency,
        amount_cents,
        destination_account_id,
        source_charge_id,
        stripe_transfer_id,
        idempotency_key,
        locked_at,
        locked_by,
        failure_code,
        failure_message,
        last_error,
        metadata,
        created_at,
        updated_at,
        succeeded_at,
        failed_at
      `
    )
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load payouts: ${error.message}`);
  }

  return (data ?? []) as OrderPayoutRow[];
}

function getLatestPayoutForTarget(
  payouts: OrderPayoutRow[],
  target: PayoutTarget
): OrderPayoutRow | undefined {
  const targetRows = payouts.filter(
    (payout) => isPayoutTarget(payout.target) && payout.target === target
  );

  return [...targetRows].sort((a, b) => {
    const byUpdated = getTimestamp(b.updated_at) - getTimestamp(a.updated_at);
    if (byUpdated !== 0) {
      return byUpdated;
    }

    return getTimestamp(b.created_at) - getTimestamp(a.created_at);
  })[0];
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ orderId: string }> }
) {
  try {
    await assertCanAccessPayouts();

    const { orderId: rawOrderId } = await context.params;
    const orderId = normalizeOrderId(rawOrderId ?? "");

    if (!orderId) {
      return NextResponse.json(
        { ok: false, error: "Missing orderId" },
        { status: 400 }
      );
    }

    const supabase = buildSupabaseAdminClient();

    const order = await loadOrder(supabase, orderId);

    if (!order) {
      return NextResponse.json(
        { ok: false, error: "Order not found" },
        { status: 404 }
      );
    }

    const payouts = await loadOrderPayouts(supabase, orderId);
    const restaurantPayout = getLatestPayoutForTarget(payouts, "restaurant");
    const driverPayout = getLatestPayoutForTarget(payouts, "driver");

    const dashboardStatus = deriveDashboardStatus(
      order,
      restaurantPayout,
      driverPayout
    );

    const timeline = buildTimeline(order, restaurantPayout, driverPayout);

    return NextResponse.json(
      {
        ok: true,
        item: {
          order,
          payouts,
          restaurant_payout: restaurantPayout ?? null,
          driver_payout: driverPayout ?? null,
          dashboard_status: dashboardStatus,
          timeline,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown admin payout detail error";

    const status = error instanceof AdminAccessError ? error.status : 500;

    return NextResponse.json(
      { ok: false, error: message },
      { status }
    );
  }
}