import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { rowDirection, textAlignStart } from "../../i18n/rtl";
import { isValidCoordinate } from "../../lib/coordinates";
import {
  ensureMapboxTokenApplied,
  getMapboxModule,
  getMapStyleStreets,
} from "../../lib/mapboxConfig";
import { getCameraForLngLatPoints } from "../../lib/liveTripTracking";
import { useNearbyActiveDrivers } from "../../hooks/useNearbyActiveDrivers";
import { MMD_GOLD, MMD_TAXI_GREEN, MMD_WHITE } from "../../theme/mmdUi";

type LatLng = { lat: number; lng: number } | null;

export function NearbyDriversSection(props: {
  pickup: LatLng;
  dropoff: LatLng;
  category: string;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const pickupReady = isValidCoordinate(props.pickup?.lat, props.pickup?.lng);
  const nearby = useNearbyActiveDrivers({
    pickup: pickupReady ? props.pickup : null,
    category: props.category,
    enabled: props.enabled && pickupReady,
  });
  const Mapbox = getMapboxModule();
  const mapModuleReady = ensureMapboxTokenApplied() && Mapbox != null;

  const dropoffReady =
    props.dropoff != null && isValidCoordinate(props.dropoff.lat, props.dropoff.lng);

  const camera = useMemo(() => {
    if (!props.pickup || !pickupReady) return null;
    const points: [number, number][] = [[props.pickup.lng, props.pickup.lat]];
    if (dropoffReady && props.dropoff) points.push([props.dropoff.lng, props.dropoff.lat]);
    for (const driver of nearby.drivers) {
      points.push([driver.longitude, driver.latitude]);
    }
    return getCameraForLngLatPoints(points);
  }, [dropoffReady, nearby.drivers, pickupReady, props.dropoff, props.pickup]);

  const statusText = !pickupReady
    ? t("taxi.home.nearbyNeedPickup")
    : nearby.status === "loading"
      ? t("taxi.home.nearbyLoading")
      : nearby.status === "updating"
        ? t("taxi.home.nearbyUpdating")
        : nearby.status === "error"
          ? t("taxi.home.nearbyError")
          : nearby.status === "empty"
            ? t("taxi.home.nearbyEmpty")
            : nearby.eta.available && nearby.eta.minutes != null
              ? `${t("taxi.home.nearbyEtaLabel")} · ${t("taxi.home.nearbyMinutes", { count: nearby.eta.minutes })}`
              : t("taxi.home.nearbyEtaUnavailable");

  if (!props.enabled) return null;

  return (
    <View style={styles.wrap}>
      <View
        style={styles.mapFrame}
        accessibilityRole="image"
        accessibilityLabel={t("taxi.home.nearbyMapLabel")}
      >
        {pickupReady && props.pickup && mapModuleReady && Mapbox && camera ? (
          <Mapbox.MapView
            style={StyleSheet.absoluteFill}
            styleURL={getMapStyleStreets()}
            logoEnabled
            attributionEnabled={false}
            compassEnabled={false}
            surfaceView={false}
            rotateEnabled={false}
            pitchEnabled={false}
          >
            <Mapbox.Camera
              centerCoordinate={camera.centerCoordinate}
              zoomLevel={camera.zoomLevel}
              animationMode="easeTo"
              animationDuration={400}
            />
            <Mapbox.PointAnnotation
              id="nearby-pickup"
              coordinate={[props.pickup.lng, props.pickup.lat]}
            >
              <View
                collapsable={false}
                style={styles.pickupPin}
                accessibilityLabel={t("taxi.home.nearbyPickupMarker")}
              />
            </Mapbox.PointAnnotation>
            {dropoffReady && props.dropoff ? (
              <Mapbox.PointAnnotation
                id="nearby-dropoff"
                coordinate={[props.dropoff.lng, props.dropoff.lat]}
              >
                <View
                  collapsable={false}
                  style={styles.dropoffPin}
                  accessibilityLabel={t("taxi.home.nearbyDropoffMarker")}
                />
              </Mapbox.PointAnnotation>
            ) : null}
            {nearby.drivers.map((driver) => (
              <Mapbox.PointAnnotation
                key={driver.markerId}
                id={`nearby-driver-${driver.markerId}`}
                coordinate={[driver.longitude, driver.latitude]}
              >
                <View
                  collapsable={false}
                  style={styles.driverPin}
                  accessibilityLabel={t("taxi.home.nearbyMarker")}
                >
                  <Ionicons name="car" size={12} color="#1A1404" />
                </View>
              </Mapbox.PointAnnotation>
            ))}
          </Mapbox.MapView>
        ) : pickupReady ? (
          <View style={styles.mapFallback}>
            <Text style={styles.fallbackText}>{t("tracking.mapUnavailable")}</Text>
          </View>
        ) : (
          <View style={styles.mapFallback} />
        )}
      </View>
      <View style={[styles.statusRow, { flexDirection: rowDirection() }]}>
        <Text style={[styles.title, { textAlign: textAlignStart() }]}>{t("taxi.home.nearbyTitle")}</Text>
        <Text style={[styles.status, { textAlign: textAlignStart() }]}>{statusText}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 8,
  },
  mapFrame: {
    height: 240,
    marginHorizontal: 20,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#001F59",
  },
  mapFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  fallbackText: {
    color: MMD_WHITE,
    textAlign: "center",
  },
  pickupPin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: MMD_TAXI_GREEN,
    borderWidth: 2,
    borderColor: MMD_WHITE,
  },
  dropoffPin: {
    width: 16,
    height: 16,
    borderRadius: 3,
    backgroundColor: "#EF4444",
    borderWidth: 2,
    borderColor: MMD_WHITE,
  },
  driverPin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: MMD_GOLD,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#1A1404",
  },
  statusRow: {
    gap: 6,
    flexWrap: "wrap",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  title: {
    color: MMD_WHITE,
    fontWeight: "800",
    flexShrink: 1,
  },
  status: {
    color: "rgba(255,255,255,0.82)",
    flexShrink: 1,
  },
});
