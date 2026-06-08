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
  const taxiRideId = String(
    record.taxiRideId ?? record.taxi_ride_id ?? ""
  ).trim();

  return {
    type,
    taxiRideId: taxiRideId || null,
  };
}
