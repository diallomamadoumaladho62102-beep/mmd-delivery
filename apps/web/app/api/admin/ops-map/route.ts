import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertStaffPermission,
} from "@/lib/adminServer";
import {
  OPS_MAP_LAYER_META,
  pointFeature,
  type OpsMapFeature,
  type OpsMapLayer,
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

    // Drivers + locations
    if (
      layers.some((l) =>
        ["drivers_online", "drivers_offline", "drivers_mission"].includes(l)
      )
    ) {
      const { data: drivers } = await supabase
        .from("driver_profiles")
        .select("user_id, is_online, full_name, city, state, country_code")
        .limit(5000);

      const driverIds = (drivers ?? []).map((d) => String(d.user_id));
      const locById = new Map<string, { lat: number; lng: number; updated_at: string }>();
      if (driverIds.length) {
        const { data: locs } = await supabase
          .from("driver_locations")
          .select("driver_id, lat, lng, updated_at")
          .in("driver_id", driverIds.slice(0, 5000));
        for (const loc of locs ?? []) {
          const lat = num(loc.lat);
          const lng = num(loc.lng);
          if (lat == null || lng == null) continue;
          locById.set(String(loc.driver_id), {
            lat,
            lng,
            updated_at: String(loc.updated_at ?? ""),
          });
        }
      }

      // Active mission heuristic: assigned open food orders or taxi rides
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
        .in("status", ["accepted", "arriving", "in_progress", "started"])
        .limit(3000);
      for (const r of activeRides ?? []) {
        if (r.driver_id) onMission.add(String(r.driver_id));
      }

      for (const d of drivers ?? []) {
        const id = String(d.user_id);
        const loc = locById.get(id);
        if (!loc) continue;
        const fresh = loc.updated_at
          ? now - new Date(loc.updated_at).getTime() < staleMs
          : false;
        const mission = onMission.has(id);
        let layer: OpsMapLayer = "drivers_offline";
        if (mission) layer = "drivers_mission";
        else if (d.is_online === true && fresh) layer = "drivers_online";
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
        });
        if (f) features.push(f);
      }
    }

    // Orders
    if (layers.some((l) => l === "orders_pending" || l === "orders_active")) {
      const { data: orders } = await supabase
        .from("orders")
        .select(
          "id, status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, country_code, city"
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
        if (!layers.includes(layer)) continue;
        const lat = num(o.pickup_lat) ?? num(o.dropoff_lat);
        const lng = num(o.pickup_lng) ?? num(o.dropoff_lng);
        if (lat == null || lng == null) continue;
        const f = pointFeature(lng, lat, {
          id: String(o.id),
          layer,
          label: `Order ${String(o.id).slice(0, 8)}`,
          href: `/admin/orders/${o.id}`,
          status: String(o.status),
          country_code: o.country_code ?? null,
          city: o.city ?? null,
        });
        if (f) features.push(f);
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
        });
        if (f) features.push(f);
      }
    }

    // Sellers — no lat/lng in schema; geocode city+country via location_points if available
    if (layers.includes("sellers")) {
      const { data: sellers } = await supabase
        .from("sellers")
        .select("id, store_name, city, country_code, region_code, status")
        .limit(2000);
      const cities = Array.from(
        new Set(
          (sellers ?? [])
            .map((s) => `${s.country_code ?? ""}|${s.city ?? ""}`.toLowerCase())
            .filter((k) => !k.endsWith("|") && !k.startsWith("|"))
        )
      );
      const cityCoords = new Map<string, { lat: number; lng: number }>();
      if (cities.length) {
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
        });
        if (f) features.push(f);
      }
    }

    // Safety incidents / map reports
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

    // Critical alerts as dispatch/payout hotspots (order coords when available)
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

    // Geo hierarchy metadata for filters (no polygon geometry stored — Mapbox admin boundaries used client-side)
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
      refresh_seconds: 15,
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
          "Country/state/county/city borders render via Mapbox administrative boundary layers; pins are live operational entities.",
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
