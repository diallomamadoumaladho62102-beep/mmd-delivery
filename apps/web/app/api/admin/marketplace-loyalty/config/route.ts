import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("loyalty.marketplace.read", request);
    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from("marketplace_loyalty_settings")
      .select("*")
      .eq("singleton", true)
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, settings: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("loyalty.marketplace.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    for (const key of ["referral_points_referrer", "referral_points_referred"]) {
      if (body[key] !== undefined) {
        const n = Math.round(Number(body[key]));
        if (!Number.isFinite(n) || n < 0) return json({ ok: false, error: `Invalid ${key}` }, 400);
        patch[key] = n;
      }
    }
    if (typeof body.currency === "string" && body.currency.trim()) {
      patch.currency = body.currency.trim().slice(0, 8).toUpperCase();
    }
    if (Object.keys(patch).length === 0) {
      return json({ ok: false, error: "No valid fields to update" }, 400);
    }

    const { data, error } = await supabase
      .from("marketplace_loyalty_settings")
      .update(patch)
      .eq("singleton", true)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "marketplace_loyalty_config_updated",
      targetType: "marketplace_loyalty_settings",
      targetId: "singleton",
      metadata: { patch },
      request,
    });

    return json({ ok: true, settings: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
