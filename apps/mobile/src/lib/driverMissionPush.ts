export type DriverMissionPushPayload = {
  type: string;
  orderId: string | null;
  deliveryRequestId: string | null;
  taxiRideId: string | null;
};

export function extractDriverMissionPushPayload(data: unknown): DriverMissionPushPayload {
  const record = (data ?? {}) as Record<string, unknown>;
  const type = String(record.type ?? "").trim();

  return {
    type,
    orderId: String(record.orderId ?? record.order_id ?? "").trim() || null,
    deliveryRequestId:
      String(record.deliveryRequestId ?? record.delivery_request_id ?? "").trim() || null,
    taxiRideId: String(record.taxiRideId ?? record.taxi_ride_id ?? "").trim() || null,
  };
}

export function isDriverMissionPushType(type: string): boolean {
  return (
    type === "taxi_offer_dispatch" ||
    type === "driver_offer" ||
    type === "delivery_request_dispatch"
  );
}

type NavRef = {
  navigate: (name: string, params?: Record<string, unknown>) => void;
};

export function navigateToDriverMission(nav: NavRef, payload: DriverMissionPushPayload) {
  if (payload.type === "driver_offer" && payload.orderId) {
    nav.navigate("DriverOrderDetails", {
      orderId: payload.orderId,
      sourceTable: "orders",
    });
    return;
  }

  if (payload.type === "delivery_request_dispatch" && payload.deliveryRequestId) {
    nav.navigate("DriverOrderDetails", {
      orderId: payload.deliveryRequestId,
      sourceTable: "delivery_requests",
    });
    return;
  }

  if (payload.type === "taxi_offer_dispatch") {
    nav.navigate("DriverTabs");
  }
}
