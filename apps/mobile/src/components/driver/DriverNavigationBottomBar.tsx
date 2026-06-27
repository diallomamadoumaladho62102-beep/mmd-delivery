import React from "react";
import { View, Text } from "react-native";
import { formatTripDistance } from "../../lib/navigationLocale";

type Props = {
  etaMinutes: number;
  remainingMeters: number;
  speedMps: number | null;
};

function formatArrivalTime(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  const arrival = new Date(Date.now() + minutes * 60_000);
  return arrival.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSpeed(speedMps: number | null): string {
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps < 0) return "0";
  return `${Math.round(speedMps * 3.6)}`;
}

export function DriverNavigationBottomBar({
  etaMinutes,
  remainingMeters,
  speedMps,
}: Props) {
  const etaLabel = etaMinutes > 0 ? `${etaMinutes} min` : "—";
  const distanceLabel = formatTripDistance(remainingMeters, "fr");
  const arrivalLabel = formatArrivalTime(etaMinutes);

  return (
    <>
      <View
        style={{
          position: "absolute",
          left: 12,
          bottom: 54,
          width: 60,
          height: 60,
          borderRadius: 30,
          backgroundColor: "rgba(8,8,8,0.94)",
          borderWidth: 1.5,
          borderColor: "rgba(255,255,255,0.16)",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 26,
        }}
      >
        <Text style={{ color: "#FFFFFF", fontSize: 20, fontWeight: "900" }}>
          {formatSpeed(speedMps)}
        </Text>
        <Text style={{ color: "#9CA3AF", fontSize: 9, fontWeight: "700" }}>
          km/h
        </Text>
      </View>

      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 25,
          paddingHorizontal: 18,
          paddingTop: 15,
          paddingBottom: 13,
          backgroundColor: "#000000",
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
        }}
      >
        <Text
          style={{
            color: "#FFFFFF",
            fontSize: 18,
            fontWeight: "600",
            textAlign: "center",
          }}
        >
          {etaLabel}
          <Text style={{ color: "#6B7280" }}>  •  </Text>
          <Text style={{ fontWeight: "900", fontSize: 22 }}>{arrivalLabel}</Text>
          <Text style={{ color: "#6B7280" }}>  •  </Text>
          {distanceLabel}
        </Text>
      </View>
    </>
  );
}
