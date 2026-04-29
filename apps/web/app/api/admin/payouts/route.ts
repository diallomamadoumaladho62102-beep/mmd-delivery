import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanAccessPayouts,
} from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PayoutTarget = "restaurant" | "driver";
type PayoutStatus = "pending" | "processing" | "succeeded" | "failed" | string;
type OrderType = "restaurant" | "errand";

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
  driver_paid_out: boolean;
  driver_paid_out_at: string | null;
  driver_transfer_id: string | null;
};

type OrderPayoutRow = {
  id: string;
  order_id: string;
  target: PayoutTarget | string;
  status: PayoutStatus;
  currency: string | null;
  amount_cents: number | null;
  destination_account_id: string | null;
  source_charge_id: string | null;
  stripe_transfer_id: string | null;
  idempotency_key: string | null;
  failure_code: string | null;
  failure_message: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  succeeded_at: string | null;
  failed_at: string | null;
};

type OrderCommissionRow = {
  order_id: string;
  restaurant_cents: number | null;
  driver_cents: number | null;
  platform_cents: number | null;
};

type DashboardStatus =
  | "completed"
  | "partial"
  | "failed"
  | "unpaid"
  | "paid_no_payout"
  | "data_mismatch";

type PayoutSide = {
  payout_status: string | null;
  amount_cents: number | null;
  destination_account_id: string | null;
  source_charge_id: string | null;
  payout_transfer_id: string | null;
  failure_code: string | null;
  failure_message: string | null;
  last_error: string | null;
  succeeded_at: string | null;
  failed_at: string | null;
};

type DashboardItem = {
  order_id: string;
  order_type: OrderType;
  created_at: string;
  order_status: string;
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

  driver_paid_out: boolean;
  driver_paid_out_at: string | null;
  driver_transfer_id: string | null;

  restaurant_payout_status: string | null;
  restaurant_amount_cents: number | null;
  restaurant_destination_account_id: string | null;
  restaurant_source_charge_id: string | null;
  restaurant_payout_transfer_id: string | null;
  restaurant_failure_code: string | null;
  restaurant_failure_message: string | null;
  restaurant_last_error: string | null;
  restaurant_succeeded_at: string | null;
  restaurant_failed_at: string | null;

  driver_payout_status: string | null;
  driver_amount_cents: number | null;
  driver_destination_account_id: string | null;
  driver_source_charge_id: string | null;
  driver_payout_transfer_id: string | null;
  driver_failure_code: string | null;
  driver_failure_message: string | null;
  driver_last_error: string | null;
  driver_succeeded_at: string | null;
  driver_failed_at: string | null;

  platform_amount_cents: number;

  dashboard_status: DashboardStatus;
};

type PayoutPair = {
  restaurant?: OrderPayoutRow;
  driver?: OrderPayoutRow;
};

function isPayoutTarget(value: string): value is PayoutTarget {
  return value === "restaurant" || value === "driver";
}

function toSide(payout?: OrderPayoutRow): PayoutSide {
  return {
    payout_status: payout?.status ?? null,
    amount_cents: payout?.amount_cents ?? null,
    destination_account_id: payout?.destination_account_id ?? null,
    source_charge_id: payout?.source_charge_id ?? null,
    payout_transfer_id: payout?.stripe_transfer_id ?? null,
    failure_code: payout?.failure_code ?? null,
    failure_message: payout?.failure_message ?? null,
    last_error: payout?.last_error ?? null,
    succeeded_at: payout?.succeeded_at ?? null,
    failed_at: payout?.failed_at ?? null,
  };
}

function getOrderType(order: OrderRow): OrderType {
  return order.restaurant_name ? "restaurant" : "errand";
}

function deriveDashboardStatus(
  order: OrderRow,
  restaurant?: OrderPayoutRow,
  driver?: OrderPayoutRow
): DashboardStatus {
  const orderType = getOrderType(order);
  const isErrand = orderType === "errand";

  const restaurantFailed = !isErrand && restaurant?.status === "failed";
  const driverFailed = driver?.status === "failed";

  const restaurantSucceeded =
    !isErrand &&
    (restaurant?.status === "succeeded" ||
      (order.restaurant_paid_out === true &&
        Boolean(order.restaurant_transfer_id)));

  const driverSucceeded =
    driver?.status === "succeeded" ||
    (order.driver_paid_out === true && Boolean(order.driver_transfer_id));

  const hasMismatch =
    (!isErrand &&
      order.restaurant_paid_out === true &&
      !order.restaurant_transfer_id) ||
    (order.driver_paid_out === true && !order.driver_transfer_id);

  if (hasMismatch) return "data_mismatch";
  if (restaurantFailed || driverFailed) return "failed";
  if (order.payment_status !== "paid") return "unpaid";

  if (isErrand) {
    if (driverSucceeded) return "completed";
    return "paid_no_payout";
  }

  if (restaurantSucceeded && driverSucceeded) return "completed";
  if (restaurantSucceeded || driverSucceeded) return "partial";

  return "paid_no_payout";
}

