import React, { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import Mapbox from "@rnmapbox/maps";
import { Platform } from "react-native";
import type { CoordinatePoint } from "../../lib/coordinates";
import {
  NAV_ARROW_BEARING_OFFSET,
  NAV_ARROW_SCREEN_OFFSET_X,
  NAV_ARROW_SCREEN_OFFSET_Y,
  NAV_ARROW_SPRITE_WIDTH,
  NAV_VISUAL_CALIB,
  REF_NAV_MEASURE,
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
  const { width, height } = useWindowDimensions();
  const iconOffsetX =
    ((NAV_ARROW_SCREEN_OFFSET_X * width) / 1080) * NAV_VISUAL_CALIB.iconOffsetScale;
  const iconOffsetY =
    ((NAV_ARROW_SCREEN_OFFSET_Y * height) / 2340) * NAV_VISUAL_CALIB.iconOffsetScale;
  /** Largeur icône calibrée référence mesurée (44 px @ 472 px) + calibrage visuel. */
  const iconSize =
    (width * REF_NAV_MEASURE.vehicleWidthRatio * NAV_VISUAL_CALIB.iconWidthScale) /
    NAV_ARROW_SPRITE_WIDTH;
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
          {...(Platform.OS === "android" ? { layerIndex: 1100 } : {})}
          style={{
            iconImage: "driverNavArrow",
            iconSize,
            iconOffset: [iconOffsetX, iconOffsetY],
            iconRotate: followMode ? 0 : ["get", "iconBearing"],
            iconRotationAlignment: followMode ? "viewport" : "map",
            iconPitchAlignment: "viewport",
            iconAnchor: "bottom",
            iconAllowOverlap: true,
            iconIgnorePlacement: true,
            symbolSortKey: 9999,
          }}
        />
      </Mapbox.ShapeSource>
    </>
  );
}
