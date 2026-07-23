import React, { useMemo } from "react";
import { Platform } from "react-native";
import Mapbox from "@rnmapbox/maps";
import type { Feature, LineString, Position } from "geojson";
import type { NavigationScreenLayout } from "../../lib/driverNavigationVisual";
import {
  NAV_ROUTE_APPROACH,
  NAV_ROUTE_APPROACH_METERS,
  NAV_ROUTE_FUTURE,
  junctionRouteMetersFromTraveled,
} from "../../lib/driverNavigationVisual";
import {
  extractRouteSlice,
  resolveNavigationFutureShape,
  routeLineWidths,
  routeTotalMeters,
  splitNavigationRoute,
} from "../../lib/driverNavigationRouteStyle";

type Props = {
  geometry: Feature<LineString>;
  traveledMeters: number;
  layout: NavigationScreenLayout;
  /** Remaining distance to the next maneuver (meters). Real Mapbox data only. */
  maneuverDistanceMeters?: number | null;
};

function optionalLayerIndex(value: number) {
  return Platform.OS === "android" ? { layerIndex: value } : {};
}

function lineFeature(coords: Position[]): Feature<LineString> | null {
  if (coords.length < 2) return null;
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: coords },
  };
}

/**
 * Mapbox route layers — official blue future + yellow approach before turn.
 * No green traveled segment behind the vehicle.
 */
export function DriverNavigationRouteLayers({
  geometry,
  traveledMeters,
  layout,
  maneuverDistanceMeters = null,
}: Props) {
  const split = useMemo(
    () => splitNavigationRoute(geometry, traveledMeters),
    [geometry, traveledMeters],
  );

  const { future: futureWidth } = routeLineWidths(layout.width);

  const futureShape = useMemo(() => {
    if (!split) return null;
    return resolveNavigationFutureShape(split.future, geometry);
  }, [geometry, split]);

  const approachShape = useMemo(() => {
    if (
      maneuverDistanceMeters == null ||
      !Number.isFinite(maneuverDistanceMeters) ||
      maneuverDistanceMeters <= 4
    ) {
      return null;
    }

    const coords = geometry.geometry.coordinates;
    if (coords.length < 2) return null;

    const totalMeters = routeTotalMeters(coords);
    const junction = junctionRouteMetersFromTraveled(traveledMeters);
    // End of yellow = exact next-maneuver point on the Mapbox polyline.
    const approachEnd = Math.min(
      totalMeters,
      traveledMeters + Math.max(0, maneuverDistanceMeters),
    );
    // Start behind the maneuver by APPROACH_METERS, but never behind the vehicle junction.
    const approachStart = Math.max(
      junction,
      Math.min(approachEnd - 12, approachEnd - NAV_ROUTE_APPROACH_METERS),
    );
    if (approachEnd - approachStart < 4) return null;

    return lineFeature(extractRouteSlice(geometry, approachStart, approachEnd));
  }, [geometry, maneuverDistanceMeters, traveledMeters]);

  if (!split || !futureShape) return null;

  const approachFeature =
    approachShape ??
    ({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [] },
    } as Feature<LineString>);

  return (
    <>
      <Mapbox.ShapeSource
        id="driver-navigation-route-future-source"
        shape={futureShape}
      >
        <Mapbox.LineLayer
          id="driver-navigation-route-future-line"
          {...optionalLayerIndex(1000)}
          style={{
            lineColor: NAV_ROUTE_FUTURE.color,
            lineWidth: futureWidth as unknown as number,
            lineCap: "round",
            lineJoin: "round",
            lineOpacity: NAV_ROUTE_FUTURE.opacity,
          }}
        />
      </Mapbox.ShapeSource>

      <Mapbox.ShapeSource
        id="driver-navigation-route-approach-source"
        shape={approachFeature}
      >
        <Mapbox.LineLayer
          id="driver-navigation-route-approach-line"
          aboveLayerID="driver-navigation-route-future-line"
          {...optionalLayerIndex(1002)}
          style={{
            lineColor: NAV_ROUTE_APPROACH.color,
            lineWidth: futureWidth as unknown as number,
            lineCap: "round",
            lineJoin: "round",
            lineOpacity: approachShape ? NAV_ROUTE_APPROACH.opacity : 0,
          }}
        />
      </Mapbox.ShapeSource>
    </>
  );
}
