"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { adminFetch } from "@/lib/adminBrowserAuth";
import { getPublicMapboxToken } from "@/lib/mapboxToken";
import {
  OPS_MAP_LAYER_META,
  OPS_MAP_LAYER_ORDER,
  interpolatePointFeatures,
  type OpsMapFeature,
  type OpsMapLayer,
  type OpsTimelineStep,
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

const ALL_LAYERS = OPS_MAP_LAYER_ORDER;

const CIRCLE_COLOR_EXPR = [
  "match",
  ["get", "layer"],
  "drivers_online",
  "#059669",
  "drivers_offline",
  "#94a3b8",
  "drivers_mission",
  "#2563eb",
  "clients",
  "#0891b2",
  "orders_pending",
  "#d97706",
  "orders_active",
  "#7c3aed",
  "taxi_rides",
  "#db2777",
  "restaurants",
  "#0f766e",
  "sellers",
  "#b45309",
  "incidents",
  "#dc2626",
  "alerts",
  "#e11d48",
  "#64748b",
] as unknown as string;

function parseTimeline(raw: string | null | undefined): OpsTimelineStep[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as OpsTimelineStep[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function AdminOpsLiveMap({
  heightClass = "h-[480px]",
  showHeaderLink = true,
}: {
  heightClass?: string;
  showHeaderLink?: boolean;
}) {
  const token = getPublicMapboxToken() ?? "";
  const [rawFeatures, setRawFeatures] = useState<OpsMapFeature[]>([]);
  const [displayFeatures, setDisplayFeatures] = useState<OpsMapFeature[]>([]);
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
  const [refreshSeconds, setRefreshSeconds] = useState(5);
  const prevPointsRef = useRef<OpsMapFeature[]>([]);
  const animFrameRef = useRef<number | null>(null);

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
        setRawFeatures([]);
        return;
      }
      setError(null);
      setCapabilityReason(null);
      const next = (body.collection?.features ?? []) as OpsMapFeature[];
      setRawFeatures(next);
      setCounts(body.counts ?? {});
      setCountries(body.geo?.countries ?? []);
      setRegions(body.geo?.regions ?? []);
      setUpdatedAt(body.generated_at ?? null);
      if (typeof body.refresh_seconds === "number") {
        setRefreshSeconds(body.refresh_seconds);
      }
    } catch {
      setError("Connection lost — map data not refreshed");
    }
  }, [token, layers, country, region, city, q]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(
      () => void load(),
      Math.max(3, refreshSeconds) * 1000
    );
    return () => window.clearInterval(timer);
  }, [load, refreshSeconds]);

  // Smooth animation for moving driver/client/order points between polls
  useEffect(() => {
    const nextPoints = rawFeatures.filter((f) => f.geometry.type === "Point");
    const nextLines = rawFeatures.filter((f) => f.geometry.type === "LineString");
    const from = prevPointsRef.current;
    if (animFrameRef.current != null) {
      cancelAnimationFrame(animFrameRef.current);
    }
    const started = performance.now();
    const durationMs = Math.min(4500, Math.max(1200, refreshSeconds * 800));

    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const points = interpolatePointFeatures(from, nextPoints, eased);
      setDisplayFeatures([...points, ...nextLines]);
      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(tick);
      } else {
        prevPointsRef.current = nextPoints;
        setDisplayFeatures(rawFeatures);
      }
    };

    if (from.length === 0) {
      prevPointsRef.current = nextPoints;
      setDisplayFeatures(rawFeatures);
      return;
    }

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current != null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [rawFeatures, refreshSeconds]);

  const pointCollection = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: displayFeatures.filter((f) => f.geometry.type === "Point"),
    }),
    [displayFeatures]
  );

  const routeCollection = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: displayFeatures.filter((f) => f.geometry.type === "LineString"),
    }),
    [displayFeatures]
  );

  const regionOptions = useMemo(
    () => regions.filter((r) => !country || r.country_code === country),
    [regions, country]
  );

  const timeline = useMemo(
    () => parseTimeline(selected?.properties.timeline_json),
    [selected]
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
            Realtime fleet · clients · orders · taxi · partners · routes · ETA
            {updatedAt
              ? ` · refreshed ${new Date(updatedAt).toLocaleTimeString()}`
              : ""}
          </p>
        </div>
        {showHeaderLink ? (
          <div className="flex gap-3">
            <Link
              href="/admin/live-map"
              className="text-sm font-semibold text-[var(--cc-info)] hover:underline"
            >
              Full screen
            </Link>
            <Link
              href="/admin/supervision"
              className="text-sm font-semibold text-[var(--cc-info)] hover:underline"
            >
              Metrics
            </Link>
          </div>
        ) : null}
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

      <div className={`relative w-full ${heightClass}`}>
        <Map
          {...viewState}
          onMove={(evt) => setViewState(evt.viewState)}
          mapboxAccessToken={token}
          mapStyle="mapbox://styles/mapbox/streets-v12"
          style={{ width: "100%", height: "100%" }}
          onClick={(e) => {
            const f = e.features?.[0];
            if (!f?.properties) {
              setSelected(null);
              return;
            }
            const props = f.properties as OpsMapFeature["properties"];
            const geom = f.geometry as
              | { type: "Point"; coordinates: number[] }
              | { type: "LineString"; coordinates: number[][] };
            setSelected({
              type: "Feature",
              geometry:
                geom.type === "LineString"
                  ? {
                      type: "LineString",
                      coordinates: (geom.coordinates ?? []).map(
                        (c) => [Number(c[0]), Number(c[1])] as [number, number]
                      ),
                    }
                  : {
                      type: "Point",
                      coordinates: [
                        Number(geom.coordinates?.[0]),
                        Number(geom.coordinates?.[1]),
                      ],
                    },
              properties: props,
            });
          }}
          interactiveLayerIds={[
            "ops-clusters",
            "ops-points",
            "ops-routes-hit",
          ]}
        >
          <NavigationControl position="top-right" />
          <Source
            id="ops-routes"
            type="geojson"
            data={routeCollection}
          >
            <Layer
              id="ops-routes-line"
              type="line"
              paint={{
                "line-color": "#0ea5e9",
                "line-width": 4,
                "line-opacity": 0.85,
              }}
            />
            <Layer
              id="ops-routes-hit"
              type="line"
              paint={{
                "line-color": "#0ea5e9",
                "line-width": 14,
                "line-opacity": 0.01,
              }}
            />
          </Source>
          <Source
            id="ops-points"
            type="geojson"
            data={pointCollection}
            cluster
            clusterMaxZoom={14}
            clusterRadius={48}
          >
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
                "circle-radius": [
                  "match",
                  ["get", "layer"],
                  "drivers_mission",
                  9,
                  "drivers_online",
                  8,
                  6,
                ],
                "circle-stroke-width": 1.5,
                "circle-stroke-color": "#ffffff",
                "circle-color": CIRCLE_COLOR_EXPR,
              }}
            />
          </Source>
        </Map>

        {selected ? (
          <div className="absolute bottom-4 left-4 max-h-[70%] w-full max-w-sm overflow-y-auto rounded-2xl border border-[var(--cc-border)] bg-white p-4 shadow-lg">
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
              {selected.properties.eta_minutes != null
                ? ` · ETA ${selected.properties.eta_minutes} min`
                : ""}
              {selected.properties.route_source
                ? ` · route ${selected.properties.route_source}`
                : ""}
              {selected.properties.payment_status
                ? ` · pay ${selected.properties.payment_status}`
                : ""}
            </p>
            {timeline.length > 0 ? (
              <ol className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                {timeline.map((step) => (
                  <li
                    key={step.key}
                    className="flex items-start gap-2 text-xs"
                  >
                    <span
                      className={[
                        "mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full",
                        step.done ? "bg-emerald-500" : "bg-slate-300",
                      ].join(" ")}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={
                          step.done
                            ? "font-medium text-slate-800"
                            : "text-slate-500"
                        }
                      >
                        {step.label}
                      </span>
                      {step.at ? (
                        <span className="ml-1 text-slate-400">
                          {new Date(step.at).toLocaleTimeString()}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-3">
              <Link
                href={selected.properties.href}
                className="text-sm font-semibold text-[var(--cc-info)] hover:underline"
              >
                Open record →
              </Link>
              {selected.properties.driver_id ? (
                <Link
                  href={`/admin/drivers?focus=${selected.properties.driver_id}`}
                  className="text-sm font-semibold text-[var(--cc-info)] hover:underline"
                >
                  Driver
                </Link>
              ) : null}
              {selected.properties.client_id ? (
                <Link
                  href={`/admin/clients?focus=${selected.properties.client_id}`}
                  className="text-sm font-semibold text-[var(--cc-info)] hover:underline"
                >
                  Client
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <p className="px-4 py-2 text-xs text-[var(--cc-muted)]">
        Live Mapbox ops map · pins + routes refresh every {refreshSeconds}s ·
        vehicle positions animate between GPS updates · click any entity for
        timeline and detail.
      </p>
    </div>
  );
}
