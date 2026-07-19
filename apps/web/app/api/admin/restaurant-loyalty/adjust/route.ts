import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { buildRestaurantLoyaltySummary } from "@/lib/loyalty/restaurantLoyaltyApi";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * Manual restaurant loyalty operations, all requiring a reason and auditable:
 *   action = "adjust_points"      -> add/remove points (compensating ledger row)
 *   action = "set_status"         -> suspend / reactivate the loyalty account
 *   action = "cancel_redemption"  -> void a fraudulent reward (+ optional claw-back)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("loyalty.restaurant.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const action = String(body.action ?? "adjust_points").trim();
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (!reason) return json({ ok: false, error: "Reason is required" }, 400);

    if (action === "adjust_points") {
      const userId = String(body.user_id ?? "").trim();
      if (!UUID_RE.test(userId)) return json({ ok: false, error: "Invalid user_id" }, 400);
      const delta = Math.round(Number(body.delta_points ?? 0));
      if (!Number.isFinite(delta) || delta === 0) return json({ ok: false, error: "Invalid delta_points" }, 400);

      const { data, error } = await supabase.rpc("mmd_restaurant_loyalty_admin_adjust", {
        p_admin_user_id: session.userId,
        p_restaurant_user_id: userId,
        p_delta_points: delta,
        p_reason: reason,
      });
      if (error) return json({ ok: false, error: error.message }, 500);
      const result = (data ?? {}) as Record<string, unknown>;
      if (result.ok === false) return json({ ok: false, ...result }, 400);

      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: session.userId,
        action: "restaurant_loyalty_points_adjusted",
        targetType: "loyalty_account",
        targetId: userId,
        metadata: { delta_points: delta, reason, result },
        request,
      });

      const summary = await buildRestaurantLoyaltySummary(supabase, userId);
      return json({ ok: true, result, summary });
    }

    if (action === "set_status") {
      const userId = String(body.user_id ?? "").trim();
      if (!UUID_RE.test(userId)) return json({ ok: false, error: "Invalid user_id" }, 400);
      const nextStatus = String(body.status ?? "").trim();
      if (nextStatus !== "active" && nextStatus !== "suspended") {
        return json({ ok: false, error: "Invalid status" }, 400);
      }

      const { data, error } = await supabase.rpc("mmd_restaurant_loyalty_set_account_status", {
        p_admin_user_id: session.userId,
        p_restaurant_user_id: userId,
        p_status: nextStatus,
        p_reason: reason,
      });
      if (error) return json({ ok: false, error: error.message }, 500);
      const result = (data ?? {}) as Record<string, unknown>;
      if (result.ok === false) return json({ ok: false, ...result }, 400);

      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: session.userId,
        action: "restaurant_loyalty_account_status_changed",
        targetType: "loyalty_account",
        targetId: userId,
        metadata: { status: nextStatus, reason },
        request,
      });

      return json({ ok: true, result });
    }

    if (action === "cancel_redemption") {
      const redemptionId = String(body.redemption_id ?? "").trim();
      if (!UUID_RE.test(redemptionId)) return json({ ok: false, error: "Invalid redemption_id" }, 400);
      const reversePoints = body.reverse_points === true;

      const { data, error } = await supabase.rpc("mmd_restaurant_cancel_redemption", {
        p_admin_user_id: session.userId,
        p_redemption_id: redemptionId,
        p_reason: reason,
        p_reverse_points: reversePoints,
      });
      if (error) return json({ ok: false, error: error.message }, 500);
      const result = (data ?? {}) as Record<string, unknown>;
      if (result.ok === false) return json({ ok: false, ...result }, 400);

      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: session.userId,
        action: "restaurant_reward_canceled",
        targetType: "restaurant_loyalty_redemption",
        targetId: redemptionId,
        metadata: { reason, reverse_points: reversePoints, result },
        request,
      });

      return json({ ok: true, result });
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
