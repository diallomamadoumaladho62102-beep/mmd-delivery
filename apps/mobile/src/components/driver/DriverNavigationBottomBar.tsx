import React from "react";
import { View, Text, useWindowDimensions } from "react-native";
import { formatTripDistance } from "../../lib/navigationLocale";
import { computeSpeedClusterLayout } from "../../lib/driverNavigationVisual";

type Props = {
  etaMinutes: number;
  remainingMeters: number;
  speedMps: number | null;
  postedSpeed: number | null;
  isSpeeding: boolean;
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
  postedSpeed,
  isSpeeding,
}: Props) {
  const { width, height } = useWindowDimensions();
  const showSpeedLimit =
    postedSpeed != null &&
    Number.isFinite(postedSpeed) &&
    postedSpeed > 0;
  const cluster = computeSpeedClusterLayout({ width, height }, showSpeedLimit);
  const etaLabel = etaMinutes > 0 ? `${etaMinutes} min` : "—";
  const distanceLabel = formatTripDistance(remainingMeters, "fr");
  const arrivalLabel = formatArrivalTime(etaMinutes);

  return (
    <>
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
          shadowColor: "#000",
          shadowOpacity: 0.15,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: -2 },
          elevation: 4,
        }}
      >
        <Text
          style={{
            color: "#FFFFFF",
            fontSize: 17,
            fontWeight: "800",
            textAlign: "center",
          }}
        >
          {etaLabel} • {arrivalLabel} • {distanceLabel}
        </Text>
      </View>

      <View
        style={{
          position: "absolute",
          left: cluster.left,
          bottom: cluster.bottom,
          zIndex: 32,
          alignItems: "center",
          elevation: 12,
        }}
      >
        {showSpeedLimit ? (
          <View
            style={{
              width: cluster.limitSize,
              height: cluster.limitSize,
              borderRadius: cluster.limitSize / 2,
              backgroundColor: isSpeeding ? "#DC2626" : "#FFFFFF",
              borderWidth: 3,
              borderColor: isSpeeding ? "#991B1B" : "#DC2626",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: cluster.gap,
              shadowColor: isSpeeding ? "#DC2626" : "#000",
              shadowOpacity: isSpeeding ? 0.42 : 0.16,
              shadowRadius: isSpeeding ? 8 : 5,
              shadowOffset: { width: 0, height: 2 },
              elevation: 12,
            }}
          >
            <Text
              style={{
                color: isSpeeding ? "#FFFFFF" : "#111827",
                fontSize: Math.max(14, Math.round(cluster.limitSize * 0.34)),
                fontWeight: "900",
              }}
            >
              {Math.round(postedSpeed)}
            </Text>
          </View>
        ) : null}

        <View
          style={{
            width: cluster.speedSize,
            height: cluster.speedSize,
            borderRadius: cluster.speedSize / 2,
            backgroundColor: "rgba(8,8,8,0.94)",
            borderWidth: 1.5,
            borderColor: isSpeeding
              ? "rgba(220,38,38,0.55)"
              : "rgba(0,0,0,0.12)",
            shadowColor: "#000",
            shadowOpacity: isSpeeding ? 0.24 : 0.2,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 12,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: Math.max(17, Math.round(cluster.speedSize * 0.33)),
              fontWeight: "900",
            }}
          >
            {formatSpeed(speedMps)}
          </Text>
          <Text
            style={{
              color: "#9CA3AF",
              fontSize: Math.max(8, Math.round(cluster.speedSize * 0.15)),
              fontWeight: "700",
            }}
          >
            km/h
          </Text>
        </View>
      </View>
    </>
  );
}
