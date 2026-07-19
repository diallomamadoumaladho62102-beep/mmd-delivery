import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

const UUID_RE = /^[0-9a-f-]{36}$/i;
const STEPS = new Set(["verified", "approved", "menu_published", "first_order", "phone", "address", "documents"]);

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("loyalty.restaurant.read", request);
    const supabase = buildSupabaseAdminClient();
    const status = String(request.nextUrl.searchParams.get("status") ?? "").trim();

    let query = supabase
      .from("restaurant_referrals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, referrals: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

/**
 * PATCH actions:
 *   action = "mark"     -> set a qualification step / verification flag
 *   action = "qualify"  -> attempt qualification + reward (idempotent)
 *   action = "reject"   -> reject a referral (fraud / ineligible)
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await assertStaffPermission("loyalty.restaurant.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const referredUserId = String(body.referred_user_id ?? "").trim();
    if (!UUID_RE.test(referredUserId)) return json({ ok: false, error: "Invalid referred_user_id" }, 400);
    const action = String(body.action ?? "").trim();

    if (action === "mark") {
      const step = String(body.step ?? "").trim();
      if (!STEPS.has(step)) return json({ ok: false, error: "Invalid step" }, 400);
      const value = body.value !== false;

      const { data, error } = await supabase.rpc("mmd_restaurant_referral_mark", {
        p_referred_user_id: referredUserId,
        p_step: step,
        p_value: value,
      });
      if (error) return json({ ok: false, error: error.message }, 500);

      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: session.userId,
        action: "restaurant_referral_marked",
        targetType: "restaurant_referral",
        targetId: referredUserId,
        metadata: { step, value },
        request,
      });
      return json({ ok: true, result: data });
    }

    if (action === "qualify") {
      const { data, error } = await supabase.rpc("mmd_restaurant_referral_qualify", {
        p_referred_user_id: referredUserId,
      });
      if (error) return json({ ok: false, error: error.message }, 500);

      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: session.userId,
        action: "restaurant_referral_qualified",
        targetType: "restaurant_referral",
        targetId: referredUserId,
        metadata: { result: data },
        request,
      });
      return json({ ok: true, result: data });
    }

    if (action === "reject") {
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : null;
      const { data, error } = await supabase
        .from("restaurant_referrals")
        .update({ status: "rejected", reason })
        .eq("referred_user_id", referredUserId)
        .not("status", "in", "(rewarded,reversed)")
        .select("*")
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);

      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: session.userId,
        action: "restaurant_referral_rejected",
        targetType: "restaurant_referral",
        targetId: referredUserId,
        metadata: { reason },
        request,
      });
      return json({ ok: true, referral: data });
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
