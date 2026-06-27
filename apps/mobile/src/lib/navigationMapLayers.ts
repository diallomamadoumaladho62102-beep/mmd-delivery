import type Mapbox from "@rnmapbox/maps";
import { NAV_MAP } from "./driverNavigationVisual";

const HIDDEN_LAYERS = [
  "poi",
  "poi-label",
  "poi-scalerank2",
  "poi-scalerank3",
  "transit",
  "transit-label",
  "airport-label",
  "settlement-label",
  "settlement-subdivision-label",
  "building",
  "building-extrusion",
  "building-top",
  "3d-buildings",
  "structure-polygon",
  "land-structure-polygon",
  "land-structure-line",
  "structure",
  "traffic",
  "traffic-congestion",
  "traffic-incident",
  "road-closure",
  "hillshade",
  "hillshade-shadow",
  "hillshade-highlight",
  "hillshade-accent",
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

const ROAD_LAYERS = [
  "road-minor",
  "road-minor-low",
  "road-street",
  "road-street-low",
  "road-secondary-tertiary",
  "road-primary",
  "road-motorway-trunk",
  "road-minor-navigation",
  "road-street-navigation",
  "road-secondary-tertiary-navigation",
  "road-primary-navigation",
  "road-motorway-trunk-navigation",
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

const ROAD_CASE_LAYERS = [
  "road-motorway-trunk-case",
  "road-primary-case",
  "road-secondary-tertiary-case",
  "road-street-case",
  "road-minor-case",
];

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

async function zeroFillLayer(
  map: MapViewWithLayerApi,
  layerId: string,
): Promise<void> {
  if (!map.setLayerProperty) return;

  try {
    await map.setLayerProperty(layerId, "fill-opacity", 0);
  } catch {
    // ignore
  }
}

async function styleRoadLayer(
  map: MapViewWithLayerApi,
  layerId: string,
): Promise<void> {
  if (!map.setLayerProperty) return;

  try {
    await map.setLayerProperty(layerId, "line-color", NAV_MAP.road);
    await map.setLayerProperty(layerId, "line-opacity", NAV_MAP.roadOpacity);
  } catch {
    // ignore
  }
}

async function styleRoadCaseLayer(
  map: MapViewWithLayerApi,
  layerId: string,
): Promise<void> {
  if (!map.setLayerProperty) return;

  try {
    await map.setLayerProperty(layerId, "line-color", NAV_MAP.roadCase);
    await map.setLayerProperty(layerId, "line-opacity", NAV_MAP.roadCaseOpacity);
  } catch {
    // ignore
  }
}

async function styleLand(map: MapViewWithLayerApi): Promise<void> {
  if (!map.setLayerProperty) return;

  for (const layerId of ["land", "land-navigation", "landcover"]) {
    try {
      await map.setLayerProperty(layerId, "fill-color", NAV_MAP.land);
    } catch {
      // ignore
    }
  }
}

async function styleLabels(
  map: MapViewWithLayerApi,
  layerId: string,
): Promise<void> {
  if (!map.setLayerProperty) return;

  try {
    await map.setLayerProperty(layerId, "text-color", NAV_MAP.label);
    await map.setLayerProperty(layerId, "text-opacity", 0.97);
    await map.setLayerProperty(layerId, "text-halo-color", "rgba(0,0,0,0.6)");
    await map.setLayerProperty(layerId, "text-halo-width", 1.5);
  } catch {
    // ignore
  }
}

export async function reduceNavigationMapClutter(
  mapRef: React.RefObject<Mapbox.MapView | null>,
): Promise<void> {
  const map = mapRef.current as MapViewWithLayerApi | null;
  if (!map) return;

  for (const layerId of HIDDEN_LAYERS) {
    await hideLayer(map, layerId);
    await hideLayer(map, `${layerId}-navigation`);
    await zeroFillLayer(map, layerId);
    await zeroFillLayer(map, `${layerId}-navigation`);
  }

  for (const layerId of NAV_STYLE_ROUTE_LAYERS) {
    await hideLayer(map, layerId);
  }

  for (const layerId of ROAD_LAYERS) {
    if (layerId.includes("-navigation")) {
      // Style navigation-night surligne toute la route (y compris derrière l'icône).
      await hideLayer(map, layerId);
      continue;
    }
    await styleRoadLayer(map, layerId);
  }

  for (const layerId of ROAD_CASE_LAYERS) {
    if (layerId.includes("-navigation")) {
      await hideLayer(map, layerId);
      continue;
    }
    await styleRoadCaseLayer(map, layerId);
  }

  for (const layerId of ["road-label"]) {
    await styleLabels(map, layerId);
  }

  await styleLand(map);
}
