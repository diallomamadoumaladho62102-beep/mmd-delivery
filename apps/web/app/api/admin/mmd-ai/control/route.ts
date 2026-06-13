import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageMmdAi,
  assertStaffPermission,
} from "@/lib/adminServer";
import { getAiDailyCostCapUsdEnv, isAiEmergencyStopEnv } from "@/lib/ai/aiConfig";
import { getAiAdminControlSnapshot } from "@/lib/ai/aiScopeGate";
import { fetchAiRuntimeSettings, upsertAiRuntimeSetting } from "@/lib/ai/aiRuntimeSettings";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("mmd_ai.read", request);
    const supabase = buildSupabaseAdminClient();
    const control = await getAiAdminControlSnapshot(supabase);
    return json({ ok: true, control });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertCanManageMmdAi(request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const before = await fetchAiRuntimeSettings(supabase);

    if (typeof body.emergency_stop === "boolean") {
      if (isAiEmergencyStopEnv()) {
        return json(
          {
            ok: false,
            error: "AI_EMERGENCY_STOP env is active — disable env flag to release stop.",
          },
          409
        );
      }

      await upsertAiRuntimeSetting({
        supabaseAdmin: supabase,
        key: "emergency_stop",
        value: { enabled: body.emergency_stop },
        updatedBy: session.userId,
      });
    }

    if (body.daily_cost_cap_usd !== undefined) {
      const amount = Number(body.daily_cost_cap_usd);
      const normalized =
        Number.isFinite(amount) && amount > 0 ? amount : null;
      await upsertAiRuntimeSetting({
        supabaseAdmin: supabase,
        key: "daily_cost_cap_usd",
        value: { amount: normalized },
        updatedBy: session.userId,
      });
    }

    const after = await fetchAiRuntimeSettings(supabase);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "mmd_ai_control_updated",
      targetType: "ai_runtime_settings",
      targetId: "control",
      oldValues: before as unknown as Record<string, unknown>,
      newValues: after as unknown as Record<string, unknown>,
      request,
    });

    const control = await getAiAdminControlSnapshot(supabase);
    return json({
      ok: true,
      control,
      note:
        control.globalEnabled === false
          ? "AI_ASSISTANT_ENABLED is still false — global activation required separately."
          : undefined,
      envCostCapUsd: getAiDailyCostCapUsdEnv(),
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
