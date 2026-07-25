"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { adminFetch } from "@/lib/adminBrowserAuth";
import { getPublicMapboxToken } from "@/lib/mapboxToken";
import {
  OPS_MAP_LAYER_META,
  type OpsMapFeature,
  type OpsMapLayer,
} from "@/lib/adminOpsMap";

const Map = dynamic(() => import("react-map-gl").then((m) => m.default), {
  ssr: false,
});
const Source = dynamic(() => import("react-map-gl").then((m) => m.Source), {
  ssr: false,
});
const Layer = dynamic(() => import("react-map-gl").then((m) => m.Layer), {
  ssr: false,
});
const NavigationControl = dynamic(
  () => import("react-map-gl").then((m) => m.NavigationControl),
  { ssr: false }
);

type CountryOpt = { country_code: string; country_name: string };
type RegionOpt = {
  country_code: string;
  region_code: string;
  region_name: string;
};

const ALL_LAYERS = Object.keys(OPS_MAP_LAYER_META) as OpsMapLayer[];

export default function AdminOpsLiveMap() {
  const token = getPublicMapboxToken() ?? "";
  const [features, setFeatures] = useState<OpsMapFeature[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [capabilityReason, setCapabilityReason] = useState<string | null>(null);
  const [countries, setCountries] = useState<CountryOpt[]>([]);
  const [regions, setRegions] = useState<RegionOpt[]>([]);
  const [layers, setLayers] = useState<OpsMapLayer[]>(ALL_LAYERS);
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<OpsMapFeature | null>(null);
  const [viewState, setViewState] = useState({
    longitude: -73.9857,
    latitude: 40.7484,
    zoom: 3.2,
  });
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setCapabilityReason("NEXT_PUBLIC_MAPBOX_TOKEN missing");
      setError("Mapbox public token is required for the live ops map.");
      return;
    }
    const params = new URLSearchParams();
    if (layers.length) params.set("layers", layers.join(","));
    if (country) params.set("country", country);
    if (region) params.set("region", region);
    if (city) params.set("city", city);
    if (q.trim()) params.set("q", q.trim());
    try {
      const res = await adminFetch(`/api/admin/ops-map?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Failed to load ops map");
        setCapabilityReason(body.capability?.reason ?? null);
        setFeatures([]);
        return;
      }
      setError(null);
      setCapabilityReason(null);
      setFeatures(body.collection?.features ?? []);
      setCounts(body.counts ?? {});
      setCountries(body.geo?.countries ?? []);
      setRegions(body.geo?.regions ?? []);
      setUpdatedAt(body.generated_at ?? null);
    } catch {
      setError("Connection lost — map data not refreshed");
    }
  }, [token, layers, country, region, city, q]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const collection = useMemo(
    () => ({ type: "FeatureCollection" as const, features }),
    [features]
  );

  const regionOptions = useMemo(
    () =>
      regions.filter((r) => !country || r.country_code === country),
    [regions, country]
  );

  function toggleLayer(layer: OpsMapLayer) {
    setLayers((prev) =>
      prev.includes(layer) ? prev.filter((l) => l !== layer) : [...prev, layer]
    );
  }

  if (!token) {
    return (
      <div className="cc-card p-6">
        <h2 className="text-base font-semibold text-slate-900">
          Live operations map
        </h2>
        <p className="mt-2 text-sm text-[var(--cc-muted)]">
          Disabled — set <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> to enable Mapbox
          live supervision. No simulated map is shown.
        </p>
      </div>
    );
  }

  return (
    <div className="cc-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--cc-border)] px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Live operations map
          </h2>
          <p className="text-sm text-[var(--cc-muted)]">
            Realtime fleet · orders · partners · alerts
            {updatedAt
              ? ` · refreshed ${new Date(updatedAt).toLocaleTimeString()}`
              : ""}
          </p>
        </div>
        <Link
          href="/admin/supervision"
          className="text-sm font-semibold text-[var(--cc-info)] hover:underline"
        >
          Metrics
        </Link>
      </div>

      <div className="grid gap-3 border-b border-[var(--cc-border)] px-4 py-3 lg:grid-cols-5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search labels…"
          className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
        />
        <select
          value={country}
          onChange={(e) => {
            setCountry(e.target.value);
            setRegion("");
          }}
          className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
        >
          <option value="">All countries</option>
          {countries.map((c) => (
            <option key={c.country_code} value={c.country_code}>
              {c.country_name || c.country_code}
            </option>
          ))}
        </select>
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
        >
          <option value="">All states / regions</option>
          {regionOptions.map((r) => (
            <option
              key={`${r.country_code}-${r.region_code}`}
              value={r.region_code}
            >
              {r.region_name || r.region_code}
            </option>
          ))}
        </select>
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="City filter"
          className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
        >
          Refresh now
        </button>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-[var(--cc-border)] px-4 py-3">
        {ALL_LAYERS.map((layer) => {
          const active = layers.includes(layer);
          const meta = OPS_MAP_LAYER_META[layer];
          return (
            <button
              key={layer}
              type="button"
              onClick={() => toggleLayer(layer)}
              className={[
                "rounded-full px-3 py-1 text-xs font-semibold",
                active ? "text-white" : "bg-slate-100 text-slate-600",
              ].join(" ")}
              style={active ? { backgroundColor: meta.color } : undefined}
            >
              {meta.label} ({counts[layer] ?? 0})
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
          {capabilityReason ? ` (${capabilityReason})` : ""}
        </div>
      ) : null}

      <div className="relative h-[480px] w-full">
        <Map
          {...viewState}
          onMove={(evt) => setViewState(evt.viewState)}
          mapboxAccessToken={token}
          mapStyle="mapbox://styles/mapbox/light-v11"
          style={{ width: "100%", height: "100%" }}
          onClick={(e) => {
            const f = e.features?.[0];
            if (!f?.properties) {
              setSelected(null);
              return;
            }
            const props = f.properties as OpsMapFeature["properties"];
            setSelected({
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [
                  Number((f.geometry as { coordinates?: number[] })?.coordinates?.[0]),
                  Number((f.geometry as { coordinates?: number[] })?.coordinates?.[1]),
                ],
              },
              properties: props,
            });
          }}
          interactiveLayerIds={["ops-clusters", "ops-points"]}
        >
          <NavigationControl position="top-right" />
          {/* Administrative boundaries from Mapbox style (countries/states visible at zoom) */}
          <Source id="ops-points" type="geojson" data={collection} cluster clusterMaxZoom={14} clusterRadius={48}>
            <Layer
              id="ops-clusters"
              type="circle"
              filter={["has", "point_count"]}
              paint={{
                "circle-color": "#334155",
                "circle-radius": [
                  "step",
                  ["get", "point_count"],
                  16,
                  25,
                  22,
                  100,
                  28,
                ],
                "circle-opacity": 0.85,
              }}
            />
            <Layer
              id="ops-cluster-count"
              type="symbol"
              filter={["has", "point_count"]}
              layout={{
                "text-field": "{point_count_abbreviated}",
                "text-size": 12,
              }}
              paint={{ "text-color": "#ffffff" }}
            />
            <Layer
              id="ops-points"
              type="circle"
              filter={["!", ["has", "point_count"]]}
              paint={{
                "circle-radius": 6,
                "circle-stroke-width": 1.5,
                "circle-stroke-color": "#ffffff",
                "circle-color": [
                  "match",
                  ["get", "layer"],
                  "drivers_online",
                  "#059669",
                  "drivers_offline",
                  "#94a3b8",
                  "drivers_mission",
                  "#2563eb",
                  "orders_pending",
                  "#d97706",
                  "orders_active",
                  "#7c3aed",
                  "restaurants",
                  "#0f766e",
                  "sellers",
                  "#b45309",
                  "incidents",
                  "#dc2626",
                  "alerts",
                  "#e11d48",
                  "#64748b",
                ],
              }}
            />
          </Source>
        </Map>

        {selected ? (
          <div className="absolute bottom-4 left-4 max-w-sm rounded-2xl border border-[var(--cc-border)] bg-white p-4 shadow-lg">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-muted)]">
              {OPS_MAP_LAYER_META[selected.properties.layer]?.label ??
                selected.properties.layer}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {selected.properties.label}
            </p>
            <p className="text-xs text-[var(--cc-muted)]">
              {selected.properties.status}
              {selected.properties.city ? ` · ${selected.properties.city}` : ""}
            </p>
            <Link
              href={selected.properties.href}
              className="mt-3 inline-flex text-sm font-semibold text-[var(--cc-info)] hover:underline"
            >
              Open record →
            </Link>
          </div>
        ) : null}
      </div>
      <p className="px-4 py-2 text-xs text-[var(--cc-muted)]">
        Borders: Mapbox administrative layers. Pins refresh every 15s from live
        Supabase ops data. Sellers without city geocodes are omitted.
      </p>
    </div>
  );
}
