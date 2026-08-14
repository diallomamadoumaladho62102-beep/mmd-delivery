import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Mapbox from "@rnmapbox/maps";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import type { RootStackParamList } from "../../navigation/AppNavigator";

type Tr = (key: string, defaultValue?: string) => string;
import {
  fetchDriverAreaIntelligence,
  type DemandHotspot,
  type DriverAreaHorizonMinutes,
  type DriverAreaIntelligence,
} from "../../lib/driverAreaIntelligenceApi";
import { ensureMapboxTokenApplied } from "../../lib/mapboxConfig";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_TEXT,
  MMD_MUTED,
  MMD_WHITE,
  MMD_ACTION_NAVY,
} from "../../theme/mmdUi";

type Nav = NativeStackNavigationProp<RootStackParamList, "DriverHotspots">;
type R = RouteProp<RootStackParamList, "DriverHotspots">;

const HORIZON_OPTIONS: { labelKey: string; fallback: string; minutes: DriverAreaHorizonMinutes }[] = [
  { labelKey: "driver.hotspots.horizon.now", fallback: "Now", minutes: 0 },
  { labelKey: "driver.hotspots.horizon.in1h", fallback: "In 1h", minutes: 60 },
  { labelKey: "driver.hotspots.horizon.in2h", fallback: "In 2h", minutes: 120 },
];

function HorizonChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.horizonChip, active && styles.horizonChipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.horizonChipLabel, active && styles.horizonChipLabelActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function levelColor(level: string): string {
  if (level === "very_busy") return "#EF4444";
  if (level === "busy") return "#F97316";
  if (level === "moderate") return "#EAB308";
  return "#22C55E";
}

function demandLevelLabel(level: string, t: Tr): string {
  const key = `driver.hotspots.demandLevel.${level}`;
  const fallbacks: Record<string, string> = {
    very_busy: "Very busy",
    busy: "Busy",
    moderate: "Moderate",
    quiet: "Quiet",
  };
  return t(key, fallbacks[level] ?? level.replace(/_/g, " "));
}

