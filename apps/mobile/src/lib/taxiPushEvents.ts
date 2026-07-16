type TaxiPushListener = () => void;

const listeners = new Set<TaxiPushListener>();

export function subscribeTaxiOfferPushRefresh(listener: TaxiPushListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyTaxiOfferPushReceived() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (e) {
      console.log("[taxiPushEvents] listener error", e);
    }
  });
}

export function extractTaxiPushPayload(data: unknown): {
  type: string;
  taxiRideId: string | null;
} {
  const record = (data ?? {}) as Record<string, unknown>;
  const type = String(record.type ?? "").trim();
  let taxiRideId = String(
    record.taxiRideId ?? record.taxi_ride_id ?? ""
  ).trim();

  if (!taxiRideId && type === "driver_arrived") {
    const entityType = String(
      record.entity_type ?? record.entityType ?? "",
    )
      .trim()
      .toLowerCase();
    if (entityType.includes("taxi")) {
      taxiRideId = String(
        record.entity_id ?? record.entityId ?? "",
      ).trim();
    }
  }

  return {
    type,
    taxiRideId: taxiRideId || null,
  };
}

export function isClientTaxiPushType(type: string): boolean {
  return (
    type === "ride_accepted" ||
    type === "taxi_ride_cancelled" ||
    type === "driver_arrived"
  );
}
