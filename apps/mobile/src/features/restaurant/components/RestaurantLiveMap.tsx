import React, { memo, useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import Mapbox from "@rnmapbox/maps";
import { useTranslation } from "react-i18next";
import type { RestaurantCommandCenterData } from "../../../lib/restaurantCommandCenterApi";
import {
  ensureMapboxTokenApplied,
  getMapStyleDark,
  isMapboxConfigured,
} from "../../../lib/mapboxConfig";
import { textAlignStart } from "../../../i18n/rtl";

type Props = {
  restaurant: RestaurantCommandCenterData["restaurant"];
  mapData: RestaurantCommandCenterData["map"];
  focusOrderId?: string | null;
  height?: number;
};

function RestaurantLiveMapComponent({
  restaurant,
  mapData,
  focusOrderId,
  height = 240,
}: Props) {
  const { t } = useTranslation();
  const cameraRef = useRef<Mapbox.Camera | null>(null);
  const mapReady = ensureMapboxTokenApplied();

  const restaurantCoordinate = useMemo<[number, number] | null>(() => {
    if (restaurant.lat == null || restaurant.lng == null) return null;
    return [restaurant.lng, restaurant.lat];
  }, [restaurant.lat, restaurant.lng]);

  const focusDriver = useMemo(
    () => mapData.drivers.find((driver) => driver.orderId === focusOrderId) ?? null,
    [focusOrderId, mapData.drivers]
  );

  useEffect(() => {
    if (!cameraRef.current || !restaurantCoordinate) return;

    if (focusDriver) {
      cameraRef.current.setCamera({
        centerCoordinate: [focusDriver.lng, focusDriver.lat],
        zoomLevel: 14,
        animationDuration: 700,
      });
      return;
    }

    cameraRef.current.setCamera({
      centerCoordinate: restaurantCoordinate,
      zoomLevel: 12.5,
      animationDuration: 700,
    });
  }, [focusDriver, restaurantCoordinate]);

  if (!isMapboxConfigured() || !mapReady || !restaurantCoordinate) {
    return (
      <View style={[styles.fallback, { height }]}>
        <Text style={[styles.fallbackTitle, { textAlign: textAlignStart() }]}>
          {t("restaurant.commandCenter.mapUnavailable")}
        </Text>
      </View>
    );
  }

  const driverPoints = mapData.drivers.filter(
    (driver) => Number.isFinite(driver.lat) && Number.isFinite(driver.lng)
  );

  return (
    <View style={[styles.wrap, { height }]}>
      <Mapbox.MapView style={styles.map} styleURL={getMapStyleDark()} scaleBarEnabled={false}>
        <Mapbox.Camera ref={cameraRef} centerCoordinate={restaurantCoordinate} zoomLevel={12.5} />

        <Mapbox.PointAnnotation id="restaurant-pin" coordinate={restaurantCoordinate}>
          <View style={styles.restaurantPin}>
            <Text style={styles.restaurantPinText}>👑</Text>
          </View>
        </Mapbox.PointAnnotation>

        {driverPoints.map((driver) => (
          <Mapbox.PointAnnotation
            key={`driver-${driver.driverId}-${driver.orderId}`}
            id={`driver-${driver.driverId}`}
            coordinate={[driver.lng, driver.lat]}
          >
            <View
              style={[
                styles.driverPin,
                driver.status === "arrived"
                  ? styles.driverArrived
                  : driver.status === "approaching"
                    ? styles.driverApproaching
                    : styles.driverEnRoute,
              ]}
            >
              <Text style={styles.driverPinText}>🛵</Text>
            </View>
          </Mapbox.PointAnnotation>
        ))}

        {mapData.customers.map((customer) => (
          <Mapbox.PointAnnotation
            key={`customer-${customer.orderId}`}
            id={`customer-${customer.orderId}`}
            coordinate={[customer.lng, customer.lat]}
          >
            <View style={styles.customerPin}>
              <Text style={styles.customerPinText}>📍</Text>
            </View>
          </Mapbox.PointAnnotation>
        ))}
      </Mapbox.MapView>

      {driverPoints.length === 0 ? (
        <View style={styles.overlay}>
          <Text style={styles.overlayText}>{t("restaurant.commandCenter.noActiveDrivers")}</Text>
        </View>
      ) : null}
    </View>
  );
}

export const RestaurantLiveMap = memo(RestaurantLiveMapComponent);

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.22)",
  },
  map: {
    flex: 1,
  },
  fallback: {
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.18)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  fallbackTitle: {
    color: "rgba(148,163,184,0.95)",
    fontSize: 13,
    fontWeight: "600",
  },
  restaurantPin: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(245,158,11,0.95)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFF",
  },
  restaurantPinText: {
    fontSize: 16,
  },
  driverPin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFF",
  },
  driverArrived: {
    backgroundColor: "rgba(34,197,94,0.95)",
  },
  driverApproaching: {
    backgroundColor: "rgba(251,146,60,0.95)",
  },
  driverEnRoute: {
    backgroundColor: "rgba(96,165,250,0.95)",
  },
  driverPinText: {
    fontSize: 14,
  },
  customerPin: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(124,58,237,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  customerPinText: {
    fontSize: 12,
  },
  overlay: {
    position: "absolute",
    left: 10,
    bottom: 10,
    backgroundColor: "rgba(2,6,23,0.78)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  overlayText: {
    color: "#E2E8F0",
    fontSize: 11,
    fontWeight: "700",
  },
});