export default function DriverHotspotsScreen() {
  const { t } = useTranslation();
  const tr = t as unknown as Tr;
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const cameraRef = useRef<Mapbox.Camera>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DriverAreaIntelligence | null>(null);
  const [horizonMinutes, setHorizonMinutes] = useState<DriverAreaHorizonMinutes>(0);

  const lat = Number(route.params?.lat);
  const lng = Number(route.params?.lng);
  const isOnline = route.params?.isOnline !== false;

  const load = useCallback(async () => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setError(t("driver.hotspots.errors.gpsRequired", "GPS position required"));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      ensureMapboxTokenApplied();
      const next = await fetchDriverAreaIntelligence({
        lat,
        lng,
        radiusMiles: 5,
        isOnline,
        horizonMinutes,
      });
      setData(next);
      const best = next.best_hotspot;
      if (best) {
        cameraRef.current?.setCamera({
          centerCoordinate: [best.lng, best.lat],
          zoomLevel: 12.5,
          animationMode: "flyTo",
          animationDuration: 700,
        });
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("driver.hotspots.errors.loadFailed", "Failed to load hotspots"),
      );
    } finally {
      setLoading(false);
    }
  }, [horizonMinutes, isOnline, lat, lng, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const hotspots = data?.hotspots ?? [];

  const shape = useMemo(() => {
    return {
      type: "FeatureCollection" as const,
      features: hotspots.map((h) => ({
        type: "Feature" as const,
        id: h.id,
        properties: {
          id: h.id,
          multiplier: h.multiplier,
          count: h.request_count,
          color: levelColor(h.demand_level),
          radius: Math.min(28, 12 + h.request_count * 3),
        },
        geometry: {
          type: "Point" as const,
          coordinates: [h.lng, h.lat],
        },
      })),
    };
  }, [hotspots]);

  const focusHotspot = (h: DemandHotspot) => {
    cameraRef.current?.setCamera({
      centerCoordinate: [h.lng, h.lat],
      zoomLevel: 14,
      animationMode: "flyTo",
      animationDuration: 500,
    });
  };

  const navigateNearest = () => {
    const best = data?.best_hotspot ?? hotspots[0];
    if (best) focusHotspot(best);
  };

  const panelTitle = data
    ? t("driver.hotspots.panelTitle.stats", "{{requests}} open · {{drivers}} drivers · {{multiplier}}x", {
        requests: data.requests_nearby,
        drivers: data.drivers_nearby,
        multiplier: data.earnings_multiplier.toFixed(1),
      })
    : horizonMinutes === 0
      ? t("driver.hotspots.panelTitle.liveDemand", "Live demand")
      : t("driver.hotspots.panelTitle.forecast", "Forecast · {{hours}}h", {
          hours: horizonMinutes / 60,
        });

  const horizonSubtitle =
    horizonMinutes === 0
      ? t(
          "driver.hotspots.subtitle.live",
          "Live open requests and current time-of-day demand.",
        )
      : t(
          "driver.hotspots.subtitle.forecast",
          "Same live open requests — wait estimates adjust for the forecast time of day.",
        );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("driver.hotspots.title", "Demand hotspots")}
        onBack={() => navigation.goBack()}
        variant="mmd"
        style={styles.header}
      />

      <View style={styles.mapWrap}>
        <Mapbox.MapView
          style={StyleSheet.absoluteFill}
          styleURL="mapbox://styles/mapbox/streets-v12"
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
        >
          <Mapbox.Camera
            ref={cameraRef}
            zoomLevel={12}
            centerCoordinate={[
              Number.isFinite(lng) ? lng : -73.95,
              Number.isFinite(lat) ? lat : 40.65,
            ]}
          />
          {Number.isFinite(lat) && Number.isFinite(lng) ? (
            <Mapbox.PointAnnotation id="me" coordinate={[lng, lat]}>
              <View style={styles.meDot} />
            </Mapbox.PointAnnotation>
          ) : null}
          {hotspots.length > 0 ? (
            <Mapbox.ShapeSource id="hotspots" shape={shape}>
              <Mapbox.CircleLayer
                id="hotspot-circles"
                style={{
                  circleRadius: ["get", "radius"],
                  circleColor: ["get", "color"],
                  circleOpacity: 0.35,
                  circleStrokeWidth: 2,
                  circleStrokeColor: ["get", "color"],
                }}
              />
              <Mapbox.SymbolLayer
                id="hotspot-labels"
                style={{
                  textField: [
                    "concat",
                    ["to-string", ["get", "multiplier"]],
                    "x",
                  ],
                  textSize: 12,
                  textColor: MMD_BLUE,
                  textHaloColor: MMD_WHITE,
                  textHaloWidth: 1.2,
                  textAllowOverlap: true,
                }}
              />
            </Mapbox.ShapeSource>
          ) : null}
        </Mapbox.MapView>

        {loading ? (
          <View style={styles.mapOverlay}>
            <Text style={styles.mapOverlayText}>···</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.panel}>
        <View style={styles.horizonRow}>
          {HORIZON_OPTIONS.map((opt) => (
            <HorizonChip
              key={opt.minutes}
              label={t(opt.labelKey, opt.fallback)}
              active={horizonMinutes === opt.minutes}
              onPress={() => setHorizonMinutes(opt.minutes)}
            />
          ))}
        </View>
        <Text style={styles.horizonSubtitle}>{horizonSubtitle}</Text>

        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>{panelTitle}</Text>
          <TouchableOpacity
            onPress={() => void load()}
            accessibilityRole="button"
            accessibilityLabel={t("driver.hotspots.refresh", "Refresh")}
            hitSlop={8}
          >
            <Ionicons name="refresh" size={18} color={MMD_WHITE} />
          </TouchableOpacity>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {loading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color={MMD_TEXT} size="small" />
            <Text style={styles.loadingTitle}>
              {t("driver.hotspots.loading", "Loading…")}
            </Text>
          </View>
        ) : hotspots.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyTitle}>
              {horizonMinutes === 0
                ? t(
                    "driver.hotspots.empty.noClustersLiveTitle",
                    "No demand clusters",
                  )
                : t(
                    "driver.hotspots.empty.noClustersForecastTitle",
                    "No clusters in range",
                  )}
            </Text>
            <Text style={styles.emptyBody}>
              {horizonMinutes === 0
                ? t(
                    "driver.hotspots.empty.noClustersLiveBody",
                    "No demand clusters in range right now. Stay online for the next wave.",
                  )
                : t(
                    "driver.hotspots.empty.noClustersForecastBody",
                    "No live open requests in range. Forecast timing may still improve wait estimates when demand picks up.",
                  )}
            </Text>
          </View>
        ) : (
          <>
            <FlatList
              data={hotspots}
              keyExtractor={(item) => item.id}
              style={{ flexGrow: 0 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => focusHotspot(item)}
                  activeOpacity={0.88}
                >
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: levelColor(item.demand_level) },
                    ]}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{item.label}</Text>
                    <Text style={styles.rowSub}>
                      {t("driver.hotspots.rowScore", "{{level}} · score {{score}}", {
                        level: demandLevelLabel(item.demand_level, tr),
                        score: item.score,
                      })}
                    </Text>
                  </View>
                  <Text style={styles.mult}>
                    {item.multiplier.toFixed(1)}x
                  </Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity
              style={styles.navCta}
              onPress={navigateNearest}
              activeOpacity={0.9}
              accessibilityRole="button"
            >
              <Ionicons name="navigate" size={22} color={MMD_WHITE} />
              <Text style={styles.navCtaLabel}>
                {t(
                  "driver.hotspots.navigateNearest",
                  "Navigate to nearest hotspot",
                )}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  header: { backgroundColor: MMD_BLUE },
  mapWrap: { height: 360, backgroundColor: "#E8EEF5" },
  meDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#2563EB",
    borderWidth: 2,
    borderColor: "#fff",
  },
  mapOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  mapOverlayText: {
    color: MMD_BLUE,
    fontSize: 12,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  panel: {
    flex: 1,
    backgroundColor: MMD_BLUE,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 14,
    gap: 4,
  },
  horizonRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 6,
  },
  horizonChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  horizonChipActive: {
    backgroundColor: MMD_WHITE,
    borderColor: MMD_WHITE,
  },
  horizonChipLabel: {
    color: MMD_WHITE,
    fontSize: 13,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  horizonChipLabelActive: {
    color: MMD_BLUE,
  },
  horizonSubtitle: {
    color: MMD_MUTED,
    fontSize: 12,
    fontFamily: MMD_FONT.regular,
    lineHeight: 17,
    marginBottom: 8,
  },
  panelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  panelTitle: {
    color: MMD_TEXT,
    fontSize: 14,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  error: {
    color: "#FCA5A5",
    marginBottom: 8,
    fontFamily: MMD_FONT.regular,
  },
  loadingBlock: {
    padding: 20,
    alignItems: "center",
    gap: 8,
    alignSelf: "center",
    width: 280,
  },
  loadingTitle: {
    color: MMD_TEXT,
    fontSize: 20,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  emptyBlock: {
    padding: 20,
    alignItems: "center",
    gap: 8,
    alignSelf: "center",
    width: 280,
  },
  emptyTitle: {
    color: MMD_TEXT,
    fontSize: 20,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  emptyBody: {
    color: MMD_MUTED,
    fontSize: 15,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
    lineHeight: 22,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 52,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1F2937",
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowTitle: {
    color: MMD_WHITE,
    fontSize: 13,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  rowSub: {
    color: MMD_WHITE,
    fontSize: 11,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    marginTop: 2,
  },
  mult: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  navCta: {
    marginTop: 10,
    height: 56,
    borderRadius: 16,
    backgroundColor: MMD_ACTION_NAVY,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 16,
  },
  navCtaLabel: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },
});
