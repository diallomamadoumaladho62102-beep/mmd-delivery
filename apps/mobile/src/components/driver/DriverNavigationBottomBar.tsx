import React from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
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
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_TEXT_MUTED_BLUE,
  MMD_WHITE,
} from "../../theme/mmdUi";

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
  value,
  label,
  large,
}: {
  value: string;
  label: string;
  large?: boolean;
}) {
  return (
    <View style={{ flex: 1, alignItems: "center", minWidth: 0, gap: 4 }}>
      <Text
        style={{
          color: MMD_WHITE,
          fontSize: large ? 20 : 16,
          fontFamily: MMD_FONT.extrabold,
          fontWeight: "800",
        }}
        numberOfLines={1}
      >
        {value}
      </Text>
      <Text
        style={{
          color: MMD_TEXT_MUTED_BLUE,
          fontSize: 11,
          fontFamily: MMD_FONT.semibold,
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
 * Figma Driver Map Active bottom panel (286:6042) — ETA / Distance / Time + End.
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

  const etaCaption =
    navLocale === "fr" ? "Arrivée" : navLocale === "es" ? "Llegada" : "Arrival";
  const distCaption =
    navLocale === "fr" ? "Distance" : navLocale === "es" ? "Distancia" : "Distance";
  const timeCaption =
    navLocale === "fr" ? "Temps" : navLocale === "es" ? "Tiempo" : "Time";
  const endCaption =
    navLocale === "fr"
      ? "Terminer la navigation"
      : navLocale === "es"
        ? "Finalizar navegación"
        : "End Navigation";

  return (
    <>
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 25,
          gap: 12,
          paddingTop: 14,
          paddingLeft: 16 + Math.max(0, insets.left),
          paddingRight: 16 + Math.max(0, insets.right),
          paddingBottom: resolveBottomBarPadding(insets.bottom),
          backgroundColor: MMD_BLUE,
        }}
      >
        <View
          style={{
            height: 6,
            borderRadius: 3,
            backgroundColor: "rgba(51,51,102,0.5)",
            overflow: "hidden",
            flexDirection: "row",
          }}
        >
          <View style={{ flex: 3, backgroundColor: "#33D966", borderRadius: 3 }} />
          <View style={{ flex: 1.5, backgroundColor: "#FFB226" }} />
          <View style={{ flex: 1, backgroundColor: "#E53333", borderRadius: 3 }} />
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <StatCell value={arrivalLabel} label={etaCaption} large />
          <View
            style={{ width: 1, height: 28, backgroundColor: MMD_GOLD_CLASSIC }}
          />
          <StatCell value={distanceLabel} label={distCaption} />
          <View
            style={{ width: 1, height: 28, backgroundColor: MMD_GOLD_CLASSIC }}
          />
          <StatCell value={timeLabel} label={timeCaption} />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={endCaption}
          onPress={onEndNavigation}
          style={{
            height: 48,
            borderRadius: 16,
            backgroundColor: "#DC2626",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: "#0B1F3A",
              fontSize: 15,
              fontFamily: MMD_FONT.extrabold,
              fontWeight: "800",
            }}
          >
            {endCaption}
          </Text>
        </Pressable>
      </View>

      <View
        style={{
          position: "absolute",
          left: cluster.left,
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
        {showSpeedLimit && postedLabel ? (
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: MMD_WHITE,
              borderWidth: 3,
              borderColor: "#DC2626",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: cluster.gap,
              shadowColor: "#000",
              shadowOpacity: 0.2,
              shadowRadius: 4,
              shadowOffset: { width: 0, height: 2 },
              elevation: 10,
            }}
          >
            <Text
              style={{
                color: "#0B1F3A",
                fontSize: 18,
                fontFamily: MMD_FONT.extrabold,
                fontWeight: "800",
              }}
            >
              {postedLabel}
            </Text>
          </View>
        ) : null}

        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            backgroundColor: isSpeeding ? "#FFBF1A" : "#FFBF1A",
            borderWidth: 3,
            borderColor: "#0066FF",
            shadowColor: "#FFB200",
            shadowOpacity: 0.35,
            shadowRadius: 5,
            shadowOffset: { width: 0, height: 2 },
            elevation: 12,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: "#000000",
              fontSize: 18,
              fontFamily: MMD_FONT.extrabold,
              fontWeight: "800",
            }}
          >
            {speedLabel}
          </Text>
          <Text
            style={{
              color: "#646464",
              fontSize: 8,
              fontFamily: MMD_FONT.bold,
              fontWeight: "700",
            }}
          >
            {unitLabel}
          </Text>
        </View>
      </View>
    </>
  );
}
