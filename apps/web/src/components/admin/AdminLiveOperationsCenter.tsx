"use client";

import { useAdminT } from "@/i18n/useAdminT";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { adminFetch } from "@/lib/adminBrowserAuth";
import { getPublicMapboxToken } from "@/lib/mapboxToken";
import {
  interpolatePointFeatures,
  type OpsMapFeature,
} from "@/lib/adminOpsMap";
import {
  buildOpsLiveCenter,
  filterOpsMissions,
  type OpsAttentionReason,
  type OpsMission,
  type OpsPhase,
  type OpsSafetyReport,
  type OpsService,
} from "@/lib/opsLiveCenter";

const Map = dynamic(() => import("react-map-gl").then((m) => m.default), { ssr: false });
const Source = dynamic(() => import("react-map-gl").then((m) => m.Source), { ssr: false });
const Layer = dynamic(() => import("react-map-gl").then((m) => m.Layer), { ssr: false });
const NavigationControl = dynamic(
  () => import("react-map-gl").then((m) => m.NavigationControl),
  { ssr: false },
);

const CENTER_LAYERS = [
  "drivers_mission",
  "drivers_online",
  "orders_pending",
  "orders_active",
  "taxi_rides",
  "routes",
  "clients",
  "incidents",
  "alerts",
].join(",");

const SERVICES: Array<OpsService | "all"> = [
  "all",
  "taxi",
  "food",
  "delivery",
  "marketplace",
];

const PHASES: Array<OpsPhase | "all" | "active" | "delayed" | "attention"> = [
  "all",
  "active",
  "waiting",
  "pickup",
  "picked_up",
  "en_route",
  "arriving",
  "delayed",
  "attention",
];

type ActivityFilter = "all" | OpsService | "safety";

function serviceLabelKey(service: OpsService | "all" | "safety"): string {
  if (service === "all") return "All";
  if (service === "taxi") return "Taxi";
  if (service === "food") return "Food";
  if (service === "delivery") return "Delivery";
  if (service === "marketplace") return "Marketplace";
  return "Safety";
}

function phaseLabelKey(phase: string): string {
  if (phase === "all") return "All";
  if (phase === "active") return "Active";
  if (phase === "waiting") return "Waiting";
  if (phase === "pickup") return "Pickup";
  if (phase === "picked_up") return "Picked up";
  if (phase === "en_route") return "En route";
  if (phase === "arriving") return "Arriving";
  if (phase === "delayed") return "Delayed";
  if (phase === "attention") return "Attention";
  return "Active";
}

function reasonLabelKey(reason: OpsAttentionReason): string {
  if (reason === "location_stale") return "Location stale";
  if (reason === "delayed") return "Delayed";
  return "Safety report";
}

