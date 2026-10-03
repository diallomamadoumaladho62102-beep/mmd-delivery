import { NextRequest, NextResponse } from "next/server";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { approveFleetAllocationTransfer } from "@/lib/minimumPay/approveFleetAllocationTransfer";
import { loadMinimumPaySettings } from "@/lib/minimumPay/settingsStore";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("minimum_pay.read", request);
    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from("minimum_pay_adjustments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return json({ ok: false, error: "adjustments_load_failed" }, 500);
    return json({ ok: true, adjustments: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: "forbidden" }, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("minimum_pay.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const reason = String(body.reason ?? "").trim();
    const adjustmentId = String(body.adjustment_id ?? "").trim();

    const settings = await loadMinimumPaySettings(supabase);
    if (settings?.requireChangeReason && !reason) {
      return json({ ok: false, error: "reason_required" }, 400);
    }

    const result = await approveFleetAllocationTransfer(supabase, {
      adjustmentId,
      actorUserId: session.userId,
      actor: `admin:${session.userId}`,
    });

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: result.ok
        ? result.skipped
          ? "minimum_pay_fleet_allocation_approval_skipped"
          : "minimum_pay_fleet_allocation_approved"
        : "minimum_pay_fleet_allocation_approval_failed",
      targetType: "minimum_pay_adjustment",
      targetId: adjustmentId || "unknown",
      metadata: {
        kind: "fleet_allocation",
        reason,
        result,
      },
      request,
    });

    if (!result.ok) {
      const status =
        result.error === "adjustment_not_found"
          ? 404
          : result.error === "not_fleet_allocation" ||
              result.error === "not_pending_approval" ||
              result.error === "shadow_adjustment" ||
              result.error === "zero_adjustment"
            ? 400
            : result.error === "transfer_already_pending" ||
                result.error === "approval_conflict"
              ? 409
              : 400;
      return json(result, status);
    }
    return json(result);
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: "forbidden" }, status);
  }
}
