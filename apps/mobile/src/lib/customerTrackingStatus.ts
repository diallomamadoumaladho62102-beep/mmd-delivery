/**
 * Pure status copy for the premium client tracking chrome.
 * Maps real taxi_rides.status values — never invents progress.
 *
 * Payment gate: unpaid / pending_payment / processing must NEVER look like
 * driver search or assignment. Dispatch only starts after payment_status=paid.
 */

export type CustomerTrackingPhase =
  | "awaiting_payment"
  | "searching"
  | "assigned"
  | "on_the_way"
  | "arriving_soon"
  | "arrived"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "unknown";

export type CustomerTrackingLabels = {
  phase: CustomerTrackingPhase;
  liveTitle: string;
  liveSubtitle: string;
  bannerStatus: string;
  detailLine: string;
  safetyLine: string;
};

const CANCELLED = new Set(["cancelled", "canceled", "expired", "failed"]);
/** Only post-payment statuses may show "Finding your driver". */
const SEARCHING = new Set(["paid", "dispatching"]);
const ASSIGNED = new Set(["accepted"]);
const ARRIVED = new Set(["driver_arrived"]);
const IN_PROGRESS = new Set(["in_progress", "picked_up"]);
const COMPLETED = new Set(["completed"]);
const AWAITING_PAYMENT_STATUS = new Set([
  "draft",
  "quoted",
  "pending_payment",
]);

export function isTaxiAwaitingPayment(input: {
  status?: string | null;
  paymentStatus?: string | null;
}): boolean {
  const payment = String(input.paymentStatus ?? "")
    .toLowerCase()
    .trim();
  const status = String(input.status ?? "")
    .toLowerCase()
    .trim();
  if (payment === "paid" || payment === "refunded") return false;
  if (payment === "pending_payment" || payment === "processing" || payment === "unpaid") {
    return true;
  }
  // Defensive: quoted/draft without an explicit paid payment_status.
  if (AWAITING_PAYMENT_STATUS.has(status) && payment !== "paid") {
    return true;
  }
  return false;
}

export function resolveCustomerTrackingPhase(
  status: string,
  opts: {
    hasDriver: boolean;
    hasLiveGps: boolean;
    etaMinutes: number | null;
    paymentStatus?: string | null;
  },
): CustomerTrackingPhase {
  const s = String(status ?? "").toLowerCase().trim();
  if (CANCELLED.has(s)) return "cancelled";
  if (COMPLETED.has(s)) return "completed";

  if (
    isTaxiAwaitingPayment({
      status: s,
      paymentStatus: opts.paymentStatus,
    })
  ) {
    return "awaiting_payment";
  }

  if (IN_PROGRESS.has(s)) return "in_progress";
  if (ARRIVED.has(s)) return "arrived";
  if (ASSIGNED.has(s) && opts.hasDriver) {
    if (!opts.hasLiveGps) return "assigned";
    if (
      opts.etaMinutes != null &&
      Number.isFinite(opts.etaMinutes) &&
      opts.etaMinutes <= 3
    ) {
      return "arriving_soon";
    }
    return "on_the_way";
  }
  // Searching only after paid — never treat unpaid quoted as dispatch.
  if (SEARCHING.has(s) || (opts.hasDriver === false && (s === "paid" || s === "dispatching"))) {
    return "searching";
  }
  return "unknown";
}

