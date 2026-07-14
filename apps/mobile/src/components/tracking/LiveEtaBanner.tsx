import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";

export type LiveEtaBannerProps = {
  distanceMiles?: number | null;
  etaMinutes?: number | null;
  progressPercent?: number | null;
  nextStep?: string | null;
  stale?: boolean;
  offline?: boolean;
  loading?: boolean;
  updatedAt?: number | null;
  emptyMessage?: string;
};

function formatArrivalClock(etaMinutes: number): string {
  const arrival = new Date(Date.now() + Math.max(0, etaMinutes) * 60_000);
  try {
    return arrival.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return arrival.toTimeString().slice(0, 5);
  }
}

export function LiveEtaBanner({
  distanceMiles,
  etaMinutes,
  progressPercent,
  nextStep,
  stale = false,
  offline = false,
  loading = false,
  updatedAt,
  emptyMessage = "ETA unavailable",
}: LiveEtaBannerProps) {
  const hasEta =
    Number.isFinite(Number(etaMinutes)) && Number(etaMinutes) > 0;
  const hasDistance =
    Number.isFinite(Number(distanceMiles)) && Number(distanceMiles) >= 0;

  const arrivalClock = useMemo(() => {
    if (!hasEta) return null;
    return formatArrivalClock(Number(etaMinutes));
  }, [hasEta, etaMinutes]);

  const progress =
    Number.isFinite(Number(progressPercent))
      ? Math.max(0, Math.min(100, Number(progressPercent)))
      : null;

  if (!hasEta && !hasDistance && !loading) {
    return (
      <View style={styles.card}>
        <Text style={styles.muted}>{emptyMessage}</Text>
        {offline ? <Text style={styles.warn}>Offline — waiting for connection</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        {hasEta ? (
          <Text style={styles.eta}>
            {Math.ceil(Number(etaMinutes))} min
          </Text>
        ) : loading ? (
          <Text style={styles.eta}>…</Text>
        ) : (
          <Text style={styles.eta}>—</Text>
        )}
        {arrivalClock ? (
          <Text style={styles.arrival}>Arrive ~{arrivalClock}</Text>
        ) : null}
      </View>

      {hasDistance ? (
        <Text style={styles.meta}>
          {Number(distanceMiles) < 0.1
            ? `${Math.round(Number(distanceMiles) * 1609)} m remaining`
            : `${Number(distanceMiles).toFixed(1)} mi remaining`}
        </Text>
      ) : null}

      {progress != null ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
      ) : null}

      {nextStep ? (
        <Text style={styles.nextStep} numberOfLines={2}>
          {nextStep}
        </Text>
      ) : null}

      <View style={styles.flags}>
        {offline ? <Text style={styles.warn}>Offline</Text> : null}
        {stale && !offline ? <Text style={styles.warn}>ETA may be approximate</Text> : null}
        {updatedAt ? (
          <Text style={styles.updated}>
            Updated {new Date(updatedAt).toLocaleTimeString()}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "rgba(15,23,42,0.95)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
    gap: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 12,
  },
  eta: {
    color: "#F8FAFC",
    fontSize: 22,
    fontWeight: "900",
  },
  arrival: {
    color: "#93C5FD",
    fontSize: 13,
    fontWeight: "700",
  },
  meta: {
    color: "#CBD5E1",
    fontSize: 13,
    fontWeight: "600",
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(51,65,85,0.9)",
    overflow: "hidden",
    marginTop: 6,
  },
  progressFill: {
    height: 6,
    backgroundColor: "#38BDF8",
  },
  nextStep: {
    color: "#E2E8F0",
    fontSize: 12,
    marginTop: 4,
  },
  flags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  warn: {
    color: "#FBBF24",
    fontSize: 11,
    fontWeight: "700",
  },
  updated: {
    color: "#64748B",
    fontSize: 11,
  },
  muted: {
    color: "#94A3B8",
    fontWeight: "600",
  },
});

export default LiveEtaBanner;
