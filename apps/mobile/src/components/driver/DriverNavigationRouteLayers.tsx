import React, { useMemo } from "react";
import Mapbox from "@rnmapbox/maps";
import type { Feature, LineString } from "geojson";
import type { NavigationScreenLayout } from "../../lib/driverNavigationVisual";
import {
  routeLineWidths,
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

/**
 * Routes Mapbox — comportement Waze : vert → base icône, cyan → pointe, masque sous le véhicule.
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

  if (!split) return null;

  return (
    <>
      {split.traveled ? (
        <Mapbox.ShapeSource
          id="driver-navigation-route-traveled-source"
          shape={split.traveled}
        >
          <Mapbox.LineLayer
            id="driver-navigation-route-traveled-line"
            belowLayerID="driver-navigation-route-future-glow-line"
            layerIndex={995}
            style={{
              lineColor: NAV_ROUTE_TRAVELED.color,
              lineWidth: traveledWidth,
              lineCap: "butt",
              lineJoin: "round",
              lineOpacity: NAV_ROUTE_TRAVELED.opacity,
            }}
          />
        </Mapbox.ShapeSource>
      ) : null}

      {split.futureGlow ? (
        <Mapbox.ShapeSource
          id="driver-navigation-route-future-glow-source"
          shape={split.futureGlow}
        >
          <Mapbox.LineLayer
            id="driver-navigation-route-future-glow-line"
            layerIndex={998}
            style={{
              lineColor: NAV_ROUTE_FUTURE.glowColor,
              lineWidth: futureGlow,
              lineCap: "butt",
              lineJoin: "round",
              lineOpacity: NAV_ROUTE_FUTURE.glowOpacity,
              lineBlur: NAV_ROUTE_FUTURE.glowBlur,
            }}
          />
        </Mapbox.ShapeSource>
      ) : null}

      <Mapbox.ShapeSource
        id="driver-navigation-route-future-source"
        shape={split.future}
      >
        {split.future.geometry.coordinates.length >= 2 ? (
          <Mapbox.LineLayer
            id="driver-navigation-route-future-line"
            layerIndex={1000}
            style={{
              lineColor: NAV_ROUTE_FUTURE.color,
              lineWidth: futureWidth,
              lineCap: "butt",
              lineJoin: "round",
              lineOpacity: NAV_ROUTE_FUTURE.opacity,
            }}
          />
        ) : (
          <Mapbox.LineLayer
            id="driver-navigation-route-future-line"
            layerIndex={1000}
            style={{
              lineColor: NAV_ROUTE_FUTURE.color,
              lineWidth: 0,
              lineOpacity: 0,
            }}
          />
        )}
      </Mapbox.ShapeSource>
    </>
  );
}