export default function AdminLiveOperationsCenter() {
  const { t } = useAdminT();
  const token = getPublicMapboxToken() ?? "";
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [missions, setMissions] = useState<OpsMission[]>([]);
  const [safety, setSafety] = useState<OpsSafetyReport[]>([]);
  const [features, setFeatures] = useState<OpsMapFeature[]>([]);
  const [displayFeatures, setDisplayFeatures] = useState<OpsMapFeature[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [service, setService] = useState<OpsService | "all">("all");
  const [phase, setPhase] = useState<(typeof PHASES)[number]>("all");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [q, setQ] = useState("");
  const [showDrivers, setShowDrivers] = useState(true);
  const [showPickups, setShowPickups] = useState(true);
  const [showDestinations, setShowDestinations] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [showRestaurants, setShowRestaurants] = useState(true);
  const [showSellers, setShowSellers] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [refreshSeconds, setRefreshSeconds] = useState(8);
  const [fullscreen, setFullscreen] = useState(false);
  const [viewState, setViewState] = useState({
    longitude: -73.9857,
    latitude: 40.7484,
    zoom: 3.2,
  });
  const prevPointsRef = useRef<OpsMapFeature[]>([]);
  const animFrameRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError("map");
      setLoading(false);
      return;
    }
    try {
      const res = await adminFetch(`/api/admin/ops-map?layers=${CENTER_LAYERS}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError("load");
        setMissions([]);
        setFeatures([]);
        return;
      }
      setError(null);
      const next = (body.collection?.features ?? []) as OpsMapFeature[];
      setFeatures(next);
      const center = body.center ?? {};
      setMissions((center.missions ?? []) as OpsMission[]);
      setSafety((center.safety ?? []) as OpsSafetyReport[]);
      setUpdatedAt(body.generated_at ?? null);
      if (typeof body.refresh_seconds === "number") {
        setRefreshSeconds(body.refresh_seconds);
      }
    } catch {
      setError("load");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    let timer: number | null = null;
    const clear = () => {
      if (timer != null) window.clearInterval(timer);
      timer = null;
    };
    const start = () => {
      clear();
      if (document.visibilityState === "hidden") return;
      timer = window.setInterval(() => {
        if (document.visibilityState === "hidden") return;
        void load();
      }, Math.max(8, refreshSeconds) * 1000);
    };
    start();
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void load();
        start();
      } else {
        clear();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, refreshSeconds]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const filtered = useMemo(() => {
    const phaseFilter =
      phase === "active"
        ? undefined
        : phase;
    const rows = filterOpsMissions(missions, {
      service,
      phase: phaseFilter === "all" ? "all" : phaseFilter,
      q,
    }).filter((mission) => (phase === "active" ? mission.phase !== "waiting" : true));
    return rows;
  }, [missions, service, phase, q]);

  const view = useMemo(
    () =>
      buildOpsLiveCenter({
        missions: filtered,
        safety:
          service === "all" && (phase === "all" || phase === "attention") ? safety : [],
      }),
    [filtered, safety, service, phase],
  );

  const visibleIds = useMemo(() => new Set(filtered.map((mission) => mission.id)), [filtered]);
  const visibleDrivers = useMemo(
    () => new Set(filtered.map((mission) => mission.driverId).filter(Boolean) as string[]),
    [filtered],
  );

  const visibleFeatures = useMemo(() => {
    return features.filter((feature) => {
      const props = feature.properties;
      if (feature.geometry.type === "LineString") {
        return showRoutes && (!props.operation_id || visibleIds.has(props.operation_id));
      }
      if (props.pin_role === "driver" || String(props.layer).startsWith("drivers_")) {
        if (!showDrivers) return false;
        if (service === "all" && phase === "all" && !q.trim()) return true;
        return props.driver_id ? visibleDrivers.has(props.driver_id) : false;
      }
      if (props.pin_role === "attention" || props.layer === "incidents" || props.layer === "alerts") {
        return phase === "all" || phase === "attention";
      }
      if (props.service === "food" && !showRestaurants && props.pin_role === "pickup") return false;
      if (props.service === "marketplace" && !showSellers && props.pin_role === "pickup") return false;
      if (props.pin_role === "pickup" && !showPickups) return false;
      if (props.pin_role === "destination" && !showDestinations) return false;
      if (props.operation_id) return visibleIds.has(props.operation_id);
      return service === "all";
    });
  }, [
    features,
    showRoutes,
    showDrivers,
    showPickups,
    showDestinations,
    showRestaurants,
    showSellers,
    visibleIds,
    visibleDrivers,
    service,
    phase,
    q,
  ]);

  useEffect(() => {
    const nextPoints = visibleFeatures.filter((feature) => feature.geometry.type === "Point");
    const nextLines = visibleFeatures.filter((feature) => feature.geometry.type === "LineString");
    const from = prevPointsRef.current;
    if (animFrameRef.current != null) cancelAnimationFrame(animFrameRef.current);
    if (from.length === 0) {
      prevPointsRef.current = nextPoints;
      setDisplayFeatures(visibleFeatures);
      return;
    }
    const started = performance.now();
    const durationMs = Math.min(4500, Math.max(1200, refreshSeconds * 800));
    const tick = (now: number) => {
      const amount = Math.min(1, (now - started) / durationMs);
      const eased = 1 - Math.pow(1 - amount, 3);
      const points = interpolatePointFeatures(from, nextPoints, eased).map((feature) => {
        if (feature.properties.location_stale) {
          return nextPoints.find((item) => item.properties.id === feature.properties.id) ?? feature;
        }
        return feature;
      });
      setDisplayFeatures([...points, ...nextLines]);
      if (amount < 1) animFrameRef.current = requestAnimationFrame(tick);
      else {
        prevPointsRef.current = nextPoints;
        setDisplayFeatures(visibleFeatures);
      }
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current != null) cancelAnimationFrame(animFrameRef.current);
    };
  }, [visibleFeatures, refreshSeconds]);

  const selected = filtered.find((mission) => mission.id === selectedId) ?? null;

  function centerOn(lng: number | null, lat: number | null) {
    if (lng == null || lat == null) return;
    setViewState((prev) => ({ ...prev, longitude: lng, latitude: lat, zoom: Math.max(prev.zoom, 12) }));
  }

  function selectMission(mission: OpsMission) {
    setSelectedId(mission.id);
    centerOn(mission.lng, mission.lat);
  }

  function fitOperations() {
    const points = visibleFeatures.filter((feature) => feature.geometry.type === "Point");
    if (!points.length) return;
    let minLng = 180;
    let maxLng = -180;
    let minLat = 90;
    let maxLat = -90;
    for (const feature of points) {
      if (feature.geometry.type !== "Point") continue;
      const [lng, lat] = feature.geometry.coordinates;
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
    setViewState({
      longitude: (minLng + maxLng) / 2,
      latitude: (minLat + maxLat) / 2,
      zoom: points.length === 1 ? 13 : 10,
    });
  }

  async function toggleFullscreen() {
    const node = rootRef.current;
    if (!node) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await node.requestFullscreen();
  }

  function freshness(mission: OpsMission): string {
    if (mission.driverId && mission.locationStale) return t("Location stale");
    if (!mission.locationUpdatedAt) return t("Updated unavailable");
    const seconds = Math.max(
      0,
      Math.round((Date.now() - new Date(mission.locationUpdatedAt).getTime()) / 1000),
    );
    if (!Number.isFinite(seconds)) return t("Location stale");
    if (seconds < 60) return `${seconds} ${t("sec ago")}`;
    return `${Math.round(seconds / 60)} ${t("min ago")}`;
  }

  const pointCollection = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: displayFeatures.filter((feature) => feature.geometry.type === "Point"),
    }),
    [displayFeatures],
  );
  const routeCollection = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: displayFeatures.filter((feature) => feature.geometry.type === "LineString"),
    }),
    [displayFeatures],
  );

  const activity = view.activity.filter((item) =>
    activityFilter === "all" ? true : item.service === activityFilter,
  );

  if (!token) {
    return (
      <div className="cc-card p-6">
        <h2 className="text-base font-semibold text-slate-900">{t("Live Operations Center")}</h2>
        <p className="mt-2 text-sm text-[var(--cc-muted)]">
          {t("Disabled — set")} <code>NEXT_PUBLIC_MAPBOX_TOKEN</code>
        </p>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="cc-card overflow-hidden bg-white">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--cc-border)] px-4 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--cc-muted)]">
            {t("Live now")}
          </p>
          <h2 className="text-lg font-semibold text-slate-900">{t("Live Operations Center")}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void load()} className="rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm font-semibold">
            {t("Refresh now")}
          </button>
          <button type="button" onClick={() => void toggleFullscreen()} className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white">
            {fullscreen ? t("Exit full screen") : t("Full screen")}
          </button>
        </div>
      </div>

      <div className="grid gap-2 border-b border-[var(--cc-border)] px-4 py-3 sm:grid-cols-3 lg:grid-cols-7" aria-live="polite">
        {(
          [
            ["Taxi", view.metrics.taxi],
            ["Food", view.metrics.food],
            ["Delivery", view.metrics.delivery],
            ["Marketplace", view.metrics.marketplace],
            ["Active operations", view.metrics.total],
            ["On time", view.metrics.onTime],
            ["Delayed", view.metrics.delayed],
            ["Waiting", view.metrics.waiting],
            ["Attention", view.metrics.attention],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="rounded-xl border border-[var(--cc-border)] px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--cc-muted)]">{t(key)}</p>
            <p className="text-xl font-semibold tabular-nums text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-[var(--cc-border)] px-4 py-3">
        <label className="sr-only" htmlFor="ops-search">{t("Search live operations")}</label>
        <input
          id="ops-search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={t("Search live operations")}
          className="min-w-[220px] flex-1 rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
        />
        {SERVICES.map((item) => (
          <FilterButton key={item} active={service === item} label={t(serviceLabelKey(item))} onClick={() => setService(item)} />
        ))}
      </div>
      <div className="flex flex-wrap gap-2 border-b border-[var(--cc-border)] px-4 py-3">
        {PHASES.map((item) => (
          <FilterButton key={item} active={phase === item} label={t(phaseLabelKey(item))} onClick={() => setPhase(item)} />
        ))}
      </div>

      {error ? (
        <p className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {t("Live operations could not be loaded.")}
        </p>
      ) : null}

      <div className={`grid gap-0 ${fullscreen ? "h-[calc(100vh-220px)]" : ""} xl:grid-cols-[minmax(0,1fr)_380px]`}>
        <div className={`relative min-h-[420px] ${fullscreen ? "h-full" : "h-[min(72vh,820px)]"}`}>
          <Map
            {...viewState}
            onMove={(event) => setViewState(event.viewState)}
            mapboxAccessToken={token}
            mapStyle="mapbox://styles/mapbox/streets-v12"
            style={{ width: "100%", height: "100%" }}
            interactiveLayerIds={["ops-points", "ops-routes-hit", "ops-clusters"]}
            onClick={(event) => {
              const feature = event.features?.[0];
              const operationId = String(feature?.properties?.operation_id ?? feature?.properties?.id ?? "");
              const mission = missions.find((item) => item.id === operationId);
              if (mission) selectMission(mission);
            }}
          >
            <NavigationControl position="top-right" />
            <Source id="ops-routes" type="geojson" data={routeCollection}>
              <Layer id="ops-routes-line" type="line" paint={{ "line-color": "#0ea5e9", "line-width": 4, "line-opacity": 0.85 }} />
              <Layer id="ops-routes-hit" type="line" paint={{ "line-color": "#0ea5e9", "line-width": 14, "line-opacity": 0.01 }} />
            </Source>
            <Source id="ops-points" type="geojson" data={pointCollection} cluster clusterMaxZoom={14} clusterRadius={48}>
              <Layer id="ops-clusters" type="circle" filter={["has", "point_count"]} paint={{ "circle-color": "#334155", "circle-radius": 16, "circle-opacity": 0.85 }} />
              <Layer id="ops-cluster-count" type="symbol" filter={["has", "point_count"]} layout={{ "text-field": "{point_count_abbreviated}", "text-size": 12 }} paint={{ "text-color": "#ffffff" }} />
              <Layer
                id="ops-points"
                type="circle"
                filter={["!", ["has", "point_count"]]}
                paint={{
                  "circle-radius": 7,
                  "circle-stroke-width": 1.5,
                  "circle-stroke-color": "#ffffff",
                  "circle-color": [
                    "match",
                    ["get", "service"],
                    "taxi",
                    "#db2777",
                    "food",
                    "#0f766e",
                    "delivery",
                    "#7c3aed",
                    "marketplace",
                    "#b45309",
                    "#2563eb",
                  ],
                }}
              />
            </Source>
          </Map>
          <div className="absolute left-3 top-3 flex max-w-[240px] flex-col gap-2">
            <button type="button" onClick={fitOperations} className="rounded-xl bg-white px-3 py-2 text-left text-xs font-semibold shadow">
              {t("Fit active operations")}
            </button>
            <Toggle label={t("Drivers")} pressed={showDrivers} onClick={() => setShowDrivers((value) => !value)} />
            <Toggle label={t("Customers")} pressed={showDestinations} onClick={() => setShowDestinations((value) => !value)} />
            <Toggle label={t("Restaurants")} pressed={showRestaurants} onClick={() => setShowRestaurants((value) => !value)} />
            <Toggle label={t("Sellers")} pressed={showSellers} onClick={() => setShowSellers((value) => !value)} />
            <Toggle label={t("Pickup")} pressed={showPickups} onClick={() => setShowPickups((value) => !value)} />
            <Toggle label={t("Routes")} pressed={showRoutes} onClick={() => setShowRoutes((value) => !value)} />
          </div>
          <ul className="absolute bottom-3 left-3 flex flex-wrap gap-2 rounded-xl bg-white/95 px-3 py-2 text-[11px] text-slate-700 shadow">
            <Legend swatch="#2563eb" label={t("Drivers")} />
            <Legend swatch="#db2777" label={t("Taxi")} />
            <Legend swatch="#0f766e" label={t("Food")} />
            <Legend swatch="#7c3aed" label={t("Delivery")} />
            <Legend swatch="#b45309" label={t("Marketplace")} />
            <Legend swatch="#dc2626" label={t("Attention")} />
          </ul>
          {!loading && filtered.length === 0 ? (
            <div className="absolute inset-x-8 top-16 rounded-xl bg-white/95 px-4 py-3 text-sm text-slate-700 shadow">
              {q.trim() || service !== "all" || phase !== "all"
                ? t("No matching operation")
                : t("No active operations")}
            </div>
          ) : null}
        </div>

        <aside className="max-h-[min(72vh,820px)] overflow-y-auto border-t border-[var(--cc-border)] xl:border-l xl:border-t-0">
          <section className="border-b border-[var(--cc-border)] p-4">
            <h3 className="text-sm font-semibold text-slate-900">{t("Live attention")}</h3>
            {view.attention.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--cc-muted)]">{t("No attention items")}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {view.attention.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="w-full rounded-xl border border-[var(--cc-border)] px-3 py-2 text-left text-sm hover:bg-slate-50"
                      onClick={() => {
                        const mission = missions.find((row) => row.id === item.missionId);
                        if (mission) selectMission(mission);
                        else centerOn(item.lng, item.lat);
                      }}
                    >
                      <span className="font-semibold">{t(serviceLabelKey(item.service))}</span>
                      <span className="mt-1 block text-[var(--cc-muted)]">{t(reasonLabelKey(item.reason))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border-b border-[var(--cc-border)] p-4">
            <h3 className="text-sm font-semibold text-slate-900">{t("Live operations")}</h3>
            {filtered.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--cc-muted)]">
                {q.trim() ? t("No matching operation") : t("No active operations")}
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {filtered.slice(0, 80).map((mission) => (
                  <li key={mission.id}>
                    <button
                      type="button"
                      onClick={() => selectMission(mission)}
                      className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${
                        selectedId === mission.id ? "border-slate-900" : "border-[var(--cc-border)]"
                      }`}
                    >
                      <span className="font-semibold">{t(serviceLabelKey(mission.service))} · {mission.id.slice(0, 8)}</span>
                      <span className="mt-1 block">{t(phaseLabelKey(mission.phase))}</span>
                      <span className="mt-1 block text-[var(--cc-muted)]">
                        {mission.etaMinutes != null ? `${t("ETA")} ${mission.etaMinutes} ${t("min")}` : t("ETA unavailable")}
                        {" · "}
                        {freshness(mission)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {selected ? (
            <section className="border-b border-[var(--cc-border)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-muted)]">{t("Current status")}</p>
              <h3 className="mt-1 text-base font-semibold">{t(serviceLabelKey(selected.service))} · {selected.id.slice(0, 8)}</h3>
              <p className="mt-1 text-sm">{t(phaseLabelKey(selected.phase))}</p>
              <dl className="mt-3 space-y-1 text-sm">
                <Detail term={t("ETA")} value={selected.etaMinutes != null ? `${selected.etaMinutes} ${t("min")}` : t("ETA unavailable")} />
                <Detail term={t("Pickup")} value={selected.pickupLabel || t("Updated unavailable")} />
                <Detail term={t("Destination")} value={selected.dropoffLabel || t("Updated unavailable")} />
                <Detail term={t("Restaurant")} value={selected.partnerLabel || t("Updated unavailable")} />
                <Detail term={t("Updated")} value={freshness(selected)} />
              </dl>
              {selected.timeline.length > 0 ? (
                <ol className="mt-3 space-y-1 border-t border-slate-100 pt-3">
                  <li className="text-xs font-semibold uppercase text-[var(--cc-muted)]">{t("Timeline")}</li>
                  {selected.timeline.map((step) => (
                    <li key={step.key} className="text-xs text-slate-700">
                      <span className={step.done ? "font-medium" : "text-slate-400"}>{t(step.label)}</span>
                      {step.at ? <span className="ml-1 text-slate-400">{new Date(step.at).toLocaleTimeString()}</span> : null}
                    </li>
                  ))}
                </ol>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-3">
                <button type="button" className="text-sm font-semibold text-[var(--cc-info)]" onClick={() => centerOn(selected.lng, selected.lat)}>
                  {t("Center on map")}
                </button>
                <Link href={selected.href} className="text-sm font-semibold text-[var(--cc-info)]">
                  {t("View full operation")}
                </Link>
              </div>
            </section>
          ) : null}

          <section className="p-4">
            <h3 className="text-sm font-semibold text-slate-900">{t("Live activity")}</h3>
            <div className="mt-2 flex flex-wrap gap-1">
              {(["all", "taxi", "food", "delivery", "marketplace", "safety"] as ActivityFilter[]).map((item) => (
                <FilterButton key={item} active={activityFilter === item} label={t(serviceLabelKey(item))} onClick={() => setActivityFilter(item)} />
              ))}
            </div>
            {activity.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--cc-muted)]">{t("No active operations")}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {activity.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="w-full text-left text-xs text-slate-700"
                      onClick={() => {
                        const mission = missions.find((row) => row.id === item.missionId);
                        if (mission) selectMission(mission);
                      }}
                    >
                      <span className="text-slate-400">{new Date(item.at).toLocaleTimeString()}</span>
                      <span className="ml-2">{t(item.label)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
      {loading ? <p className="px-4 py-2 text-xs text-[var(--cc-muted)]">{t("Loading…")}</p> : null}
    </div>
  );
}

function FilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"
      }`}
    >
      {label}
    </button>
  );
}

function Toggle({
  label,
  pressed,
  onClick,
}: {
  label: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="rounded-xl bg-white px-3 py-1.5 text-left text-xs font-semibold shadow"
    >
      {label}
    </button>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <li className="flex items-center gap-1">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: swatch }} aria-hidden />
      <span>{label}</span>
    </li>
  );
}

function Detail({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--cc-muted)]">{term}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
