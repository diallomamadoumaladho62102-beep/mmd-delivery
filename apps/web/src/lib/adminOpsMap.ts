export type OpsMapLayer =
  | "drivers_online"
  | "drivers_offline"
  | "drivers_mission"
  | "clients"
  | "orders_pending"
  | "orders_active"
  | "taxi_rides"
  | "routes"
  | "restaurants"
  | "sellers"
  | "incidents"
  | "alerts";

/**
 * Live Map extension contract
 * ---------------------------
 * To add a new realtime entity (e.g. delivery_requests, marketplace_orders):
 * 1. Add a layer key to `OpsMapLayer` + `OPS_MAP_LAYER_META`
 * 2. Emit GeoJSON features from `GET /api/admin/ops-map` (Point and/or LineString)
 * 3. Optionally extend `OpsMapFeatureProperties` with mission fields
 * The map UI (`AdminOpsLiveMap`) renders all registered layers via
 * `OPS_MAP_LAYER_ORDER` — no page redesign required.
 */

export type OpsMapFeatureProperties = {
  id: string;
  layer: OpsMapLayer;
  label: string;
  href: string;
  status?: string;
  country_code?: string | null;
  region_code?: string | null;
  city?: string | null;
  /** Mission kind for detail panel */
  mission_kind?: "order" | "taxi" | "driver" | "client" | "partner";
  driver_id?: string | null;
  client_id?: string | null;
  eta_minutes?: number | null;
  /** How the route geometry/ETA was produced */
  route_source?: "mapbox" | "cache" | "straight" | null;
  payment_status?: string | null;
  /** JSON-encoded timeline steps for live mission panel */
  timeline_json?: string | null;
};

export type OpsMapGeometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "LineString"; coordinates: [number, number][] };

export type OpsMapFeature = {
  type: "Feature";
  geometry: OpsMapGeometry;
  properties: OpsMapFeatureProperties;
};

export type OpsMapFeatureCollection = {
  type: "FeatureCollection";
  features: OpsMapFeature[];
};

export const OPS_MAP_LAYER_META: Record<
  OpsMapLayer,
  { label: string; color: string }
> = {
  drivers_online: { label: "Drivers online", color: "#059669" },
  drivers_offline: { label: "Drivers offline", color: "#94a3b8" },
  drivers_mission: { label: "Drivers on mission", color: "#2563eb" },
  clients: { label: "Clients", color: "#0891b2" },
  orders_pending: { label: "Orders pending", color: "#d97706" },
  orders_active: { label: "Orders active", color: "#7c3aed" },
  taxi_rides: { label: "Taxi rides", color: "#db2777" },
  routes: { label: "Live routes", color: "#0ea5e9" },
  restaurants: { label: "Restaurants", color: "#0f766e" },
  sellers: { label: "Sellers", color: "#b45309" },
  incidents: { label: "Safety incidents", color: "#dc2626" },
  alerts: { label: "Critical alerts", color: "#e11d48" },
};

/** Stable render / toggle order for the Live Map layer chips. */
export const OPS_MAP_LAYER_ORDER = Object.keys(
  OPS_MAP_LAYER_META
) as OpsMapLayer[];

export function isOpsMapLayer(value: string): value is OpsMapLayer {
  return Object.prototype.hasOwnProperty.call(OPS_MAP_LAYER_META, value);
}

export type OpsTimelineStep = {
  key: string;
  label: string;
  at: string | null;
  done: boolean;
};

export function pointFeature(
  lng: number,
  lat: number,
  properties: OpsMapFeatureProperties
): OpsMapFeature | null {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties,
  };
}

export function lineStringFeature(
  coordinates: [number, number][],
  properties: OpsMapFeatureProperties
): OpsMapFeature | null {
  const clean = coordinates.filter(
    ([lng, lat]) =>
      Number.isFinite(lng) &&
      Number.isFinite(lat) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180
  );
  if (clean.length < 2) return null;
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: clean },
    properties,
  };
}

export function filterOpsFeatures(
  features: OpsMapFeature[],
  filters: {
    layers?: OpsMapLayer[];
    country?: string;
    region?: string;
    city?: string;
    q?: string;
  }
): OpsMapFeature[] {
  const q = (filters.q ?? "").trim().toLowerCase();
  const layers = filters.layers?.length ? new Set(filters.layers) : null;
  return features.filter((f) => {
    const p = f.properties;
    if (layers && !layers.has(p.layer)) return false;
    if (filters.country && p.country_code !== filters.country) return false;
    if (filters.region && p.region_code !== filters.region) return false;
    if (
      filters.city &&
      String(p.city ?? "").toLowerCase() !== filters.city.toLowerCase()
    ) {
      return false;
    }
    if (q && !`${p.label} ${p.status ?? ""}`.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
}

export function lerp(
  a: number,
  b: number,
  t: number
): number {
  return a + (b - a) * t;
}

/** Interpolate Point features between two snapshots for smooth vehicle animation. */
export function interpolatePointFeatures(
  from: OpsMapFeature[],
  to: OpsMapFeature[],
  t: number
): OpsMapFeature[] {
  const fromById = new Map(
    from
      .filter((f) => f.geometry.type === "Point")
      .map((f) => [f.properties.id, f] as const)
  );
  return to.map((feature) => {
    if (feature.geometry.type !== "Point") return feature;
    const prev = fromById.get(feature.properties.id);
    if (!prev || prev.geometry.type !== "Point") return feature;
    const [lng0, lat0] = prev.geometry.coordinates;
    const [lng1, lat1] = feature.geometry.coordinates;
    return {
      ...feature,
      geometry: {
        type: "Point",
        coordinates: [lerp(lng0, lng1, t), lerp(lat0, lat1, t)],
      },
    };
  });
}
