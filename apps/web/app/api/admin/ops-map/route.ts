import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertStaffPermission,
} from "@/lib/adminServer";
import {
  OPS_MAP_LAYER_META,
  lineStringFeature,
  pointFeature,
  type OpsMapFeature,
  type OpsMapLayer,
  type OpsTimelineStep,
} from "@/lib/adminOpsMap";
import { resolveCcCapability } from "@/lib/adminFeatureFlags";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function encodeTimeline(steps: OpsTimelineStep[]): string {
  return JSON.stringify(steps);
}

function orderTimeline(o: {
  created_at?: string | null;
  accepted_at?: string | null;
  driver_id?: string | null;
  picked_up_at?: string | null;
  delivered_at?: string | null;
  payment_status?: string | null;
  status?: string | null;
}): OpsTimelineStep[] {
  const status = String(o.status ?? "");
  const assigned = Boolean(o.driver_id);
  const picked =
    Boolean(o.picked_up_at) ||
    ["picked_up", "en_route", "out_for_delivery", "delivered"].includes(status);
  const done = status === "delivered" || Boolean(o.delivered_at);
  const paid = ["paid", "succeeded", "captured"].includes(
    String(o.payment_status ?? "").toLowerCase()
  );
  return [
    { key: "created", label: "Created", at: o.created_at ?? null, done: true },
    {
      key: "assigned",
      label: "Driver assigned",
      at: o.accepted_at ?? null,
      done: assigned,
    },
    {
      key: "pickup",
      label: "Picked up / started",
      at: o.picked_up_at ?? null,
      done: picked,
    },
    {
      key: "in_progress",
      label: "In progress (GPS)",
      at: null,
      done: picked && !done,
    },
    {
      key: "delivered",
      label: "Delivered",
      at: o.delivered_at ?? null,
      done,
    },
    {
      key: "payment",
      label: "Payment",
      at: null,
      done: paid || done,
    },
    { key: "closed", label: "Closed", at: o.delivered_at ?? null, done },
  ];
}

