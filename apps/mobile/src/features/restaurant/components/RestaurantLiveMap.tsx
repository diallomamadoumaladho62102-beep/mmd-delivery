import React, { memo, useEffect, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Mapbox from "@rnmapbox/maps";
import { useTranslation } from "react-i18next";
import type { RestaurantCommandCenterData } from "../../../lib/restaurantCommandCenterApi";
import {
  ensureMapboxTokenApplied,
  getMapStyleStreets,
  isMapboxConfigured,
} from "../../../lib/mapboxConfig";
import { rowDirection, textAlignStart } from "../../../i18n/rtl";
import { GlassCard } from "./GlassCard";
import { SectionHeroHeader } from "./SectionHeroHeader";
import { CC, LIVE_OPS_STATUS } from "./commandCenterTheme";

type Props = {
  restaurant: RestaurantCommandCenterData["restaurant"];
  mapData: RestaurantCommandCenterData["map"];
  focusOrderId?: string | null;
  height?: number;
  onOpenFullMap?: () => void;
};

function RestaurantLiveMapComponent({
  restaurant,
  mapData,
  focusOrderId,
  height = 360,
  onOpenFullMap,
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

  const driverPoints = mapData.drivers.filter(
    (driver) => Number.isFinite(driver.lat) && Number.isFinite(driver.lng)
  );

  const statusCounts = useMemo(() => {
    const counts = { arrived: 0, approaching: 0, en_route: 0 };
    for (const driver of driverPoints) {
      counts[driver.status] += 1;
    }
    return counts;
  }, [driverPoints]);

  useEffect(() => {
    if (!cameraRef.current || !restaurantCoordinate) return;

    if (focusDriver) {
      cameraRef.current.setCamera({
        centerCoordinate: [focusDriver.lng, focusDriver.lat],
        zoomLevel: 14.5,
        animationDuration: 700,
      });
      return;
    }

    cameraRef.current.setCamera({
      centerCoordinate: restaurantCoordinate,
      zoomLevel: 13,
      animationDuration: 700,
    });
  }, [focusDriver, restaurantCoordinate]);

  const mapHeight = height - 72;

  return (
    <GlassCard variant="map" accentBar={CC.blue} style={styles.shell}>
      <SectionHeroHeader
        title={t("restaurant.commandCenter.liveMap")}
        subtitle={restaurant.name}
        badge={driverPoints.length > 0 ? String(driverPoints.length) : undefined}
        badgeColor={CC.blue}
        rightSlot={
          onOpenFullMap ? (
            <Pressable style={styles.fullMapBtn} onPress={onOpenFullMap}>
              <Text style={styles.fullMapText}>
                {t("restaurant.commandCenter.liveMapFull", "Map operations")}
              </Text>
            </Pressable>
          ) : null
        }
      />

      {!isMapboxConfigured() || !mapReady || !restaurantCoordinate ? (
        <View style={[styles.fallback, { height: mapHeight }]}>
          <Text style={[styles.fallbackTitle, { textAlign: textAlignStart() }]}>
            {t("restaurant.commandCenter.mapUnavailable")}
          </Text>
        </View>
      ) : (
        <View style={[styles.frame, { height: mapHeight }]}>
          <View style={styles.frameGlow} pointerEvents="none" />
          <View style={styles.wrap}>
            <Mapbox.MapView style={styles.map} styleURL={getMapStyleStreets()} scaleBarEnabled={false}>
              <Mapbox.Camera ref={cameraRef} centerCoordinate={restaurantCoordinate} zoomLevel={13} />

              <Mapbox.PointAnnotation id="restaurant-pin" coordinate={restaurantCoordinate}>
                <View style={styles.restaurantPinWrap}>
                  <View style={styles.restaurantPin}>
                    <Text style={styles.restaurantPinText}>👑</Text>
                  </View>
                  <View style={styles.restaurantLabel}>
                    <Text style={styles.restaurantLabelText} numberOfLines={1}>
                      {restaurant.name}
                    </Text>
                  </View>
                </View>
              </Mapbox.PointAnnotation>

              {driverPoints.map((driver) => {
                const status = LIVE_OPS_STATUS[driver.status];
                return (
                  <Mapbox.PointAnnotation
                    key={`driver-${driver.driverId}-${driver.orderId}`}
                    id={`driver-${driver.driverId}`}
                    coordinate={[driver.lng, driver.lat]}
                  >
                    <View style={styles.driverPinWrap}>
                      <View
                        style={[
                          styles.driverPin,
                          {
                            backgroundColor: status.color,
                            borderColor: status.border,
                          },
                        ]}
                      >
                        <Text style={styles.driverPinText}>🛵</Text>
                      </View>
                      {driver.etaMinutes != null ? (
                        <View style={[styles.etaChip, { borderColor: status.border }]}>
                          <Text style={[styles.etaChipText, { color: status.color }]}>
                            {t("restaurant.commandCenter.etaMinutes", { minutes: driver.etaMinutes })}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </Mapbox.PointAnnotation>
                );
              })}

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
          </View>

          <View style={[styles.legendOverlay, { flexDirection: rowDirection() }]}>
            {(["arrived", "approaching", "en_route"] as const).map((key) => (
              <View key={key} style={styles.legendPill}>
                <Text style={styles.legendDot}>{LIVE_OPS_STATUS[key].dot}</Text>
                <Text style={styles.legendCount}>{statusCounts[key]}</Text>
              </View>
            ))}
          </View>

          {driverPoints.length === 0 ? (
            <View style={styles.overlay}>
              <Text style={styles.overlayText}>{t("restaurant.commandCenter.noActiveDrivers")}</Text>
            </View>
          ) : null}
        </View>
      )}
    </GlassCard>
  );
}

export const RestaurantLiveMap = memo(RestaurantLiveMapComponent);

const styles = StyleSheet.create({
  shell: {
    paddingBottom: 14,
  },
  fullMapBtn: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: CC.purpleGlow,
    borderWidth: 1,
    borderColor: CC.glassBorder,
  },
  fullMapText: {
    color: CC.purpleLight,
    fontSize: 11,
    fontWeight: "900",
  },
  frame: {
    position: "relative",
    borderRadius: 20,
  },
  frameGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: CC.mapFrameGlow,
    shadowColor: CC.blue,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
  },
  wrap: {
    flex: 1,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: CC.glassBorder,
  },
  map: {
    flex: 1,
  },
  fallback: {
    borderRadius: 20,
    backgroundColor: CC.bgElevated,
    borderWidth: 1.5,
    borderColor: CC.mapFrameGlow,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  fallbackTitle: {
    color: CC.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  restaurantPinWrap: {
    alignItems: "center",
  },
  restaurantPin: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(245,158,11,0.96)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#FFF",
    ...CC.heroShadow,
  },
  restaurantPinText: {
    fontSize: 20,
  },
  restaurantLabel: {
    marginTop: 4,
    maxWidth: 120,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(2,6,23,0.88)",
    borderWidth: 1,
    borderColor: CC.glassBorderGold,
  },
  restaurantLabelText: {
    color: CC.gold,
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
  },
  driverPinWrap: {
    alignItems: "center",
  },
  driverPin: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    ...CC.shadow,
  },
  driverPinText: {
    fontSize: 16,
  },
  etaChip: {
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: "rgba(2,6,23,0.9)",
    borderWidth: 1,
  },
  etaChipText: {
    fontSize: 9,
    fontWeight: "900",
  },
  customerPin: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(124,58,237,0.9)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFF",
  },
  customerPinText: {
    fontSize: 13,
  },
  legendOverlay: {
    position: "absolute",
    top: 12,
    right: 12,
    gap: 6,
  },
  legendPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(2,6,23,0.85)",
    borderWidth: 1,
    borderColor: CC.glassBorder,
  },
  legendDot: {
    fontSize: 10,
  },
  legendCount: {
    color: CC.textPrimary,
    fontSize: 11,
    fontWeight: "900",
  },
  overlay: {
    position: "absolute",
    left: 12,
    bottom: 12,
    backgroundColor: "rgba(2,6,23,0.88)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CC.glassBorder,
  },
  overlayText: {
    color: CC.textPrimary,
    fontSize: 12,
    fontWeight: "800",
  },
});
