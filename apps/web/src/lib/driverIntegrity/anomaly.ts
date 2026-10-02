import { haversineMeters, speedMetersPerSecond } from "./gpsIntegrity";
import { elapsedSeconds, hasArrivalProgress, hasPickupProgress } from "./progress";
import type {
  DriverIntegrityAnomalyType,
  DriverIntegritySeverity,
  DriverIntegritySettings,
  GpsPoint,
  ProgressSignals,
} from "./types";

export type DetectedAnomaly = {
  type: DriverIntegrityAnomalyType;
  severity: DriverIntegritySeverity;
  reviewRecommended: boolean;
  automaticFraud: false;
  automaticPayDeletion: false;
  details: Record<string, unknown>;
};

function anomaly(
  type: DriverIntegrityAnomalyType,
  severity: DriverIntegritySeverity,
  details: Record<string, unknown>
): DetectedAnomaly {
  return {
    type,
    severity,
    reviewRecommended: true,
    automaticFraud: false,
    automaticPayDeletion: false,
    details,
  };
}

export function detectAnomalies(input: {
  signals: ProgressSignals;
  settings: DriverIntegritySettings;
  acceptGps: GpsPoint | null;
  currentGps: GpsPoint | null;
  previousGps: GpsPoint | null;
  priorAnomalyCount: number;
}): DetectedAnomaly[] {
  const { signals, settings } = input;
  const out: DetectedAnomaly[] = [];
  const sinceAccept = elapsedSeconds(signals.driverAcceptedAtMs, signals.nowMs);

  if (!signals.gpsAvailable) {
    out.push(
      anomaly("gps_unavailable", "info", {
        note: "gps_is_integrity_signal_only",
        automaticFraud: false,
      })
    );
  } else if (signals.gpsStale) {
    out.push(
      anomaly("gps_inconsistent", "low", {
        reason: "stale_fix",
        locationUpdatedAtMs: signals.locationUpdatedAtMs,
      })
    );
  }

  if (
    settings.driverAcceptanceWarningAfterSeconds != null &&
    sinceAccept >= settings.driverAcceptanceWarningAfterSeconds &&
    !hasArrivalProgress(signals) &&
    !hasPickupProgress(signals) &&
    signals.metersFromAccept != null &&
    settings.movementProgressThresholdMeters != null &&
    signals.metersFromAccept < settings.movementProgressThresholdMeters
  ) {
    out.push(
      anomaly("no_progress", "medium", {
        elapsedSeconds: sinceAccept,
        metersFromAccept: signals.metersFromAccept,
      })
    );
  } else if (
    settings.driverAcceptanceWarningAfterSeconds != null &&
    sinceAccept >= settings.driverAcceptanceWarningAfterSeconds &&
    !hasArrivalProgress(signals) &&
    !hasPickupProgress(signals) &&
    !signals.gpsAvailable
  ) {
    out.push(
      anomaly("no_progress", "medium", {
        elapsedSeconds: sinceAccept,
        gpsAvailable: false,
        note: "server_events_also_absent",
      })
    );
  }

  if (
    settings.longTripThresholdSeconds != null &&
    sinceAccept >= settings.longTripThresholdSeconds &&
    signals.deliveredAtMs == null &&
    signals.cancelledAtMs == null
  ) {
    out.push(
      anomaly("long_trip", "medium", {
        elapsedSeconds: sinceAccept,
        note: "does_not_delete_trip_time",
      })
    );
  }

  if (
    signals.gpsAvailable &&
    settings.stationaryThresholdSeconds != null &&
    settings.movementProgressThresholdMeters != null &&
    sinceAccept >= settings.stationaryThresholdSeconds &&
    (signals.metersFromAccept == null ||
      signals.metersFromAccept < settings.movementProgressThresholdMeters) &&
    !hasArrivalProgress(signals)
  ) {
    out.push(
      anomaly("stationary", "medium", {
        elapsedSeconds: sinceAccept,
        metersFromAccept: signals.metersFromAccept,
      })
    );
  }

  if (
    input.acceptGps &&
    input.currentGps &&
    settings.gpsJumpThresholdMeters != null
  ) {
    const jump = haversineMeters(input.acceptGps, input.currentGps);
    if (jump != null && jump >= settings.gpsJumpThresholdMeters) {
      out.push(
        anomaly("gps_inconsistent", "medium", {
          reason: "jump",
          meters: jump,
        })
      );
    }
  }

  if (
    input.previousGps &&
    input.currentGps &&
    settings.impossibleSpeedThresholdMps != null
  ) {
    const speed = speedMetersPerSecond(input.previousGps, input.currentGps);
    if (speed != null && speed >= settings.impossibleSpeedThresholdMps) {
      out.push(
        anomaly("impossible_speed", "high", {
          metersPerSecond: speed,
          note: "review_only_not_automatic_fraud",
        })
      );
    }
  }

  if (
    signals.pickedUpAtMs != null &&
    signals.driverAcceptedAtMs > signals.pickedUpAtMs
  ) {
    out.push(
      anomaly("incoherent_timestamps", "high", {
        reason: "pickup_before_accept",
      })
    );
  }

  if (
    signals.deliveredAtMs != null &&
    signals.pickedUpAtMs == null &&
    signals.arrivedAtMs == null
  ) {
    out.push(
      anomaly("incoherent_events", "high", {
        reason: "delivered_without_pickup_or_arrival",
      })
    );
  }

  if (
    hasArrivalProgress(signals) &&
    settings.restaurantWaitReviewThresholdSeconds != null
  ) {
    const waitStart = signals.arrivedAtMs ?? signals.waitTimerStartedAtMs;
    if (waitStart != null) {
      const waitSeconds = elapsedSeconds(waitStart, signals.nowMs);
      if (
        waitSeconds >= settings.restaurantWaitReviewThresholdSeconds &&
        !hasPickupProgress(signals)
      ) {
        out.push(
          anomaly("restaurant_wait_review", "low", {
            waitSeconds,
            note: "does_not_delete_admissible_time",
          })
        );
      }
    }
  }

  if (input.priorAnomalyCount >= 3) {
    out.push(
      anomaly("repeated_anomalies", "high", {
        priorAnomalyCount: input.priorAnomalyCount,
        note: "history_is_not_automatic_fraud",
      })
    );
  }

  return out;
}

export function anomaliesNeverDeletePay(rows: DetectedAnomaly[]): boolean {
  return rows.every(
    (row) => row.automaticFraud === false && row.automaticPayDeletion === false
  );
}
