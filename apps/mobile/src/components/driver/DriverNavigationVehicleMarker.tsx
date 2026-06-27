import React, { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import Mapbox from "@rnmapbox/maps";
import type { CoordinatePoint } from "../../lib/coordinates";
import {
  NAV_ARROW_BEARING_OFFSET,
  NAV_ARROW_ICON,
  NAV_ARROW_SCREEN_OFFSET_Y,
} from "../../lib/driverNavigationVisual";

const ARROW_IMAGE = require("../../../assets/driver-navigation-arrow.png");

type Props = {
  point: CoordinatePoint;
  bearing: number;
  followMode: boolean;
};

function normalizeBearing(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((value % 360) + 360) % 360;
}

/**
 * Chevron navigation premium Waze — base GPS snapée sur la route Mapbox.
 * Follow : viewport (pointe vers le haut, carte tourne). Libre : cap carte.
 */
export function DriverNavigationVehicleMarker({
  point,
  bearing,
  followMode,
}: Props) {
  const { height } = useWindowDimensions();
  const iconOffsetY = (NAV_ARROW_SCREEN_OFFSET_Y * height) / 2340;
  const iconBearing = normalizeBearing(bearing + NAV_ARROW_BEARING_OFFSET);

  const shape = useMemo(
    () => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [point.longitude, point.latitude],
      },
      properties: { iconBearing },
    }),
    [iconBearing, point.latitude, point.longitude],
  );

  return (
    <>
      <Mapbox.Images images={{ driverNavArrow: ARROW_IMAGE }} />
      <Mapbox.ShapeSource id="driver-nav-vehicle-source" shape={shape}>
        <Mapbox.SymbolLayer
          id="driver-nav-vehicle-layer"
          aboveLayerID="driver-navigation-route-future-line"
          layerIndex={1100}
          style={{
            iconImage: "driverNavArrow",
            iconSize: NAV_ARROW_ICON.size,
            iconOffset: [0, iconOffsetY],
            iconRotate: followMode ? 0 : ["get", "iconBearing"],
            iconRotationAlignment: followMode ? "viewport" : "map",
            iconPitchAlignment: "viewport",
            iconAnchor: "bottom",
            iconAllowOverlap: true,
            iconIgnorePlacement: true,
            symbolSortKey: 200,
          }}
        />
      </Mapbox.ShapeSource>
    </>
  );
}