export function firstNameFromDisplayName(name: string | null | undefined): string {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

export function buildCustomerTrackingLabels(input: {
  status: string;
  paymentStatus?: string | null;
  hasDriver: boolean;
  hasLiveGps: boolean;
  etaMinutes: number | null;
  driverName: string | null;
  distanceLabel: string | null;
  t: (key: string, fallback: string, vars?: Record<string, unknown>) => string;
}): CustomerTrackingLabels {
  const phase = resolveCustomerTrackingPhase(input.status, {
    hasDriver: input.hasDriver,
    hasLiveGps: input.hasLiveGps,
    etaMinutes: input.etaMinutes,
    paymentStatus: input.paymentStatus,
  });
  const first = firstNameFromDisplayName(input.driverName);
  const who = first || input.t("taxi.tracking.driverFallback", "Driver");
  const safetyLine = input.t(
    "taxi.tracking.safetyPriority",
    "Your safety is our priority.",
  );

  switch (phase) {
    case "awaiting_payment":
      return {
        phase,
        liveTitle: input.t("taxi.tracking.liveTitle", "Live tracking"),
        liveSubtitle: input.t(
          "taxi.tracking.awaitingPayment",
          "Payment required",
        ),
        bannerStatus: input.t(
          "taxi.tracking.bannerAwaitingPayment",
          "Complete payment to find a driver",
        ),
        detailLine: safetyLine,
        safetyLine,
      };
    case "searching":
      return {
        phase,
        liveTitle: input.t("taxi.tracking.liveTitle", "Live tracking"),
        liveSubtitle: input.t(
          "taxi.tracking.lookingForDriver",
          "Looking for a driver…",
        ),
        bannerStatus: input.t(
          "taxi.tracking.searchingNearby",
          "Searching nearby drivers…",
        ),
        detailLine: input.t(
          "taxi.tracking.paymentConfirmedMatching",
          "Payment confirmed — matching nearby drivers",
        ),
        safetyLine,
      };
    case "assigned":
      return {
        phase,
        liveTitle: input.t("taxi.tracking.liveTitle", "Live tracking"),
        liveSubtitle: input.t(
          "taxi.tracking.driverAssigned",
          "Driver assigned",
        ),
        bannerStatus: input.t(
          "taxi.tracking.bannerAssigned",
          "{{name}} is assigned",
          { name: who },
        ),
        detailLine: safetyLine,
        safetyLine,
      };
    case "on_the_way":
      return {
        phase,
        liveTitle: input.t("taxi.tracking.liveTitle", "Live tracking"),
        liveSubtitle: input.t(
          "taxi.tracking.driverOnTheWay",
          "Driver on the way",
        ),
        bannerStatus: input.distanceLabel
          ? input.t(
              "taxi.tracking.bannerAway",
              "{{name}} is {{distance}} away",
              { name: who, distance: input.distanceLabel },
            )
          : input.t("taxi.tracking.bannerOnTheWay", "{{name}} is on the way", {
              name: who,
            }),
        detailLine: safetyLine,
        safetyLine,
      };
    case "arriving_soon":
      return {
        phase,
        liveTitle: input.t("taxi.tracking.liveTitle", "Live tracking"),
        liveSubtitle: input.t(
          "taxi.tracking.driverArrivingSoon",
          "Driver arriving soon",
        ),
        bannerStatus: input.distanceLabel
          ? input.t(
              "taxi.tracking.bannerAway",
              "{{name}} is {{distance}} away",
              { name: who, distance: input.distanceLabel },
            )
          : input.t(
              "taxi.tracking.bannerArrivingSoon",
              "{{name}} is arriving soon",
              { name: who },
            ),
        detailLine: safetyLine,
        safetyLine,
      };
    case "arrived":
      return {
        phase,
        liveTitle: input.t("taxi.tracking.liveTitle", "Live tracking"),
        liveSubtitle: input.t("taxi.tracking.driverArrived", "Driver arrived"),
        bannerStatus: input.t(
          "taxi.tracking.bannerArrived",
          "{{name}} has arrived",
          { name: who },
        ),
        detailLine: safetyLine,
        safetyLine,
      };
    case "in_progress":
      return {
        phase,
        liveTitle: input.t("taxi.tracking.liveTitle", "Live tracking"),
        liveSubtitle: input.t(
          "taxi.tracking.tripInProgress",
          "Trip in progress",
        ),
        bannerStatus: input.t(
          "taxi.tracking.bannerInProgress",
          "Trip in progress",
        ),
        detailLine: input.t(
          "taxi.tracking.shareMaskedCall",
          "Share trip · masked call available",
        ),
        safetyLine,
      };
    case "completed":
      return {
        phase,
        liveTitle: input.t("taxi.tracking.liveTitle", "Live tracking"),
        liveSubtitle: input.t("taxi.tracking.rideCompleted", "Ride completed"),
        bannerStatus: input.t("taxi.tracking.bannerCompleted", "Trip completed"),
        detailLine: input.t(
          "taxi.tracking.thanksRiding",
          "Thanks for riding with MMD Taxi",
        ),
        safetyLine,
      };
    case "cancelled":
      return {
        phase,
        liveTitle: input.t("taxi.tracking.liveTitle", "Live tracking"),
        liveSubtitle: input.t("taxi.tracking.cancelled", "Trip cancelled"),
        bannerStatus: input.t("taxi.tracking.bannerCancelled", "Trip cancelled"),
        detailLine: safetyLine,
        safetyLine,
      };
    default:
      return {
        phase: "unknown",
        liveTitle: input.t("taxi.tracking.liveTitle", "Live tracking"),
        liveSubtitle: input.t("taxi.tracking.updating", "Updating…"),
        bannerStatus: input.t("taxi.tracking.updating", "Updating…"),
        detailLine: safetyLine,
        safetyLine,
      };
  }
}

/** Bearing degrees from previous → next GPS sample (north = 0). */
export function bearingDegrees(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number | null {
  if (
    !Number.isFinite(fromLat) ||
    !Number.isFinite(fromLng) ||
    !Number.isFinite(toLat) ||
    !Number.isFinite(toLng)
  ) {
    return null;
  }
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(fromLat);
  const φ2 = toRad(toLat);
  const Δλ = toRad(toLng - fromLng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  if (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) return null;
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
