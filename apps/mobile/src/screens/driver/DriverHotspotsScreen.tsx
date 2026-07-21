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
import { Ionicons } from "@expo/vector-icons";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import {
  fetchDriverAreaIntelligence,
  type DemandHotspot,
  type DriverAreaIntelligence,
} from "../../lib/driverAreaIntelligenceApi";
import { ensureMapboxTokenApplied } from "../../lib/mapboxConfig";
import { APP_COLORS } from "../../theme/appTheme";
import ScreenHeader from "../../components/navigation/ScreenHeader";

type Nav = NativeStackNavigationProp<RootStackParamList, "DriverHotspots">;
type R = RouteProp<RootStackParamList, "DriverHotspots">;

function levelColor(level: string): string {
  if (level === "very_busy") return "#EF4444";
  if (level === "busy") return "#F97316";
  if (level === "moderate") return "#EAB308";
  return "#22C55E";
}

export default function DriverHotspotsScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const cameraRef = useRef<Mapbox.Camera>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DriverAreaIntelligence | null>(null);

  const lat = Number(route.params?.lat);
  const lng = Number(route.params?.lng);
  const isOnline = route.params?.isOnline !== false;

  const load = useCallback(async () => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setError("GPS position required");
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
      setError(e instanceof Error ? e.message : "Failed to load hotspots");
    } finally {
      setLoading(false);
    }
  }, [isOnline, lat, lng]);

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

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title="Demand hotspots"
        onBack={() => navigation.goBack()}
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
                  textColor: "#0F172A",
                  textHaloColor: "#FFFFFF",
                  textHaloWidth: 1.2,
                  textAllowOverlap: true,
                }}
              />
            </Mapbox.ShapeSource>
          ) : null}
        </Mapbox.MapView>

        {loading ? (
          <View style={styles.overlay}>
            <ActivityIndicator color="#0F172A" />
          </View>
        ) : null}
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>
            {data
              ? `${data.requests_nearby} open · ${data.drivers_nearby} drivers · ${data.earnings_multiplier.toFixed(1)}x`
              : "Live demand"}
          </Text>
          <TouchableOpacity onPress={() => void load()}>
            <Ionicons name="refresh" size={18} color={APP_COLORS.accent} />
          </TouchableOpacity>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {hotspots.length === 0 && !loading ? (
          <Text style={styles.empty}>
            No demand clusters in range right now. Stay online for the next wave.
          </Text>
        ) : (
          <FlatList
            data={hotspots}
            keyExtractor={(item) => item.id}
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
                    {item.demand_level.replace("_", " ")} · score {item.score}
                  </Text>
                </View>
                <Text style={styles.mult}>{item.multiplier.toFixed(1)}x</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: APP_COLORS.bg },
  mapWrap: { flex: 1.15, backgroundColor: "#E8EEF5" },
  meDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#2563EB",
    borderWidth: 2,
    borderColor: "#fff",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  panel: {
    flex: 1,
    backgroundColor: APP_COLORS.bgElevated,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 14,
  },
  panelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  panelTitle: { color: APP_COLORS.text, fontSize: 14, fontWeight: "800" },
  error: { color: APP_COLORS.danger, marginBottom: 8 },
  empty: { color: APP_COLORS.textMuted, fontSize: 13, lineHeight: 18 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: APP_COLORS.border,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowTitle: { color: APP_COLORS.text, fontSize: 13, fontWeight: "800" },
  rowSub: { color: APP_COLORS.textMuted, fontSize: 11, marginTop: 2 },
  mult: { color: APP_COLORS.accent, fontSize: 16, fontWeight: "900" },
});
