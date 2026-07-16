export type CommunicationPushPayload = {
  type: string;
  orderId: string | null;
  order_id: string | null;
  deliveryRequestId: string | null;
  delivery_request_id: string | null;
  taxiRideId: string | null;
  taxi_ride_id: string | null;
  seller_order_id: string | null;
  targetRole: string | null;
  target_role: string | null;
  sourceTable: string | null;
  source_table: string | null;
};

type NavRef = {
  navigate: (name: string, params?: Record<string, unknown>) => void;
};

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

export function extractCommunicationPushPayload(
  data: unknown,
): CommunicationPushPayload {
  const record = asRecord(data);
  const type = String(record.type ?? "").trim();

  return {
    type,
    orderId: String(record.orderId ?? "").trim() || null,
    order_id: String(record.order_id ?? "").trim() || null,
    deliveryRequestId: String(record.deliveryRequestId ?? "").trim() || null,
    delivery_request_id: String(record.delivery_request_id ?? "").trim() || null,
    taxiRideId: String(record.taxiRideId ?? "").trim() || null,
    taxi_ride_id: String(record.taxi_ride_id ?? "").trim() || null,
    seller_order_id: String(record.seller_order_id ?? "").trim() || null,
    targetRole: String(record.targetRole ?? record.target_role ?? "").trim() || null,
    target_role: String(record.target_role ?? record.targetRole ?? "").trim() || null,
    sourceTable: String(record.sourceTable ?? record.source_table ?? "").trim() || null,
    source_table: String(record.source_table ?? record.sourceTable ?? "").trim() || null,
  };
}

function resolveOrderId(payload: CommunicationPushPayload): string | null {
  return payload.orderId || payload.order_id;
}

function resolveTargetRole(payload: CommunicationPushPayload): string {
  return payload.targetRole || payload.target_role || "driver";
}

function resolveSourceTable(
  payload: CommunicationPushPayload,
): "orders" | "delivery_requests" | "taxi_rides" | "marketplace_delivery_jobs" {
  const raw = String(payload.sourceTable || payload.source_table || "orders")
    .trim()
    .toLowerCase();

  if (raw === "delivery_requests" || raw === "delivery_request") {
    return "delivery_requests";
  }
  if (raw === "taxi_rides" || raw === "taxi_ride") {
    return "taxi_rides";
  }
  if (
    raw === "marketplace_delivery_jobs" ||
    raw === "marketplace_delivery_job"
  ) {
    return "marketplace_delivery_jobs";
  }
  return "orders";
}

export function isCommunicationPushType(type: string): boolean {
  return (
    type === "order_paid" ||
    type === "order_accepted" ||
    type === "order_cancelled" ||
    type === "order_message" ||
    type === "chat_message" ||
    type === "restaurant_new_order" ||
    type === "marketplace_new_order" ||
    type === "marketplace_client_status" ||
    type === "delivery_request_paid"
  );
}

export function navigateFromCommunicationPush(
  nav: NavRef,
  data: unknown,
): boolean {
  const payload = extractCommunicationPushPayload(data);
  if (!payload.type || !isCommunicationPushType(payload.type)) return false;

  const orderId = resolveOrderId(payload);
  const targetRole = resolveTargetRole(payload);
  const sourceTable = resolveSourceTable(payload);

  switch (payload.type) {
    case "order_paid":
    case "order_accepted":
    case "order_cancelled":
      if (orderId) {
        nav.navigate("ClientOrderDetails", { orderId });
        return true;
      }
      return false;

    case "delivery_request_paid": {
      const requestId =
        payload.deliveryRequestId || payload.delivery_request_id;
      if (requestId) {
        nav.navigate("ClientDeliveryRequestDetails", { requestId });
        return true;
      }
      return false;
    }

    case "order_message":
    case "chat_message":
      if (orderId) {
        const role = targetRole.toLowerCase();
        if (role === "driver") {
          nav.navigate("DriverChat", { orderId, targetRole: "client", sourceTable });
          return true;
        }
        if (role === "restaurant" || role === "seller") {
          nav.navigate("RestaurantChat", {
            orderId,
            targetRole: "client",
            sourceTable,
          });
          return true;
        }
        nav.navigate("ClientChat", {
          orderId,
          targetRole: role === "client" ? "driver" : targetRole,
          sourceTable,
        });
        return true;
      }
      return false;

    case "restaurant_new_order":
      if (orderId) {
        nav.navigate("RestaurantOrderDetails", { orderId });
        return true;
      }
      return false;

    case "marketplace_new_order": {
      const sellerOrderId = payload.seller_order_id;
      if (sellerOrderId) {
        nav.navigate("SellerOrders", { highlightOrderId: sellerOrderId });
        return true;
      }
      return false;
    }

    case "marketplace_client_status":
      if (orderId) {
        nav.navigate("ClientOrderDetails", { orderId });
        return true;
      }
      return false;

    default:
      return false;
  }
}
