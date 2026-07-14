import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { CoordinatePoint } from "../../lib/coordinates";
import { isValidCoordinate } from "../../lib/coordinates";
import {
  ensureMapboxTokenApplied,
  getMapboxModule,
  getMapStyleStreets,
} from "../../lib/mapboxConfig";
import {
  collectLiveTripCameraPoints,
  getCameraForLngLatPoints,
  straightLineGeometry,
} from "../../lib/liveTripTracking";

export type LiveTripStop = CoordinatePoint & {
  id?: string;
  label?: string;
};

export type LiveTripMapProps = {
  pickup?: CoordinatePoint | null;
  dropoff?: CoordinatePoint | null;
  driver?: CoordinatePoint | null;
  stops?: LiveTripStop[];
  routeGeometry?: GeoJSON.Feature<GeoJSON.LineString> | null;
  height?: number;
  /** When true, map fills parent (flex: 1) instead of fixed height. */
  fill?: boolean;
  showRezoom?: boolean;
  labels?: boolean;
  stale?: boolean;
  unavailable?: boolean;
  badgeText?: string | null;
};

function pinStyle(color: string) {
  return {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: color,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 2,
    borderColor: "#fff",
  };
}

const pinText = { color: "#fff", fontWeight: "800" as const, fontSize: 11 };