function getPayoutSortTimestamp(payout: OrderPayoutRow): number {
  const timestamp = Date.parse(payout.updated_at || payout.created_at);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function pickLatestPayout(
  current: OrderPayoutRow | undefined,
  candidate: OrderPayoutRow
): OrderPayoutRow {
  if (!current) return candidate;

  return getPayoutSortTimestamp(candidate) >= getPayoutSortTimestamp(current)
    ? candidate
    : current;
}

function buildPayoutsByOrderId(
  payouts: OrderPayoutRow[]
): Map<string, PayoutPair> {
  const payoutsByOrderId = new Map<string, PayoutPair>();

  for (const payout of payouts) {
    if (!isPayoutTarget(payout.target)) continue;

    const current = payoutsByOrderId.get(payout.order_id) ?? {};

    if (payout.target === "restaurant") {
      current.restaurant = pickLatestPayout(current.restaurant, payout);
    }

    if (payout.target === "driver") {
      current.driver = pickLatestPayout(current.driver, payout);
    }

    payoutsByOrderId.set(payout.order_id, current);
  }

  return payoutsByOrderId;
}

function cents(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function calculatePlatformAmountCents(params: {
  totalCents: number | null;
  restaurantAmountCents: number | null;
  driverAmountCents: number | null;
  commissionPlatformCents: number | null | undefined;
}): number {
  if (params.commissionPlatformCents != null) {
    return Math.max(0, cents(params.commissionPlatformCents));
  }

  const total = cents(params.totalCents);
  const restaurant = cents(params.restaurantAmountCents);
  const driver = cents(params.driverAmountCents);

  return Math.max(0, total - restaurant - driver);
}

function buildDashboardItems(
  orders: OrderRow[],
  payoutsByOrderId: Map<string, PayoutPair>,
  commissionsByOrderId: Map<string, OrderCommissionRow>
): DashboardItem[] {
  return orders.map((order) => {
    const pair = payoutsByOrderId.get(order.id) ?? {};
    const commission = commissionsByOrderId.get(order.id);

    const orderType = getOrderType(order);
    const isErrand = orderType === "errand";

    const restaurantSide = toSide(pair.restaurant);
    const driverSide = toSide(pair.driver);

    const restaurantAmountCents = isErrand
      ? 0
      : commission?.restaurant_cents ?? restaurantSide.amount_cents;

    const driverAmountCents =
      commission?.driver_cents ?? driverSide.amount_cents;

    const platformAmountCents = calculatePlatformAmountCents({
      totalCents: order.total_cents,
      restaurantAmountCents,
      driverAmountCents,
      commissionPlatformCents: commission?.platform_cents,
    });

    return {
      order_id: order.id,
      order_type: orderType,
      created_at: order.created_at,
      order_status: order.status,
      payment_status: order.payment_status,
      restaurant_name: order.restaurant_name,
      currency: order.currency,
      total: order.total,
      total_cents: order.total_cents,
      paid_at: order.paid_at,
      picked_up_at: order.picked_up_at,
      delivered_confirmed_at: order.delivered_confirmed_at,

      restaurant_paid_out: isErrand ? false : order.restaurant_paid_out,
      restaurant_paid_out_at: isErrand ? null : order.restaurant_paid_out_at,
      restaurant_transfer_id: isErrand ? null : order.restaurant_transfer_id,

      driver_paid_out: order.driver_paid_out,
      driver_paid_out_at: order.driver_paid_out_at,
      driver_transfer_id: order.driver_transfer_id,

      restaurant_payout_status: isErrand ? null : restaurantSide.payout_status,
      restaurant_amount_cents: restaurantAmountCents,
      restaurant_destination_account_id: isErrand
        ? null
        : restaurantSide.destination_account_id,
      restaurant_source_charge_id: isErrand
        ? null
        : restaurantSide.source_charge_id,
      restaurant_payout_transfer_id: isErrand
        ? null
        : restaurantSide.payout_transfer_id,
      restaurant_failure_code: isErrand ? null : restaurantSide.failure_code,
      restaurant_failure_message: isErrand
        ? null
        : restaurantSide.failure_message,
      restaurant_last_error: isErrand ? null : restaurantSide.last_error,
      restaurant_succeeded_at: isErrand ? null : restaurantSide.succeeded_at,
      restaurant_failed_at: isErrand ? null : restaurantSide.failed_at,

      driver_payout_status: driverSide.payout_status,
      driver_amount_cents: driverAmountCents,
      driver_destination_account_id: driverSide.destination_account_id,
      driver_source_charge_id: driverSide.source_charge_id,
      driver_payout_transfer_id: driverSide.payout_transfer_id,
      driver_failure_code: driverSide.failure_code,
      driver_failure_message: driverSide.failure_message,
      driver_last_error: driverSide.last_error,
      driver_succeeded_at: driverSide.succeeded_at,
      driver_failed_at: driverSide.failed_at,

      platform_amount_cents: platformAmountCents,

      dashboard_status: deriveDashboardStatus(order, pair.restaurant, pair.driver),
    };
  });
}

function buildSummary(items: DashboardItem[]) {
  return {
    total_orders: items.length,
    paid_orders: items.filter((item) => item.payment_status === "paid").length,
    restaurant_paid_out_orders: items.filter(
      (item) => item.restaurant_paid_out
    ).length,
    driver_paid_out_orders: items.filter((item) => item.driver_paid_out).length,
    orders_with_failed_payouts: items.filter(
      (item) => item.dashboard_status === "failed"
    ).length,
    completed_orders: items.filter(
      (item) => item.dashboard_status === "completed"
    ).length,
    partial_orders: items.filter(
      (item) => item.dashboard_status === "partial"
    ).length,
    unpaid_orders: items.filter(
      (item) => item.dashboard_status === "unpaid"
    ).length,
    mismatch_orders: items.filter(
      (item) => item.dashboard_status === "data_mismatch"
    ).length,
    paid_no_payout_orders: items.filter(
      (item) => item.dashboard_status === "paid_no_payout"
    ).length,
  };
}

export async function GET(request: NextRequest) {
  try {
    await assertCanAccessPayouts(request);

    const supabase = buildSupabaseAdminClient();

    const { data: orders, error: ordersError } = await supabase
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
          driver_paid_out,
          driver_paid_out_at,
          driver_transfer_id
        `
      )
      .order("created_at", { ascending: false })
      .limit(200);

    if (ordersError) {
      throw new Error(`Failed to load orders: ${ordersError.message}`);
    }

    const typedOrders = (orders ?? []) as OrderRow[];
    const orderIds = typedOrders.map((order) => order.id);

    let payouts: OrderPayoutRow[] = [];
    let commissions: OrderCommissionRow[] = [];

    if (orderIds.length > 0) {
      const { data: payoutsData, error: payoutsError } = await supabase
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
            failure_code,
            failure_message,
            last_error,
            created_at,
            updated_at,
            succeeded_at,
            failed_at
          `
        )
        .in("order_id", orderIds);

      if (payoutsError) {
        throw new Error(`Failed to load order_payouts: ${payoutsError.message}`);
      }

      payouts = (payoutsData ?? []) as OrderPayoutRow[];

      const { data: commissionsData, error: commissionsError } = await supabase
        .from("order_commissions")
        .select("order_id, restaurant_cents, driver_cents, platform_cents")
        .in("order_id", orderIds);

      if (commissionsError) {
        throw new Error(
          `Failed to load order_commissions: ${commissionsError.message}`
        );
      }

      commissions = (commissionsData ?? []) as OrderCommissionRow[];
    }

    const payoutsByOrderId = buildPayoutsByOrderId(payouts);
    const commissionsByOrderId = new Map(
      commissions.map((commission) => [commission.order_id, commission])
    );

    const items = buildDashboardItems(
      typedOrders,
      payoutsByOrderId,
      commissionsByOrderId
    );

    const summary = buildSummary(items);

    return NextResponse.json(
      {
        ok: true,
        items,
        summary,
      },
      { status: 200 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown admin payouts error";

    const status = error instanceof AdminAccessError ? error.status : 500;

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status }
    );
  }
}