import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertCanModifyPricing } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertCanModifyPricing(request);
    const supabase = buildSupabaseAdminClient();

    const body = (await request.json().catch(() => ({}))) as {
      historyId?: string;
    };

    const historyId = String(body.historyId ?? "").trim();
    if (!historyId) return json({ ok: false, error: "historyId required" }, 400);

    const { data: history, error: histErr } = await supabase
      .from("pricing_config_history")
      .select("id, pricing_config_id, old_values, new_values, created_at")
      .eq("id", historyId)
      .maybeSingle();

    if (histErr || !history) {
      return json({ ok: false, error: "History row not found" }, 404);
    }

    const rollbackPayload = history.old_values as Record<string, unknown>;
    if (!rollbackPayload || typeof rollbackPayload !== "object") {
      return json({ ok: false, error: "Invalid history old_values" }, 400);
    }

    const { data: before, error: readErr } = await supabase
      .from("pricing_config")
      .select("*")
      .eq("id", history.pricing_config_id)
      .maybeSingle();

    if (readErr || !before) {
      return json({ ok: false, error: "pricing_config not found" }, 404);
    }

    const allowedKeys = Object.keys(before).filter(
      (k) => !["id", "config_key", "label", "order_type", "created_at"].includes(k)
    );

    const update: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      if (key in rollbackPayload) {
        update[key] = rollbackPayload[key];
      }
    }
    update.updated_at = new Date().toISOString();

    const { data: updated, error: updErr } = await supabase
      .from("pricing_config")
      .update(update)
      .eq("id", history.pricing_config_id)
      .select("*")
      .single();

    if (updErr) return json({ ok: false, error: updErr.message }, 500);

    await supabase.from("pricing_config_history").insert({
      pricing_config_id: history.pricing_config_id,
      changed_by: session.userId,
      old_values: before,
      new_values: update,
      change_type: "rollback",
    });

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "pricing_rollback",
      targetType: "pricing_config",
      targetId: history.pricing_config_id,
      oldValues: before as Record<string, unknown>,
      newValues: update,
      metadata: { rolled_back_from_history_id: historyId },
      request,
    });

    return json({ ok: true, item: updated });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
