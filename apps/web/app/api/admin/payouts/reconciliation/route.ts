import { NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanAccessAuditLogs,
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

  driver_paid_out: boolean;
  driver_paid_out_at: string | null;
  driver_transfer_id: string | null;
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

type PayoutPair = {
  restaurant?: OrderPayoutRow;
  driver?: OrderPayoutRow;
};

type AnomalyKind =
  | "paid_without_any_payout_rows"
  | "paid_without_restaurant_payout"
  | "paid_without_driver_payout"
  | "restaurant_failed"
  | "driver_failed"
  | "partial_payout"
  | "restaurant_paid_flag_missing_transfer"
  | "driver_paid_flag_missing_transfer"
  | "restaurant_succeeded_missing_order_sync"
  | "driver_succeeded_missing_order_sync"
  | "order_transfer_missing_but_payout_has_transfer"
  | "payout_row_transfer_missing"
  | "duplicate_target_rows";

type ReviewRow = {
  order_id: string;
  anomaly_kind: string;
  status: string;
  is_reviewed: boolean;
  is_resolved: boolean;
  admin_note: string | null;
  actor: string | null;
  updated_at: string;
};

type AnomalySeverity = "high" | "medium" | "low";

type DashboardStatus =
  | "completed"
  | "partial"
  | "failed"
  | "unpaid"
  | "paid_no_payout"
  | "data_mismatch";

type AnomalyItem = {
  anomaly_id: string;
  anomaly_kind: AnomalyKind;
  severity: AnomalySeverity;
  title: string;
  description: string;

  order_id: string;
  created_at: string;
  restaurant_name: string | null;
  order_status: string;
  payment_status: string;
  dashboard_status: DashboardStatus;
  currency: string | null;
  total: number | null;
  total_cents: number | null;

  restaurant_paid_out: boolean;
  restaurant_transfer_id: string | null;
  restaurant_payout_status: string | null;
  restaurant_payout_transfer_id: string | null;

  driver_paid_out: boolean;
  driver_transfer_id: string | null;
  driver_payout_status: string | null;
  driver_payout_transfer_id: string | null;

  restaurant_failure_message: string | null;
  driver_failure_message: string | null;

  review_status: "open" | "reviewed" | "resolved";
  review_is_reviewed: boolean;
  review_is_resolved: boolean;
  review_admin_note: string | null;
  review_actor: string | null;
  review_updated_at: string | null;

  last_activity: string | null;
};

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

function getLastActivity(
  order: OrderRow,
  restaurant?: OrderPayoutRow,
  driver?: OrderPayoutRow
): string | null {
  const candidates = [
    driver?.succeeded_at,
    restaurant?.succeeded_at,
    driver?.failed_at,
    restaurant?.failed_at,
    order.driver_paid_out_at,
    order.restaurant_paid_out_at,
    order.delivered_confirmed_at,
    order.picked_up_at,
    order.paid_at,
    order.created_at,
  ].filter(Boolean) as string[];

  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((a, b) => getTimestamp(b) - getTimestamp(a))[0];
}

function deriveDashboardStatus(
  order: OrderRow,
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

function pickLatestReview(
  current: ReviewRow | undefined,
  candidate: ReviewRow
): ReviewRow {
  if (!current) {
    return candidate;
  }

  return getTimestamp(candidate.updated_at) >= getTimestamp(current.updated_at)
    ? candidate
    : current;
}

function buildReviewMap(reviews: ReviewRow[]): Map<string, ReviewRow> {
  const reviewMap = new Map<string, ReviewRow>();

  for (const review of reviews) {
    const key = `${review.order_id}:${review.anomaly_kind}`;
    const current = reviewMap.get(key);
    reviewMap.set(key, pickLatestReview(current, review));
  }

  return reviewMap;
}

function buildPayoutsGrouped(
  payouts: OrderPayoutRow[]
): Map<string, OrderPayoutRow[]> {
  const grouped = new Map<string, OrderPayoutRow[]>();

  for (const payout of payouts) {
    const current = grouped.get(payout.order_id) ?? [];
    current.push(payout);
    grouped.set(payout.order_id, current);
  }

  return grouped;
}

function getLatestPayout(rows: OrderPayoutRow[]): OrderPayoutRow | undefined {
  return [...rows].sort((a, b) => {
    const byUpdated = getTimestamp(b.updated_at) - getTimestamp(a.updated_at);
    if (byUpdated !== 0) {
      return byUpdated;
    }

    return getTimestamp(b.created_at) - getTimestamp(a.created_at);
  })[0];
}

function makeAnomalyBase(
  order: OrderRow,
  restaurant: OrderPayoutRow | undefined,
  driver: OrderPayoutRow | undefined,
  anomalyKind: AnomalyKind,
  severity: AnomalySeverity,
  title: string,
  description: string,
  reviewMap: Map<string, ReviewRow>
): AnomalyItem {
  const review = reviewMap.get(`${order.id}:${anomalyKind}`);

  return {
    anomaly_id: `${anomalyKind}:${order.id}`,
    anomaly_kind: anomalyKind,
    severity,
    title,
    description,

    order_id: order.id,
    created_at: order.created_at,
    restaurant_name: order.restaurant_name,
    order_status: order.status,
    payment_status: order.payment_status,
    dashboard_status: deriveDashboardStatus(order, restaurant, driver),
    currency: order.currency,
    total: order.total,
    total_cents: order.total_cents,

    restaurant_paid_out: order.restaurant_paid_out,
    restaurant_transfer_id: order.restaurant_transfer_id,
    restaurant_payout_status: restaurant?.status ?? null,
    restaurant_payout_transfer_id: restaurant?.stripe_transfer_id ?? null,

    driver_paid_out: order.driver_paid_out,
    driver_transfer_id: order.driver_transfer_id,
    driver_payout_status: driver?.status ?? null,
    driver_payout_transfer_id: driver?.stripe_transfer_id ?? null,

    restaurant_failure_message:
      restaurant?.failure_message ?? restaurant?.last_error ?? null,
    driver_failure_message: driver?.failure_message ?? driver?.last_error ?? null,

    review_status:
      review?.status === "resolved"
        ? "resolved"
        : review?.status === "reviewed"
          ? "reviewed"
          : "open",
    review_is_reviewed: review?.is_reviewed ?? false,
    review_is_resolved: review?.is_resolved ?? false,
    review_admin_note: review?.admin_note ?? null,
    review_actor: review?.actor ?? null,
    review_updated_at: review?.updated_at ?? null,

    last_activity: getLastActivity(order, restaurant, driver),
  };
}

function buildSummary(anomalies: AnomalyItem[], totalOrdersScanned: number) {
  return {
    total_orders_scanned: totalOrdersScanned,
    total_anomalies: anomalies.length,
    high_severity: anomalies.filter((item) => item.severity === "high").length,
    medium_severity: anomalies.filter((item) => item.severity === "medium").length,
    low_severity: anomalies.filter((item) => item.severity === "low").length,

    paid_without_any_payout_rows: anomalies.filter(
      (item) => item.anomaly_kind === "paid_without_any_payout_rows"
    ).length,
    payout_failed: anomalies.filter(
      (item) =>
        item.anomaly_kind === "restaurant_failed" ||
        item.anomaly_kind === "driver_failed"
    ).length,
    partial_payout: anomalies.filter(
      (item) => item.anomaly_kind === "partial_payout"
    ).length,
    transfer_missing: anomalies.filter(
      (item) =>
        item.anomaly_kind === "restaurant_paid_flag_missing_transfer" ||
        item.anomaly_kind === "driver_paid_flag_missing_transfer" ||
        item.anomaly_kind === "order_transfer_missing_but_payout_has_transfer" ||
        item.anomaly_kind === "payout_row_transfer_missing"
    ).length,
    duplicates: anomalies.filter(
      (item) => item.anomaly_kind === "duplicate_target_rows"
    ).length,
  };
}

function sortAnomalies(anomalies: AnomalyItem[]): AnomalyItem[] {
  const severityRank: Record<AnomalySeverity, number> = {
    high: 3,
    medium: 2,
    low: 1,
  };

  return [...anomalies].sort((a, b) => {
    if (severityRank[b.severity] !== severityRank[a.severity]) {
      return severityRank[b.severity] - severityRank[a.severity];
    }

    return (
      getTimestamp(b.last_activity || b.created_at) -
      getTimestamp(a.last_activity || a.created_at)
    );
  });
}

export async function GET() {
  try {
    await assertCanAccessAuditLogs();

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
      .limit(500);

    if (ordersError) {
      throw new Error(`Failed to load orders: ${ordersError.message}`);
    }

    const typedOrders = (orders ?? []) as OrderRow[];
    const orderIds = typedOrders.map((order) => order.id);

    let payouts: OrderPayoutRow[] = [];

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
        .in("order_id", orderIds);

      if (payoutsError) {
        throw new Error(`Failed to load order_payouts: ${payoutsError.message}`);
      }

      payouts = (payoutsData ?? []) as OrderPayoutRow[];
    }

    let reviews: ReviewRow[] = [];

    if (orderIds.length > 0) {
      const { data: reviewData, error: reviewError } = await supabase
        .from("admin_payout_case_reviews")
        .select(
          `
            order_id,
            anomaly_kind,
            status,
            is_reviewed,
            is_resolved,
            admin_note,
            actor,
            updated_at
          `
        )
        .in("order_id", orderIds);

      if (reviewError) {
        throw new Error(`Failed to load case reviews: ${reviewError.message}`);
      }

      reviews = (reviewData ?? []) as ReviewRow[];
    }

    const reviewMap = buildReviewMap(reviews);
    const payoutsGrouped = buildPayoutsGrouped(payouts);

    const anomalies: AnomalyItem[] = [];

    for (const order of typedOrders) {
      const rows = payoutsGrouped.get(order.id) ?? [];
      const restaurantRows = rows.filter(
        (row) => isPayoutTarget(row.target) && row.target === "restaurant"
      );
      const driverRows = rows.filter(
        (row) => isPayoutTarget(row.target) && row.target === "driver"
      );

      const restaurant = getLatestPayout(restaurantRows);
      const driver = getLatestPayout(driverRows);

      const pair: PayoutPair = { restaurant, driver };

      const isPaid = order.payment_status === "paid";
      const restaurantSucceeded = pair.restaurant?.status === "succeeded";
      const driverSucceeded = pair.driver?.status === "succeeded";
      const restaurantFailed = pair.restaurant?.status === "failed";
      const driverFailed = pair.driver?.status === "failed";

      if (restaurantRows.length > 1) {
        anomalies.push(
          makeAnomalyBase(
            order,
            pair.restaurant,
            pair.driver,
            "duplicate_target_rows",
            "medium",
            "Duplicate restaurant payout rows",
            `This order has ${restaurantRows.length} restaurant payout rows and should be reviewed.`,
            reviewMap
          )
        );
      }

      if (driverRows.length > 1) {
        anomalies.push(
          makeAnomalyBase(
            order,
            pair.restaurant,
            pair.driver,
            "duplicate_target_rows",
            "medium",
            "Duplicate driver payout rows",
            `This order has ${driverRows.length} driver payout rows and should be reviewed.`,
            reviewMap
          )
        );
      }

      if (isPaid && rows.length === 0) {
        anomalies.push(
          makeAnomalyBase(
            order,
            pair.restaurant,
            pair.driver,
            "paid_without_any_payout_rows",
            "high",
            "Paid order without payout rows",
            "The order is marked paid, but no order_payouts rows exist yet.",
            reviewMap
          )
        );
      }

      if (isPaid && restaurantRows.length === 0) {
        anomalies.push(
          makeAnomalyBase(
            order,
            pair.restaurant,
            pair.driver,
            "paid_without_restaurant_payout",
            "high",
            "Missing restaurant payout row",
            "The order is paid, but no restaurant payout row exists.",
            reviewMap
          )
        );
      }

      if (isPaid && driverRows.length === 0) {
        anomalies.push(
          makeAnomalyBase(
            order,
            pair.restaurant,
            pair.driver,
            "paid_without_driver_payout",
            "high",
            "Missing driver payout row",
            "The order is paid, but no driver payout row exists.",
            reviewMap
          )
        );
      }

      if (restaurantFailed) {
        anomalies.push(
          makeAnomalyBase(
            order,
            pair.restaurant,
            pair.driver,
            "restaurant_failed",
            "high",
            "Restaurant payout failed",
            pair.restaurant?.failure_message ||
              pair.restaurant?.last_error ||
              "Restaurant payout row is failed.",
            reviewMap
          )
        );
      }

      if (driverFailed) {
        anomalies.push(
          makeAnomalyBase(
            order,
            pair.restaurant,
            pair.driver,
            "driver_failed",
            "high",
            "Driver payout failed",
            pair.driver?.failure_message ||
              pair.driver?.last_error ||
              "Driver payout row is failed.",
            reviewMap
          )
        );
      }

      if (
        isPaid &&
        ((restaurantSucceeded && !driverSucceeded) ||
          (driverSucceeded && !restaurantSucceeded))
      ) {
        anomalies.push(
          makeAnomalyBase(
            order,
            pair.restaurant,
            pair.driver,
            "partial_payout",
            "high",
            "Partial payout",
            "Only one payout side has succeeded. The order is only partially paid out.",
            reviewMap
          )
        );
      }

      if (order.restaurant_paid_out === true && !order.restaurant_transfer_id) {
        anomalies.push(
          makeAnomalyBase(
            order,
            pair.restaurant,
            pair.driver,
            "restaurant_paid_flag_missing_transfer",
            "high",
            "Restaurant paid flag missing transfer",
            "orders.restaurant_paid_out is true but restaurant_transfer_id is missing.",
            reviewMap
          )
        );
      }

      if (order.driver_paid_out === true && !order.driver_transfer_id) {
        anomalies.push(
          makeAnomalyBase(
            order,
            pair.restaurant,
            pair.driver,
            "driver_paid_flag_missing_transfer",
            "high",
            "Driver paid flag missing transfer",
            "orders.driver_paid_out is true but driver_transfer_id is missing.",
            reviewMap
          )
        );
      }

      if (restaurantSucceeded && order.restaurant_paid_out !== true) {
        anomalies.push(
          makeAnomalyBase(
            order,
            pair.restaurant,
            pair.driver,
            "restaurant_succeeded_missing_order_sync",
            "medium",
            "Restaurant payout succeeded but order not synced",
            "Restaurant payout row succeeded, but orders.restaurant_paid_out is not true.",
            reviewMap
          )
        );
      }

      if (driverSucceeded && order.driver_paid_out !== true) {
        anomalies.push(
          makeAnomalyBase(
            order,
            pair.restaurant,
            pair.driver,
            "driver_succeeded_missing_order_sync",
            "medium",
            "Driver payout succeeded but order not synced",
            "Driver payout row succeeded, but orders.driver_paid_out is not true.",
            reviewMap
          )
        );
      }

      if (!order.restaurant_transfer_id && !!pair.restaurant?.stripe_transfer_id) {
        anomalies.push(
          makeAnomalyBase(
            order,
            pair.restaurant,
            pair.driver,
            "order_transfer_missing_but_payout_has_transfer",
            "medium",
            "Restaurant order transfer missing",
            "Payout row has a restaurant transfer ID, but orders.restaurant_transfer_id is empty.",
            reviewMap
          )
        );
      }

      if (!order.driver_transfer_id && !!pair.driver?.stripe_transfer_id) {
        anomalies.push(
          makeAnomalyBase(
            order,
            pair.restaurant,
            pair.driver,
            "order_transfer_missing_but_payout_has_transfer",
            "medium",
            "Driver order transfer missing",
            "Payout row has a driver transfer ID, but orders.driver_transfer_id is empty.",
            reviewMap
          )
        );
      }

      if (
        pair.restaurant &&
        pair.restaurant.status === "succeeded" &&
        !pair.restaurant.stripe_transfer_id
      ) {
        anomalies.push(
          makeAnomalyBase(
            order,
            pair.restaurant,
            pair.driver,
            "payout_row_transfer_missing",
            "medium",
            "Restaurant payout row missing transfer ID",
            "Restaurant payout row is marked succeeded but stripe_transfer_id is missing.",
            reviewMap
          )
        );
      }

      if (
        pair.driver &&
        pair.driver.status === "succeeded" &&
        !pair.driver.stripe_transfer_id
      ) {
        anomalies.push(
          makeAnomalyBase(
            order,
            pair.restaurant,
            pair.driver,
            "payout_row_transfer_missing",
            "medium",
            "Driver payout row missing transfer ID",
            "Driver payout row is marked succeeded but stripe_transfer_id is missing.",
            reviewMap
          )
        );
      }
    }

    const summary = buildSummary(anomalies, typedOrders.length);
    const items = sortAnomalies(anomalies);

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
      error instanceof Error ? error.message : "Unknown reconciliation error";

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