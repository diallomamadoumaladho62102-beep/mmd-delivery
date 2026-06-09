import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageTaxiRides,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_rides.read", request);
    const supabase = buildSupabaseAdminClient();
    const userId = String(request.nextUrl.searchParams.get("userId") ?? "").trim();

    let query = supabase
      .from("taxi_loyalty_accounts")
      .select(
        "user_id, points_balance, lifetime_points, tier, created_at, updated_at"
      )
      .order("updated_at", { ascending: false })
      .limit(100);

    if (userId) {
      query = query.eq("user_id", userId);
    }

    const { data, error } = await query;

    if (error) return json({ ok: false, error: error.message }, 500);

    return json({ ok: true, items: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertCanManageTaxiRides(request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const userId = String(body.user_id ?? body.userId ?? "").trim();
    const deltaPoints = Math.round(Number(body.delta_points ?? body.deltaPoints ?? 0));
    const description =
      typeof body.description === "string" ? body.description.trim() : null;

    if (!userId) return json({ ok: false, error: "Missing user_id" }, 400);
    if (!Number.isFinite(deltaPoints) || deltaPoints === 0) {
      return json({ ok: false, error: "Invalid delta_points" }, 400);
    }

    const { data, error } = await supabase.rpc("adjust_taxi_loyalty_account", {
      p_user_id: userId,
      p_delta_points: deltaPoints,
      p_description: description,
      p_admin_id: session.userId,
    });

    if (error) return json({ ok: false, error: error.message }, 500);

    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok === false) {
      return json({ ok: false, ...result }, 400);
    }

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "taxi_loyalty_adjusted",
      targetType: "taxi_loyalty_account",
      targetId: userId,
      metadata: { delta_points: deltaPoints, description, result },
      request,
    });

    return json({ ok: true, ...result });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