function taxiTimeline(r: {
  created_at?: string | null;
  accepted_at?: string | null;
  driver_id?: string | null;
  driver_arrived_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  payment_status?: string | null;
  status?: string | null;
}): OpsTimelineStep[] {
  const status = String(r.status ?? "");
  const assigned = Boolean(r.driver_id) || Boolean(r.accepted_at);
  const arrived =
    Boolean(r.driver_arrived_at) ||
    ["driver_arrived", "in_progress", "completed"].includes(status);
  const started =
    Boolean(r.started_at) || ["in_progress", "completed"].includes(status);
  const done = status === "completed" || Boolean(r.completed_at);
  const paid = ["paid", "succeeded", "captured"].includes(
    String(r.payment_status ?? "").toLowerCase()
  );
  return [
    { key: "created", label: "Created", at: r.created_at ?? null, done: true },
    {
      key: "assigned",
      label: "Driver assigned",
      at: r.accepted_at ?? null,
      done: assigned,
    },
    {
      key: "arrived",
      label: "Driver arrived",
      at: r.driver_arrived_at ?? null,
      done: arrived,
    },
    {
      key: "started",
      label: "Trip started",
      at: r.started_at ?? null,
      done: started,
    },
    {
      key: "in_progress",
      label: "GPS in progress",
      at: null,
      done: started && !done,
    },
    {
      key: "completed",
      label: "Completed",
      at: r.completed_at ?? null,
      done,
    },
    {
      key: "payment",
      label: "Payment",
      at: null,
      done: paid || done,
    },
    { key: "closed", label: "Closed", at: r.completed_at ?? null, done },
  ];
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("supervision.read", request);
    const capability = resolveCcCapability("liveMapboxOpsMap");
    if (!capability.enabled) {
      return json(
        {
          ok: false,
          error: capability.reason ?? "Mapbox not configured",
          capability,
        },
        503
      );
    }

    const supabase = buildSupabaseAdminClient();
    const url = request.nextUrl;
    const country = url.searchParams.get("country") || undefined;
    const region = url.searchParams.get("region") || undefined;
    const city = url.searchParams.get("city") || undefined;
    const q = url.searchParams.get("q") || undefined;
    const layersParam = url.searchParams.get("layers");
    const layers = layersParam
      ? (layersParam.split(",").filter(Boolean) as OpsMapLayer[])
      : (Object.keys(OPS_MAP_LAYER_META) as OpsMapLayer[]);

    const features: OpsMapFeature[] = [];
    const now = Date.now();
    const staleMs = 15 * 60 * 1000;
    const driverLocById = new Map<
      string,
      { lat: number; lng: number; updated_at: string }
    >();

    // Drivers + locations
    if (
      layers.some((l) =>
        ["drivers_online", "drivers_offline", "drivers_mission", "routes"].includes(
          l
        )
      )
    ) {
      const { data: drivers } = await supabase
        .from("driver_profiles")
        .select("user_id, is_online, full_name, city, state, country_code")
        .limit(5000);

      const driverIds = (drivers ?? []).map((d) => String(d.user_id));
      if (driverIds.length) {
        const { data: locs } = await supabase
          .from("driver_locations")
          .select("driver_id, lat, lng, updated_at")
          .in("driver_id", driverIds.slice(0, 5000));
        for (const loc of locs ?? []) {
          const lat = num(loc.lat);
          const lng = num(loc.lng);
          if (lat == null || lng == null) continue;
          driverLocById.set(String(loc.driver_id), {
            lat,
            lng,
            updated_at: String(loc.updated_at ?? ""),
          });
        }
      }

      const onMission = new Set<string>();
      const { data: activeOrders } = await supabase
        .from("orders")
        .select("driver_id")
        .not("driver_id", "is", null)
        .in("status", [
          "accepted",
          "preparing",
          "ready",
          "picked_up",
          "en_route",
          "out_for_delivery",
          "driver_assigned",
        ])
        .limit(3000);
      for (const o of activeOrders ?? []) {
        if (o.driver_id) onMission.add(String(o.driver_id));
      }
      const { data: activeRides } = await supabase
        .from("taxi_rides")
        .select("driver_id")
        .not("driver_id", "is", null)
        .in("status", [
          "accepted",
          "driver_arrived",
          "in_progress",
          "dispatching",
        ])
        .limit(3000);
      for (const r of activeRides ?? []) {
        if (r.driver_id) onMission.add(String(r.driver_id));
      }

      for (const d of drivers ?? []) {
        const id = String(d.user_id);
        const loc = driverLocById.get(id);
        if (!loc) continue;
        const mission = onMission.has(id);
        let layer: OpsMapLayer = "drivers_offline";
        if (mission) layer = "drivers_mission";
        else if (d.is_online === true) layer = "drivers_online";
        if (!layers.includes(layer)) continue;
        const f = pointFeature(loc.lng, loc.lat, {
          id,
          layer,
          label: String(d.full_name ?? "Driver"),
          href: `/admin/drivers?focus=${id}`,
          status: mission ? "on_mission" : d.is_online ? "online" : "offline",
          country_code: d.country_code ?? null,
          region_code: d.state ?? null,
          city: d.city ?? null,
          mission_kind: "driver",
          driver_id: id,
        });
        if (f) features.push(f);
      }
    }

    // Orders + client pins at dropoff + routes
    if (
      layers.some((l) =>
        ["orders_pending", "orders_active", "clients", "routes"].includes(l)
      )
    ) {
      const { data: orders } = await supabase
        .from("orders")
        .select(
          "id, status, client_user_id, driver_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, country_code, city, created_at, accepted_at, picked_up_at, delivered_at, payment_status, eta_minutes"
        )
        .in("status", [
          "pending",
          "paid",
          "accepted",
          "preparing",
          "ready",
          "picked_up",
          "en_route",
          "out_for_delivery",
          "driver_assigned",
        ])
        .limit(4000);

      for (const o of orders ?? []) {
        const pending = ["pending", "paid"].includes(String(o.status));
        const layer: OpsMapLayer = pending ? "orders_pending" : "orders_active";
        const pickupLat = num(o.pickup_lat);
        const pickupLng = num(o.pickup_lng);
        const dropLat = num(o.dropoff_lat);
        const dropLng = num(o.dropoff_lng);
        const orderLat = pickupLat ?? dropLat;
        const orderLng = pickupLng ?? dropLng;
        const timeline = encodeTimeline(orderTimeline(o));

        if (layers.includes(layer) && orderLat != null && orderLng != null) {
          const f = pointFeature(orderLng, orderLat, {
            id: String(o.id),
            layer,
            label: `Order ${String(o.id).slice(0, 8)}`,
            href: `/admin/orders/${o.id}`,
            status: String(o.status),
            country_code: o.country_code ?? null,
            city: o.city ?? null,
            mission_kind: "order",
            driver_id: o.driver_id ? String(o.driver_id) : null,
            client_id: o.client_user_id ? String(o.client_user_id) : null,
            eta_minutes: num(o.eta_minutes),
            payment_status: o.payment_status ? String(o.payment_status) : null,
            timeline_json: timeline,
          });
          if (f) features.push(f);
        }

        if (
          layers.includes("clients") &&
          dropLat != null &&
          dropLng != null &&
          o.client_user_id
        ) {
          const f = pointFeature(dropLng, dropLat, {
            id: `client-order-${o.client_user_id}`,
            layer: "clients",
            label: `Client ${String(o.client_user_id).slice(0, 8)}`,
            href: `/admin/clients?focus=${o.client_user_id}`,
            status: String(o.status),
            country_code: o.country_code ?? null,
            city: o.city ?? null,
            mission_kind: "client",
            client_id: String(o.client_user_id),
            driver_id: o.driver_id ? String(o.driver_id) : null,
            timeline_json: timeline,
          });
          if (f) features.push(f);
        }

        if (layers.includes("routes") && !pending) {
          const driverLoc = o.driver_id
            ? driverLocById.get(String(o.driver_id))
            : null;
          const coords: [number, number][] = [];
          if (driverLoc) coords.push([driverLoc.lng, driverLoc.lat]);
          if (pickupLng != null && pickupLat != null) {
            coords.push([pickupLng, pickupLat]);
          }
          if (dropLng != null && dropLat != null) {
            coords.push([dropLng, dropLat]);
          }
          const route = lineStringFeature(coords, {
            id: `route-order-${o.id}`,
            layer: "routes",
            label: `Route order ${String(o.id).slice(0, 8)}`,
            href: `/admin/orders/${o.id}`,
            status: String(o.status),
            mission_kind: "order",
            driver_id: o.driver_id ? String(o.driver_id) : null,
            client_id: o.client_user_id ? String(o.client_user_id) : null,
            eta_minutes: num(o.eta_minutes),
            payment_status: o.payment_status ? String(o.payment_status) : null,
            timeline_json: timeline,
            country_code: o.country_code ?? null,
            city: o.city ?? null,
          });
          if (route) features.push(route);
        }
      }
    }

    // Taxi rides + clients + routes
    if (layers.some((l) => ["taxi_rides", "clients", "routes"].includes(l))) {
      const { data: rides } = await supabase
        .from("taxi_rides")
        .select(
          "id, status, client_user_id, driver_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, country_code, created_at, accepted_at, driver_arrived_at, started_at, completed_at, payment_status, duration_minutes"
        )
        .in("status", [
          "paid",
          "dispatching",
          "accepted",
          "driver_arrived",
          "in_progress",
        ])
        .limit(3000);

      for (const r of rides ?? []) {
        const pickupLat = num(r.pickup_lat);
        const pickupLng = num(r.pickup_lng);
        const dropLat = num(r.dropoff_lat);
        const dropLng = num(r.dropoff_lng);
        const timeline = encodeTimeline(taxiTimeline(r));
        const eta = num(r.duration_minutes);

        if (
          layers.includes("taxi_rides") &&
          pickupLat != null &&
          pickupLng != null
        ) {
          const f = pointFeature(pickupLng, pickupLat, {
            id: String(r.id),
            layer: "taxi_rides",
            label: `Taxi ${String(r.id).slice(0, 8)}`,
            href: `/admin/taxi-rides?focus=${r.id}`,
            status: String(r.status),
            country_code: r.country_code ?? null,
            mission_kind: "taxi",
            driver_id: r.driver_id ? String(r.driver_id) : null,
            client_id: r.client_user_id ? String(r.client_user_id) : null,
            eta_minutes: eta,
            payment_status: r.payment_status
              ? String(r.payment_status)
              : null,
            timeline_json: timeline,
          });
          if (f) features.push(f);
        }

        if (
          layers.includes("clients") &&
          pickupLat != null &&
          pickupLng != null &&
          r.client_user_id
        ) {
          const f = pointFeature(pickupLng, pickupLat, {
            id: `client-taxi-${r.client_user_id}`,
            layer: "clients",
            label: `Client ${String(r.client_user_id).slice(0, 8)}`,
            href: `/admin/clients?focus=${r.client_user_id}`,
            status: String(r.status),
            country_code: r.country_code ?? null,
            mission_kind: "client",
            client_id: String(r.client_user_id),
            driver_id: r.driver_id ? String(r.driver_id) : null,
            timeline_json: timeline,
          });
          if (f) features.push(f);
        }

        if (layers.includes("routes")) {
          const driverLoc = r.driver_id
            ? driverLocById.get(String(r.driver_id))
            : null;
          const coords: [number, number][] = [];
          if (driverLoc) coords.push([driverLoc.lng, driverLoc.lat]);
          if (pickupLng != null && pickupLat != null) {
            coords.push([pickupLng, pickupLat]);
          }
          if (dropLng != null && dropLat != null) {
            coords.push([dropLng, dropLat]);
          }
          const route = lineStringFeature(coords, {
            id: `route-taxi-${r.id}`,
            layer: "routes",
            label: `Route taxi ${String(r.id).slice(0, 8)}`,
            href: `/admin/taxi-rides?focus=${r.id}`,
            status: String(r.status),
            mission_kind: "taxi",
            driver_id: r.driver_id ? String(r.driver_id) : null,
            client_id: r.client_user_id ? String(r.client_user_id) : null,
            eta_minutes: eta,
            payment_status: r.payment_status
              ? String(r.payment_status)
              : null,
            timeline_json: timeline,
            country_code: r.country_code ?? null,
          });
          if (route) features.push(route);
        }
      }
    }

    // Restaurants
    if (layers.includes("restaurants")) {
      const { data: restaurants } = await supabase
        .from("restaurant_profiles")
        .select(
          "user_id, restaurant_name, location_lat, location_lng, lat, lng, city, country_code, account_status"
        )
        .limit(4000);
      for (const r of restaurants ?? []) {
        const lat = num(r.location_lat) ?? num(r.lat);
        const lng = num(r.location_lng) ?? num(r.lng);
        if (lat == null || lng == null) continue;
        const f = pointFeature(lng, lat, {
          id: String(r.user_id),
          layer: "restaurants",
          label: String(r.restaurant_name ?? "Restaurant"),
          href: `/admin/restaurants?focus=${r.user_id}`,
          status: String(r.account_status ?? "active"),
          country_code: r.country_code ?? null,
          city: r.city ?? null,
          mission_kind: "partner",
        });
        if (f) features.push(f);
      }
    }

    // Sellers — geocode via location_points
    if (layers.includes("sellers")) {
      const { data: sellers } = await supabase
        .from("sellers")
        .select("id, store_name, city, country_code, region_code, status")
        .limit(2000);
      const cityCoords = new Map<string, { lat: number; lng: number }>();
      const { data: points } = await supabase
        .from("location_points")
        .select("country_code, city_name, pin_lat, pin_lng, geocoded_lat, geocoded_lng")
        .limit(5000);
      for (const p of points ?? []) {
        const key = `${p.country_code ?? ""}|${p.city_name ?? ""}`.toLowerCase();
        const lat = num(p.pin_lat) ?? num(p.geocoded_lat);
        const lng = num(p.pin_lng) ?? num(p.geocoded_lng);
        if (lat != null && lng != null) cityCoords.set(key, { lat, lng });
      }
      for (const s of sellers ?? []) {
        const key = `${s.country_code ?? ""}|${s.city ?? ""}`.toLowerCase();
        const c = cityCoords.get(key);
        if (!c) continue;
        const f = pointFeature(c.lng, c.lat, {
          id: String(s.id),
          layer: "sellers",
          label: String(s.store_name ?? "Seller"),
          href: `/admin/sellers?focus=${s.id}`,
          status: String(s.status ?? "active"),
          country_code: s.country_code ?? null,
          region_code: s.region_code ?? null,
          city: s.city ?? null,
          mission_kind: "partner",
        });
        if (f) features.push(f);
      }
    }

    if (layers.includes("incidents")) {
      const { data: reports } = await supabase
        .from("driver_map_reports")
        .select("id, latitude, longitude, status, country_code, city")
        .order("created_at", { ascending: false })
        .limit(1000);
      for (const r of reports ?? []) {
        const lat = num(r.latitude);
        const lng = num(r.longitude);
        if (lat == null || lng == null) continue;
        const f = pointFeature(lng, lat, {
          id: String(r.id),
          layer: "incidents",
          label: "Safety report",
          href: `/admin/road-safety`,
          status: String(r.status ?? "open"),
          country_code: r.country_code ?? null,
          city: r.city ?? null,
        });
        if (f) features.push(f);
      }
    }

    if (layers.includes("alerts")) {
      const { data: failedPayouts } = await supabase
        .from("orders")
        .select("id, pickup_lat, pickup_lng, country_code, city, payout_status")
        .eq("payout_status", "failed")
        .limit(500);
      for (const o of failedPayouts ?? []) {
        const lat = num(o.pickup_lat);
        const lng = num(o.pickup_lng);
        if (lat == null || lng == null) continue;
        const f = pointFeature(lng, lat, {
          id: `payout-${o.id}`,
          layer: "alerts",
          label: "Failed payout",
          href: `/admin/payouts/${o.id}`,
          status: "failed_payout",
          country_code: o.country_code ?? null,
          city: o.city ?? null,
        });
        if (f) features.push(f);
      }
    }

    let filtered = features;
    if (country) {
      filtered = filtered.filter((f) => f.properties.country_code === country);
    }
    if (region) {
      filtered = filtered.filter(
        (f) => String(f.properties.region_code ?? "") === region
      );
    }
    if (city) {
      filtered = filtered.filter(
        (f) =>
          String(f.properties.city ?? "").toLowerCase() === city.toLowerCase()
      );
    }
    if (q) {
      const qq = q.toLowerCase();
      filtered = filtered.filter((f) =>
        `${f.properties.label} ${f.properties.status ?? ""}`
          .toLowerCase()
          .includes(qq)
      );
    }

    const { data: countries } = await supabase
      .from("platform_countries")
      .select("country_code, country_name")
      .limit(300);
    const { data: regions } = await supabase
      .from("platform_regions")
      .select("country_code, region_code, region_name, region_type")
      .limit(2000);

    return json({
      ok: true,
      capability,
      generated_at: new Date().toISOString(),
      refresh_seconds: 5,
      collection: { type: "FeatureCollection", features: filtered },
      counts: Object.fromEntries(
        (Object.keys(OPS_MAP_LAYER_META) as OpsMapLayer[]).map((layer) => [
          layer,
          filtered.filter((f) => f.properties.layer === layer).length,
        ])
      ),
      geo: {
        countries: countries ?? [],
        regions: regions ?? [],
        boundaries_provider: "mapbox_admin_boundaries",
        note:
          "Country/state/county/city borders render via Mapbox administrative boundary layers; pins and routes are live operational entities.",
      },
      meta: {
        stale_driver_location_ms: staleMs,
        server_now_ms: now,
      },
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
