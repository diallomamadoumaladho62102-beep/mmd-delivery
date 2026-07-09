import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { createClient } from "@supabase/supabase-js";
import {
  notifyDriverEligibilityTransitions,
} from "@/lib/driverPushNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function isCronAuthorized(request: NextRequest): boolean {
  return isAuthorizedCronRequest(request);
}

export async function GET(request: NextRequest) {
  return runVehicleEligibilityRefresh(request);
}

export async function POST(request: NextRequest) {
  return runVehicleEligibilityRefresh(request);
}

async function runVehicleEligibilityRefresh(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: vehicles, error } = await supabase
    .from("driver_vehicles")
    .select("id, driver_user_id")
    .eq("vehicle_active", true);

  if (error) return json({ ok: false, error: error.message }, 500);

  let processed = 0;
  let notificationsSent = 0;

  for (const vehicle of vehicles ?? []) {
    const vehicleId = String(vehicle.id);
    const driverUserId = String(vehicle.driver_user_id);

    const { data: beforeRows } = await supabase
      .from("vehicle_category_eligibility")
      .select("category, status, reason_message")
      .eq("vehicle_id", vehicleId);

    const { data: recalc, error: recalcError } = await supabase.rpc(
      "recalculate_vehicle_category_eligibility",
      { p_vehicle_id: vehicleId },
    );

    if (recalcError) {
      console.log("[cron vehicle eligibility] recalc error:", recalcError.message);
      continue;
    }

    processed += 1;
    const payload = recalc as {
      before?: Array<{ category: string; status: string; reason_message?: string | null }>;
      after?: Array<{ category: string; status: string; reason_message?: string | null }>;
    };

    notificationsSent += await notifyDriverEligibilityTransitions({
      supabaseAdmin: supabase,
      driverUserId,
      before: payload.before ?? beforeRows ?? [],
      after: payload.after ?? [],
    });
  }

  return json({
    ok: true,
    processed,
    notifications_sent: notificationsSent,
    year: new Date().getFullYear(),
    ran_at: new Date().toISOString(),
  });
}
