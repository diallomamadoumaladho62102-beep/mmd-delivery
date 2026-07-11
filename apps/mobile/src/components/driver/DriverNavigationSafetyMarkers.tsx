import React from "react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Mapbox from "@rnmapbox/maps";
import type { ProjectedSafetyEvent } from "../../lib/roadSafety";
import { safetyBadgeModel } from "../../lib/roadSafetyDisplay";
import { NAV_ELEVATION } from "../../theme/navigationTheme";

type Props = {
  events: ProjectedSafetyEvent[];
  locale: string;
  /** Hide markers further than this ahead-distance to avoid clutter. */
  maxAheadMeters?: number;
  /** Cap the number of on-map markers (nearest first). */
  maxMarkers?: number;
};

/**
 * On-map safety markers with distinct, recognizable icons. Only ahead events on
 * the active route are passed in; markers naturally disappear once passed and
 * are recomputed after reroute (parent recomputes `events`).
 */
export function DriverNavigationSafetyMarkers({
  events,
  locale,
  maxAheadMeters = 1200,
  maxMarkers = 6,
}: Props) {
  const visible = events
    .filter((event) => event.distanceAheadMeters <= maxAheadMeters)
    .slice(0, maxMarkers);

  return (
    <>
      {visible.map((event) => {
        const model = safetyBadgeModel(event.type, locale);
        return (
          <Mapbox.PointAnnotation
            key={`safety-${event.id}`}
            id={`safety-${event.id}`}
            coordinate={[event.coordinate.longitude, event.coordinate.latitude]}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                backgroundColor: model.colors.bg,
                borderWidth: 2,
                borderColor: model.colors.ring,
                alignItems: "center",
                justifyContent: "center",
                ...NAV_ELEVATION.low,
              }}
            >
              <Ionicons name={model.icon as never} size={16} color={model.colors.icon} />
            </View>
          </Mapbox.PointAnnotation>
        );
      })}
    </>
  );
}
