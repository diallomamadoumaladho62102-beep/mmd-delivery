export type OpsMapLayer =
  | "drivers_online"
  | "drivers_offline"
  | "drivers_mission"
  | "orders_pending"
  | "orders_active"
  | "restaurants"
  | "sellers"
  | "incidents"
  | "alerts";

export type OpsMapFeatureProperties = {
  id: string;
  layer: OpsMapLayer;
  label: string;
  href: string;
  status?: string;
  country_code?: string | null;
  region_code?: string | null;
  city?: string | null;
};

export type OpsMapFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
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
  orders_pending: { label: "Orders pending", color: "#d97706" },
  orders_active: { label: "Orders active", color: "#7c3aed" },
  restaurants: { label: "Restaurants", color: "#0f766e" },
  sellers: { label: "Sellers", color: "#b45309" },
  incidents: { label: "Safety incidents", color: "#dc2626" },
  alerts: { label: "Critical alerts", color: "#e11d48" },
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
