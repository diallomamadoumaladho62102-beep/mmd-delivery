import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertCanModifyPricing } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import {
  PAYOUT_METHOD_SELECT,
  buildAdminPayoutMethodView,
  validatePayoutMethodPatch,
  type PayoutMethodPatchInput,
} from "@/lib/adminPayoutMethods";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type { PayoutMethodRow } from "@/lib/payoutTypes";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await assertCanModifyPricing(request);
    const { id } = await context.params;
    const payoutMethodId = String(id ?? "").trim();
    if (!payoutMethodId) {
      return json({ ok: false, error: "missing_payout_method_id" }, 400);
    }

    const body = (await request.json().catch(() => ({}))) as PayoutMethodPatchInput;
    const supabase = buildSupabaseAdminClient();

    const { data: existing, error: readErr } = await supabase
      .from("payout_methods")
      .select(PAYOUT_METHOD_SELECT)
      .eq("id", payoutMethodId)
      .maybeSingle();

    if (readErr) return json({ ok: false, error: readErr.message }, 500);
    if (!existing) return json({ ok: false, error: "payout_method_not_found" }, 404);

    const validated = validatePayoutMethodPatch(existing as PayoutMethodRow, body);
    if (validated.ok === false) {
      return json({ ok: false, error: validated.error }, 400);
    }

    const { data: updated, error: updateErr } = await supabase
      .from("payout_methods")
      .update(validated.update)
      .eq("id", payoutMethodId)
      .select(PAYOUT_METHOD_SELECT)
      .single();

    if (updateErr || !updated) {
      return json({ ok: false, error: updateErr?.message ?? "update_failed" }, 500);
    }

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "payout_methods.update",
      targetType: "payout_method",
      targetId: payoutMethodId,
      oldValues: existing as Record<string, unknown>,
      newValues: updated as Record<string, unknown>,
      metadata: {
        country_code: existing.country_code,
        recipient_type: existing.recipient_type,
        method_code: existing.method_code,
      },
      request,
    });

    return json({
      ok: true,
      item: buildAdminPayoutMethodView(updated as PayoutMethodRow),
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
