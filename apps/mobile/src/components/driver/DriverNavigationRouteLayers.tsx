import React, { useMemo } from "react";
import { Platform } from "react-native";
import Mapbox from "@rnmapbox/maps";
import type { Feature, LineString } from "geojson";
import type { NavigationScreenLayout } from "../../lib/driverNavigationVisual";
import {
  routeLineWidths,
  resolveNavigationFutureShape,
  splitNavigationRoute,
} from "../../lib/driverNavigationRouteStyle";
import {
  NAV_ROUTE_FUTURE,
  NAV_ROUTE_TRAVELED,
} from "../../lib/driverNavigationVisual";

type Props = {
  geometry: Feature<LineString>;
  traveledMeters: number;
  layout: NavigationScreenLayout;
};

function optionalLayerIndex(value: number) {
  return Platform.OS === "android" ? { layerIndex: value } : {};
}

/**
 * Routes Mapbox — vert jusqu'au centre icône, cyan depuis le centre icône.
 * iOS: layerIndex is ignored — use aboveLayerID chain with layers always registered.
 */
export function DriverNavigationRouteLayers({
  geometry,
  traveledMeters,
  layout,
}: Props) {
  const split = useMemo(
    () => splitNavigationRoute(geometry, traveledMeters),
    [geometry, traveledMeters],
  );

  const { future: futureWidth, futureGlow, traveled: traveledWidth } =
    routeLineWidths(layout.width);

  const futureShape = useMemo(() => {
    if (!split) return null;
    return resolveNavigationFutureShape(split.future, geometry);
  }, [geometry, split]);

  if (!split || !futureShape) return null;

  const glowShape = split.futureGlow ?? futureShape;
  const hasFutureGlow = split.futureGlow != null;

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
            lineCap: "butt",
            lineJoin: "round",
            lineOpacity: NAV_ROUTE_FUTURE.opacity,
          }}
        />
      </Mapbox.ShapeSource>

      <Mapbox.ShapeSource
        id="driver-navigation-route-future-glow-source"
        shape={glowShape}
      >
        <Mapbox.LineLayer
          id="driver-navigation-route-future-glow-line"
          aboveLayerID="driver-navigation-route-future-line"
          {...optionalLayerIndex(998)}
          style={
            hasFutureGlow
              ? {
                  lineColor: NAV_ROUTE_FUTURE.glowColor,
                  lineWidth: futureGlow as unknown as number,
                  lineCap: "butt",
                  lineJoin: "round",
                  lineOpacity: NAV_ROUTE_FUTURE.glowOpacity,
                  lineBlur: NAV_ROUTE_FUTURE.glowBlur,
                }
              : {
                  lineColor: NAV_ROUTE_FUTURE.glowColor,
                  lineWidth: 0,
                  lineOpacity: 0,
                }
          }
        />
      </Mapbox.ShapeSource>

      {split.traveled ? (
        <Mapbox.ShapeSource
          id="driver-navigation-route-traveled-source"
          shape={split.traveled}
        >
          <Mapbox.LineLayer
            id="driver-navigation-route-traveled-line"
            aboveLayerID="driver-navigation-route-future-glow-line"
            {...optionalLayerIndex(995)}
            style={{
              lineColor: NAV_ROUTE_TRAVELED.color,
              lineWidth: traveledWidth as unknown as number,
              lineCap: "butt",
              lineJoin: "round",
              lineOpacity: NAV_ROUTE_TRAVELED.opacity,
            }}
          />
        </Mapbox.ShapeSource>
      ) : null}
    </>
  );
}
