import React from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  formatPostedSpeedLimit,
  formatSpeedValue,
  formatTripDistance,
  resolveNavigationLocale,
  resolveUnitSystem,
  speedUnitLabel,
  type NavigationLocale,
} from "../../lib/navigationLocale";
import { computeSpeedClusterLayout } from "../../lib/driverNavigationVisual";
import { resolveBottomBarPadding } from "../../lib/navigationSafeArea";

type Props = {
  etaMinutes: number;
  remainingMeters: number;
  speedMps: number | null;
  postedSpeed: number | null;
  postedUnit?: "km/h" | "mph" | null;
  isSpeeding: boolean;
  locale?: string;
  countryCode?: string | null;
  onEndNavigation: () => void;
};

function formatArrivalTime(minutes: number, locale: NavigationLocale): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  const arrival = new Date(Date.now() + minutes * 60_000);
  const tag = locale === "fr" ? "fr-FR" : locale === "es" ? "es-ES" : "en-US";
  return arrival.toLocaleTimeString(tag, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRemainingTime(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

function StatCell({
  icon,
  value,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
}) {
  return (
    <View style={{ flex: 1, alignItems: "center", minWidth: 0 }}>
      <Ionicons name={icon} size={16} color="#2F7BFF" />
      <Text
        style={{
          marginTop: 4,
          color: "#0F172A",
          fontSize: 17,
          fontWeight: "800",
          letterSpacing: -0.2,
        }}
        numberOfLines={1}
      >
        {value}
      </Text>
      <Text
        style={{
          marginTop: 1,
          color: "#94A3B8",
          fontSize: 11,
          fontWeight: "600",
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * Premium trip footer — ETA / Distance / Time / End + US-style speed cluster.
 */
export function DriverNavigationBottomBar({
  etaMinutes,
  remainingMeters,
  speedMps,
  postedSpeed,
  postedUnit = null,
  isSpeeding,
  locale = "en",
  countryCode = null,
  onEndNavigation,
}: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const navLocale = resolveNavigationLocale(locale);
  const units = resolveUnitSystem(countryCode, navLocale);

  const postedLabel = formatPostedSpeedLimit(postedSpeed, postedUnit, units);
  const showSpeedLimit = postedLabel != null;
  const cluster = computeSpeedClusterLayout({ width, height }, showSpeedLimit);

  const arrivalLabel = formatArrivalTime(etaMinutes, navLocale);
  const distanceLabel = formatTripDistance(remainingMeters, navLocale, units);
  const timeLabel = formatRemainingTime(etaMinutes);
  const speedLabel = formatSpeedValue(speedMps, units);
  const unitLabel = speedUnitLabel(units);

  const etaCaption = navLocale === "fr" ? "Arrivée" : navLocale === "es" ? "ETA" : "ETA";
  const distCaption =
    navLocale === "fr" ? "Distance" : navLocale === "es" ? "Distancia" : "Distance";
  const timeCaption = navLocale === "fr" ? "Temps" : navLocale === "es" ? "Tiempo" : "Time";
  const endCaption = navLocale === "fr" ? "Terminer" : navLocale === "es" ? "Fin" : "End";

  return (
    <>
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 25,
          flexDirection: "row",
          alignItems: "center",
          paddingTop: 14,
          paddingLeft: 14 + Math.max(0, insets.left),
          paddingRight: 14 + Math.max(0, insets.right),
          // Background flush to bottom edge; inset only pads content.
          paddingBottom: resolveBottomBarPadding(insets.bottom),
          backgroundColor: "#FFFFFF",
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          shadowColor: "#000",
          shadowOpacity: 0.14,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: -3 },
          elevation: 8,
        }}
      >
        <StatCell icon="time-outline" value={arrivalLabel} label={etaCaption} />
        <StatCell icon="location-outline" value={distanceLabel} label={distCaption} />
        <StatCell icon="stopwatch-outline" value={timeLabel} label={timeCaption} />

        <View style={{ alignItems: "center", marginLeft: 4, width: 56 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={endCaption}
            onPress={onEndNavigation}
            hitSlop={8}
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: "#E11D48",
              alignItems: "center",
              justifyContent: "center",
              shadowColor: "#E11D48",
              shadowOpacity: 0.35,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 3 },
              elevation: 6,
            }}
          >
            <Ionicons name="close" size={26} color="#FFFFFF" />
          </Pressable>
          <Text
            style={{
              marginTop: 4,
              color: "#94A3B8",
              fontSize: 11,
              fontWeight: "600",
            }}
          >
            {endCaption}
          </Text>
        </View>
      </View>

      <View
        style={{
          position: "absolute",
          left: cluster.left,
          // Keep the speed-limit sign at its previous absolute bottom.
          // Old stack (bottom→top): speedometer @ cluster.bottom, limit above it.
          // New stack: limit stays at that same absolute Y; current speed sits above.
          bottom: showSpeedLimit
            ? cluster.bottom + cluster.speedSize + cluster.gap
            : cluster.bottom,
          zIndex: 32,
          alignItems: "center",
          elevation: 12,
          width: Math.max(
            showSpeedLimit ? Math.max(44, cluster.limitSize) : cluster.speedSize,
            cluster.speedSize,
          ),
        }}
      >
          <View
            style={{
              width: cluster.speedSize,
              height: cluster.speedSize,
              borderRadius: cluster.speedSize / 2,
              backgroundColor: "#FFFFFF",
              borderWidth: 3,
              borderColor: isSpeeding ? "#DC2626" : "#2F7BFF",
              shadowColor: "#000",
              shadowOpacity: 0.18,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
              elevation: 12,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: showSpeedLimit ? cluster.gap : 0,
            }}
          >
            <Text
              style={{
                color: "#0F172A",
                fontSize: Math.max(16, Math.round(cluster.speedSize * 0.3)),
                fontWeight: "900",
              }}
            >
              {speedLabel}
            </Text>
            <Text
              style={{
                color: "#64748B",
                fontSize: Math.max(9, Math.round(cluster.speedSize * 0.14)),
                fontWeight: "700",
              }}
            >
              {unitLabel}
            </Text>
          </View>

          {showSpeedLimit && postedLabel ? (
            <View
              style={{
                width: Math.max(44, cluster.limitSize),
                minHeight: Math.max(54, Math.round(cluster.limitSize * 1.15)),
                borderRadius: 6,
                backgroundColor: "#FFFFFF",
                borderWidth: 2.5,
                borderColor: isSpeeding ? "#DC2626" : "#0F172A",
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 4,
                paddingHorizontal: 4,
                shadowColor: "#000",
                shadowOpacity: 0.16,
                shadowRadius: 5,
                shadowOffset: { width: 0, height: 2 },
                elevation: 10,
              }}
            >
              <Text
                style={{
                  color: "#0F172A",
                  fontSize: 7,
                  fontWeight: "800",
                  letterSpacing: 0.4,
                  textAlign: "center",
                  lineHeight: 9,
                }}
              >
                {units === "imperial" ? "SPEED\nLIMIT" : "LIMITE"}
              </Text>
              <Text
                style={{
                  color: isSpeeding ? "#DC2626" : "#0F172A",
                  fontSize: Math.max(18, Math.round(cluster.limitSize * 0.42)),
                  fontWeight: "900",
                  marginTop: 1,
                }}
              >
                {postedLabel}
              </Text>
            </View>
          ) : null}
      </View>
    </>
  );
}
