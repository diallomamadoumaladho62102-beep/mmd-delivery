import { NextRequest } from "next/server";
import { requireDriver } from "@/lib/driverServicePreferencesAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const vehicleId = String(body.vehicle_id ?? body.vehicleId ?? "").trim();
  if (!vehicleId) return json({ ok: false, error: "vehicle_id_required" }, 400);

  const { data, error } = await auth.supabaseAdmin.rpc("set_driver_active_vehicle", {
    p_driver_user_id: auth.userId,
    p_vehicle_id: vehicleId,
  });

  if (error) return json({ ok: false, error: error.message }, 500);

  const result = data as { ok?: boolean; message?: string; active_vehicle_id?: string };
  if (!result?.ok) {
    const code = String(result?.message ?? "set_active_failed");
    const messages: Record<string, string> = {
      must_be_offline: "Passez hors ligne pour changer de véhicule actif.",
      active_ride_in_progress: "Impossible de changer de véhicule pendant une course.",
      vehicle_not_active: "Ce véhicule n'est pas actif ou approuvé.",
      vehicle_not_found: "Véhicule introuvable.",
    };
    return json(
      { ok: false, error: code, message: messages[code] ?? code },
      code === "vehicle_not_found" ? 404 : 400,
    );
  }

  return json({ ok: true, active_vehicle_id: result.active_vehicle_id ?? vehicleId });
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}