export function LiveTripMap({
  pickup,
  dropoff,
  driver,
  stops = [],
  routeGeometry,
  height = 250,
  fill = false,
  showRezoom = true,
  labels = true,
  stale = false,
  unavailable = false,
  badgeText,
}: LiveTripMapProps) {
  const Mapbox = getMapboxModule();
  const cameraRef = useRef<{
    setCamera: (config: Record<string, unknown>) => void;
  } | null>(null);

  const validPickup =
    pickup && isValidCoordinate(pickup.latitude, pickup.longitude) ? pickup : null;
  const validDropoff =
    dropoff && isValidCoordinate(dropoff.latitude, dropoff.longitude)
      ? dropoff
      : null;
  const validDriver =
    driver && isValidCoordinate(driver.latitude, driver.longitude) ? driver : null;

  const mapPoints = useMemo(
    () =>
      collectLiveTripCameraPoints({
        pickup: validPickup,
        dropoff: validDropoff,
        driver: validDriver,
        stops,
      }),
    [validPickup, validDropoff, validDriver, stops]
  );

  const camera = useMemo(() => getCameraForLngLatPoints(mapPoints), [mapPoints]);

  const lineFeature = useMemo(() => {
    if (routeGeometry?.geometry?.coordinates?.length) {
      return routeGeometry;
    }
    if (validPickup && validDropoff) {
      return straightLineGeometry(validPickup, validDropoff);
    }
    if (validDriver && validDropoff) {
      return straightLineGeometry(validDriver, validDropoff);
    }
    return null;
  }, [routeGeometry, validPickup, validDropoff, validDriver]);

  const fitCamera = useCallback(() => {
    if (!cameraRef.current || mapPoints.length === 0) return;
    cameraRef.current.setCamera({
      centerCoordinate: camera.centerCoordinate,
      zoomLevel: camera.zoomLevel,
      animationDuration: 650,
      animationMode: "flyTo",
    });
  }, [camera, mapPoints.length]);

  useEffect(() => {
    const t = setTimeout(fitCamera, 350);
    return () => clearTimeout(t);
  }, [fitCamera]);

  const mapReady =
    Boolean(Mapbox) &&
    ensureMapboxTokenApplied() &&
    mapPoints.length > 0 &&
    !unavailable;

  if (!mapReady || !Mapbox) {
    return (
      <View style={[styles.fallback, fill ? styles.fill : { height }]}>
        <Text style={styles.fallbackText}>Map unavailable</Text>
        {badgeText ? <Text style={styles.badgeText}>{badgeText}</Text> : null}
      </View>
    );
  }

  return (
    <View style={[styles.wrap, fill ? styles.fill : { height }]}>
      <Mapbox.MapView
        style={StyleSheet.absoluteFill}
        styleURL={getMapStyleStreets()}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled
        surfaceView={false}
      >
        <Mapbox.Camera
          ref={cameraRef as never}
          allowUpdates
          centerCoordinate={camera.centerCoordinate}
          zoomLevel={camera.zoomLevel}
          animationMode="flyTo"
          animationDuration={650}
        />

        {validPickup ? (
          <Mapbox.PointAnnotation
            id="live-pickup"
            coordinate={[validPickup.longitude, validPickup.latitude]}
          >
            <View style={pinStyle("#22C55E")}>
              <Text style={pinText}>{labels ? "P" : ""}</Text>
            </View>
          </Mapbox.PointAnnotation>
        ) : null}

        {validDropoff ? (
          <Mapbox.PointAnnotation
            id="live-dropoff"
            coordinate={[validDropoff.longitude, validDropoff.latitude]}
          >
            <View style={pinStyle("#EF4444")}>
              <Text style={pinText}>{labels ? "D" : ""}</Text>
            </View>
          </Mapbox.PointAnnotation>
        ) : null}

        {validDriver ? (
          <Mapbox.PointAnnotation
            id="live-driver"
            coordinate={[validDriver.longitude, validDriver.latitude]}
          >
            <View style={pinStyle("#38BDF8")}>
              <Text style={pinText}>{labels ? "T" : ""}</Text>
            </View>
          </Mapbox.PointAnnotation>
        ) : null}

        {stops.map((stop, index) => {
          if (!isValidCoordinate(stop.latitude, stop.longitude)) return null;
          const id = stop.id ?? `stop-${index}`;
          return (
            <Mapbox.PointAnnotation
              key={id}
              id={id}
              coordinate={[stop.longitude, stop.latitude]}
            >
              <View style={pinStyle("#A855F7")}>
                <Text style={pinText}>{stop.label ?? String(index + 1)}</Text>
              </View>
            </Mapbox.PointAnnotation>
          );
        })}

        {lineFeature ? (
          <Mapbox.ShapeSource id="live-trip-route" shape={lineFeature}>
            <Mapbox.LineLayer
              id="live-trip-route-shadow"
              style={{
                lineColor: "rgba(59,130,246,0.2)",
                lineWidth: 8,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
            <Mapbox.LineLayer
              id="live-trip-route-line"
              style={{
                lineColor: "#60A5FA",
                lineWidth: 4,
                lineOpacity: 0.9,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
          </Mapbox.ShapeSource>
        ) : null}
      </Mapbox.MapView>

      {showRezoom ? (
        <View style={styles.rezoomWrap}>
          <TouchableOpacity onPress={fitCamera} style={styles.rezoomBtn}>
            <Text style={styles.rezoomText}>Re-zoom</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {(stale || badgeText) && (
        <View style={styles.badgeWrap}>
          <Text style={styles.badgeText}>
            {badgeText ?? (stale ? "Location may be stale" : "")}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.14)",
    backgroundColor: "rgba(2,6,23,0.7)",
  },
  fill: {
    flex: 1,
    borderRadius: 0,
    borderWidth: 0,
  },
  fallback: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.14)",
    backgroundColor: "rgba(2,6,23,0.7)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  fallbackText: {
    color: "#94A3B8",
    fontWeight: "700",
  },
  rezoomWrap: {
    position: "absolute",
    top: 12,
    right: 12,
  },
  rezoomBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(2,6,23,0.86)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
  },
  rezoomText: {
    color: "#93C5FD",
    fontWeight: "800",
    fontSize: 12,
  },
  badgeWrap: {
    position: "absolute",
    left: 12,
    bottom: 12,
    right: 12,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: "rgba(2,6,23,0.84)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.35)",
  },
  badgeText: {
    color: "#FDE68A",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
});

export default LiveTripMap;
