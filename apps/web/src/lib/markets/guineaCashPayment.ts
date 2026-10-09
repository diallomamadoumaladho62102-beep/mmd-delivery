/**
 * Cash collection rules. The phone never supplies the fare or the status.
 * A second confirmation is a no-op: it does not create another ledger line.
 */

export type CashRideSnapshot = {
  id: string;
  clientUserId: string | null;
  driverId: string | null;
  status: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  currency: string | null;
  countryCode: string | null;
  totalCents: number | null;
};

export type CashCollectionDecision =
  | { ok: true; idempotent: true; fareGnf: number }
  | { ok: true; idempotent: false; fareGnf: number }
  | { ok: false; status: number; error: string };

function norm(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function taxiCashSkipsStripe(paymentStatus: unknown): boolean {
  const status = norm(paymentStatus);
  return status === "pending_cash" || status === "cash_collected";
}

export function taxiPaymentAllowsDispatch(
  paymentStatus: unknown,
  paymentMethod: unknown,
): boolean {
  const status = norm(paymentStatus);
  if (status === "paid") return true;
  return norm(paymentMethod) === "cash" && status === "pending_cash";
}

export function evaluateCashCollection(
  ride: CashRideSnapshot | null,
  actorUserId: string,
): CashCollectionDecision {
  if (!ride?.id) {
    return { ok: false, status: 404, error: "ride_not_found" };
  }

  const actor = String(actorUserId ?? "").trim();
  const driverId = String(ride.driverId ?? "").trim();
  if (!actor || !driverId || actor !== driverId) {
    return { ok: false, status: 403, error: "cash_forbidden" };
  }
  if (ride.clientUserId && actor === ride.clientUserId && actor !== driverId) {
    return { ok: false, status: 403, error: "cash_forbidden" };
  }

  if (norm(ride.paymentMethod) !== "cash") {
    return { ok: false, status: 409, error: "not_cash" };
  }
  if (String(ride.currency ?? "").trim().toUpperCase() !== "GNF") {
    return { ok: false, status: 409, error: "currency_mismatch" };
  }
  if (String(ride.countryCode ?? "").trim().toUpperCase() !== "GN") {
    return { ok: false, status: 409, error: "market_mismatch" };
  }

  const status = norm(ride.status);
  if (status === "canceled" || status === "cancelled") {
    return { ok: false, status: 409, error: "ride_canceled" };
  }
  if (status !== "completed") {
    return { ok: false, status: 409, error: "ride_not_completed" };
  }

  const fareGnf = Number(ride.totalCents);
  if (!Number.isSafeInteger(fareGnf) || fareGnf <= 0) {
    return { ok: false, status: 409, error: "fare_missing" };
  }

  const paymentStatus = norm(ride.paymentStatus);
  if (paymentStatus === "cash_collected") {
    return { ok: true, idempotent: true, fareGnf };
  }
  if (paymentStatus !== "pending_cash") {
    return { ok: false, status: 409, error: "invalid_payment_status" };
  }

  return { ok: true, idempotent: false, fareGnf };
}

export function buildCashCollectionLedgerRow(input: {
  rideId: string;
  driverUserId: string;
  fareGnf: number;
}): Record<string, unknown> {
  return {
    account_type: "driver",
    account_user_id: input.driverUserId,
    country_code: "GN",
    currency: "GNF",
    direction: "credit",
    amount_cents: input.fareGnf,
    reference_type: "cash_collection",
    reference_id: input.rideId,
    description: "Cash collected by assigned driver",
    metadata: {
      market: "GN",
      payment_method: "cash",
      payment_status: "cash_collected",
    },
  };
}
