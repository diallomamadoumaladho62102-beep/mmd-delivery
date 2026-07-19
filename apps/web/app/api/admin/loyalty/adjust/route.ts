import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { buildLoyaltySummary, normalizeLoyaltyRole } from "@/lib/loyalty/loyaltyUserApi";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("loyalty.read", request);
    const supabase = buildSupabaseAdminClient();
    const userId = String(request.nextUrl.searchParams.get("userId") ?? "").trim();
    if (!userId || !UUID_RE.test(userId)) {
      return json({ ok: false, error: "Missing or invalid userId" }, 400);
    }

    const role = normalizeLoyaltyRole(request.nextUrl.searchParams.get("role"));
    const summary = await buildLoyaltySummary(supabase, userId, role);
    return json({ ok: true, summary });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("loyalty.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const userId = String(body.user_id ?? body.userId ?? "").trim();
    const kind = String(body.kind ?? "points").trim();
    const role = normalizeLoyaltyRole(body.role);
    const reason =
      typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : null;

    if (!userId || !UUID_RE.test(userId)) {
      return json({ ok: false, error: "Missing or invalid user_id" }, 400);
    }

    if (kind === "credit") {
      const deltaCents = Math.round(Number(body.delta_cents ?? body.deltaCents ?? 0));
      if (!Number.isFinite(deltaCents) || deltaCents === 0) {
        return json({ ok: false, error: "Invalid delta_cents" }, 400);
      }
      const { data, error } = await supabase.rpc("mmd_credit_admin_adjust", {
        p_admin_user_id: session.userId,
        p_user_id: userId,
        p_delta_cents: deltaCents,
        p_reason: reason,
      });
      if (error) return json({ ok: false, error: error.message }, 500);
      const result = (data ?? {}) as Record<string, unknown>;
      if (result.ok === false) return json({ ok: false, ...result }, 400);

      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: session.userId,
        action: "loyalty_credit_adjusted",
        targetType: "mmd_credit_wallet",
        targetId: userId,
        metadata: { delta_cents: deltaCents, reason, result },
        request,
      });

      const summary = await buildLoyaltySummary(supabase, userId, role);
      return json({ ok: true, result, summary });
    }

    // default: points adjustment
    const deltaPoints = Math.round(Number(body.delta_points ?? body.deltaPoints ?? 0));
    if (!Number.isFinite(deltaPoints) || deltaPoints === 0) {
      return json({ ok: false, error: "Invalid delta_points" }, 400);
    }

    const { data, error } = await supabase.rpc("mmd_loyalty_admin_adjust", {
      p_admin_user_id: session.userId,
      p_user_id: userId,
      p_delta_points: deltaPoints,
      p_reason: reason,
      p_role: role,
    });
    if (error) return json({ ok: false, error: error.message }, 500);
    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok === false) return json({ ok: false, ...result }, 400);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "loyalty_points_adjusted",
      targetType: "loyalty_account",
      targetId: userId,
      metadata: { delta_points: deltaPoints, role, reason, result },
      request,
    });

    const summary = await buildLoyaltySummary(supabase, userId, role);
    return json({ ok: true, result, summary });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
