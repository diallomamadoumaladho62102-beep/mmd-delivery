import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import type { GpsQualityStatus } from "../../lib/driverNavigation/types";

type Props = {
  etaMinutes: number;
  remainingMeters: number;
  destinationLabel: string;
  gpsStatus: GpsQualityStatus;
  speedMps: number | null;
  onOpenDetails: () => void;
};

function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "—";
  if (meters < 1600) return `${Math.max(100, Math.round(meters / 50) * 50)} m`;
  return `${(meters / 1609.344).toFixed(1)} mi`;
}

function formatArrivalTime(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  const arrival = new Date(Date.now() + minutes * 60_000);
  return arrival.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatSpeed(speedMps: number | null): string {
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps < 0) return "—";
  const mph = speedMps * 2.23694;
  return `${Math.round(mph)} mph`;
}

function gpsLabel(status: GpsQualityStatus): string {
  if (status === "active") return "GPS OK";
  if (status === "degraded") return "GPS weak";
  if (status === "lost") return "GPS lost";
  return "GPS…";
}

export function DriverNavigationBottomBar({
  etaMinutes,
  remainingMeters,
  destinationLabel,
  gpsStatus,
  speedMps,
  onOpenDetails,
}: Props) {
  return (
    <View
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        bottom: 18,
        borderRadius: 22,
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: "rgba(2,6,23,0.96)",
        borderWidth: 1,
        borderColor: "rgba(148,163,184,0.24)",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ color: "#FFFFFF", fontSize: 22, fontWeight: "900" }}>
            {etaMinutes > 0 ? `${etaMinutes} min` : "—"}
            <Text style={{ color: "#94A3B8", fontSize: 16, fontWeight: "700" }}>
              {"  ·  "}
              {formatArrivalTime(etaMinutes)}
              {"  ·  "}
              {formatDistance(remainingMeters)}
            </Text>
          </Text>
          <Text
            style={{ color: "#CBD5E1", fontSize: 12, marginTop: 6, fontWeight: "700" }}
            numberOfLines={1}
          >
            {destinationLabel}
          </Text>
        </View>

        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: "#93C5FD", fontSize: 16, fontWeight: "900" }}>
            {formatSpeed(speedMps)}
          </Text>
          <Text
            style={{
              color:
                gpsStatus === "active"
                  ? "#86EFAC"
                  : gpsStatus === "degraded"
                    ? "#FDE047"
                    : "#FCA5A5",
              fontSize: 11,
              fontWeight: "800",
              marginTop: 4,
            }}
          >
            {gpsLabel(gpsStatus)}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        onPress={onOpenDetails}
        activeOpacity={0.88}
        style={{
          marginTop: 12,
          borderRadius: 14,
          paddingVertical: 11,
          alignItems: "center",
          backgroundColor: "rgba(37,99,235,0.22)",
          borderWidth: 1,
          borderColor: "rgba(96,165,250,0.35)",
        }}
      >
        <Text style={{ color: "#BFDBFE", fontSize: 13, fontWeight: "900" }}>
          Mission details
        </Text>
      </TouchableOpacity>
    </View>
  );
}
