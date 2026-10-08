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
  type OpsMapFeatureProperties,
  type OpsMapLayer,
  type OpsTimelineStep,
} from "@/lib/adminOpsMap";
import { resolveCcCapability } from "@/lib/adminFeatureFlags";
import {
  mapPool,
  resolveOpsMapDrivingRoute,
  type LatLng,
} from "@/lib/opsMapDirections";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  OPS_LOCATION_STALE_MS,
  buildOpsLiveCenter,
  decorateOpsMission,
  isDriverLocationStale,
  isLiveOpsStatus,
  opsServiceFromKind,
  type OpsSafetyReport,
  type OpsService,
} from "@/lib/opsLiveCenter";

export const dynamic = "force-dynamic";

type PendingOpsRoute = {
  missionId: string;
  waypoints: LatLng[];
  fallbackEtaMinutes: number | null;
  properties: OpsMapFeatureProperties;
};

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
    const pendingRoutes: PendingOpsRoute[] = [];
    const missionDrafts: Array<Parameters<typeof decorateOpsMission>[0]> = [];
    const safetyReports: OpsSafetyReport[] = [];
    const now = Date.now();
    const staleMs = OPS_LOCATION_STALE_MS;
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
        const fresh = loc.updated_at
          ? now - new Date(loc.updated_at).getTime() < staleMs
          : false;
        const mission = onMission.has(id);
        let layer: OpsMapLayer = "drivers_offline";
        // Stale GPS pins are never shown as "online" — only mission keeps them
        // visible as drivers_mission so active trips remain supervisable.
        if (mission) layer = "drivers_mission";
        else if (d.is_online === true && fresh) layer = "drivers_online";
        else if (!fresh && !mission) layer = "drivers_offline";
        if (!layers.includes(layer)) continue;
        const f = pointFeature(loc.lng, loc.lat, {
          id,
          layer,
          label: String(d.full_name ?? "Driver"),
          href: `/admin/drivers?focus=${id}`,
          status: mission
            ? fresh
              ? "on_mission"
              : "on_mission_stale_gps"
            : d.is_online && fresh
              ? "online"
              : fresh
                ? "offline"
                : "stale_gps",
          country_code: d.country_code ?? null,
          region_code: d.state ?? null,
          city: d.city ?? null,
          mission_kind: "driver",
          driver_id: id,
          pin_role: "driver",
          location_updated_at: loc.updated_at || null,
          location_stale: !fresh,
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
          "id, status, kind, client_user_id, driver_id, restaurant_name, pickup_address, dropoff_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, country_code, city, created_at, accepted_at, picked_up_at, delivered_at, payment_status, eta_minutes"
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
        const service = opsServiceFromKind(String(o.kind ?? ""));
        const driverLoc = o.driver_id ? driverLocById.get(String(o.driver_id)) : null;
        const locationUpdatedAt = driverLoc?.updated_at || null;

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
            eta_minutes: null,
            payment_status: o.payment_status ? String(o.payment_status) : null,
            timeline_json: timeline,
            service,
            pin_role: "pickup",
            operation_id: String(o.id),
            location_updated_at: locationUpdatedAt,
            location_stale: o.driver_id
              ? isDriverLocationStale(locationUpdatedAt, now, staleMs)
              : false,
            partner_label: o.restaurant_name ? String(o.restaurant_name) : null,
            pickup_label: o.pickup_address ? String(o.pickup_address) : null,
            dropoff_label: o.dropoff_address ? String(o.dropoff_address) : null,
          });
          if (f) features.push(f);
        }

        if (service && isLiveOpsStatus(String(o.status))) {
          missionDrafts.push({
            id: String(o.id),
            service,
            status: String(o.status),
            href: `/admin/orders/${o.id}`,
            driverId: o.driver_id ? String(o.driver_id) : null,
            clientId: o.client_user_id ? String(o.client_user_id) : null,
            partnerLabel: o.restaurant_name ? String(o.restaurant_name) : null,
            pickupLabel: o.pickup_address ? String(o.pickup_address) : null,
            dropoffLabel: o.dropoff_address ? String(o.dropoff_address) : null,
            etaMinutes: null,
            etaSource: null,
            locationUpdatedAt,
            driverAssigned: Boolean(o.driver_id),
            lat: orderLat,
            lng: orderLng,
            timeline: orderTimeline(o),
            updatedAt: String(o.accepted_at ?? o.created_at ?? "") || null,
            nowMs: now,
          });
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
            service,
            pin_role: "destination",
            operation_id: String(o.id),
            dropoff_label: o.dropoff_address ? String(o.dropoff_address) : null,
          });
          if (f) features.push(f);
        }

        if (layers.includes("routes") && !pending) {
          const waypoints: LatLng[] = [];
          if (driverLoc) {
            waypoints.push({ lat: driverLoc.lat, lng: driverLoc.lng });
          }
          if (pickupLng != null && pickupLat != null) {
            waypoints.push({ lat: pickupLat, lng: pickupLng });
          }
          if (dropLng != null && dropLat != null) {
            waypoints.push({ lat: dropLat, lng: dropLng });
          }
          if (waypoints.length >= 2) {
            pendingRoutes.push({
              missionId: `order-${o.id}`,
              waypoints,
              fallbackEtaMinutes: num(o.eta_minutes),
              properties: {
                id: `route-order-${o.id}`,
                layer: "routes",
                label: `Route order ${String(o.id).slice(0, 8)}`,
                href: `/admin/orders/${o.id}`,
                status: String(o.status),
                mission_kind: "order",
                driver_id: o.driver_id ? String(o.driver_id) : null,
                client_id: o.client_user_id ? String(o.client_user_id) : null,
                eta_minutes: num(o.eta_minutes),
                payment_status: o.payment_status
                  ? String(o.payment_status)
                  : null,
                timeline_json: timeline,
                country_code: o.country_code ?? null,
                city: o.city ?? null,
                service,
                operation_id: String(o.id),
              },
            });
          }
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
            eta_minutes: null,
            payment_status: r.payment_status
              ? String(r.payment_status)
              : null,
            timeline_json: timeline,
            service: "taxi",
            pin_role: "pickup",
            operation_id: String(r.id),
            location_updated_at: r.driver_id
              ? driverLocById.get(String(r.driver_id))?.updated_at ?? null
              : null,
            location_stale: r.driver_id
              ? isDriverLocationStale(
                  driverLocById.get(String(r.driver_id))?.updated_at,
                  now,
                  staleMs,
                )
              : false,
          });
          if (f) features.push(f);
        }

        if (isLiveOpsStatus(String(r.status))) {
          const taxiLoc = r.driver_id ? driverLocById.get(String(r.driver_id)) : null;
          missionDrafts.push({
            id: String(r.id),
            service: "taxi",
            status: String(r.status),
            href: `/admin/taxi-rides?focus=${r.id}`,
            driverId: r.driver_id ? String(r.driver_id) : null,
            clientId: r.client_user_id ? String(r.client_user_id) : null,
            partnerLabel: null,
            pickupLabel: null,
            dropoffLabel: null,
            etaMinutes: null,
            etaSource: null,
            locationUpdatedAt: taxiLoc?.updated_at ?? null,
            driverAssigned: Boolean(r.driver_id),
            lat: pickupLat,
            lng: pickupLng,
            timeline: taxiTimeline(r),
            updatedAt: String(r.accepted_at ?? r.created_at ?? "") || null,
            nowMs: now,
          });
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
            service: "taxi",
            pin_role: "destination",
            operation_id: String(r.id),
          });
          if (f) features.push(f);
        }

        if (layers.includes("routes")) {
          const driverLoc = r.driver_id
            ? driverLocById.get(String(r.driver_id))
            : null;
          const waypoints: LatLng[] = [];
          if (driverLoc) {
            waypoints.push({ lat: driverLoc.lat, lng: driverLoc.lng });
          }
          if (pickupLng != null && pickupLat != null) {
            waypoints.push({ lat: pickupLat, lng: pickupLng });
          }
          if (dropLng != null && dropLat != null) {
            waypoints.push({ lat: dropLat, lng: dropLng });
          }
          if (waypoints.length >= 2) {
            pendingRoutes.push({
              missionId: `taxi-${r.id}`,
              waypoints,
              fallbackEtaMinutes: eta,
              properties: {
                id: `route-taxi-${r.id}`,
                layer: "routes",
                label: `Route taxi ${String(r.id).slice(0, 8)}`,
                href: `/admin/taxi-rides?focus=${r.id}`,
                status: String(r.status),
                mission_kind: "taxi",
                driver_id: r.driver_id ? String(r.driver_id) : null,
                client_id: r.client_user_id
                  ? String(r.client_user_id)
                  : null,
                eta_minutes: eta,
                payment_status: r.payment_status
                  ? String(r.payment_status)
                  : null,
                timeline_json: timeline,
                country_code: r.country_code ?? null,
                service: "taxi",
                operation_id: String(r.id),
              },
            });
          }
        }
      }
    }

    if (layers.some((l) => ["orders_active", "orders_pending", "clients", "routes"].includes(l))) {
      const { data: deliveries } = await supabase
        .from("delivery_requests")
        .select(
          "id, status, client_user_id, driver_id, pickup_address, dropoff_address, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, eta_minutes, created_at, payment_status"
        )
        .in("status", [
          "pending",
          "paid",
          "accepted",
          "dispatched",
          "ready",
          "picked_up",
          "in_transit",
          "en_route",
          "in_progress",
        ])
        .limit(1500);

      for (const d of deliveries ?? []) {
        if (!isLiveOpsStatus(String(d.status))) continue;
        const operationId = `dr:${d.id}`;
        const pickupLat = num(d.pickup_lat);
        const pickupLng = num(d.pickup_lng);
        const dropLat = num(d.dropoff_lat);
        const dropLng = num(d.dropoff_lng);
        const driverLoc = d.driver_id ? driverLocById.get(String(d.driver_id)) : null;
        const timelineSteps = orderTimeline({
          created_at: d.created_at,
          driver_id: d.driver_id,
          status: d.status,
          payment_status: d.payment_status,
        });
        const timeline = encodeTimeline(timelineSteps);
        const service: OpsService = "delivery";
        if (pickupLat != null && pickupLng != null) {
          const f = pointFeature(pickupLng, pickupLat, {
            id: `delivery-${d.id}`,
            layer: "orders_active",
            label: `Delivery ${String(d.id).slice(0, 8)}`,
            href: `/admin/delivery-requests?focus=${d.id}`,
            status: String(d.status),
            mission_kind: "order",
            driver_id: d.driver_id ? String(d.driver_id) : null,
            client_id: d.client_user_id ? String(d.client_user_id) : null,
            eta_minutes: null,
            payment_status: d.payment_status ? String(d.payment_status) : null,
            timeline_json: timeline,
            service,
            pin_role: "pickup",
            operation_id: operationId,
            location_updated_at: driverLoc?.updated_at ?? null,
            location_stale: d.driver_id
              ? isDriverLocationStale(driverLoc?.updated_at, now, staleMs)
              : false,
            pickup_label: d.pickup_address ? String(d.pickup_address) : null,
            dropoff_label: d.dropoff_address ? String(d.dropoff_address) : null,
          });
          if (f) features.push(f);
        }
        if (dropLat != null && dropLng != null && layers.includes("clients")) {
          const f = pointFeature(dropLng, dropLat, {
            id: `delivery-dest-${d.id}`,
            layer: "clients",
            label: `Delivery ${String(d.id).slice(0, 8)}`,
            href: `/admin/delivery-requests?focus=${d.id}`,
            status: String(d.status),
            mission_kind: "client",
            service,
            pin_role: "destination",
            operation_id: operationId,
            client_id: d.client_user_id ? String(d.client_user_id) : null,
            driver_id: d.driver_id ? String(d.driver_id) : null,
          });
          if (f) features.push(f);
        }
        missionDrafts.push({
          id: operationId,
          service,
          status: String(d.status),
          href: `/admin/delivery-requests?focus=${d.id}`,
          driverId: d.driver_id ? String(d.driver_id) : null,
          clientId: d.client_user_id ? String(d.client_user_id) : null,
          partnerLabel: null,
          pickupLabel: d.pickup_address ? String(d.pickup_address) : null,
          dropoffLabel: d.dropoff_address ? String(d.dropoff_address) : null,
          etaMinutes: null,
          etaSource: null,
          locationUpdatedAt: driverLoc?.updated_at ?? null,
          driverAssigned: Boolean(d.driver_id),
          lat: pickupLat,
          lng: pickupLng,
          timeline: timelineSteps,
          updatedAt: String(d.created_at ?? "") || null,
          nowMs: now,
        });
        if (layers.includes("routes")) {
          const waypoints: LatLng[] = [];
          if (driverLoc) waypoints.push({ lat: driverLoc.lat, lng: driverLoc.lng });
          if (pickupLat != null && pickupLng != null) {
            waypoints.push({ lat: pickupLat, lng: pickupLng });
          }
          if (dropLat != null && dropLng != null) {
            waypoints.push({ lat: dropLat, lng: dropLng });
          }
          if (waypoints.length >= 2) {
            pendingRoutes.push({
              missionId: `delivery-${d.id}`,
              waypoints,
              fallbackEtaMinutes: num(d.eta_minutes),
              properties: {
                id: `route-delivery-${d.id}`,
                layer: "routes",
                label: `Route delivery ${String(d.id).slice(0, 8)}`,
                href: `/admin/delivery-requests?focus=${d.id}`,
                status: String(d.status),
                mission_kind: "order",
                service,
                operation_id: operationId,
                driver_id: d.driver_id ? String(d.driver_id) : null,
                client_id: d.client_user_id ? String(d.client_user_id) : null,
                eta_minutes: null,
                timeline_json: timeline,
              },
            });
          }
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
        .select("id, latitude, longitude, status, country_code, city, created_at")
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
          pin_role: "attention",
          service: null,
        });
        if (f) features.push(f);
        safetyReports.push({
          id: String(r.id),
          label: "Safety report",
          status: String(r.status ?? "open"),
          at: r.created_at ? String(r.created_at) : null,
          lat,
          lng,
        });
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

    if (pendingRoutes.length > 0) {
      const resolved = await mapPool(pendingRoutes, 6, async (job) => {
        const route = await resolveOpsMapDrivingRoute({
          missionId: job.missionId,
          waypoints: job.waypoints,
          fallbackEtaMinutes: job.fallbackEtaMinutes,
        });
        return lineStringFeature(route.coordinates, {
          ...job.properties,
          eta_minutes: route.etaMinutes ?? job.fallbackEtaMinutes,
          route_source: route.source,
        });
      });
      for (const route of resolved) {
        if (!route || route.properties.route_source === "straight") continue;
        features.push(route);
        const operationId = route.properties.operation_id;
        if (!operationId) continue;
        const draft = missionDrafts.find((item) => item.id === operationId);
        if (!draft) continue;
        draft.etaMinutes = route.properties.eta_minutes ?? null;
        draft.etaSource = route.properties.route_source ?? null;
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
        `${f.properties.id} ${f.properties.operation_id ?? ""} ${f.properties.label} ${f.properties.status ?? ""} ${f.properties.driver_id ?? ""} ${f.properties.client_id ?? ""}`
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

    const center = buildOpsLiveCenter({
      missions: missionDrafts.map((draft) => decorateOpsMission(draft)),
      safety: safetyReports,
      nowMs: now,
    });

    return json({
      ok: true,
      capability,
      generated_at: new Date().toISOString(),
      center,
      // Routes use cached Directions; slightly slower poll reduces Mapbox burn.
      refresh_seconds: layers.includes("routes") ? 8 : 5,
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
        routes_directions: layers.includes("routes"),
        routes_pending: pendingRoutes.length,
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
