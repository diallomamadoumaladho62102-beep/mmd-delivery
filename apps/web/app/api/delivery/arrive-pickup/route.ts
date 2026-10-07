import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  findDeliveryPickupArrivalEvent,
  recordDeliveryPickupArrival,
  type DeliveryStageEntityType,
} from "@/lib/deliveryDriverStageEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function getBearer(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function parseEntityType(value: unknown): DeliveryStageEntityType | null {
  const raw = String(value ?? "").trim();
  return raw === "order" || raw === "delivery_request" ? raw : null;
}

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
    { auth: { persistSession: false } },
  );
}

async function requireDriver(req: NextRequest) {
  const token = getBearer(req);
  if (!token) return { error: json({ error: "Missing Authorization Bearer token" }, 401) };

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.id) {
    return { error: json({ error: "Invalid token" }, 401) };
  }
  return { driverUserId: data.user.id, supabaseAdmin: getAdminClient() };
}

export async function GET(req: NextRequest) {
  const auth = await requireDriver(req);
  if ("error" in auth) return auth.error;

  const entityType = parseEntityType(req.nextUrl.searchParams.get("entity_type"));
  const entityId = String(req.nextUrl.searchParams.get("entity_id") ?? "").trim();
  if (!entityType || !entityId) {
    return json({ error: "entity_type_and_entity_id_required" }, 400);
  }

  const found = await findDeliveryPickupArrivalEvent(
    auth.supabaseAdmin,
    entityType,
    entityId,
  );
  if ("error" in found && found.error) {
    return json({ error: found.error }, 500);
  }

  return json({
    ok: true,
    arrived: Boolean(found.event?.id),
    arrived_at: found.event?.created_at ?? null,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireDriver(req);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => ({}));
  const entityType = parseEntityType(body.entity_type);
  const entityId = String(body.entity_id ?? "").trim();
  const driverLat = Number(body.driver_lat);
  const driverLng = Number(body.driver_lng);

  if (!entityType || !entityId) {
    return json({ error: "entity_type_and_entity_id_required" }, 400);
  }

  const result = await recordDeliveryPickupArrival({
    supabaseAdmin: auth.supabaseAdmin,
    entityType,
    entityId,
    driverUserId: auth.driverUserId,
    driverLat: Number.isFinite(driverLat) ? driverLat : null,
    driverLng: Number.isFinite(driverLng) ? driverLng : null,
  });

  if (result.ok === false) {
    return json({ error: result.error }, result.status);
  }

  return json(result);
}
