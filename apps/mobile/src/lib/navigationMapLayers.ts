import type Mapbox from "@rnmapbox/maps";

/** Couches panneaux vitesse natifs Mapbox — un seul panneau MMD en UI. */
const NAV_STYLE_SPEED_LIMIT_LAYERS = [
  "speed-limit",
  "speed-limit-sign",
  "road-speed-limit",
  "maxspeed",
  "speed-limit-us",
  "speed-limit-metric",
];

const NAV_STYLE_ROUTE_LAYERS = [
  "route",
  "route-casing",
  "route-line",
  "route-path",
  "road-route",
  "road-path",
  "road-shield-navigation",
  "road-intersection-navigation",
  "road-label-navigation",
  "road-oneway-arrow-blue",
  "road-oneway-arrow-white",
  "turning-feature",
  "turning-feature-outline",
  "guidance",
  "guidance-arrow",
  "navigation-route",
  "navigation-route-casing",
  "navigation-route-line",
  "navigation-path",
];

/** Palette Apple Plans / carte jour premium (streets-v12). */
const APPLE_DAY_MAP = {
  land: "#F4F2EC",
  landcover: "#F0EDE6",
  road: "#FFFFFF",
  roadCase: "#DDD9D2",
  roadMinor: "#F7F6F3",
  building: "#D8D4CC",
  buildingOutline: "#C8C4BC",
  park: "#A8D4A0",
  parkAlt: "#BDE0B5",
  water: "#A8D8EA",
  waterway: "#9FD0E6",
  label: "#3C3C43",
  labelSecondary: "#636366",
  labelHalo: "rgba(255,255,255,0.88)",
} as const;

type MapViewWithLayerApi = Mapbox.MapView & {
  setLayerProperty?: (
    layerId: string,
    property: string,
    value: unknown,
  ) => Promise<void>;
};

async function hideLayer(
  map: MapViewWithLayerApi,
  layerId: string,
): Promise<void> {
  if (!map.setLayerProperty) return;

  try {
    await map.setLayerProperty(layerId, "visibility", "none");
  } catch {
    // Layer ids vary by style.
  }
}

async function setProp(
  map: MapViewWithLayerApi,
  layerId: string,
  property: string,
  value: unknown,
): Promise<void> {
  if (!map.setLayerProperty) return;
  try {
    await map.setLayerProperty(layerId, property, value);
  } catch {
    // Layer ids vary by style version.
  }
}

const LAND_LAYERS = ["land", "landcover", "background"];

const ROAD_LAYERS = [
  "road-minor",
  "road-minor-low",
  "road-street",
  "road-street-low",
  "road-secondary-tertiary",
  "road-primary",
  "road-motorway-trunk",
  "tunnel-minor",
  "tunnel-street",
  "tunnel-secondary-tertiary",
  "tunnel-primary",
  "tunnel-motorway-trunk",
  "bridge-minor",
  "bridge-street",
  "bridge-secondary-tertiary",
  "bridge-primary",
  "bridge-motorway-trunk",
];

const ROAD_MINOR_LAYERS = new Set([
  "road-minor",
  "road-minor-low",
  "road-street",
  "road-street-low",
  "tunnel-minor",
  "tunnel-street",
  "bridge-minor",
  "bridge-street",
]);

const ROAD_CASE_LAYERS = [
  "road-motorway-trunk-case",
  "road-primary-case",
  "road-secondary-tertiary-case",
  "road-street-case",
  "road-minor-case",
];

const LABEL_LAYERS = [
  "road-label",
  "road-number-shield",
  "road-exit-shield",
  "natural-label",
  "waterway-label",
  "poi-label",
  "settlement-label",
  "settlement-subdivision-label",
  "block-number",
];

const BUILDING_LAYERS = ["building", "building-outline"];

const GREEN_LAYERS = [
  "landuse",
  "landcover-grass",
  "national-park",
  "landuse-grass",
  "landuse-park",
  "park",
];

const WATER_LAYERS = ["water", "waterway"];

async function applyAppleDayMapStyle(map: MapViewWithLayerApi): Promise<void> {
  for (const layerId of LAND_LAYERS) {
    await setProp(map, layerId, "background-color", APPLE_DAY_MAP.land);
    await setProp(map, layerId, "fill-color", APPLE_DAY_MAP.land);
  }

  for (const layerId of WATER_LAYERS) {
    await setProp(map, layerId, "fill-color", APPLE_DAY_MAP.water);
    await setProp(map, layerId, "line-color", APPLE_DAY_MAP.waterway);
    await setProp(map, layerId, "fill-opacity", 0.82);
    await setProp(map, layerId, "line-opacity", 0.9);
  }

  for (const layerId of ROAD_LAYERS) {
    const isMinor = ROAD_MINOR_LAYERS.has(layerId);
    await setProp(
      map,
      layerId,
      "line-color",
      isMinor ? APPLE_DAY_MAP.roadMinor : APPLE_DAY_MAP.road,
    );
    await setProp(map, layerId, "line-opacity", 1);
  }

  for (const layerId of ROAD_CASE_LAYERS) {
    await setProp(map, layerId, "line-color", APPLE_DAY_MAP.roadCase);
    await setProp(map, layerId, "line-opacity", 0.95);
  }

  for (const layerId of BUILDING_LAYERS) {
    await setProp(
      map,
      layerId,
      "fill-color",
      layerId.includes("outline")
        ? APPLE_DAY_MAP.buildingOutline
        : APPLE_DAY_MAP.building,
    );
    await setProp(map, layerId, "fill-opacity", layerId.includes("outline") ? 0.55 : 0.82);
  }

  for (const layerId of GREEN_LAYERS) {
    await setProp(
      map,
      layerId,
      "fill-color",
      layerId.includes("park") || layerId.includes("national")
        ? APPLE_DAY_MAP.parkAlt
        : APPLE_DAY_MAP.park,
    );
    await setProp(map, layerId, "fill-opacity", 0.78);
  }

  for (const layerId of LABEL_LAYERS) {
    const isArea = layerId.includes("settlement");
    await setProp(
      map,
      layerId,
      "text-color",
      isArea ? APPLE_DAY_MAP.labelSecondary : APPLE_DAY_MAP.label,
    );
    await setProp(map, layerId, "text-opacity", isArea ? 0.72 : 0.96);
    await setProp(map, layerId, "text-halo-color", APPLE_DAY_MAP.labelHalo);
    await setProp(map, layerId, "text-halo-width", isArea ? 1.1 : 1.25);
  }
}

/** Masque les surbrillances Mapbox et applique le style carte jour Apple Plans. */
export async function reduceNavigationMapClutter(
  mapRef: React.RefObject<Mapbox.MapView | null>,
): Promise<void> {
  const map = mapRef.current as MapViewWithLayerApi | null;
  if (!map) return;

  for (const layerId of NAV_STYLE_ROUTE_LAYERS) {
    await hideLayer(map, layerId);
  }

  for (const layerId of NAV_STYLE_SPEED_LIMIT_LAYERS) {
    await hideLayer(map, layerId);
  }
}

export { APPLE_DAY_MAP };
